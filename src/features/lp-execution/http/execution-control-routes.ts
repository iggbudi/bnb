import type { Express } from 'express';
import { parsePositiveNumber } from '../../../shared/http/validation.js';
import type { ExecutionRouteDependencies } from './execution-routes.js';

export function registerExecutionStatusAndControlRoutes(
  app: Express,
  dependencies: ExecutionRouteDependencies
): void {
  const { executionStore } = dependencies;
  const getExecutionStatus = dependencies.getExecutionStatus;
  const isExecutionAdminAuthorized = dependencies.isAdminAuthorized;

  app.get('/api/execution/status', (req, res) => {
    res.json({
      success: true,
      data: getExecutionStatus(),
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/execution/audit', (req, res) => {
    try {
      const requestedLimit =
        req.query.limit === undefined ? 50 : parsePositiveNumber(req.query.limit, 'limit');
      const limit = Math.min(200, Math.max(1, Math.floor(requestedLimit)));
      res.json({
        success: true,
        data: { events: executionStore.getRecentAudit(limit) },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : 'Invalid audit parameters',
        timestamp: new Date().toISOString(),
      });
    }
  });

  app.post('/api/execution/kill-switch', (req, res) => {
    if (!isExecutionAdminAuthorized(req.headers.authorization)) {
      res.status(401).json({ success: false, error: 'Unauthorized', timestamp: new Date().toISOString() });
      return;
    }
    if (
      typeof req.body?.engaged !== 'boolean' ||
      typeof req.body?.reason !== 'string' ||
      req.body.reason.trim().length < 5
    ) {
      res.status(400).json({
        success: false,
        error: 'engaged boolean and reason are required',
        timestamp: new Date().toISOString(),
      });
      return;
    }
    const control = executionStore.setKillSwitch(req.body.engaged, req.body.reason.trim());
    res.json({
      success: true,
      data: { control, execution: getExecutionStatus() },
      timestamp: new Date().toISOString(),
    });
  });
}
