/**
 * ============================================
 * 📚 BNB LP Analyzer - WBNB/USDT Focused API
 * ============================================
 *
 * API khusus untuk WBNB/USDT di PancakeSwap
 */

import 'dotenv/config';
import { type NextFunction, type Request, type Response } from 'express';
import { timingSafeEqual } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { calculateIL, calculateLPInvestmentProjection } from '../amm.js';
import { registerFrontendAndErrorRoutes } from '../bnb-routes.js';
import { APPLICATION_SCHEMA_VERSION } from '../schema-migrations.js';
import { StorageMaintenanceService } from '../storage-maintenance.js';
import type { PaperAgentDecision } from '../agent-store.js';
import {
  AGGRESSIVE_INITIAL_CAPITAL_USD,
  AGGRESSIVE_MAX_HOLD_HOURS,
  AGGRESSIVE_MAX_RECENTERS,
  AGGRESSIVE_NORMAL_COOLDOWN_HOURS,
  AGGRESSIVE_OUT_OF_RANGE_CONFIRMATION_MINUTES,
  AGGRESSIVE_PAPER_STRATEGY_VERSION,
  AGGRESSIVE_RECENTER_SLIPPAGE_BPS,
  AGGRESSIVE_RISK_COOLDOWN_HOURS,
  AGGRESSIVE_STOP_LOSS_PERCENT,
  AGGRESSIVE_TARGET_RETURN_PERCENT,
  processAggressivePaperLifecycle,
} from '../aggressive-paper-manager.js';
import { REFLECTION_PROMPT_VERSION, reflectOnPaperOutcome } from '../agent-reflection.js';
import { runDirectionalForwardCycle } from '../directional-paper-manager.js';
import { DEFAULT_DIRECTIONAL_CONFIG, DIRECTIONAL_STRATEGY_VERSION } from '../directional-strategy.js';
import { getPoolByAddress } from '../dexscreener.js';
import { evaluateExecutionReadiness } from '../execution-control.js';
import { registerAggressivePaperRoutes } from '../features/aggressive-paper/index.js';
import { registerDirectionalPaperRoutes } from '../features/directional-paper/index.js';
import { registerLearningRoutes } from '../features/learning/index.js';
import { registerLpAnalysisRoutes } from '../features/lp-analysis/index.js';
import { registerLpExecutionRoutes } from '../features/lp-execution/index.js';
import { registerMarketDataRoutes } from '../features/market-data/index.js';
import { registerOperationsRoutes } from '../features/operations/index.js';
import { registerPaperAgentRoutes } from '../features/paper-agent/index.js';
import {
  estimateFullRangeFeeBetweenCheckpoints,
  FULL_RANGE_FEE_ACCOUNTING_VERSION,
  projectFullRangeFee24h,
} from '../full-range-fee.js';
import { verifyPositionManagerAdapter } from '../pancakeswap-v3-execution.js';
import { PANCAKE_V3_SWAP_ROUTER, verifyPancakeV3SwapRouter } from '../pancakeswap-v3-exit.js';
import {
  applyLearningModel,
  MIN_TRAINING_ROWS,
  RETRAIN_EVERY_NEW_OUTCOMES,
  trainWalkForwardCandidate,
} from '../learning-model.js';
import {
  buildHighRiskStrategyPlan,
  HIGH_RISK_FEE_RETENTION_FACTOR,
  HIGH_RISK_HISTORY_WINDOW_HOURS,
  HIGH_RISK_MAX_RECENTERS_PER_MONTH,
  HIGH_RISK_MIN_HISTORY_COVERAGE_PERCENT,
  HIGH_RISK_RECENTER_SLIPPAGE_BPS,
  HIGH_RISK_STOP_LOSS_PERCENT,
  HIGH_RISK_TARGET_MONTHLY_RETURN_PERCENT,
} from '../high-risk-strategy.js';
import { simulateFullRangeLP, type FullRangeLPSimulation } from '../lp-simulator.js';
import { analyzeLPWithOpenAI } from '../openai-analysis.js';
import type { OnchainPoolSnapshot } from '../onchain-store.js';
import { AsyncLock, ConcurrencyGate, SchedulerRegistry } from '../operational-controls.js';
import {
  ENTRY_VERDICT_HORIZON_HOURS,
  interpretPaperOutcomeLifecycle,
  OUTCOME_INTERPRETATION_VERSION,
} from '../outcome-interpretation.js';
import {
  assessPaperOutcomeEconomics,
  ASSUMED_ENTRY_GAS_UNITS,
  ASSUMED_EXIT_GAS_UNITS,
  ECONOMIC_SLIPPAGE_BPS_PER_LEG,
  gasCostUsd,
  MINIMUM_ACTIONABLE_EDGE_USD,
  OUTCOME_ASSESSMENT_VERSION,
  type OutcomeGasContext,
} from '../outcome-assessment.js';
import { estimateLifecycleGas, processPaperPositionLifecycle } from '../paper-position-manager.js';
import {
  feeGrowthDelta,
  feeGrowthX128ToTokenPerLiquidity,
  fetchPancakeV3OnchainState,
  type PancakeV3OnchainState,
} from '../pancakeswap-v3-onchain.js';
import {
  ENTRY_FEE_RETENTION_FACTOR,
  ENTRY_FORECAST_DAYS,
  ENTRY_HISTORY_COVERAGE_PERCENT,
  ENTRY_MINIMUM_NET_EDGE_USD,
  makeBaselinePaperDecision,
  PAPER_AGENT_INVESTMENT,
  PAPER_AGENT_STRATEGY_VERSION,
} from '../paper-agent.js';
import {
  evaluatePaperDecision,
  makeSkippedPaperOutcome,
  OUTCOME_DATA_GRACE_MS,
  OUTCOME_SNAPSHOT_MIN_COVERAGE_PERCENT,
  OUTCOME_TARGET_SNAPSHOT_MAX_AGE_MS,
  PAPER_AGENT_HORIZONS,
} from '../paper-agent-evaluator.js';
import type { AILPAnalysis, LPAnalysisMetrics } from '../openai-analysis.js';
import type { LPInvestmentProjection, Pair } from '../types.js';
import { safeErrorMessage } from '../shared/http/errors.js';
import { SingleFlight } from '../upstream-resilience.js';
import { loadBnbAppConfig } from './config.js';
import { BnbServiceContainer } from './container.js';
import { createBnbHttpApp } from './create-app.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const config = loadBnbAppConfig();
const http = createBnbHttpApp(config, join(__dirname, '../../public'));
const { app } = http;
const services = new BnbServiceContainer();
const {
  snapshotStore,
  agentStore,
  executionStore,
  onchainStore,
  positionStore,
  aggressivePaperStore,
  directionalPaperStore,
  shadowModeStore,
  lifecycleActivationStore,
} = services;
const storageMaintenance = new StorageMaintenanceService(snapshotStore, onchainStore, config.backupDirectory);

function getLifecycleCompatibleActiveModel() {
  const active = agentStore.getActiveModel();
  return active &&
    active.trainingRows >= MIN_TRAINING_ROWS &&
    active.model.featureNames.includes('predictedNetEdge7d')
    ? active
    : null;
}

const EXECUTION_CONFIG = config.execution;
const POSITION_LIFECYCLE_ENABLED = config.positionLifecycleEnabled;
const AGGRESSIVE_PAPER_ENABLED = config.aggressivePaperEnabled;
const DIRECTIONAL_PAPER_ENABLED = config.directionalPaperEnabled;
const MINT_RECEIPT_MIN_CONFIRMATIONS = config.mintReceiptMinimumConfirmations;
let executionAdapterVerified = false;
let exitSwapRouterVerified = false;
let shuttingDown = false;

const schedulerRegistry = new SchedulerRegistry();
const aiSingleFlight = new SingleFlight();
const openAiLock = new AsyncLock();
const rpcHeavyGate = new ConcurrencyGate(config.rpcHeavyConcurrency);

function rpcHeavyLimit(req: Request, res: Response, next: NextFunction): void {
  const release = rpcHeavyGate.tryAcquire();
  if (!release) {
    res.setHeader('Retry-After', '1');
    res
      .status(429)
      .json({ success: false, error: 'RPC concurrency limit reached', timestamp: new Date().toISOString() });
    return;
  }
  let done = false;
  const finish = () => {
    if (!done) {
      done = true;
      release();
    }
  };
  res.once('finish', finish);
  res.once('close', finish);
  next();
}

// Pool WBNB/USDT PancakeSwap V3 dengan fee tier 0,01% (100).
// Fee tier diverifikasi melalui fee() pool contract di BNB Smart Chain.
const CHAIN_ID = 'bsc';
const WBNB_USDT_POOL_ADDRESS = '0x172fcD41E0913e95784454622d1c3724f546f849';
const FEE_RATE = 0.0001;

// ============================================
// 📌 Cache (simple in-memory)
// ============================================

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const cache = new Map<string, CacheEntry<unknown>>();
const CACHE_TTL = 60 * 1000; // 1 minute
const AI_ANALYSIS_CACHE_TTL = 15 * 60 * 1000; // 15 minutes

function getCached<T>(key: string, ttl = CACHE_TTL): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > ttl) {
    cache.delete(key);
    return null;
  }
  return entry.data as T;
}

function setCache<T>(key: string, data: T): void {
  cache.set(key, { data, timestamp: Date.now() });
}

// ============================================
// 📌 Get WBNB/USDT Pair Data
// ============================================

async function getWBNBUSDTPair(): Promise<Pair> {
  const cached = getCached<Pair>('wbnbusdt');
  if (cached) return cached;

  const pair = await getPoolByAddress(CHAIN_ID, WBNB_USDT_POOL_ADDRESS);
  if (
    !pair ||
    pair.chainId !== CHAIN_ID ||
    pair.dexId !== 'pancakeswap' ||
    pair.baseToken?.symbol !== 'WBNB' ||
    pair.quoteToken?.symbol !== 'USDT' ||
    !pair.labels?.includes('v3')
  ) {
    throw new Error('Configured PancakeSwap V3 WBNB/USDT 0.01% pool is unavailable');
  }

  setCache('wbnbusdt', pair);
  return pair;
}

// ============================================
// 📌 Analyze WBNB/USDT
// ============================================

interface WBNBUSDTAnalysis {
  price: number;
  tvl: number;
  volume24h: number;
  volume6h: number;
  volume1h: number;
  volLiqRatio: number;
  estimatedFees24h: number;
  estimatedAPR: number;
  priceChange1h: number;
  priceChange6h: number;
  priceChange24h: number;
  txns24h: { buys: number; sells: number };
  wbnbInPool: number;
  usdtInPool: number;
  pairAddress: string;
}

function analyzeWBNBUSDT(pair: Pair): WBNBUSDTAnalysis {
  const price = parseFloat(pair.priceUsd);
  const tvl = pair.liquidity?.usd || 0;
  const volume24h = pair.volume?.h24 || 0;
  const volume6h = pair.volume?.h6 || 0;
  const volume1h = pair.volume?.h1 || 0;

  const volLiqRatio = tvl > 0 ? volume24h / tvl : 0;
  const estimatedFees24h = volume24h * FEE_RATE; // estimasi sebelum protocol fee
  const estimatedAPR = tvl > 0 ? ((estimatedFees24h * 365) / tvl) * 100 : 0;

  return {
    price,
    tvl,
    volume24h,
    volume6h,
    volume1h,
    volLiqRatio,
    estimatedFees24h,
    estimatedAPR,
    priceChange1h: pair.priceChange?.h1 || 0,
    priceChange6h: pair.priceChange?.h6 || 0,
    priceChange24h: pair.priceChange?.h24 || 0,
    txns24h: pair.txns?.h24 || { buys: 0, sells: 0 },
    wbnbInPool: pair.liquidity?.base || 0,
    usdtInPool: pair.liquidity?.quote || 0,
    pairAddress: pair.pairAddress,
  };
}

async function capturePoolSnapshot(): Promise<WBNBUSDTAnalysis> {
  const pair = await getWBNBUSDTPair();
  const analysis = analyzeWBNBUSDT(pair);
  snapshotStore.save(analysis);
  return analysis;
}

interface OnchainHealth {
  ready: boolean;
  lastSuccessAt: string | null;
  lastError: string | null;
}

let onchainHealth: OnchainHealth = {
  ready: false,
  lastSuccessAt: null,
  lastError: null,
};

async function captureOnchainPoolState() {
  const cached = getCached<
    Awaited<ReturnType<typeof fetchPancakeV3OnchainState>> & {
      historyDelta: Record<string, unknown> | null;
    }
  >('pancake-v3-onchain', CACHE_TTL);
  if (cached) return cached;

  try {
    const state = await fetchPancakeV3OnchainState();
    onchainStore.saveIfAbsent(state);
    const snapshots = onchainStore.getRecent(2);
    const previous = snapshots.find(snapshot => snapshot.blockNumber !== state.blockNumber);
    const historyDelta = previous
      ? (() => {
          const delta0 = feeGrowthDelta(state.feeGrowthGlobal0X128, previous.feeGrowthGlobal0X128);
          const delta1 = feeGrowthDelta(state.feeGrowthGlobal1X128, previous.feeGrowthGlobal1X128);
          return {
            previousBlockNumber: previous.blockNumber,
            previousCapturedAt: previous.capturedAt,
            elapsedSeconds: Math.max(
              0,
              (new Date(state.blockTimestamp).getTime() - new Date(previous.blockTimestamp).getTime()) / 1_000
            ),
            feeGrowthGlobal0DeltaX128: delta0,
            feeGrowthGlobal1DeltaX128: delta1,
            token0PerLiquidity: feeGrowthX128ToTokenPerLiquidity(delta0),
            token1PerLiquidity: feeGrowthX128ToTokenPerLiquidity(delta1),
          };
        })()
      : null;
    const result = { ...state, historyDelta };
    setCache('pancake-v3-onchain', result);
    onchainHealth = { ready: true, lastSuccessAt: state.capturedAt, lastError: null };
    return result;
  } catch (error) {
    onchainHealth = {
      ...onchainHealth,
      ready: false,
      lastError: error instanceof Error ? error.message : 'Unknown on-chain error',
    };
    throw error;
  }
}

// ============================================
// 📌 LP Simulator
// ============================================

function buildLPAnalysisMetrics(analysis: WBNBUSDTAnalysis): LPAnalysisMetrics {
  const scenarioChanges = [-50, -20, 20, 50, 100];
  const historicalContext = snapshotStore.getStatistics();
  const widestPeriod = historicalContext.find(period => period.label === '30d');
  const firstTimestamp = widestPeriod?.firstCapturedAt
    ? new Date(widestPeriod.firstCapturedAt).getTime()
    : null;
  const latestTimestamp = widestPeriod?.latestCapturedAt
    ? new Date(widestPeriod.latestCapturedAt).getTime()
    : null;

  return {
    pair: 'WBNB/USDT',
    chain: CHAIN_ID,
    dex: 'PancakeSwap V3',
    feeTierPercent: FEE_RATE * 100,
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
    ilScenarios: scenarioChanges.map(priceChangePercent => ({
      priceChangePercent,
      ilPercent: calculateIL(100, 100 * (1 + priceChangePercent / 100), 10_000).ilPercent,
    })),
    historicalContext,
    historyDataQuality: {
      totalRows: widestPeriod?.count ?? 0,
      availableHours:
        firstTimestamp !== null && latestTimestamp !== null
          ? (latestTimestamp - firstTimestamp) / (60 * 60 * 1000)
          : 0,
      firstCapturedAt: widestPeriod?.firstCapturedAt ?? null,
      latestCapturedAt: widestPeriod?.latestCapturedAt ?? null,
    },
    agentLessons: agentStore.getRecentReflections(5).map(reflection => ({
      lesson: reflection.lesson,
      futureChecks: reflection.futureChecks,
      confidence: reflection.confidence,
      createdAt: reflection.createdAt,
    })),
    onchainContext: (() => {
      const snapshot = onchainStore.getRecent(1)[0];
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
      const latestDecision = agentStore.getRecent(1)[0] ?? null;
      const performance168h = agentStore.getPerformance(168);
      const activeModel = getLifecycleCompatibleActiveModel();
      const execution = getExecutionStatus();
      return {
        mode: 'paper' as const,
        totalDecisions: agentStore.count(),
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

function buildCurrentHighRiskPlan(
  analysis: WBNBUSDTAnalysis,
  onchain: PancakeV3OnchainState,
  investment = aggressivePaperStore.getAvailableCapital(AGGRESSIVE_INITIAL_CAPITAL_USD)
) {
  const gas = estimateLifecycleGas(onchain);
  const stats7d = snapshotStore.getStatistics().find(period => period.label === '7d');
  const history7d = snapshotStore.getHistory(HIGH_RISK_HISTORY_WINDOW_HOURS, 10_080);
  const averageVolume24h = stats7d?.volume24h.average;
  const conservativeVolume24h =
    averageVolume24h !== null && averageVolume24h !== undefined
      ? Math.min(analysis.volume24h, averageVolume24h)
      : analysis.volume24h;
  return buildHighRiskStrategyPlan({
    investment,
    currentPrice: onchain.priceWbnbUsd,
    volume24h: analysis.volume24h,
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

function runAggressivePaperLifecycle(
  plan: ReturnType<typeof buildCurrentHighRiskPlan> | null,
  onchain: PancakeV3OnchainState | null,
  now: Date
) {
  if (!AGGRESSIVE_PAPER_ENABLED) return null;
  try {
    const result = processAggressivePaperLifecycle({
      plan,
      onchain,
      store: aggressivePaperStore,
      snapshotStore,
      initialCapitalUsd: AGGRESSIVE_INITIAL_CAPITAL_USD,
      now,
    });
    if (result.reasonCode !== 'HOURLY_AGGRESSIVE_LIFECYCLE_ALREADY_PROCESSED') {
      console.log(`🔥 Aggressive paper: ${result.action} (${result.reasonCode})`);
    }
    return result;
  } catch (error) {
    console.error('Aggressive paper lifecycle error:', error);
    return null;
  }
}

function runDirectionalPaperCycle(now = new Date()) {
  if (!DIRECTIONAL_PAPER_ENABLED) return null;
  const performance = runDirectionalForwardCycle({
    store: directionalPaperStore,
    snapshotStore,
    config: DEFAULT_DIRECTIONAL_CONFIG,
    now,
  });
  const latest = performance?.latestDecision;
  if (latest && latest.action !== 'WAIT' && latest.action !== 'HOLD') {
    console.log(`📈 Directional paper: ${latest.action} (${latest.reasonCode})`);
  }
  return performance;
}

function runShadowPositionLifecycle(
  signal: PaperAgentDecision,
  market: WBNBUSDTAnalysis,
  onchain: PancakeV3OnchainState | null,
  now: Date
) {
  try {
    const result = processPaperPositionLifecycle({
      signal,
      market: { price: market.price, tvl: market.tvl, volume1h: market.volume1h },
      onchain,
      positionStore,
      snapshotStore,
      now,
    });
    shadowModeStore.recordSuccess(signal, result, now);
    return result;
  } catch (error) {
    shadowModeStore.recordFailure(signal, error, now);
    reconcileLifecycleActivation(now);
    throw error;
  }
}

async function runHourlyPaperAgent(now = new Date()) {
  const decisionHour = new Date(now);
  decisionHour.setUTCMinutes(0, 0, 0);
  const existing = agentStore.getByDecisionHour(decisionHour.toISOString());
  const [analysis, onchain] = await Promise.all([
    capturePoolSnapshot(),
    captureOnchainPoolState().catch(() => null),
  ]);
  const aggressivePlan = onchain ? buildCurrentHighRiskPlan(analysis, onchain) : null;

  if (existing) {
    if (POSITION_LIFECYCLE_ENABLED) {
      runShadowPositionLifecycle(existing, analysis, onchain, now);
    }
    runAggressivePaperLifecycle(aggressivePlan, onchain, now);
    return { decision: existing, created: false };
  }

  const historicalStatistics = snapshotStore.getStatistics();
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
    historicalStatistics,
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
  const reflectionLessons = agentStore.getRecentReflections(3).map(reflection => ({
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
  const activeModel = getLifecycleCompatibleActiveModel();
  const decision = activeModel
    ? applyLearningModel(baselineDecision, activeModel.version, activeModel.model)
    : baselineDecision;

  const saved = agentStore.saveIfAbsent(decision);
  if (saved.created) {
    console.log(`🧠 Paper agent: ${saved.decision.action} (${saved.decision.reasonCode})`);
  }
  if (POSITION_LIFECYCLE_ENABLED) {
    const lifecycle = runShadowPositionLifecycle(saved.decision, analysis, onchain, now);
    console.log(`🧭 Position lifecycle: ${lifecycle.action} (${lifecycle.reasonCode})`);
  }
  runAggressivePaperLifecycle(aggressivePlan, onchain, now);
  return saved;
}

function freshOnchainSnapshotAtOrBefore(timestamp: string): OnchainPoolSnapshot | null {
  const snapshot = onchainStore.getAtOrBefore(timestamp);
  if (!snapshot) return null;
  const ageMs = new Date(timestamp).getTime() - new Date(snapshot.capturedAt).getTime();
  return ageMs >= 0 && ageMs <= 30 * 60 * 1_000 ? snapshot : null;
}

function outcomeGasContext(
  outcome: { status: string; targetAt: string; decision: { createdAt: string } },
  fallback: OnchainPoolSnapshot | null
): OutcomeGasContext | null {
  const entrySnapshot = freshOnchainSnapshotAtOrBefore(outcome.decision.createdAt);
  const exitSnapshot = freshOnchainSnapshotAtOrBefore(outcome.targetAt);
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

function processPendingPaperOutcomeMetadata(now = new Date()): {
  assessments: number;
  interpretations: number;
} {
  const fallback = onchainStore.getRecent(1)[0] ?? null;
  let assessments = 0;
  for (const outcome of agentStore.getOutcomesPendingAssessment(500)) {
    const gas = outcomeGasContext(outcome, fallback);
    if (!gas) continue;
    const result = agentStore.saveOutcomeAssessmentIfAbsent(assessPaperOutcomeEconomics(outcome, gas, now));
    if (result.created) assessments++;
  }

  let interpretations = 0;
  for (const outcome of agentStore.getOutcomesPendingInterpretation(500)) {
    const gas = outcomeGasContext(outcome, fallback);
    if (!gas) continue;
    const result = agentStore.saveOutcomeInterpretationIfAbsent(
      interpretPaperOutcomeLifecycle(outcome, gas, now)
    );
    if (result.created) interpretations++;
  }
  return { assessments, interpretations };
}

function observedFullRangeFeeForOutcome(decision: PaperAgentDecision, targetAt: Date) {
  const entry = freshOnchainSnapshotAtOrBefore(decision.createdAt);
  const exit = freshOnchainSnapshotAtOrBefore(targetAt.toISOString());
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

function evaluateDuePaperDecisions(now = new Date()): number {
  let createdOutcomes = 0;

  for (const horizonHours of PAPER_AGENT_HORIZONS) {
    const dueDecisions = agentStore.getDueDecisions(horizonHours, now);

    for (const decision of dueDecisions) {
      const startedAt = new Date(decision.createdAt);
      const targetAt = new Date(startedAt.getTime() + horizonHours * 60 * 60 * 1_000);
      const snapshots = snapshotStore.getSnapshotsBetween(startedAt, targetAt);
      const exitSnapshot = snapshotStore.getSnapshotAtOrBefore(targetAt, OUTCOME_TARGET_SNAPSHOT_MAX_AGE_MS);
      const expectedSnapshots = horizonHours * 60;
      const coveragePercent = (snapshots.length / expectedSnapshots) * 100;
      const observedFee = observedFullRangeFeeForOutcome(decision, targetAt);

      if (exitSnapshot && observedFee && coveragePercent >= OUTCOME_SNAPSHOT_MIN_COVERAGE_PERCENT) {
        const result = agentStore.saveOutcomeIfAbsent(
          evaluatePaperDecision(decision, horizonHours, exitSnapshot, snapshots, observedFee, now)
        );
        if (result.created) {
          createdOutcomes++;
          console.log(
            `📋 Paper outcome: decision ${decision.id}, ${horizonHours}h, correct=${result.outcome.actionCorrect}`
          );
        }
      } else if (now.getTime() - targetAt.getTime() >= OUTCOME_DATA_GRACE_MS) {
        const reason = !exitSnapshot
          ? 'Outcome dilewati karena tidak ada snapshot dekat waktu target.'
          : !observedFee
            ? 'Outcome dilewati karena checkpoint fee-growth on-chain dekat entry atau target tidak tersedia.'
            : `Outcome dilewati karena coverage snapshot ${coveragePercent.toFixed(1)}% berada di bawah 80%.`;
        const result = agentStore.saveOutcomeIfAbsent(
          makeSkippedPaperOutcome(decision, horizonHours, now, snapshots.length, reason)
        );
        if (result.created) {
          createdOutcomes++;
          console.log(`⚠️ Paper outcome skipped: decision ${decision.id}, ${horizonHours}h`);
        }
      }
    }
  }

  const metadata = processPendingPaperOutcomeMetadata(now);
  if (metadata.assessments > 0 || metadata.interpretations > 0) {
    console.log(
      `⚖️ Outcome metadata: ${metadata.assessments} legacy assessments, ${metadata.interpretations} lifecycle interpretations`
    );
  }
  return createdOutcomes;
}

let reflectionCycleRunning = false;

async function runReflectionCycle(now = new Date()) {
  if (reflectionCycleRunning) return { status: 'ALREADY_RUNNING', created: 0 };
  if (!config.openAiConfigured) return { status: 'NOT_CONFIGURED', created: 0 };

  reflectionCycleRunning = true;
  let created = 0;
  try {
    const pending = agentStore.getOutcomesPendingReflection(3);
    let previousLessons = agentStore.getRecentReflections(5).map(reflection => ({
      lesson: reflection.lesson,
      futureChecks: reflection.futureChecks,
      confidence: reflection.confidence,
    }));

    for (const outcome of pending) {
      const content = await openAiLock.run(() => reflectOnPaperOutcome(outcome, previousLessons));
      const saved = agentStore.saveReflectionIfAbsent({
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
        console.log(`🪞 Agent reflection: decision ${outcome.decisionId} (${content.assessment})`);
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
    reflectionCycleRunning = false;
  }
}

function getReflectionStatus() {
  return {
    enabled: true,
    configured: config.openAiConfigured,
    running: reflectionCycleRunning,
    totalReflections: agentStore.reflectionCount(),
    pending168hOutcomes: agentStore.pendingReflectionCount(),
    promptVersion: REFLECTION_PROMPT_VERSION,
    recentLessons: agentStore.getRecentReflections(5),
    decisionAuthority: false,
  };
}

function runLearningCycle(now = new Date()) {
  const examples = agentStore.getLearningExamples();
  const latestModel = agentStore.getLatestModel();
  const activeModel = getLifecycleCompatibleActiveModel();

  if (examples.length < MIN_TRAINING_ROWS) {
    return {
      status: 'COLLECTING_DATA',
      examples: examples.length,
      minimumExamples: MIN_TRAINING_ROWS,
      activeModel,
      latestModel,
    };
  }

  if (latestModel && examples.length < latestModel.trainingRows + RETRAIN_EVERY_NEW_OUTCOMES) {
    return {
      status: 'WAITING_FOR_NEW_OUTCOMES',
      examples: examples.length,
      minimumExamples: MIN_TRAINING_ROWS,
      nextTrainingAtRows: latestModel.trainingRows + RETRAIN_EVERY_NEW_OUTCOMES,
      activeModel,
      latestModel,
    };
  }

  const candidate = trainWalkForwardCandidate(examples);
  if (!candidate) throw new Error('Learning candidate was unavailable after minimum rows');

  const improvesActive =
    activeModel === null || candidate.metrics.accuracyPercent >= activeModel.accuracyPercent + 1;
  const activate = candidate.eligibleForActivation && improvesActive;
  const timestamp = now.toISOString();
  const version = `logistic-${timestamp.replace(/[-:.TZ]/g, '').slice(0, 14)}-n${examples.length}`;
  const gateReason =
    candidate.eligibleForActivation && !improvesActive ? 'ACTIVE_MODEL_NOT_IMPROVED' : candidate.gateReason;
  const savedModel = agentStore.saveModel({
    version,
    trainedAt: timestamp,
    status: activate ? 'ACTIVE' : 'REJECTED',
    trainingRows: examples.length,
    validationRows: candidate.metrics.validationRows,
    accuracyPercent: candidate.metrics.accuracyPercent,
    baselineAccuracyPercent: candidate.metrics.baselineAccuracyPercent,
    brierScore: candidate.metrics.brierScore,
    positiveRows: candidate.metrics.positiveRows,
    negativeRows: candidate.metrics.negativeRows,
    gateReason,
    model: candidate.model,
    activatedAt: activate ? timestamp : null,
  });

  console.log(`🎓 Learning model ${savedModel.version}: ${savedModel.status} (${savedModel.gateReason})`);
  return {
    status: savedModel.status,
    examples: examples.length,
    minimumExamples: MIN_TRAINING_ROWS,
    activeModel: getLifecycleCompatibleActiveModel(),
    latestModel: savedModel,
  };
}

function getLearningStatus() {
  const examples = agentStore.getLearningExamples();
  const latestModel = agentStore.getLatestModel();
  return {
    trainerEnabled: true,
    examples: examples.length,
    minimumExamples: MIN_TRAINING_ROWS,
    progressPercent: Math.min(100, (examples.length / MIN_TRAINING_ROWS) * 100),
    activeModel: getLifecycleCompatibleActiveModel(),
    latestModel,
    nextTrainingAtRows: latestModel
      ? latestModel.trainingRows + RETRAIN_EVERY_NEW_OUTCOMES
      : MIN_TRAINING_ROWS,
    activationGates: {
      minimumAccuracyPercent: 55,
      improvementOverBaselinePercent: 2,
      maximumBrierScore: 0.25,
      minimumClassRows: 10,
      retrainEveryNewOutcomes: RETRAIN_EVERY_NEW_OUTCOMES,
      verdictHorizonHours: ENTRY_VERDICT_HORIZON_HOURS,
      purgeRows: ENTRY_VERDICT_HORIZON_HOURS,
    },
  };
}

async function refreshExecutionAdapterVerification(): Promise<boolean> {
  const [positionManagerResult, swapRouterResult] = await Promise.allSettled([
    verifyPositionManagerAdapter(),
    verifyPancakeV3SwapRouter(),
  ]);
  executionAdapterVerified = positionManagerResult.status === 'fulfilled' && positionManagerResult.value;
  exitSwapRouterVerified = swapRouterResult.status === 'fulfilled' && swapRouterResult.value;
  if (!executionAdapterVerified) {
    console.error('Execution adapter verification error: Position Manager bytecode verification failed');
  }
  if (!exitSwapRouterVerified) {
    console.error(
      'Optional exit swap adapter verification error: PancakeSwap V3 SwapRouter verification failed'
    );
  }
  return executionAdapterVerified;
}

function reconcileLifecycleActivation(now = new Date()) {
  const shadowValidation = shadowModeStore.refreshQualification(now);
  let activation = lifecycleActivationStore.getState();
  if (activation.mode === 'PAPER_ACTIVE' && !shadowValidation.qualified) {
    activation = lifecycleActivationStore.returnToShadow(
      `Automatic fail-closed rollback: ${shadowValidation.blockers.join(', ')}`,
      now
    );
    executionStore.recordAudit(
      'LIFECYCLE_AUTO_RETURNED_TO_SHADOW',
      null,
      {
        shadowRunId: shadowValidation.run.id,
        blockers: shadowValidation.blockers,
      },
      now
    );
  }
  return {
    activation,
    shadowValidation,
    activationEligible: POSITION_LIFECYCLE_ENABLED && shadowValidation.qualified,
  };
}

function getExecutionStatus(now = new Date()) {
  const control = executionStore.getControl();
  const performance168h = agentStore.getPerformance(168);
  const latestDecision = agentStore.getRecent(1)[0] ?? null;
  const realizedLossTodayUsd = executionStore.getRealizedLossToday(now);
  const lifecycleRuntime = reconcileLifecycleActivation(now);
  const shadowValidation = lifecycleRuntime.shadowValidation;
  const readiness = evaluateExecutionReadiness({
    liveExecutionEnabled: EXECUTION_CONFIG.liveExecutionEnabled,
    adminTokenConfigured: EXECUTION_CONFIG.adminToken.length >= 32,
    onchainAdapterReady: executionAdapterVerified && onchainHealth.ready,
    shadowValidationQualified: shadowValidation.qualified,
    paperLifecycleActive: lifecycleRuntime.activation.mode === 'PAPER_ACTIVE',
    killSwitchEngaged: control.killSwitchEngaged,
    activeModel: getLifecycleCompatibleActiveModel(),
    performance168h,
    latestDecision,
    realizedLossTodayUsd,
    now,
    limits: EXECUTION_CONFIG.limits,
  });

  return {
    ...readiness,
    control,
    limits: EXECUTION_CONFIG.limits,
    realizedLossTodayUsd,
    shadowValidation,
    lifecycleActivation: lifecycleRuntime.activation,
    liveExecutionEnabled: EXECUTION_CONFIG.liveExecutionEnabled,
    adminTokenConfigured: EXECUTION_CONFIG.adminToken.length >= 32,
    onchainDataAdapterReady: onchainHealth.ready,
    onchainExecutionAdapterReady: executionAdapterVerified && onchainHealth.ready,
    privateKeyStoredByServer: false,
    unsignedTransactionPlanningAvailable: executionAdapterVerified,
    mintReceiptVerificationAvailable: executionAdapterVerified,
    mintReceiptMinimumConfirmations: MINT_RECEIPT_MIN_CONFIRMATIONS,
    trackedLiveNfts: positionStore.getRecentLiveNfts(10),
    unsignedExitPlanningAvailable: executionAdapterVerified,
    optionalExitSwapAvailable: exitSwapRouterVerified,
    exitSwapRouter: PANCAKE_V3_SWAP_ROUTER,
    recentExitProposals: executionStore.getRecentExitProposals(10),
    transactionSigningAvailable: false,
    broadcastAvailable: false,
    approvalEffect:
      'Approval permits preparation of an unsigned full-range mint plan; an external wallet must explicitly sign every transaction.',
    recentProposals: executionStore.getRecentProposals(10),
  };
}

function isExecutionAdminAuthorized(authorization: string | undefined): boolean {
  if (EXECUTION_CONFIG.adminToken.length < 32 || !authorization?.startsWith('Bearer ')) {
    return false;
  }
  const provided = Buffer.from(authorization.slice('Bearer '.length));
  const expected = Buffer.from(EXECUTION_CONFIG.adminToken);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

function buildCurrentInvestmentProjection(
  analysis: WBNBUSDTAnalysis,
  onchain: PancakeV3OnchainState,
  investment = PAPER_AGENT_INVESTMENT
): LPInvestmentProjection {
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

function simulateLP(
  investment: number,
  analysis: WBNBUSDTAnalysis,
  onchain: PancakeV3OnchainState
): FullRangeLPSimulation {
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

// ============================================
// 📌 API Routes
// ============================================

function getReadiness(now = Date.now()) {
  const checks: Record<string, { ready: boolean; detail: string }> = {};
  try {
    snapshotStore.count();
    onchainStore.count();
    agentStore.count();
    directionalPaperStore.getRecentRuns(1);
    checks.sqlite = { ready: true, detail: 'read/write stores are queryable' };
  } catch {
    checks.sqlite = { ready: false, detail: 'SQLite query failed' };
  }
  const latestMigration = services.appliedMigrations.at(-1);
  checks.schemaMigrations = {
    ready: latestMigration?.version === APPLICATION_SCHEMA_VERSION,
    detail: latestMigration
      ? `version=${latestMigration.version}, name=${latestMigration.name}`
      : 'no schema migration recorded',
  };

  const latestMarket = snapshotStore.getHistory(24, 1)[0] ?? null;
  const latestOnchain = onchainStore.getRecent(1)[0] ?? null;
  const marketAgeMs = latestMarket ? now - new Date(latestMarket.capturedAt).getTime() : Infinity;
  const onchainAgeMs = latestOnchain ? now - new Date(latestOnchain.capturedAt).getTime() : Infinity;
  checks.marketFreshness = {
    ready: marketAgeMs <= 5 * 60_000,
    detail: latestMarket ? `ageMs=${Math.max(0, marketAgeMs)}` : 'no market snapshot',
  };
  checks.onchainFreshness = {
    ready: onchainAgeMs <= 15 * 60_000,
    detail: latestOnchain ? `ageMs=${Math.max(0, onchainAgeMs)}` : 'no on-chain snapshot',
  };
  const schedulers = schedulerRegistry.list().map(status => ({
    ...status,
    lastError: status.lastError ? safeErrorMessage(new Error(status.lastError), 'scheduler failed') : null,
  }));
  const staleRunning = schedulers.filter(
    status =>
      status.state === 'RUNNING' &&
      status.startedAt &&
      now - new Date(status.startedAt).getTime() > 30 * 60_000
  );
  const failedCritical = schedulers.filter(
    status =>
      [
        'market-snapshot',
        'onchain-snapshot',
        'paper-lifecycle',
        'directional-paper',
        'paper-outcome',
        'storage-maintenance',
      ].includes(status.name) &&
      status.lastErrorAt &&
      (!status.lastSuccessAt || status.lastErrorAt > status.lastSuccessAt)
  );
  checks.schedulers = {
    ready: staleRunning.length === 0 && failedCritical.length === 0,
    detail:
      staleRunning.length > 0
        ? `stuck=${staleRunning.map(item => item.name).join(',')}`
        : failedCritical.length > 0
          ? `failed=${failedCritical.map(item => item.name).join(',')}`
          : 'critical schedulers healthy',
  };
  checks.shutdown = {
    ready: !shuttingDown,
    detail: shuttingDown ? 'shutdown in progress' : 'accepting traffic',
  };
  return {
    ready: Object.values(checks).every(check => check.ready),
    checks,
    schedulers,
    activeHttpRequests: http.getActiveHttpRequests(),
    rpcHeavyActive: rpcHeavyGate.active,
    openAiActive: openAiLock.active,
  };
}

registerOperationsRoutes(app, {
  getReadiness,
  getStorageStatus: () => storageMaintenance.getStatus(),
});

registerMarketDataRoutes(app, {
  snapshotStore,
  onchainStore,
  onchainMiddleware: rpcHeavyLimit,
  captureMarketSnapshot: capturePoolSnapshot,
  captureOnchainState: captureOnchainPoolState,
  getOnchainHealth: () => onchainHealth,
  isExecutionAdapterReady: () => executionAdapterVerified,
});

registerLpExecutionRoutes(app, {
  lifecycle: {
    positionStore,
    executionStore,
    lifecycleActivationStore,
    shadowModeStore,
    lifecycleEnabled: POSITION_LIFECYCLE_ENABLED,
    mintReceiptMinimumConfirmations: MINT_RECEIPT_MIN_CONFIRMATIONS,
    reconcileLifecycle: reconcileLifecycleActivation,
    isAdminAuthorized: isExecutionAdminAuthorized,
    isExecutionAdapterReady: () => executionAdapterVerified,
    isExitSwapRouterReady: () => exitSwapRouterVerified,
  },
  execution: {
    agentStore,
    executionStore,
    positionStore,
    limits: EXECUTION_CONFIG.limits,
    mintReceiptMinimumConfirmations: MINT_RECEIPT_MIN_CONFIRMATIONS,
    getExecutionStatus,
    isAdminAuthorized: isExecutionAdminAuthorized,
    captureOnchainState: captureOnchainPoolState,
    isExecutionAdapterReady: () => executionAdapterVerified,
    setExecutionAdapterReady: value => {
      executionAdapterVerified = value;
    },
    isExitSwapRouterReady: () => exitSwapRouterVerified,
    setExitSwapRouterReady: value => {
      exitSwapRouterVerified = value;
    },
  },
});

// Current high-risk/high-gain concentrated strategy advisory and actual paper portfolio
registerAggressivePaperRoutes(app, {
  store: aggressivePaperStore,
  enabled: AGGRESSIVE_PAPER_ENABLED,
  strategyVersion: AGGRESSIVE_PAPER_STRATEGY_VERSION,
  policy: {
    initialCapitalUsd: AGGRESSIVE_INITIAL_CAPITAL_USD,
    targetReturnPercent: AGGRESSIVE_TARGET_RETURN_PERCENT,
    stopLossPercent: AGGRESSIVE_STOP_LOSS_PERCENT,
    outOfRangeConfirmationMinutes: AGGRESSIVE_OUT_OF_RANGE_CONFIRMATION_MINUTES,
    maxRecentersPerCycle: AGGRESSIVE_MAX_RECENTERS,
    recenterSlippageBps: AGGRESSIVE_RECENTER_SLIPPAGE_BPS,
    maxHoldHours: AGGRESSIVE_MAX_HOLD_HOURS,
    normalCooldownHours: AGGRESSIVE_NORMAL_COOLDOWN_HOURS,
    riskCooldownHours: AGGRESSIVE_RISK_COOLDOWN_HOURS,
  },
  highRiskPlanMiddleware: rpcHeavyLimit,
  async loadHighRiskPlan() {
    const [pair, onchain] = await Promise.all([getWBNBUSDTPair(), captureOnchainPoolState()]);
    return buildCurrentHighRiskPlan(analyzeWBNBUSDT(pair), onchain);
  },
});

registerDirectionalPaperRoutes(app, {
  store: directionalPaperStore,
  enabled: DIRECTIONAL_PAPER_ENABLED,
  strategyVersion: DIRECTIONAL_STRATEGY_VERSION,
  config: DEFAULT_DIRECTIONAL_CONFIG,
});

registerPaperAgentRoutes(app, {
  store: agentStore,
  policy: {
    strategyVersion: PAPER_AGENT_STRATEGY_VERSION,
    investment: PAPER_AGENT_INVESTMENT,
    entryPolicy: {
      forecastDays: ENTRY_FORECAST_DAYS,
      minimumHistoryCoveragePercent: ENTRY_HISTORY_COVERAGE_PERCENT,
      feeRetentionFactor: ENTRY_FEE_RETENTION_FACTOR,
      minimumNetEdgeUsd: ENTRY_MINIMUM_NET_EDGE_USD,
      includesStressIL: true,
      includesEntryAndExitGas: true,
      transactionPath: 'BALANCED_TOKENS_MINT_WITHDRAW',
      implicitSwapSlippageUsd: 0,
    },
    highRiskAdvisoryPolicy: {
      targetMonthlyReturnPercent: HIGH_RISK_TARGET_MONTHLY_RETURN_PERCENT,
      feeRetentionFactor: HIGH_RISK_FEE_RETENTION_FACTOR,
      maxRecentersPerMonth: HIGH_RISK_MAX_RECENTERS_PER_MONTH,
      recenterSlippageBps: HIGH_RISK_RECENTER_SLIPPAGE_BPS,
      stopLossPercent: HIGH_RISK_STOP_LOSS_PERCENT,
      minimumHistoryCoveragePercent: HIGH_RISK_MIN_HISTORY_COVERAGE_PERCENT,
      historyWindowHours: HIGH_RISK_HISTORY_WINDOW_HOURS,
      conservativeVolumeSource: 'MIN_CURRENT_AND_7D_AVERAGE',
      executionEnabled: false,
      mode: AGGRESSIVE_PAPER_ENABLED ? 'PAPER_PORTFOLIO_ACTIVE' : 'PAPER_DISABLED',
      performanceEndpoint: '/api/agent/aggressive-performance',
    },
    directionalPaperPolicy: {
      strategyVersion: DIRECTIONAL_STRATEGY_VERSION,
      enabled: DIRECTIONAL_PAPER_ENABLED,
      decisionIntervalMinutes: 1,
      initialCapitalUsd: DEFAULT_DIRECTIONAL_CONFIG.initialCapitalUsd,
      leverage: DEFAULT_DIRECTIONAL_CONFIG.leverage,
      marginFraction: DEFAULT_DIRECTIONAL_CONFIG.marginFraction,
      liveExecutionEnabled: false,
      performanceEndpoint: '/api/agent/directional-performance',
    },
    outcomeInterpretation: {
      version: OUTCOME_INTERPRETATION_VERSION,
      entryVerdictHorizonHours: ENTRY_VERDICT_HORIZON_HOURS,
      earlyDiagnosticHorizonsHours: [1, 6, 24],
      minimumActionableEdgeUsd: MINIMUM_ACTIONABLE_EDGE_USD,
      assumedEntryGasUnits: ASSUMED_ENTRY_GAS_UNITS,
      assumedExitGasUnits: ASSUMED_EXIT_GAS_UNITS,
      transactionPath: 'BALANCED_TOKENS_MINT_WITHDRAW',
      applicableSwapSlippageUsd: 0,
      optionalSwapCostedOnlyWhenRequested: true,
      rawOutcomesImmutable: true,
    },
    legacyOutcomeAssessment: {
      version: OUTCOME_ASSESSMENT_VERSION,
      slippageBpsPerLeg: ECONOMIC_SLIPPAGE_BPS_PER_LEG,
      operational: false,
      retainedForAudit: true,
    },
    evaluationHorizonsHours: PAPER_AGENT_HORIZONS,
  },
  getReflectionStatus,
  getLearningStatus,
  isLearningEnabled: () => getLifecycleCompatibleActiveModel() !== null,
});

registerLearningRoutes(app, {
  store: agentStore,
  getLearningStatus,
});

registerLpAnalysisRoutes(app, {
  rpcMiddleware: rpcHeavyLimit,
  aiRateLimitMiddleware: http.limitAiRequests,
  async simulate(investment) {
    const [pair, onchain] = await Promise.all([getWBNBUSDTPair(), captureOnchainPoolState()]);
    return simulateLP(investment, analyzeWBNBUSDT(pair), onchain);
  },
  async generateAiAnalysis() {
    const [pair, onchain] = await Promise.all([getWBNBUSDTPair(), captureOnchainPoolState()]);
    const poolAnalysis = analyzeWBNBUSDT(pair);
    const investmentProjection = buildCurrentInvestmentProjection(poolAnalysis, onchain);
    const cached = getCached<AILPAnalysis>('lp-ai-analysis-v2.7', AI_ANALYSIS_CACHE_TTL);
    if (cached) return { ...cached, investmentProjection, cached: true };

    const generated = await aiSingleFlight.run('lp-ai-analysis-v2.7', async () => {
      const sharedCached = getCached<AILPAnalysis>('lp-ai-analysis-v2.7', AI_ANALYSIS_CACHE_TTL);
      if (sharedCached) return { analysis: sharedCached, cached: true };
      const metrics = buildLPAnalysisMetrics(poolAnalysis);
      const analysis = await openAiLock.run(() => analyzeLPWithOpenAI(metrics));
      setCache('lp-ai-analysis-v2.7', analysis);
      return { analysis, cached: false };
    });
    return { ...generated.analysis, investmentProjection, cached: generated.cached };
  },
});

// ============================================
// 📌 Serve Frontend
// ============================================

registerFrontendAndErrorRoutes(app, join(__dirname, '../../public'), safeErrorMessage);

// ============================================
// 📌 Runtime hooks (no listen/timer side effects)
// ============================================

async function runStorageMaintenance(): Promise<void> {
  const result = await storageMaintenance.run();
  console.log(
    `💾 Storage maintenance: backup=${result.backupCreated}, marketDeleted=${result.deletedMarketSnapshots}, onchainDeleted=${result.deletedOnchainSnapshots}, backupsDeleted=${result.deletedDailyBackups.length}, walBusy=${result.walCheckpoint.busy}`
  );
}

function closeStores(): void {
  services.close();
}

export const bnbRuntime = {
  app,
  port: config.port,
  host: config.host,
  shutdownTimeoutMs: config.shutdownTimeoutMs,
  schedulerRegistry,
  tasks: {
    capturePoolSnapshot,
    captureOnchainPoolState,
    refreshExecutionAdapterVerification,
    runHourlyPaperAgent,
    runDirectionalPaperCycle,
    evaluateDuePaperDecisions,
    runLearningCycle,
    runReflectionCycle,
    runStorageMaintenance,
  },
  setShuttingDown(value: boolean) {
    shuttingDown = value;
  },
  getActiveHttpRequests: http.getActiveHttpRequests,
  closeStores,
};

export type BnbRuntime = typeof bnbRuntime;
export default app;
