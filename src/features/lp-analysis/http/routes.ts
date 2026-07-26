import type { Express, RequestHandler } from 'express';

import { calculateIL } from '../domain/amm.js';
import { safeErrorMessage } from '../../../shared/http/errors.js';
import { UpstreamError } from '../../../shared/runtime/upstream-resilience.js';
import { parsePositiveNumber, parsePositiveNumberOrDefault } from '../../../validation.js';

export interface LpAnalysisRouteDependencies {
  rpcMiddleware: RequestHandler;
  aiRateLimitMiddleware: RequestHandler;
  simulate(investment: number): Promise<unknown>;
  generateAiAnalysis(): Promise<unknown>;
}

function upstreamErrorCode(error: unknown): string {
  return error instanceof UpstreamError ? error.code : 'UPSTREAM_UNAVAILABLE';
}

export function registerLpAnalysisRoutes(app: Express, dependencies: LpAnalysisRouteDependencies): void {
  app.get('/api/simulate', dependencies.rpcMiddleware, async (req, res) => {
    try {
      const investment = parsePositiveNumberOrDefault(req.query.amount, 'amount', 50);
      console.log(`💰 Simulating LP with $${investment}...`);
      const simulation = await dependencies.simulate(investment);
      res.json({ success: true, data: simulation, timestamp: new Date().toISOString() });
    } catch (error) {
      console.error('Simulation error:', error);
      const isInputError = error instanceof Error && error.message.startsWith('Parameter');
      res.status(isInputError ? 400 : 500).json({
        success: false,
        error: isInputError
          ? safeErrorMessage(error, 'Invalid simulation input')
          : 'Simulation temporarily unavailable',
        code: isInputError ? 'INVALID_INPUT' : upstreamErrorCode(error),
        timestamp: new Date().toISOString(),
      });
    }
  });

  app.post(
    '/api/lp-analysis',
    dependencies.aiRateLimitMiddleware,
    dependencies.rpcMiddleware,
    async (_req, res) => {
      try {
        const analysis = await dependencies.generateAiAnalysis();
        res.json({ success: true, data: analysis, timestamp: new Date().toISOString() });
      } catch (error) {
        console.error('AI LP analysis error:', error);
        const message = error instanceof Error ? error.message : 'Unknown error';
        const status = message.includes('OPENAI_API_KEY')
          ? 503
          : error instanceof Error && error.name === 'TimeoutError'
            ? 504
            : 502;
        res.status(status).json({
          success: false,
          error: message.includes('OPENAI_API_KEY')
            ? 'AI analysis is not configured on the server'
            : 'AI analysis is temporarily unavailable',
          timestamp: new Date().toISOString(),
        });
      }
    }
  );

  app.get('/api/il', (req, res) => {
    try {
      const from = parsePositiveNumber(req.query.from, 'from');
      const to = parsePositiveNumber(req.query.to, 'to');
      const invest = parsePositiveNumber(req.query.invest, 'invest');
      const result = calculateIL(from, to, invest);
      res.json({ success: true, data: result, timestamp: new Date().toISOString() });
    } catch (error) {
      const isInputError = error instanceof Error && error.message.startsWith('Parameter');
      res.status(isInputError ? 400 : 500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      });
    }
  });
}
