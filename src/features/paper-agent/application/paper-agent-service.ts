import type { AgentStore, PaperAgentDecision } from '../../../agent-store.js';
import type { OnchainPoolSnapshot, OnchainStore } from '../../../onchain-store.js';
import type { PositionStore } from '../../../position-store.js';
import type { ShadowModeStore } from '../../../shadow-mode-store.js';
import type { SnapshotStore } from '../../../snapshot-store.js';
import type { AsyncLock } from '../../../shared/runtime/operational-controls.js';
import type { AggressivePaperService } from '../../aggressive-paper/index.js';
import type { LearningService } from '../../learning/index.js';
import type { MarketDataService, WbnbUsdtAnalysis } from '../../market-data/index.js';
import {
  estimateFullRangeFeeBetweenCheckpoints,
  FULL_RANGE_FEE_ACCOUNTING_VERSION,
  projectFullRangeFee24h,
} from '../../lp-analysis/index.js';
import {
  estimateLifecycleGas,
  processPaperPositionLifecycle,
  type PancakeV3OnchainState,
} from '../../lp-execution/index.js';
import { applyLearningModel } from '../../learning/index.js';
import {
  ENTRY_FEE_RETENTION_FACTOR,
  ENTRY_FORECAST_DAYS,
  ENTRY_HISTORY_COVERAGE_PERCENT,
  ENTRY_MINIMUM_NET_EDGE_USD,
  makeBaselinePaperDecision,
  PAPER_AGENT_INVESTMENT,
  PAPER_AGENT_STRATEGY_VERSION,
} from '../domain/paper-agent.js';
import {
  assessPaperOutcomeEconomics,
  ASSUMED_ENTRY_GAS_UNITS,
  ASSUMED_EXIT_GAS_UNITS,
  gasCostUsd,
  type OutcomeGasContext,
} from '../domain/outcome-assessment.js';
import { interpretPaperOutcomeLifecycle } from '../domain/outcome-interpretation.js';
import {
  evaluatePaperDecision,
  makeSkippedPaperOutcome,
  OUTCOME_DATA_GRACE_MS,
  OUTCOME_SNAPSHOT_MIN_COVERAGE_PERCENT,
  OUTCOME_TARGET_SNAPSHOT_MAX_AGE_MS,
  PAPER_AGENT_HORIZONS,
} from './paper-agent-evaluator.js';
import { REFLECTION_PROMPT_VERSION, reflectOnPaperOutcome } from './agent-reflection.js';

export interface PaperAgentServiceDependencies {
  agentStore: AgentStore;
  onchainStore: OnchainStore;
  positionStore: PositionStore;
  shadowModeStore: ShadowModeStore;
  snapshotStore: SnapshotStore;
  marketDataService: MarketDataService;
  aggressivePaperService: AggressivePaperService;
  learningService: LearningService;
  openAiLock: AsyncLock;
  openAiConfigured: boolean;
  positionLifecycleEnabled: boolean;
  reconcileLifecycleActivation(now: Date): unknown;
  log?: (message: string) => void;
}

export class PaperAgentService {
  private reflectionCycleRunning = false;
  private readonly log: (message: string) => void;

  constructor(private readonly dependencies: PaperAgentServiceDependencies) {
    this.log = dependencies.log ?? console.log;
  }

  private runShadowPositionLifecycle(
    signal: PaperAgentDecision,
    market: WbnbUsdtAnalysis,
    onchain: PancakeV3OnchainState | null,
    now: Date
  ) {
    try {
      const result = processPaperPositionLifecycle({
        signal,
        market: { price: market.price, tvl: market.tvl, volume1h: market.volume1h },
        onchain,
        positionStore: this.dependencies.positionStore,
        snapshotStore: this.dependencies.snapshotStore,
        now,
      });
      this.dependencies.shadowModeStore.recordSuccess(signal, result, now);
      return result;
    } catch (error) {
      this.dependencies.shadowModeStore.recordFailure(signal, error, now);
      this.dependencies.reconcileLifecycleActivation(now);
      throw error;
    }
  }

  async runHourly(now = new Date()) {
    const decisionHour = new Date(now);
    decisionHour.setUTCMinutes(0, 0, 0);
    const existing = this.dependencies.agentStore.getByDecisionHour(decisionHour.toISOString());
    const [analysis, onchain] = await Promise.all([
      this.dependencies.marketDataService.capturePoolSnapshot(),
      this.dependencies.marketDataService.captureOnchainPoolState().catch(() => null),
    ]);
    const aggressivePlan = onchain
      ? this.dependencies.aggressivePaperService.buildCurrentPlan(analysis, onchain)
      : null;

    if (existing) {
      if (this.dependencies.positionLifecycleEnabled) {
        this.runShadowPositionLifecycle(existing, analysis, onchain, now);
      }
      this.dependencies.aggressivePaperService.runLifecycle(aggressivePlan, onchain, now);
      return { decision: existing, created: false };
    }

    const baselineDecision = makeBaselinePaperDecision(
      {
        price: analysis.price,
        tvl: analysis.tvl,
        volume1h: analysis.volume1h,
        volume6h: analysis.volume6h,
        volume24h: analysis.volume24h,
        volLiqRatio: analysis.volLiqRatio,
        estimatedFees24h: analysis.estimatedFees24h,
        estimatedAPR: analysis.estimatedAPR,
        priceChange1h: analysis.priceChange1h,
        priceChange6h: analysis.priceChange6h,
        priceChange24h: analysis.priceChange24h,
        buys24h: analysis.txns24h.buys,
        sells24h: analysis.txns24h.sells,
      },
      this.dependencies.snapshotStore.getStatistics(),
      onchain
        ? (() => {
            const gas = estimateLifecycleGas(onchain);
            return {
              entryGasUsd: gas.entryGasUsd,
              exitGasUsd: gas.estimatedExitGasUsd,
              applicableSwapSlippageUsd: 0,
              projectedFee24hOnchain: projectFullRangeFee24h({
                investmentUsd: PAPER_AGENT_INVESTMENT,
                priceWbnbUsd: onchain.priceWbnbUsd,
                currentTick: onchain.currentTick,
                activeLiquidity: onchain.activeLiquidity,
                volume24h: analysis.volume24h,
                poolFeeRate: onchain.fee / 1_000_000,
                protocolFeeShareToken0Bps: onchain.protocolFeeShareToken0Bps,
                protocolFeeShareToken1Bps: onchain.protocolFeeShareToken1Bps,
                token0Decimals: onchain.token0Decimals,
                token1Decimals: onchain.token1Decimals,
              }),
              transactionPath: 'BALANCED_TOKENS_MINT_WITHDRAW' as const,
            };
          })()
        : null,
      now
    );
    const reflectionLessons = this.dependencies.agentStore.getRecentReflections(3).map(reflection => ({
      id: reflection.id,
      lesson: reflection.lesson,
      futureChecks: reflection.futureChecks,
      confidence: reflection.confidence,
    }));
    baselineDecision.features = {
      ...baselineDecision.features,
      reflectionLessons,
      onchainContext: onchain
        ? {
            blockNumber: onchain.blockNumber,
            currentTick: onchain.currentTick,
            activeLiquidity: onchain.activeLiquidity,
            feeGrowthGlobal0X128: onchain.feeGrowthGlobal0X128,
            feeGrowthGlobal1X128: onchain.feeGrowthGlobal1X128,
            gasPriceGwei: onchain.gas.gasPriceGwei,
            ranges: onchain.ranges.map(range => ({
              percent: range.percent,
              tickLower: range.tickLower,
              tickUpper: range.tickUpper,
              inRange: range.inRange,
            })),
          }
        : null,
      highRiskPlan: aggressivePlan,
    };
    const activeModel = this.dependencies.learningService.getLifecycleCompatibleActiveModel();
    const decision = activeModel
      ? applyLearningModel(baselineDecision, activeModel.version, activeModel.model)
      : baselineDecision;

    const saved = this.dependencies.agentStore.saveIfAbsent(decision);
    if (saved.created) {
      this.log(`🧠 Paper agent: ${saved.decision.action} (${saved.decision.reasonCode})`);
    }
    if (this.dependencies.positionLifecycleEnabled) {
      const lifecycle = this.runShadowPositionLifecycle(saved.decision, analysis, onchain, now);
      this.log(`🧭 Position lifecycle: ${lifecycle.action} (${lifecycle.reasonCode})`);
    }
    this.dependencies.aggressivePaperService.runLifecycle(aggressivePlan, onchain, now);
    return saved;
  }

  private freshOnchainSnapshotAtOrBefore(timestamp: string): OnchainPoolSnapshot | null {
    const snapshot = this.dependencies.onchainStore.getAtOrBefore(timestamp);
    if (!snapshot) return null;
    const ageMs = new Date(timestamp).getTime() - new Date(snapshot.capturedAt).getTime();
    return ageMs >= 0 && ageMs <= 30 * 60 * 1_000 ? snapshot : null;
  }

  private outcomeGasContext(
    outcome: { status: string; targetAt: string; decision: { createdAt: string } },
    fallback: OnchainPoolSnapshot | null
  ): OutcomeGasContext | null {
    const entrySnapshot = this.freshOnchainSnapshotAtOrBefore(outcome.decision.createdAt);
    const exitSnapshot = this.freshOnchainSnapshotAtOrBefore(outcome.targetAt);
    if (outcome.status === 'EVALUATED' && ((!entrySnapshot && !fallback) || (!exitSnapshot && !fallback))) {
      return null;
    }
    const entryGasSnapshot = entrySnapshot ?? fallback;
    const exitGasSnapshot = exitSnapshot ?? fallback;
    return {
      entryGasUsd: entryGasSnapshot
        ? gasCostUsd(entryGasSnapshot.gasPriceWei, ASSUMED_ENTRY_GAS_UNITS, entryGasSnapshot.priceWbnbUsd)
        : 0,
      exitGasUsd: exitGasSnapshot
        ? gasCostUsd(exitGasSnapshot.gasPriceWei, ASSUMED_EXIT_GAS_UNITS, exitGasSnapshot.priceWbnbUsd)
        : 0,
      gasSource: entrySnapshot && exitSnapshot ? 'HISTORICAL_ONCHAIN' : 'CURRENT_FALLBACK',
    };
  }

  private processPendingOutcomeMetadata(now = new Date()): {
    assessments: number;
    interpretations: number;
  } {
    const fallback = this.dependencies.onchainStore.getRecent(1)[0] ?? null;
    let assessments = 0;
    for (const outcome of this.dependencies.agentStore.getOutcomesPendingAssessment(500)) {
      const gas = this.outcomeGasContext(outcome, fallback);
      if (!gas) continue;
      const result = this.dependencies.agentStore.saveOutcomeAssessmentIfAbsent(
        assessPaperOutcomeEconomics(outcome, gas, now)
      );
      if (result.created) assessments++;
    }

    let interpretations = 0;
    for (const outcome of this.dependencies.agentStore.getOutcomesPendingInterpretation(500)) {
      const gas = this.outcomeGasContext(outcome, fallback);
      if (!gas) continue;
      const result = this.dependencies.agentStore.saveOutcomeInterpretationIfAbsent(
        interpretPaperOutcomeLifecycle(outcome, gas, now)
      );
      if (result.created) interpretations++;
    }
    return { assessments, interpretations };
  }

  private observedFullRangeFee(decision: PaperAgentDecision, targetAt: Date) {
    const entry = this.freshOnchainSnapshotAtOrBefore(decision.createdAt);
    const exit = this.freshOnchainSnapshotAtOrBefore(targetAt.toISOString());
    if (!entry || !exit) return null;
    const estimate = estimateFullRangeFeeBetweenCheckpoints({
      investmentUsd: decision.investment,
      entry,
      exit,
    });
    return {
      amountUsd: estimate.feeUsd,
      token0Fee: estimate.token0Fee,
      token1Fee: estimate.token1Fee,
      liquidity: estimate.liquidity,
      entryBlockNumber: entry.blockNumber,
      exitBlockNumber: exit.blockNumber,
      accountingVersion: FULL_RANGE_FEE_ACCOUNTING_VERSION,
    };
  }

  evaluateDueDecisions(now = new Date()): number {
    let createdOutcomes = 0;
    for (const horizonHours of PAPER_AGENT_HORIZONS) {
      for (const decision of this.dependencies.agentStore.getDueDecisions(horizonHours, now)) {
        const startedAt = new Date(decision.createdAt);
        const targetAt = new Date(startedAt.getTime() + horizonHours * 60 * 60 * 1_000);
        const snapshots = this.dependencies.snapshotStore.getSnapshotsBetween(startedAt, targetAt);
        const exitSnapshot = this.dependencies.snapshotStore.getSnapshotAtOrBefore(
          targetAt,
          OUTCOME_TARGET_SNAPSHOT_MAX_AGE_MS
        );
        const coveragePercent = (snapshots.length / (horizonHours * 60)) * 100;
        const observedFee = this.observedFullRangeFee(decision, targetAt);

        if (exitSnapshot && observedFee && coveragePercent >= OUTCOME_SNAPSHOT_MIN_COVERAGE_PERCENT) {
          const result = this.dependencies.agentStore.saveOutcomeIfAbsent(
            evaluatePaperDecision(decision, horizonHours, exitSnapshot, snapshots, observedFee, now)
          );
          if (result.created) {
            createdOutcomes++;
            this.log(
              `📋 Paper outcome: decision ${decision.id}, ${horizonHours}h, correct=${result.outcome.actionCorrect}`
            );
          }
        } else if (now.getTime() - targetAt.getTime() >= OUTCOME_DATA_GRACE_MS) {
          const reason = !exitSnapshot
            ? 'Outcome dilewati karena tidak ada snapshot dekat waktu target.'
            : !observedFee
              ? 'Outcome dilewati karena checkpoint fee-growth on-chain dekat entry atau target tidak tersedia.'
              : `Outcome dilewati karena coverage snapshot ${coveragePercent.toFixed(1)}% berada di bawah 80%.`;
          const result = this.dependencies.agentStore.saveOutcomeIfAbsent(
            makeSkippedPaperOutcome(decision, horizonHours, now, snapshots.length, reason)
          );
          if (result.created) {
            createdOutcomes++;
            this.log(`⚠️ Paper outcome skipped: decision ${decision.id}, ${horizonHours}h`);
          }
        }
      }
    }

    const metadata = this.processPendingOutcomeMetadata(now);
    if (metadata.assessments > 0 || metadata.interpretations > 0) {
      this.log(
        `⚖️ Outcome metadata: ${metadata.assessments} legacy assessments, ${metadata.interpretations} lifecycle interpretations`
      );
    }
    return createdOutcomes;
  }

  async runReflectionCycle(now = new Date()) {
    if (this.reflectionCycleRunning) return { status: 'ALREADY_RUNNING', created: 0 };
    if (!this.dependencies.openAiConfigured) return { status: 'NOT_CONFIGURED', created: 0 };

    this.reflectionCycleRunning = true;
    let created = 0;
    try {
      const pending = this.dependencies.agentStore.getOutcomesPendingReflection(3);
      let previousLessons = this.dependencies.agentStore.getRecentReflections(5).map(reflection => ({
        lesson: reflection.lesson,
        futureChecks: reflection.futureChecks,
        confidence: reflection.confidence,
      }));

      for (const outcome of pending) {
        const content = await this.dependencies.openAiLock.run(() =>
          reflectOnPaperOutcome(outcome, previousLessons)
        );
        const saved = this.dependencies.agentStore.saveReflectionIfAbsent({
          decisionId: outcome.decisionId,
          outcomeId: outcome.id,
          createdAt: now.toISOString(),
          model: content.model,
          promptVersion: content.promptVersion,
          assessment: content.assessment,
          confidence: content.confidence,
          summary: content.summary,
          predictionErrorAnalysis: content.predictionErrorAnalysis,
          whatWorked: content.whatWorked,
          whatFailed: content.whatFailed,
          lesson: content.lesson,
          futureChecks: content.futureChecks,
        });
        if (saved.created) {
          created++;
          this.log(`🪞 Agent reflection: decision ${outcome.decisionId} (${content.assessment})`);
          previousLessons = [
            {
              lesson: content.lesson,
              futureChecks: content.futureChecks,
              confidence: content.confidence,
            },
            ...previousLessons,
          ].slice(0, 5);
        }
      }

      return { status: pending.length === 0 ? 'NO_PENDING_OUTCOMES' : 'COMPLETED', created };
    } finally {
      this.reflectionCycleRunning = false;
    }
  }

  getReflectionStatus() {
    return {
      enabled: true,
      configured: this.dependencies.openAiConfigured,
      running: this.reflectionCycleRunning,
      totalReflections: this.dependencies.agentStore.reflectionCount(),
      pending168hOutcomes: this.dependencies.agentStore.pendingReflectionCount(),
      promptVersion: REFLECTION_PROMPT_VERSION,
      recentLessons: this.dependencies.agentStore.getRecentReflections(5),
      decisionAuthority: false,
    };
  }

  getPolicy() {
    return {
      strategyVersion: PAPER_AGENT_STRATEGY_VERSION,
      investment: PAPER_AGENT_INVESTMENT,
      forecastDays: ENTRY_FORECAST_DAYS,
      minimumHistoryCoveragePercent: ENTRY_HISTORY_COVERAGE_PERCENT,
      feeRetentionFactor: ENTRY_FEE_RETENTION_FACTOR,
      minimumNetEdgeUsd: ENTRY_MINIMUM_NET_EDGE_USD,
    };
  }
}
