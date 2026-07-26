import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';

import { FixedWindowRateLimiter } from '../operational-controls.js';
import type { BnbAppConfig } from './config.js';

export interface BnbHttpApp {
  app: express.Express;
  getActiveHttpRequests(): number;
  limitAiRequests(req: Request, res: Response, next: NextFunction): void;
}

export function safeErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return error.message
    .replace(/https?:\/\/[^\s)]+/gi, '[redacted-url]')
    .replace(/(api[_-]?key|token|password|secret)=([^\s&]+)/gi, '$1=[redacted]');
}

function applyRateLimitResult(
  result: { allowed: boolean; retryAfterSeconds: number },
  res: Response,
  next: NextFunction
): void {
  if (result.allowed) {
    next();
    return;
  }
  res.setHeader('Retry-After', String(result.retryAfterSeconds));
  res.status(429).json({
    success: false,
    error: 'Too many requests',
    timestamp: new Date().toISOString(),
  });
}

export function createBnbHttpApp(config: BnbAppConfig, publicDirectory: string): BnbHttpApp {
  const app = express();
  let activeHttpRequests = 0;
  const globalRateLimiter = new FixedWindowRateLimiter(config.apiRateLimitPerMinute, 60_000);
  const aiRateLimiter = new FixedWindowRateLimiter(config.aiRateLimitPerFifteenMinutes, 15 * 60_000);
  const exitAdminRateLimiter = new FixedWindowRateLimiter(config.exitAdminRateLimitPerMinute, 60_000);

  if (config.trustProxy) app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'"
    );
    next();
  });
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || config.corsAllowedOrigins.has(origin)) callback(null, true);
        else callback(new Error('CORS origin is not allowed'));
      },
    })
  );
  app.use(express.json({ limit: config.jsonBodyLimit }));
  app.use((_req, res, next) => {
    const json = res.json.bind(res);
    res.json = ((body: unknown) => {
      if (body && typeof body === 'object') {
        const record = body as Record<string, unknown>;
        if (typeof record.error === 'string') {
          record.error = safeErrorMessage(new Error(record.error), record.error);
        }
      }
      return json(body);
    }) as Response['json'];
    next();
  });
  app.use((_req, res, next) => {
    activeHttpRequests++;
    let completed = false;
    const finish = () => {
      if (!completed) {
        completed = true;
        activeHttpRequests--;
      }
    };
    res.once('finish', finish);
    res.once('close', finish);
    next();
  });

  const isRiskReductionExitPath = (path: string) => path.startsWith('/api/execution/exit-proposals');
  app.use('/api', (req, res, next) => {
    if (req.path === '/health' || req.path.startsWith('/health/')) return next();
    const limiter = isRiskReductionExitPath(req.originalUrl) ? exitAdminRateLimiter : globalRateLimiter;
    applyRateLimitResult(limiter.consume(req.ip || req.socket.remoteAddress || 'unknown'), res, next);
  });
  app.use(express.static(publicDirectory));

  return {
    app,
    getActiveHttpRequests: () => activeHttpRequests,
    limitAiRequests(req, res, next) {
      applyRateLimitResult(aiRateLimiter.consume(req.ip || req.socket.remoteAddress || 'unknown'), res, next);
    },
  };
}
