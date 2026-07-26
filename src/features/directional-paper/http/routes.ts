import type { Express } from 'express';

import type { DirectionalPaperStore } from '../infrastructure/directional-paper-store.js';
import type { DirectionalStrategyConfig } from '../domain/directional-strategy.js';
import { parsePositiveNumber } from '../../../shared/http/validation.js';

export interface DirectionalPaperRouteDependencies {
  store: Pick<
    DirectionalPaperStore,
    | 'getLatestRun'
    | 'getPerformance'
    | 'getRecentRuns'
    | 'getRecentPositions'
    | 'getRecentDecisions'
    | 'getPosition'
    | 'getFills'
    | 'getRecentEvaluations'
  >;
  enabled: boolean;
  strategyVersion: string;
  config: DirectionalStrategyConfig;
}

export function buildDirectionalPaperStatus(
  dependencies: DirectionalPaperRouteDependencies
): Record<string, unknown> {
  const { store, enabled, strategyVersion, config } = dependencies;
  const forwardRun = store.getLatestRun('FORWARD');
  const backtestRun = store.getLatestRun('BACKTEST');
  const forwardPerformance = forwardRun ? store.getPerformance(forwardRun.id) : null;
  const backtestPerformance = backtestRun ? store.getPerformance(backtestRun.id) : null;
  const selectedRun = forwardRun ?? backtestRun;

  return {
    enabled,
    mode: 'SIMULATION_ONLY',
    strategyVersion,
    marketSource: 'POOL_SNAPSHOT_CLOSE_PER_MINUTE',
    limitations: {
      nativePerpetualData: false,
      intraminuteHighLowAvailable: false,
      markIndexSpreadAvailable: false,
      orderBookAvailable: false,
      fundingRateSource: 'FIXED_SIMULATION_ASSUMPTION',
    },
    policy: {
      initialCapitalUsd: config.initialCapitalUsd,
      leverage: config.leverage,
      marginFraction: config.marginFraction,
      takerFeeBps: config.takerFeeBps,
      slippageBps: config.slippageBps,
      maintenanceMarginRate: config.maintenanceMarginRate,
      minimumHistoryPoints: config.minimumHistoryPoints,
      maximumHoldMinutes: config.maximumHoldMinutes,
      cooldownMinutes: config.cooldownMinutes,
      fundingRate8h: config.fundingRate8h,
      onePositionPerRun: true,
      liveExecutionEnabled: false,
    },
    forwardPerformance,
    latestBacktestPerformance: backtestPerformance,
    recentRuns: store.getRecentRuns(20),
    recentPositions: selectedRun ? store.getRecentPositions(selectedRun.id, 20) : [],
    recentDecisions: selectedRun ? store.getRecentDecisions(selectedRun.id, 100) : [],
  };
}

export function registerDirectionalPaperRoutes(
  app: Express,
  dependencies: DirectionalPaperRouteDependencies
): void {
  app.get('/api/agent/directional-performance', (_req, res) => {
    res.json({
      success: true,
      data: buildDirectionalPaperStatus(dependencies),
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/agent/directional-positions/:id', (req, res) => {
    try {
      const id = Math.floor(parsePositiveNumber(req.params.id, 'id'));
      const position = dependencies.store.getPosition(id);
      if (!position) {
        res.status(404).json({
          success: false,
          error: 'Directional paper position not found',
          timestamp: new Date().toISOString(),
        });
        return;
      }
      res.json({
        success: true,
        data: {
          position,
          fills: dependencies.store.getFills(id),
          evaluations: dependencies.store.getRecentEvaluations(id, 10_000),
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : 'Invalid directional position parameter',
        timestamp: new Date().toISOString(),
      });
    }
  });
}
