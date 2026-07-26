import type { Express } from 'express';

import type { AgentStore } from '../../../agent-store.js';

export interface LearningRouteDependencies {
  store: Pick<AgentStore, 'getRecentModels'>;
  getLearningStatus(): Record<string, unknown>;
}

export function registerLearningRoutes(app: Express, dependencies: LearningRouteDependencies): void {
  app.get('/api/agent/models', (_req, res) => {
    res.json({
      success: true,
      data: {
        ...dependencies.getLearningStatus(),
        models: dependencies.store.getRecentModels(20),
      },
      timestamp: new Date().toISOString(),
    });
  });
}
