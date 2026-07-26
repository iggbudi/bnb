import type { AgentStore } from '../../../agent-store.js';
import type { OnchainStore } from '../../../onchain-store.js';
import type { SnapshotStore } from '../../../snapshot-store.js';
import type { AsyncLock } from '../../../shared/runtime/operational-controls.js';
import type { SingleFlight } from '../../../shared/runtime/upstream-resilience.js';
import type { LearningService } from '../../learning/index.js';
import {
  WBNB_USDT_CHAIN_ID,
  WBNB_USDT_FEE_RATE,
  type MarketDataService,
  type WbnbUsdtAnalysis,
} from '../../market-data/index.js';
import { estimateLifecycleGas, type PancakeV3OnchainState } from '../../lp-execution/index.js';
import { calculateIL, calculateLPInvestmentProjection } from '../domain/amm.js';
import { projectFullRangeFee24h } from '../domain/full-range-fee.js';
import { simulateFullRangeLP } from '../domain/lp-simulator.js';
import { analyzeLPWithOpenAI, type AILPAnalysis, type LPAnalysisMetrics } from './openai-analysis.js';

interface ExecutionStatusReaderResult {
  ready: boolean;
  mode: 'LOCKED' | 'MANUAL_APPROVAL';
  blockers: readonly string[];
}

export interface LpAnalysisServiceDependencies {
  agentStore: AgentStore;
  snapshotStore: SnapshotStore;
  onchainStore: OnchainStore;
  marketDataService: MarketDataService;
  learningService: LearningService;
  getExecutionStatus(): ExecutionStatusReaderResult;
  openAiLock: AsyncLock;
  aiSingleFlight: SingleFlight;
}

export class LpAnalysisService {
  private aiCache: { data: AILPAnalysis; timestamp: number } | null = null;
  private readonly aiCacheTtlMs = 15 * 60_000;

  constructor(private readonly dependencies: LpAnalysisServiceDependencies) {}

  private buildMetrics(analysis: WbnbUsdtAnalysis): LPAnalysisMetrics {
    const historicalContext = this.dependencies.snapshotStore.getStatistics();
    const widestPeriod = historicalContext.find(period => period.label === '30d');
    const firstTimestamp = widestPeriod?.firstCapturedAt
      ? new Date(widestPeriod.firstCapturedAt).getTime()
      : null;
    const latestTimestamp = widestPeriod?.latestCapturedAt
      ? new Date(widestPeriod.latestCapturedAt).getTime()
      : null;

    return {
      pair: 'WBNB/USDT',
      chain: WBNB_USDT_CHAIN_ID,
      dex: 'PancakeSwap V3',
      feeTierPercent: WBNB_USDT_FEE_RATE * 100,
      price: analysis.price,
      tvl: analysis.tvl,
      volume1h: analysis.volume1h,
      volume6h: analysis.volume6h,
      volume24h: analysis.volume24h,
      volumeLiquidityRatio: analysis.volLiqRatio,
      estimatedFees24h: analysis.estimatedFees24h,
      estimatedApr: analysis.estimatedAPR,
      priceChange1h: analysis.priceChange1h,
      priceChange6h: analysis.priceChange6h,
      priceChange24h: analysis.priceChange24h,
      buys24h: analysis.txns24h.buys,
      sells24h: analysis.txns24h.sells,
      ilScenarios: [-50, -20, 20, 50, 100].map(priceChangePercent => ({
        priceChangePercent,
        ilPercent: calculateIL(100, 100 * (1 + priceChangePercent / 100), 10_000).ilPercent,
      })),
      historicalContext,
      historyDataQuality: {
        totalRows: widestPeriod?.count ?? 0,
        availableHours:
          firstTimestamp !== null && latestTimestamp !== null
            ? (latestTimestamp - firstTimestamp) / 3_600_000
            : 0,
        firstCapturedAt: widestPeriod?.firstCapturedAt ?? null,
        latestCapturedAt: widestPeriod?.latestCapturedAt ?? null,
      },
      agentLessons: this.dependencies.agentStore.getRecentReflections(5).map(reflection => ({
        lesson: reflection.lesson,
        futureChecks: reflection.futureChecks,
        confidence: reflection.confidence,
        createdAt: reflection.createdAt,
      })),
      onchainContext: (() => {
        const snapshot = this.dependencies.onchainStore.getRecent(1)[0];
        return snapshot
          ? {
              blockNumber: snapshot.blockNumber,
              blockTimestamp: snapshot.blockTimestamp,
              currentTick: snapshot.currentTick,
              activeLiquidity: snapshot.activeLiquidity,
              feeGrowthGlobal0X128: snapshot.feeGrowthGlobal0X128,
              feeGrowthGlobal1X128: snapshot.feeGrowthGlobal1X128,
              gasPriceWei: snapshot.gasPriceWei,
              priceWbnbUsd: snapshot.priceWbnbUsd,
            }
          : null;
      })(),
      operationalContext: (() => {
        const latestDecision = this.dependencies.agentStore.getRecent(1)[0] ?? null;
        const performance168h = this.dependencies.agentStore.getPerformance(168);
        const activeModel = this.dependencies.learningService.getLifecycleCompatibleActiveModel();
        const execution = this.dependencies.getExecutionStatus();
        return {
          mode: 'paper' as const,
          totalDecisions: this.dependencies.agentStore.count(),
          latestDecision: latestDecision
            ? {
                action: latestDecision.action,
                strategyVersion: latestDecision.strategyVersion,
                confidence: latestDecision.confidence,
                createdAt: latestDecision.createdAt,
              }
            : null,
          outcomes168h: {
            evaluated: performance168h.evaluated,
            scored: performance168h.scored,
            abstained: performance168h.abstained,
            accuracyPercent: performance168h.accuracyPercent,
          },
          activeModel: activeModel
            ? {
                version: activeModel.version,
                accuracyPercent: activeModel.accuracyPercent,
                trainingRows: activeModel.trainingRows,
              }
            : null,
          execution: {
            ready: execution.ready,
            mode: execution.mode,
            blockers: [...execution.blockers],
            strategy: 'FULL_RANGE_ONLY' as const,
            transactionSigningAvailable: false as const,
            broadcastAvailable: false as const,
            privateKeyStoredByServer: false as const,
          },
        };
      })(),
    };
  }

  private buildInvestmentProjection(
    analysis: WbnbUsdtAnalysis,
    onchain: PancakeV3OnchainState,
    investment = 100
  ) {
    const estimatedFee24h = projectFullRangeFee24h({
      investmentUsd: investment,
      priceWbnbUsd: onchain.priceWbnbUsd,
      currentTick: onchain.currentTick,
      activeLiquidity: onchain.activeLiquidity,
      volume24h: analysis.volume24h,
      poolFeeRate: onchain.fee / 1_000_000,
      protocolFeeShareToken0Bps: onchain.protocolFeeShareToken0Bps,
      protocolFeeShareToken1Bps: onchain.protocolFeeShareToken1Bps,
      token0Decimals: onchain.token0Decimals,
      token1Decimals: onchain.token1Decimals,
    });
    return calculateLPInvestmentProjection(
      investment,
      analysis.price,
      analysis.priceChange24h,
      estimatedFee24h
    );
  }

  async simulate(investment: number) {
    const [pair, onchain] = await Promise.all([
      this.dependencies.marketDataService.getPair(),
      this.dependencies.marketDataService.captureOnchainPoolState(),
    ]);
    const analysis = this.dependencies.marketDataService.analyzePair(pair);
    const gas = estimateLifecycleGas(onchain);
    return simulateFullRangeLP({
      investment,
      currentPrice: onchain.priceWbnbUsd,
      volume24h: analysis.volume24h,
      poolFeeRate: onchain.fee / 1_000_000,
      activeLiquidity: onchain.activeLiquidity,
      sqrtPriceX96: onchain.sqrtPriceX96,
      currentTick: onchain.currentTick,
      token0Decimals: onchain.token0Decimals,
      token1Decimals: onchain.token1Decimals,
      protocolFeeShareToken0Bps: onchain.protocolFeeShareToken0Bps,
      protocolFeeShareToken1Bps: onchain.protocolFeeShareToken1Bps,
      entryGasUsd: gas.entryGasUsd,
      exitGasUsd: gas.estimatedExitGasUsd,
      assetSymbol: 'BNB',
    });
  }

  async generateAiAnalysis() {
    const [pair, onchain] = await Promise.all([
      this.dependencies.marketDataService.getPair(),
      this.dependencies.marketDataService.captureOnchainPoolState(),
    ]);
    const poolAnalysis = this.dependencies.marketDataService.analyzePair(pair);
    const investmentProjection = this.buildInvestmentProjection(poolAnalysis, onchain);
    if (this.aiCache && Date.now() - this.aiCache.timestamp <= this.aiCacheTtlMs) {
      return { ...this.aiCache.data, investmentProjection, cached: true };
    }

    const generated = await this.dependencies.aiSingleFlight.run('lp-ai-analysis-v2.7', async () => {
      if (this.aiCache && Date.now() - this.aiCache.timestamp <= this.aiCacheTtlMs) {
        return { analysis: this.aiCache.data, cached: true };
      }
      const analysis = await this.dependencies.openAiLock.run(() =>
        analyzeLPWithOpenAI(this.buildMetrics(poolAnalysis))
      );
      this.aiCache = { data: analysis, timestamp: Date.now() };
      return { analysis, cached: false };
    });
    return { ...generated.analysis, investmentProjection, cached: generated.cached };
  }
}
