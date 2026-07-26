import type { Express } from 'express';

import { registerExecutionControlRoutes, type ExecutionRouteDependencies } from './http/execution-routes.js';
import {
  registerPositionLifecycleRoutes,
  type PositionLifecycleRouteDependencies,
} from './http/lifecycle-routes.js';

export interface LpExecutionRouteDependencies {
  execution: ExecutionRouteDependencies;
  lifecycle: PositionLifecycleRouteDependencies;
}

export function registerLpExecutionRoutes(app: Express, dependencies: LpExecutionRouteDependencies): void {
  registerPositionLifecycleRoutes(app, dependencies.lifecycle);
  registerExecutionControlRoutes(app, dependencies.execution);
}

export { ExecutionService } from './application/execution-service.js';
export {
  type PaperPositionLifecycleResult,
  processPaperPositionLifecycle,
} from './application/paper-position-manager.js';
export { type LpExecutionTaskService, createExecutionTasks } from './application/scheduled-tasks.js';
export { ExecutionStore } from './infrastructure/execution-store.js';
export { PositionStore } from './infrastructure/position-store.js';
export { lpExecutionSchema } from './infrastructure/schema.js';
export { ShadowModeStore } from './infrastructure/shadow-mode-store.js';
