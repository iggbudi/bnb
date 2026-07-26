import type { NextFunction, Request, Response } from 'express';
import type { Express } from 'express';
import { join } from 'node:path';

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
