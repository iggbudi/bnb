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

export type { ExecutionRouteDependencies, ExecutionStatusView } from './http/execution-routes.js';
export type { LifecycleRuntimeView, PositionLifecycleRouteDependencies } from './http/lifecycle-routes.js';
