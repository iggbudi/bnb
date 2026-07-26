import { AggressivePaperStore } from '../infrastructure/aggressive-paper-store.js';
import { SnapshotStore } from '../../market-data/index.js';
import type { PancakeV3OnchainState } from '../../lp-execution/index.js';
import { estimateLifecycleGas } from '../../lp-execution/index.js';
import {
  AGGRESSIVE_INITIAL_CAPITAL_USD,
  processAggressivePaperLifecycle,
} from './aggressive-paper-manager.js';
import { buildHighRiskStrategyPlan, HIGH_RISK_HISTORY_WINDOW_HOURS } from '../domain/high-risk-strategy.js';

export interface AggressivePaperMarketInput {
  volume24h: number;
}

export interface AggressivePaperServiceDependencies {
  store: AggressivePaperStore;
  snapshotStore: SnapshotStore;
  enabled: boolean;
  log?: (message: string) => void;
  logError?: (message: string, error: unknown) => void;
}

export class AggressivePaperService {
  private readonly log: (message: string) => void;
  private readonly logError: (message: string, error: unknown) => void;

  constructor(private readonly dependencies: AggressivePaperServiceDependencies) {
    this.log = dependencies.log ?? console.log;
    this.logError = dependencies.logError ?? console.error;
  }

  buildCurrentPlan(
    market: AggressivePaperMarketInput,
    onchain: PancakeV3OnchainState,
    investment = this.dependencies.store.getAvailableCapital(AGGRESSIVE_INITIAL_CAPITAL_USD)
  ) {
    const gas = estimateLifecycleGas(onchain);
    const stats7d = this.dependencies.snapshotStore.getStatistics().find(period => period.label === '7d');
    const history7d = this.dependencies.snapshotStore.getHistory(HIGH_RISK_HISTORY_WINDOW_HOURS, 10_080);
    const averageVolume24h = stats7d?.volume24h.average;
    const conservativeVolume24h =
      averageVolume24h !== null && averageVolume24h !== undefined
        ? Math.min(market.volume24h, averageVolume24h)
        : market.volume24h;
    return buildHighRiskStrategyPlan({
      investment,
      currentPrice: onchain.priceWbnbUsd,
      volume24h: market.volume24h,
      conservativeVolume24h,
      poolFeeRate: onchain.fee / 1_000_000,
      activeLiquidity: onchain.activeLiquidity,
      sqrtPriceX96: onchain.sqrtPriceX96,
      currentTick: onchain.currentTick,
      tickSpacing: onchain.tickSpacing,
      token0Decimals: onchain.token0Decimals,
      token1Decimals: onchain.token1Decimals,
      protocolFeeShareToken0Bps: onchain.protocolFeeShareToken0Bps,
      protocolFeeShareToken1Bps: onchain.protocolFeeShareToken1Bps,
      entryGasUsd: gas.entryGasUsd,
      exitGasUsd: gas.estimatedExitGasUsd,
      historyWindowHours: HIGH_RISK_HISTORY_WINDOW_HOURS,
      historyCoveragePercent: stats7d?.coveragePercent ?? 0,
      historyPrices: history7d.map(snapshot => snapshot.price),
    });
  }

  runLifecycle(
    plan: ReturnType<AggressivePaperService['buildCurrentPlan']> | null,
    onchain: PancakeV3OnchainState | null,
    now: Date
  ) {
    if (!this.dependencies.enabled) return null;
    try {
      const result = processAggressivePaperLifecycle({
        plan,
        onchain,
        store: this.dependencies.store,
        snapshotStore: this.dependencies.snapshotStore,
        initialCapitalUsd: AGGRESSIVE_INITIAL_CAPITAL_USD,
        now,
      });
      if (result.reasonCode !== 'HOURLY_AGGRESSIVE_LIFECYCLE_ALREADY_PROCESSED') {
        this.log(`🔥 Aggressive paper: ${result.action} (${result.reasonCode})`);
      }
      return result;
    } catch (error) {
      this.logError('Aggressive paper lifecycle error:', error);
      return null;
    }
  }
}
