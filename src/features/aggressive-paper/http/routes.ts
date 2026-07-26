import type { Express, RequestHandler } from 'express';

import type { AggressivePaperStore } from '../infrastructure/aggressive-paper-store.js';
import { parsePositiveNumber } from '../../../validation.js';

export interface AggressivePaperPolicy {
  initialCapitalUsd: number;
  targetReturnPercent: number;
  stopLossPercent: number;
  outOfRangeConfirmationMinutes: number;
  maxRecentersPerCycle: number;
  recenterSlippageBps: number;
  maxHoldHours: number;
  normalCooldownHours: number;
  riskCooldownHours: number;
}

export interface AggressivePaperRouteDependencies {
  store: Pick<
    AggressivePaperStore,
    'getPerformance' | 'getRecentPositions' | 'getActions' | 'getEvaluations' | 'getPosition'
  >;
  enabled: boolean;
  strategyVersion: string;
  policy: AggressivePaperPolicy;
  highRiskPlanMiddleware: RequestHandler;
  loadHighRiskPlan(): Promise<unknown>;
}

export function buildAggressivePaperStatus(
  dependencies: AggressivePaperRouteDependencies
): Record<string, unknown> {
  const { store, enabled, strategyVersion, policy } = dependencies;
  const performance = store.getPerformance(policy.initialCapitalUsd);
  const selectedPosition = performance.activePosition ?? store.getRecentPositions(1)[0] ?? null;

  return {
    enabled,
    mode: 'PAPER_CONCENTRATED_PORTFOLIO',
    strategyVersion,
    liveExecutionEnabled: false,
    policy: {
      ...policy,
      feeSource: 'ONCHAIN_FEE_GROWTH_GLOBAL_X128_WITH_IN_RANGE_OCCUPANCY',
      onePositionAtATime: true,
      capitalCompoundsBetweenCompletedCycles: true,
    },
    performance,
    recentPositions: store.getRecentPositions(20),
    recentActions: selectedPosition ? store.getActions(selectedPosition.id, 50) : [],
    recentEvaluations: selectedPosition ? store.getEvaluations(selectedPosition.id, 100) : [],
  };
}

export function registerAggressivePaperRoutes(
  app: Express,
  dependencies: AggressivePaperRouteDependencies
): void {
  app.get('/api/agent/high-risk-plan', dependencies.highRiskPlanMiddleware, async (_req, res) => {
    try {
      const plan = await dependencies.loadHighRiskPlan();
      res.json({ success: true, data: plan, timestamp: new Date().toISOString() });
    } catch (error) {
      res.status(503).json({
        success: false,
        error: error instanceof Error ? error.message : 'High-risk strategy plan unavailable',
        timestamp: new Date().toISOString(),
      });
    }
  });

  app.get('/api/agent/aggressive-performance', (_req, res) => {
    res.json({
      success: true,
      data: buildAggressivePaperStatus(dependencies),
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/agent/aggressive-positions/:id', (req, res) => {
    try {
      const id = Math.floor(parsePositiveNumber(req.params.id, 'id'));
      const position = dependencies.store.getPosition(id);
      if (!position) {
        res.status(404).json({
          success: false,
          error: 'Aggressive paper position not found',
          timestamp: new Date().toISOString(),
        });
        return;
      }
      res.json({
        success: true,
        data: {
          position,
          actions: dependencies.store.getActions(id, 1_000),
          evaluations: dependencies.store.getEvaluations(id, 10_000),
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : 'Invalid aggressive position parameter',
        timestamp: new Date().toISOString(),
      });
    }
  });
}
