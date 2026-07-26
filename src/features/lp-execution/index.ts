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
export * from './domain/execution-control.js';
export * from './domain/position-lifecycle.js';
export * from './application/paper-position-manager.js';
export * from './application/execution-service.js';
export * from './infrastructure/pancakeswap-v3-execution.js';
export * from './infrastructure/pancakeswap-v3-exit.js';
export * from './infrastructure/pancakeswap-v3-exit-tracker.js';
export * from './infrastructure/pancakeswap-v3-onchain.js';
export * from './infrastructure/pancakeswap-v3-position-tracker.js';
