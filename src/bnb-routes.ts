import type { NextFunction, Request, Response } from 'express';
import type { Express } from 'express';
import { join } from 'node:path';

export interface ReadinessResult {
  ready: boolean;
  [key: string]: unknown;
}

export function registerHealthRoutes(app: Express, getReadiness: () => ReadinessResult): void {
  app.get('/api/health/live', (_req, res) => {
    res.json({ success: true, data: { status: 'alive' }, timestamp: new Date().toISOString() });
  });

  app.get('/api/health/ready', (_req, res) => {
    const readiness = getReadiness();
    res.status(readiness.ready ? 200 : 503).json({
      success: readiness.ready,
      data: readiness,
      timestamp: new Date().toISOString(),
    });
  });

  // Backward-compatible liveness alias used by existing Termux scripts.
  app.get('/api/health', (_req, res) => {
    res.json({ success: true, data: { status: 'alive' }, timestamp: new Date().toISOString() });
  });
}

export function registerFrontendAndErrorRoutes(
  app: Express,
  publicDirectory: string,
  safeErrorMessage: (error: unknown, fallback: string) => string
): void {
  app.get('*', (_req, res) => {
    res.sendFile(join(publicDirectory, 'index.html'));
  });

  app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    console.error('HTTP middleware error:', safeErrorMessage(error, 'unknown middleware error'));
    res.status(400).json({
      success: false,
      error: error instanceof SyntaxError ? 'Invalid JSON request body' : 'Request rejected',
      timestamp: new Date().toISOString(),
    });
  });
}
