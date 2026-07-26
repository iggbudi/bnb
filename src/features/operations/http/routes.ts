import type { Express } from 'express';

export interface ReadinessResult {
  ready: boolean;
  [key: string]: unknown;
}

export interface OperationsRouteDependencies {
  getReadiness(): ReadinessResult;
  getStorageStatus(): unknown;
}

export function registerOperationsRoutes(app: Express, dependencies: OperationsRouteDependencies): void {
  app.get('/api/health/live', (_req, res) => {
    res.json({ success: true, data: { status: 'alive' }, timestamp: new Date().toISOString() });
  });

  app.get('/api/health/ready', (_req, res) => {
    const readiness = dependencies.getReadiness();
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

  app.get('/api/operations/storage', (_req, res) => {
    res.json({
      success: true,
      data: dependencies.getStorageStatus(),
      timestamp: new Date().toISOString(),
    });
  });
}
