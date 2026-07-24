/**
 * ============================================
 * 📚 BNB LP Analyzer - WBNB/USDT Focused API
 * ============================================
 *
 * API khusus untuk WBNB/USDT di PancakeSwap
 */

import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import { timingSafeEqual } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { calculateIL, calculateLPInvestmentProjection } from './amm.js';
import { registerFrontendAndErrorRoutes, registerHealthRoutes } from './bnb-routes.js';
import { BnbServiceContainer } from './bnb-services.js';
import { APPLICATION_SCHEMA_VERSION } from './schema-migrations.js';
import type { PaperAgentDecision } from './agent-store.js';
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
} from './aggressive-paper-manager.js';
import { REFLECTION_PROMPT_VERSION, reflectOnPaperOutcome } from './agent-reflection.js';
import { getPoolByAddress } from './dexscreener.js';
import { evaluateExecutionReadiness } from './execution-control.js';
import {
  estimateFullRangeFeeBetweenCheckpoints,
  FULL_RANGE_FEE_ACCOUNTING_VERSION,
  projectFullRangeFee24h,
} from './full-range-fee.js';
import {
  buildFullRangeMintPlan,
  fetchWalletTokenState,
  PANCAKE_V3_POSITION_MANAGER,
  verifyPositionManagerAdapter,
} from './pancakeswap-v3-execution.js';
import {
  buildFullRangeExitPlan,
  fetchWbnbSwapRouterAllowance,
  PANCAKE_V3_SWAP_ROUTER,
  verifyPancakeV3SwapRouter,
} from './pancakeswap-v3-exit.js';
import { fetchAndVerifyExitReceipts } from './pancakeswap-v3-exit-tracker.js';
import {
  fetchAndVerifyPancakeV3MintReceipt,
  fetchPancakeV3PositionState,
  verifyMintAgainstImmutablePlan,
} from './pancakeswap-v3-position-tracker.js';
import {
  applyLearningModel,
  MIN_TRAINING_ROWS,
  RETRAIN_EVERY_NEW_OUTCOMES,
  trainWalkForwardCandidate,
} from './learning-model.js';
import {
  buildHighRiskStrategyPlan,
  HIGH_RISK_FEE_RETENTION_FACTOR,
  HIGH_RISK_MAX_RECENTERS_PER_MONTH,
  HIGH_RISK_MIN_HISTORY_COVERAGE_PERCENT,
  HIGH_RISK_RECENTER_SLIPPAGE_BPS,
  HIGH_RISK_STOP_LOSS_PERCENT,
  HIGH_RISK_TARGET_MONTHLY_RETURN_PERCENT,
} from './high-risk-strategy.js';
import { simulateFullRangeLP, type FullRangeLPSimulation } from './lp-simulator.js';
import { analyzeLPWithOpenAI } from './openai-analysis.js';
import type { OnchainPoolSnapshot } from './onchain-store.js';
import {
  AsyncLock,
  ConcurrencyGate,
  FixedWindowRateLimiter,
  SchedulerRegistry,
} from './operational-controls.js';
import {
  ENTRY_VERDICT_HORIZON_HOURS,
  interpretPaperOutcomeLifecycle,
  OUTCOME_INTERPRETATION_VERSION,
} from './outcome-interpretation.js';
import {
  assessPaperOutcomeEconomics,
  ASSUMED_ENTRY_GAS_UNITS,
  ASSUMED_EXIT_GAS_UNITS,
  ECONOMIC_SLIPPAGE_BPS_PER_LEG,
  gasCostUsd,
  MINIMUM_ACTIONABLE_EDGE_USD,
  OUTCOME_ASSESSMENT_VERSION,
  type OutcomeGasContext,
} from './outcome-assessment.js';
import { estimateLifecycleGas, processPaperPositionLifecycle } from './paper-position-manager.js';
import {
  feeGrowthDelta,
  feeGrowthX128ToTokenPerLiquidity,
  fetchPancakeV3OnchainState,
  type PancakeV3OnchainState,
} from './pancakeswap-v3-onchain.js';
import {
  ENTRY_FEE_RETENTION_FACTOR,
  ENTRY_FORECAST_DAYS,
  ENTRY_HISTORY_COVERAGE_PERCENT,
  ENTRY_MINIMUM_NET_EDGE_USD,
  makeBaselinePaperDecision,
  PAPER_AGENT_INVESTMENT,
  PAPER_AGENT_STRATEGY_VERSION,
} from './paper-agent.js';
import {
  evaluatePaperDecision,
  makeSkippedPaperOutcome,
  OUTCOME_DATA_GRACE_MS,
  OUTCOME_SNAPSHOT_MIN_COVERAGE_PERCENT,
  OUTCOME_TARGET_SNAPSHOT_MAX_AGE_MS,
  PAPER_AGENT_HORIZONS,
} from './paper-agent-evaluator.js';
import { parsePositiveNumber, parsePositiveNumberOrDefault } from './validation.js';
import type { AILPAnalysis, LPAnalysisMetrics } from './openai-analysis.js';
import type { LPInvestmentProjection, Pair } from './types.js';
import { SingleFlight, UpstreamError } from './upstream-resilience.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const BACKUP_DIR = process.env.SQLITE_BACKUP_DIR || 'backups';
const services = new BnbServiceContainer();
const {
  snapshotStore,
  agentStore,
  executionStore,
  onchainStore,
  positionStore,
  aggressivePaperStore,
  shadowModeStore,
  lifecycleActivationStore,
} = services;

function getLifecycleCompatibleActiveModel() {
  const active = agentStore.getActiveModel();
  return active &&
    active.trainingRows >= MIN_TRAINING_ROWS &&
    active.model.featureNames.includes('predictedNetEdge7d')
    ? active
    : null;
}

function positiveEnvNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const EXECUTION_CONFIG = {
  liveExecutionEnabled: process.env.LIVE_EXECUTION_ENABLED === 'true',
  adminToken: process.env.EXECUTION_ADMIN_TOKEN || '',
  limits: {
    maxCapitalUsd: positiveEnvNumber('LIVE_EXECUTION_MAX_CAPITAL_USD', 100),
    maxDailyLossUsd: positiveEnvNumber('LIVE_EXECUTION_MAX_DAILY_LOSS_USD', 5),
    proposalExpiryMinutes: positiveEnvNumber('LIVE_EXECUTION_PROPOSAL_EXPIRY_MINUTES', 15),
  },
} as const;

const POSITION_LIFECYCLE_ENABLED = process.env.POSITION_LIFECYCLE_ENABLED === 'true';
const AGGRESSIVE_PAPER_ENABLED = process.env.AGGRESSIVE_PAPER_ENABLED !== 'false';
const MINT_RECEIPT_MIN_CONFIRMATIONS = Math.min(
  100,
  Math.max(1, Math.floor(positiveEnvNumber('MINT_RECEIPT_MIN_CONFIRMATIONS', 3)))
);
let executionAdapterVerified = false;
let exitSwapRouterVerified = false;
let shuttingDown = false;
let activeHttpRequests = 0;

const schedulerRegistry = new SchedulerRegistry();
const aiSingleFlight = new SingleFlight();
const openAiLock = new AsyncLock();
const rpcHeavyGate = new ConcurrencyGate(Math.floor(positiveEnvNumber('RPC_HEAVY_CONCURRENCY', 2)));
const globalRateLimiter = new FixedWindowRateLimiter(
  Math.floor(positiveEnvNumber('API_RATE_LIMIT_PER_MINUTE', 120)),
  60_000
);
const aiRateLimiter = new FixedWindowRateLimiter(
  Math.floor(positiveEnvNumber('AI_RATE_LIMIT_PER_15_MINUTES', 4)),
  15 * 60_000
);
const exitAdminRateLimiter = new FixedWindowRateLimiter(
  Math.floor(positiveEnvNumber('EXIT_ADMIN_RATE_LIMIT_PER_MINUTE', 60)),
  60_000
);
const corsAllowedOrigins = new Set(
  (process.env.CORS_ALLOWED_ORIGINS || `http://127.0.0.1:${PORT},http://localhost:${PORT}`)
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean)
);

if (process.env.TRUST_PROXY === 'true') app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'"
  );
  next();
});
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || corsAllowedOrigins.has(origin)) callback(null, true);
      else callback(new Error('CORS origin is not allowed'));
    },
  })
);
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '32kb' }));
app.use((req, res, next) => {
  const json = res.json.bind(res);
  res.json = ((body: unknown) => {
    if (body && typeof body === 'object') {
      const record = body as Record<string, unknown>;
      if (typeof record.error === 'string') {
        record.error = record.error
          .replace(/https?:\/\/[^\s)]+/gi, '[redacted-url]')
          .replace(/(api[_-]?key|token|password|secret)=([^\s&]+)/gi, '$1=[redacted]');
      }
    }
    return json(body);
  }) as Response['json'];
  next();
});
app.use((req, res, next) => {
  activeHttpRequests++;
  let completed = false;
  const finish = () => {
    if (!completed) {
      completed = true;
      activeHttpRequests--;
    }
  };
  res.once('finish', finish);
  res.once('close', finish);
  next();
});

function rateLimitRequest(
  limiter: FixedWindowRateLimiter,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const result = limiter.consume(req.ip || req.socket.remoteAddress || 'unknown');
  if (result.allowed) {
    next();
    return;
  }
  res.setHeader('Retry-After', String(result.retryAfterSeconds));
  res.status(429).json({
    success: false,
    error: 'Too many requests',
    timestamp: new Date().toISOString(),
  });
}

const isRiskReductionExitPath = (path: string) => path.startsWith('/api/execution/exit-proposals');
app.use('/api', (req, res, next) => {
  if (req.path === '/health' || req.path.startsWith('/health/')) return next();
  if (isRiskReductionExitPath(req.originalUrl)) {
    rateLimitRequest(exitAdminRateLimiter, req, res, next);
    return;
  }
  rateLimitRequest(globalRateLimiter, req, res, next);
});
app.use(express.static(join(__dirname, '../public')));

function safeErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return error.message
    .replace(/https?:\/\/[^\s)]+/gi, '[redacted-url]')
    .replace(/(api[_-]?key|token|password|secret)=([^\s&]+)/gi, '$1=[redacted]');
}

function upstreamErrorCode(error: unknown): string {
  return error instanceof UpstreamError ? error.code : 'UPSTREAM_UNAVAILABLE';
}

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
  const stats24h = snapshotStore.getStatistics().find(period => period.label === '24h');
  const history24hPrices = snapshotStore.getHistory(24, 1_440).map(snapshot => snapshot.price);
  return buildHighRiskStrategyPlan({
    investment,
    currentPrice: onchain.priceWbnbUsd,
    volume24h: analysis.volume24h,
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
    history24hCoveragePercent: stats24h?.coveragePercent ?? 0,
    history24hPrices,
  });
}

function getAggressivePaperStatus() {
  const performance = aggressivePaperStore.getPerformance(AGGRESSIVE_INITIAL_CAPITAL_USD);
  const selectedPosition =
    performance.activePosition ?? aggressivePaperStore.getRecentPositions(1)[0] ?? null;
  return {
    enabled: AGGRESSIVE_PAPER_ENABLED,
    mode: 'PAPER_CONCENTRATED_PORTFOLIO',
    strategyVersion: AGGRESSIVE_PAPER_STRATEGY_VERSION,
    liveExecutionEnabled: false,
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
      feeSource: 'ONCHAIN_FEE_GROWTH_GLOBAL_X128_WITH_IN_RANGE_OCCUPANCY',
      onePositionAtATime: true,
      capitalCompoundsBetweenCompletedCycles: true,
    },
    performance,
    recentPositions: aggressivePaperStore.getRecentPositions(20),
    recentActions: selectedPosition ? aggressivePaperStore.getActions(selectedPosition.id, 50) : [],
    recentEvaluations: selectedPosition ? aggressivePaperStore.getEvaluations(selectedPosition.id, 100) : [],
  };
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
  if (!process.env.OPENAI_API_KEY) return { status: 'NOT_CONFIGURED', created: 0 };

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
    configured: Boolean(process.env.OPENAI_API_KEY),
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

function parseAgentHorizon(value: unknown): 1 | 6 | 24 | 168 {
  const horizon = parsePositiveNumberOrDefault(value, 'horizon', 24);
  if (!PAPER_AGENT_HORIZONS.includes(horizon as 1 | 6 | 24 | 168)) {
    throw new Error('Parameter "horizon" must be one of: 1, 6, 24, 168');
  }
  return horizon as 1 | 6 | 24 | 168;
}

function getNextAgentRunAt(now = new Date()): string {
  const next = new Date(now);
  next.setUTCMinutes(0, 0, 0);
  next.setUTCHours(next.getUTCHours() + 1);
  return next.toISOString();
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
      ['market-snapshot', 'onchain-snapshot', 'paper-lifecycle', 'paper-outcome'].includes(status.name) &&
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
    activeHttpRequests,
    rpcHeavyActive: rpcHeavyGate.active,
    openAiActive: openAiLock.active,
  };
}

registerHealthRoutes(app, getReadiness);

// Get WBNB/USDT analysis
app.get('/api/wbnbusdt', async (req, res) => {
  try {
    console.log('📊 Fetching WBNB/USDT data...');
    const analysis = await capturePoolSnapshot();

    res.json({
      success: true,
      data: analysis,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('WBNB/USDT error:', error);
    res.status(error instanceof UpstreamError && error.code === 'UPSTREAM_TIMEOUT' ? 504 : 502).json({
      success: false,
      error: safeErrorMessage(error, 'Market data is unavailable'),
      code: upstreamErrorCode(error),
      timestamp: new Date().toISOString(),
    });
  }
});

// Read persisted pool history
app.get('/api/history', (req, res) => {
  try {
    const hours = req.query.hours === undefined ? 24 : parsePositiveNumber(req.query.hours, 'hours');
    const requestedLimit =
      req.query.limit === undefined ? 1_440 : parsePositiveNumber(req.query.limit, 'limit');
    const limit = Math.min(10_000, Math.max(1, Math.floor(requestedLimit)));

    if (hours > 24 * 30) {
      throw new Error('Parameter "hours" must not exceed 720');
    }

    const snapshots = snapshotStore.getHistory(hours, limit);
    res.json({
      success: true,
      data: {
        hours,
        count: snapshots.length,
        snapshots,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Invalid history parameters',
      timestamp: new Date().toISOString(),
    });
  }
});

// Downsampled history for charts
app.get('/api/history/chart', (req, res) => {
  try {
    const hours = req.query.hours === undefined ? 24 : parsePositiveNumber(req.query.hours, 'hours');
    const requestedPoints =
      req.query.points === undefined ? 240 : parsePositiveNumber(req.query.points, 'points');

    if (hours > 24 * 30) {
      throw new Error('Parameter "hours" must not exceed 720');
    }

    const maxPoints = Math.min(1_000, Math.max(2, Math.floor(requestedPoints)));
    const points = snapshotStore.getChartHistory(hours, maxPoints);
    res.json({
      success: true,
      data: { hours, count: points.length, points },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Invalid chart parameters',
      timestamp: new Date().toISOString(),
    });
  }
});

// Aggregated historical statistics for 1h, 24h, 7d, and 30d
app.get('/api/history/stats', (req, res) => {
  res.json({
    success: true,
    data: {
      totalRows: snapshotStore.count(),
      periods: snapshotStore.getStatistics(),
    },
    timestamp: new Date().toISOString(),
  });
});

// Read-only PancakeSwap V3 on-chain state
app.get('/api/onchain/pool', rpcHeavyLimit, async (req, res) => {
  try {
    const state = await captureOnchainPoolState();
    res.json({
      success: true,
      data: {
        ...state,
        storedSnapshots: onchainStore.count(),
        dataAdapterReady: true,
        executionAdapterReady: executionAdapterVerified,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(error instanceof UpstreamError && error.code === 'UPSTREAM_TIMEOUT' ? 504 : 502).json({
      success: false,
      error: safeErrorMessage(error, 'On-chain data is unavailable'),
      code: upstreamErrorCode(error),
      timestamp: new Date().toISOString(),
    });
  }
});

app.get('/api/onchain/history', (req, res) => {
  try {
    const requestedLimit =
      req.query.limit === undefined ? 100 : parsePositiveNumber(req.query.limit, 'limit');
    const limit = Math.min(10_000, Math.max(1, Math.floor(requestedLimit)));
    res.json({
      success: true,
      data: {
        count: onchainStore.count(),
        snapshots: onchainStore.getRecent(limit),
        health: onchainHealth,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Invalid on-chain history parameters',
      timestamp: new Date().toISOString(),
    });
  }
});

app.get('/api/lifecycle/activation', (req, res) => {
  const runtime = reconcileLifecycleActivation();
  res.json({
    success: true,
    data: {
      stage: 'G',
      lifecycleEnabled: POSITION_LIFECYCLE_ENABLED,
      activation: runtime.activation,
      activationEligible: runtime.activationEligible,
      shadowValidation: runtime.shadowValidation,
      events: lifecycleActivationStore.getEvents(100),
      liveExecutionChanged: false,
    },
    timestamp: new Date().toISOString(),
  });
});

app.post('/api/lifecycle/activate-paper', (req, res) => {
  if (!isExecutionAdminAuthorized(req.headers.authorization)) {
    res.status(401).json({ success: false, error: 'Unauthorized', timestamp: new Date().toISOString() });
    return;
  }
  try {
    if (typeof req.body?.reason !== 'string' || req.body.reason.trim().length < 5) {
      throw new Error('reason is required and must contain at least 5 characters');
    }
    if (req.body?.confirmPaperOnly !== true) {
      throw new Error('confirmPaperOnly=true is required');
    }
    const runtime = reconcileLifecycleActivation();
    const activation = lifecycleActivationStore.activatePaper({
      shadowQualified: runtime.shadowValidation.qualified,
      shadowRunId: runtime.shadowValidation.run.id,
      shadowBlockers: runtime.shadowValidation.blockers,
      confirmPaperOnly: true,
      reason: req.body.reason.trim(),
    });
    executionStore.recordAudit('PAPER_LIFECYCLE_ACTIVATED', null, {
      shadowRunId: runtime.shadowValidation.run.id,
      reason: req.body.reason.trim(),
      liveExecutionChanged: false,
    });
    res.json({
      success: true,
      data: { activation, shadowValidation: runtime.shadowValidation, liveExecutionChanged: false },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Paper lifecycle activation failed';
    res.status(message.includes('SHADOW_VALIDATION_NOT_QUALIFIED') ? 409 : 400).json({
      success: false,
      error: message,
      timestamp: new Date().toISOString(),
    });
  }
});

app.post('/api/lifecycle/return-to-shadow', (req, res) => {
  if (!isExecutionAdminAuthorized(req.headers.authorization)) {
    res.status(401).json({ success: false, error: 'Unauthorized', timestamp: new Date().toISOString() });
    return;
  }
  try {
    if (typeof req.body?.reason !== 'string' || req.body.reason.trim().length < 5) {
      throw new Error('reason is required and must contain at least 5 characters');
    }
    if (req.body?.resetShadowRun !== undefined && typeof req.body.resetShadowRun !== 'boolean') {
      throw new Error('resetShadowRun must be a boolean');
    }
    const activation = lifecycleActivationStore.returnToShadow(req.body.reason.trim());
    const shadowValidation = req.body?.resetShadowRun
      ? shadowModeStore.reset(req.body.reason.trim())
      : shadowModeStore.refreshQualification();
    executionStore.recordAudit('PAPER_LIFECYCLE_RETURNED_TO_SHADOW', null, {
      shadowRunId: shadowValidation.run.id,
      reason: req.body.reason.trim(),
      resetShadowRun: req.body?.resetShadowRun ?? false,
    });
    res.json({
      success: true,
      data: { activation, shadowValidation, liveExecutionChanged: false },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Return to shadow failed',
      timestamp: new Date().toISOString(),
    });
  }
});

app.get('/api/shadow/status', (req, res) => {
  const runtime = reconcileLifecycleActivation();
  res.json({
    success: true,
    data: {
      lifecycleEnabled: POSITION_LIFECYCLE_ENABLED,
      lifecycleMode: runtime.activation.mode,
      validation: runtime.shadowValidation,
    },
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/shadow/observations', (req, res) => {
  try {
    const requestedLimit =
      req.query.limit === undefined ? 336 : parsePositiveNumber(req.query.limit, 'limit');
    const limit = Math.min(1_000, Math.max(1, Math.floor(requestedLimit)));
    res.json({
      success: true,
      data: { observations: shadowModeStore.getObservations(limit) },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Invalid shadow observation parameters',
      timestamp: new Date().toISOString(),
    });
  }
});

app.post('/api/shadow/reset', (req, res) => {
  if (!isExecutionAdminAuthorized(req.headers.authorization)) {
    res.status(401).json({ success: false, error: 'Unauthorized', timestamp: new Date().toISOString() });
    return;
  }
  try {
    if (typeof req.body?.reason !== 'string' || req.body.reason.trim().length < 5) {
      throw new Error('reason is required and must contain at least 5 characters');
    }
    const validation = shadowModeStore.reset(req.body.reason.trim());
    executionStore.recordAudit('SHADOW_VALIDATION_RESET', null, {
      shadowRunId: validation.run.id,
      reason: req.body.reason.trim(),
    });
    res.json({ success: true, data: { validation }, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Shadow validation reset failed',
      timestamp: new Date().toISOString(),
    });
  }
});

// Stage G activation controls are installed, but remain fail-closed until Stage F qualifies.
app.get('/api/positions/status', (req, res) => {
  const activePosition = positionStore.getActivePosition();
  const lifecycleRuntime = reconcileLifecycleActivation();
  res.json({
    success: true,
    data: {
      stage: 'G',
      lifecycleEnabled: POSITION_LIFECYCLE_ENABLED,
      lifecycleMode: lifecycleRuntime.activation.mode,
      lifecycleActivation: lifecycleRuntime.activation,
      activationEligible: lifecycleRuntime.activationEligible,
      shadowValidation: lifecycleRuntime.shadowValidation,
      behaviorIntegrated: POSITION_LIFECYCLE_ENABLED,
      dashboardIntegrated: true,
      nftReceiptVerification: {
        available: executionAdapterVerified,
        positionManager: PANCAKE_V3_POSITION_MANAGER,
        minimumConfirmations: MINT_RECEIPT_MIN_CONFIRMATIONS,
        adminAuthenticationRequired: true,
        externalWalletSigningOnly: true,
      },
      recentLiveNfts: positionStore.getRecentLiveNfts(10),
      exitPlanner: {
        available: executionAdapterVerified,
        optionalSwapAvailable: exitSwapRouterVerified,
        swapRouter: PANCAKE_V3_SWAP_ROUTER,
        signingAvailable: false,
        broadcastAvailable: false,
        recentProposals: executionStore.getRecentExitProposals(10),
      },
      totalPositions: positionStore.count(),
      activePosition,
      latestAction: positionStore.getRecentActions(1)[0] ?? null,
      latestEvaluation: activePosition
        ? (positionStore.getEvaluations(activePosition.id, 1)[0] ?? null)
        : null,
      recentPositions: positionStore.getRecentPositions(10),
      supportedStatuses: ['PENDING_ENTRY', 'OPEN', 'PENDING_EXIT', 'CLOSED', 'EMERGENCY_EXITED', 'CANCELLED'],
      supportedActions: ['WAIT', 'ENTER', 'HOLD', 'REVIEW_7D', 'REVIEW_14D', 'EXIT', 'EMERGENCY_EXIT'],
      policy: {
        maxActivePositions: 1,
        minimumHoldDays: 7,
        finalPaperReviewDays: 14,
        reentryCooldownHours: 24,
        hourlyGasChargedUsd: 0,
      },
      note:
        lifecycleRuntime.activation.mode === 'PAPER_ACTIVE'
          ? 'Stage G paper lifecycle is active. Live execution remains independently gated and external-wallet-only.'
          : 'Stage G controls are installed but remain in SHADOW because Stage F qualification and explicit activation are required.',
    },
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/positions/:id', (req, res) => {
  try {
    const id = Math.floor(parsePositiveNumber(req.params.id, 'id'));
    const position = positionStore.getPosition(id);
    if (!position) {
      res
        .status(404)
        .json({ success: false, error: 'Position not found', timestamp: new Date().toISOString() });
      return;
    }
    res.json({
      success: true,
      data: {
        position,
        liveNft: positionStore.getLiveNftByPosition(id),
        exitProposals: executionStore.getExitProposalsForPosition(id, 100),
        actions: positionStore.getActions(id, 1_000),
        evaluations: positionStore.getEvaluations(id, 10_000),
        events: positionStore.getEvents(id, 1_000),
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Invalid position parameter',
      timestamp: new Date().toISOString(),
    });
  }
});

// Current high-risk/high-gain concentrated strategy advisory and actual paper portfolio
app.get('/api/agent/high-risk-plan', rpcHeavyLimit, async (req, res) => {
  try {
    const [pair, onchain] = await Promise.all([getWBNBUSDTPair(), captureOnchainPoolState()]);
    const analysis = analyzeWBNBUSDT(pair);
    const plan = buildCurrentHighRiskPlan(analysis, onchain);
    res.json({ success: true, data: plan, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(503).json({
      success: false,
      error: error instanceof Error ? error.message : 'High-risk strategy plan unavailable',
      timestamp: new Date().toISOString(),
    });
  }
});

app.get('/api/agent/aggressive-performance', (req, res) => {
  res.json({
    success: true,
    data: getAggressivePaperStatus(),
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/agent/aggressive-positions/:id', (req, res) => {
  try {
    const id = Math.floor(parsePositiveNumber(req.params.id, 'id'));
    const position = aggressivePaperStore.getPosition(id);
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
        actions: aggressivePaperStore.getActions(id, 1_000),
        evaluations: aggressivePaperStore.getEvaluations(id, 10_000),
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

// Paper agent status and immutable hourly decisions
app.get('/api/agent/status', (req, res) => {
  res.json({
    success: true,
    data: {
      mode: 'paper',
      strategyVersion: PAPER_AGENT_STRATEGY_VERSION,
      investment: PAPER_AGENT_INVESTMENT,
      decisionIntervalHours: 1,
      decisionSemantics: 'HOURLY_ENTRY_SIGNAL_NOT_TRANSACTION',
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
        executionEnabled: false,
        mode: AGGRESSIVE_PAPER_ENABLED ? 'PAPER_PORTFOLIO_ACTIVE' : 'PAPER_DISABLED',
        performanceEndpoint: '/api/agent/aggressive-performance',
      },
      totalDecisions: agentStore.count(),
      latestDecision: agentStore.getRecent(1)[0] ?? null,
      outcomeCounts: agentStore.outcomeCounts(),
      outcomeInterpretation: {
        version: OUTCOME_INTERPRETATION_VERSION,
        counts: agentStore.outcomeInterpretationCounts(),
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
        counts: agentStore.outcomeAssessmentCounts(),
        slippageBpsPerLeg: ECONOMIC_SLIPPAGE_BPS_PER_LEG,
        operational: false,
        retainedForAudit: true,
      },
      evaluationHorizonsHours: PAPER_AGENT_HORIZONS,
      nextDecisionAt: getNextAgentRunAt(),
      outcomeEvaluationEnabled: true,
      reflection: getReflectionStatus(),
      learning: getLearningStatus(),
      learningEnabled: getLifecycleCompatibleActiveModel() !== null,
    },
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/agent/decisions', (req, res) => {
  try {
    const requestedLimit = req.query.limit === undefined ? 24 : parsePositiveNumber(req.query.limit, 'limit');
    const limit = Math.min(1_000, Math.max(1, Math.floor(requestedLimit)));

    res.json({
      success: true,
      data: {
        count: agentStore.count(),
        decisions: agentStore.getRecent(limit),
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Invalid agent history parameters',
      timestamp: new Date().toISOString(),
    });
  }
});

app.get('/api/agent/outcomes', (req, res) => {
  try {
    const requestedLimit =
      req.query.limit === undefined ? 100 : parsePositiveNumber(req.query.limit, 'limit');
    const limit = Math.min(1_000, Math.max(1, Math.floor(requestedLimit)));
    const horizon = req.query.horizon === undefined ? null : parseAgentHorizon(req.query.horizon);

    res.json({
      success: true,
      data: {
        ...agentStore.outcomeCounts(),
        horizon,
        outcomes:
          horizon === null
            ? agentStore.getRecentOutcomes(limit)
            : agentStore.getOutcomeDetails(horizon, limit),
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Invalid outcome history parameters',
      timestamp: new Date().toISOString(),
    });
  }
});

app.get('/api/agent/performance', (req, res) => {
  try {
    const horizon = parseAgentHorizon(req.query.horizon);
    res.json({
      success: true,
      data: agentStore.getPerformance(horizon),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Invalid performance parameters',
      timestamp: new Date().toISOString(),
    });
  }
});

app.get('/api/agent/models', (req, res) => {
  res.json({
    success: true,
    data: {
      ...getLearningStatus(),
      models: agentStore.getRecentModels(20),
    },
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/agent/reflections', (req, res) => {
  try {
    const requestedLimit = req.query.limit === undefined ? 20 : parsePositiveNumber(req.query.limit, 'limit');
    const limit = Math.min(100, Math.max(1, Math.floor(requestedLimit)));
    res.json({
      success: true,
      data: {
        ...getReflectionStatus(),
        reflections: agentStore.getRecentReflections(limit),
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Invalid reflection parameters',
      timestamp: new Date().toISOString(),
    });
  }
});

app.get('/api/execution/status', (req, res) => {
  res.json({
    success: true,
    data: getExecutionStatus(),
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/execution/audit', (req, res) => {
  try {
    const requestedLimit = req.query.limit === undefined ? 50 : parsePositiveNumber(req.query.limit, 'limit');
    const limit = Math.min(200, Math.max(1, Math.floor(requestedLimit)));
    res.json({
      success: true,
      data: { events: executionStore.getRecentAudit(limit) },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Invalid audit parameters',
      timestamp: new Date().toISOString(),
    });
  }
});

app.post('/api/execution/kill-switch', (req, res) => {
  if (!isExecutionAdminAuthorized(req.headers.authorization)) {
    res.status(401).json({ success: false, error: 'Unauthorized', timestamp: new Date().toISOString() });
    return;
  }
  if (
    typeof req.body?.engaged !== 'boolean' ||
    typeof req.body?.reason !== 'string' ||
    req.body.reason.trim().length < 5
  ) {
    res.status(400).json({
      success: false,
      error: 'engaged boolean and reason are required',
      timestamp: new Date().toISOString(),
    });
    return;
  }
  const control = executionStore.setKillSwitch(req.body.engaged, req.body.reason.trim());
  res.json({
    success: true,
    data: { control, execution: getExecutionStatus() },
    timestamp: new Date().toISOString(),
  });
});

app.post('/api/execution/proposals', (req, res) => {
  if (!isExecutionAdminAuthorized(req.headers.authorization)) {
    res.status(401).json({ success: false, error: 'Unauthorized', timestamp: new Date().toISOString() });
    return;
  }

  try {
    const status = getExecutionStatus();
    if (!status.ready) {
      executionStore.recordAudit('PROPOSAL_BLOCKED', null, { blockers: status.blockers });
      res.status(409).json({
        success: false,
        error: 'Execution readiness gates are not satisfied',
        data: status,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const amountUsd = parsePositiveNumberOrDefault(
      req.body?.amountUsd,
      'amountUsd',
      EXECUTION_CONFIG.limits.maxCapitalUsd
    );
    if (amountUsd > EXECUTION_CONFIG.limits.maxCapitalUsd) {
      throw new Error(`Parameter "amountUsd" must not exceed ${EXECUTION_CONFIG.limits.maxCapitalUsd}`);
    }
    const decision = agentStore.getRecent(1)[0];
    if (!decision) throw new Error('No agent decision is available');
    const expiresAt = new Date(
      Date.now() + EXECUTION_CONFIG.limits.proposalExpiryMinutes * 60 * 1_000
    ).toISOString();
    const proposal = executionStore.createProposal({
      decisionId: decision.id,
      amountUsd,
      readiness: status as unknown as Record<string, unknown>,
      expiresAt,
    });
    res.status(201).json({ success: true, data: proposal, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Proposal could not be created',
      timestamp: new Date().toISOString(),
    });
  }
});

app.post('/api/execution/proposals/:id/review', (req, res) => {
  if (!isExecutionAdminAuthorized(req.headers.authorization)) {
    res.status(401).json({ success: false, error: 'Unauthorized', timestamp: new Date().toISOString() });
    return;
  }

  try {
    const id = parsePositiveNumber(req.params.id, 'id');
    if (
      typeof req.body?.approve !== 'boolean' ||
      typeof req.body?.reason !== 'string' ||
      req.body.reason.trim().length < 5
    ) {
      throw new Error('approve boolean and reason are required');
    }
    if (req.body.approve) {
      const status = getExecutionStatus();
      if (!status.ready) {
        executionStore.recordAudit(
          'APPROVAL_BLOCKED',
          executionStore.getProposal(Math.floor(id)) ? Math.floor(id) : null,
          { blockers: status.blockers }
        );
        res.status(409).json({
          success: false,
          error: 'Execution readiness gates are not satisfied',
          data: status,
          timestamp: new Date().toISOString(),
        });
        return;
      }
    }
    const proposal = executionStore.reviewProposal(Math.floor(id), req.body.approve, req.body.reason.trim());
    res.json({
      success: true,
      data: {
        proposal,
        transactionSigned: false,
        transactionBroadcast: false,
        note: 'Manual review recorded. No private key is stored and no transaction was broadcast.',
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Proposal review failed',
      timestamp: new Date().toISOString(),
    });
  }
});

app.post('/api/execution/proposals/:id/transaction-plan', async (req, res) => {
  if (!isExecutionAdminAuthorized(req.headers.authorization)) {
    res.status(401).json({ success: false, error: 'Unauthorized', timestamp: new Date().toISOString() });
    return;
  }

  try {
    const id = Math.floor(parsePositiveNumber(req.params.id, 'id'));
    const proposal = executionStore.getProposal(id);
    if (!proposal || proposal.status !== 'APPROVED') {
      throw new Error('An approved execution proposal is required');
    }
    if (new Date(proposal.expiresAt).getTime() <= Date.now()) {
      throw new Error('Approved execution proposal has expired');
    }
    const status = getExecutionStatus();
    if (!status.ready) {
      executionStore.recordAudit('TRANSACTION_PLAN_BLOCKED', id, { blockers: status.blockers });
      res.status(409).json({
        success: false,
        error: 'Execution readiness gates are not satisfied',
        data: status,
        timestamp: new Date().toISOString(),
      });
      return;
    }
    if (typeof req.body?.wallet !== 'string') throw new Error('wallet is required');
    const slippageBps =
      req.body?.slippageBps === undefined ? 100 : parsePositiveNumber(req.body.slippageBps, 'slippageBps');
    const [state, walletState] = await Promise.all([
      captureOnchainPoolState(),
      fetchWalletTokenState(req.body.wallet),
    ]);
    const deadline = Math.floor(Date.now() / 1_000) + 10 * 60;
    const plan = buildFullRangeMintPlan({
      state,
      walletState,
      amountUsd: proposal.amountUsd,
      slippageBps: Math.floor(slippageBps),
      deadline,
    });
    executionStore.bindProposalWallet(id, plan.recipient);
    const mintTransaction = plan.transactions.find(transaction => transaction.purpose === 'MINT_FULL_RANGE');
    if (!mintTransaction) throw new Error('Mint transaction is missing from the generated plan');
    const storedPlan = executionStore.saveMintTransactionPlan({
      proposalId: id,
      wallet: plan.recipient,
      referenceBlockNumber: state.blockNumber,
      amountUsd: plan.amountUsd,
      amount0Desired: plan.amount0Desired,
      amount1Desired: plan.amount1Desired,
      amount0Min: plan.amount0Min,
      amount1Min: plan.amount1Min,
      deadline: plan.deadline,
      mintCalldata: mintTransaction.data,
    });
    executionStore.recordAudit('UNSIGNED_TRANSACTION_PLAN_PREPARED', id, {
      recipient: plan.recipient,
      amountUsd: plan.amountUsd,
      transactionCount: plan.transactions.length,
      deadline: plan.deadline,
    });
    res.json({
      success: true,
      data: {
        proposal,
        walletState,
        plan,
        immutablePlanEvidence: {
          planHash: storedPlan.planHash,
          referenceBlockNumber: storedPlan.referenceBlockNumber,
          createdAt: storedPlan.createdAt,
        },
        transactionSigned: false,
        transactionBroadcast: false,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Transaction plan could not be prepared',
      timestamp: new Date().toISOString(),
    });
  }
});

app.post('/api/execution/proposals/:id/mint-receipt', async (req, res) => {
  if (!isExecutionAdminAuthorized(req.headers.authorization)) {
    res.status(401).json({ success: false, error: 'Unauthorized', timestamp: new Date().toISOString() });
    return;
  }

  let proposalId: number | null = null;
  try {
    const id = Math.floor(parsePositiveNumber(req.params.id, 'id'));
    const proposal = executionStore.getProposal(id);
    if (!proposal || proposal.status !== 'APPROVED') {
      throw new Error('An approved execution proposal is required');
    }
    proposalId = id;
    if (typeof req.body?.txHash !== 'string') throw new Error('txHash is required');
    const txHash = req.body.txHash.toLowerCase();
    if (!/^0x[0-9a-f]{64}$/.test(txHash)) throw new Error('Invalid transaction hash');
    const binding = executionStore.getProposalWallet(id);
    const storedPlan = executionStore.getMintTransactionPlan(id);
    if (!binding || !storedPlan) throw new Error('Prepare and persist an immutable transaction plan first');

    const existing = positionStore.getLiveNftByProposal(id);
    if (existing) {
      if (existing.txHash !== txHash)
        throw new Error('Execution proposal is already linked to another live NFT');
      const transaction = executionStore.recordVerifiedTransaction(id, txHash);
      res.json({
        success: true,
        data: {
          proposal,
          position: positionStore.getPosition(existing.positionId),
          nft: existing,
          transaction,
          idempotent: true,
          signedByServer: false,
          broadcastByServer: false,
          onchainTransactionObserved: true,
        },
        timestamp: new Date().toISOString(),
      });
      return;
    }

    if (!executionAdapterVerified) {
      executionAdapterVerified = await verifyPositionManagerAdapter();
      if (!executionAdapterVerified) throw new Error('Position Manager bytecode verification failed');
    }
    const verified = await fetchAndVerifyPancakeV3MintReceipt({
      txHash,
      wallet: binding.wallet,
      minimumConfirmations: MINT_RECEIPT_MIN_CONFIRMATIONS,
    });
    verifyMintAgainstImmutablePlan({
      verified,
      proposalCreatedAt: proposal.createdAt,
      proposalExpiresAt: proposal.expiresAt,
      plan: storedPlan,
      proposalAmountUsd: proposal.amountUsd,
    });
    const state = await captureOnchainPoolState();
    const entryGasUsd = (Number(BigInt(verified.gasCostWei)) / 1e18) * state.priceWbnbUsd;
    const tracked = positionStore.confirmVerifiedLiveMint({
      proposalId: id,
      decisionId: proposal.decisionId,
      investmentUsd: proposal.amountUsd,
      entryPrice: state.priceWbnbUsd,
      entryGasUsd,
      txHash: verified.transactionHash,
      wallet: verified.wallet,
      tokenId: verified.tokenId,
      blockNumber: verified.blockNumber,
      blockHash: verified.blockHash,
      blockTimestamp: verified.blockTimestamp,
      confirmations: verified.confirmations,
      token0: verified.token0,
      token1: verified.token1,
      fee: verified.fee,
      tickLower: verified.tickLower,
      tickUpper: verified.tickUpper,
      liquidity: verified.liquidity,
      feeGrowthInside0LastX128: verified.feeGrowthInside0LastX128,
      feeGrowthInside1LastX128: verified.feeGrowthInside1LastX128,
      tokensOwed0: verified.tokensOwed0,
      tokensOwed1: verified.tokensOwed1,
      amount0: verified.amount0,
      amount1: verified.amount1,
      gasUsed: verified.gasUsed,
      effectiveGasPriceWei: verified.effectiveGasPriceWei,
      gasCostWei: verified.gasCostWei,
      owner: verified.owner,
    });
    const transaction = executionStore.recordVerifiedTransaction(id, txHash);
    res.status(201).json({
      success: true,
      data: {
        proposal,
        position: tracked.position,
        nft: tracked.nft,
        transaction,
        idempotent: false,
        signedByServer: false,
        broadcastByServer: false,
        onchainTransactionObserved: true,
        note: 'External-wallet mint receipt, NFT ownership, liquidity, ticks, and fee checkpoints were verified on BSC.',
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Mint receipt verification failed';
    executionStore.recordAudit('MINT_RECEIPT_VERIFICATION_FAILED', proposalId, { error: message });
    const pending = /not mined|confirmation/i.test(message);
    res.status(pending ? 409 : 400).json({
      success: false,
      error: message,
      timestamp: new Date().toISOString(),
    });
  }
});

app.post('/api/execution/exit-proposals', (req, res) => {
  if (!isExecutionAdminAuthorized(req.headers.authorization)) {
    res.status(401).json({ success: false, error: 'Unauthorized', timestamp: new Date().toISOString() });
    return;
  }
  try {
    const positionId = Math.floor(parsePositiveNumber(req.body?.positionId, 'positionId'));
    if (typeof req.body?.reason !== 'string' || req.body.reason.trim().length < 5) {
      throw new Error('reason is required and must contain at least 5 characters');
    }
    if (req.body?.burnAfterCollect !== undefined && typeof req.body.burnAfterCollect !== 'boolean') {
      throw new Error('burnAfterCollect must be a boolean');
    }
    if (req.body?.swapWbnbToUsdt !== undefined && typeof req.body.swapWbnbToUsdt !== 'boolean') {
      throw new Error('swapWbnbToUsdt must be a boolean');
    }
    const position = positionStore.getPosition(positionId);
    const nft = positionStore.getLiveNftByPosition(positionId);
    if (!position || position.mode !== 'LIVE' || position.status !== 'OPEN' || !nft?.ownershipVerified) {
      throw new Error('An open verified LIVE NFT position is required');
    }
    const slippageBps = Math.floor(parsePositiveNumberOrDefault(req.body?.slippageBps, 'slippageBps', 100));
    const expiresAt = new Date(
      Date.now() + EXECUTION_CONFIG.limits.proposalExpiryMinutes * 60 * 1_000
    ).toISOString();
    const proposal = executionStore.createExitProposal({
      positionId,
      reason: req.body.reason.trim(),
      slippageBps,
      burnAfterCollect: req.body?.burnAfterCollect ?? true,
      swapWbnbToUsdt: req.body?.swapWbnbToUsdt ?? false,
      expiresAt,
    });
    res.status(201).json({
      success: true,
      data: {
        proposal,
        position,
        nft,
        note: 'Exit proposal requires a separate manual approval and never signs or broadcasts a transaction.',
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Exit proposal could not be created',
      timestamp: new Date().toISOString(),
    });
  }
});

app.post('/api/execution/exit-proposals/:id/review', (req, res) => {
  if (!isExecutionAdminAuthorized(req.headers.authorization)) {
    res.status(401).json({ success: false, error: 'Unauthorized', timestamp: new Date().toISOString() });
    return;
  }
  try {
    const id = Math.floor(parsePositiveNumber(req.params.id, 'id'));
    if (
      typeof req.body?.approve !== 'boolean' ||
      typeof req.body?.reason !== 'string' ||
      req.body.reason.trim().length < 5
    ) {
      throw new Error('approve boolean and reason are required');
    }
    const pending = executionStore.getExitProposal(id);
    if (!pending) throw new Error('Exit proposal not found');
    if (req.body.approve) {
      const position = positionStore.getPosition(pending.positionId);
      const nft = positionStore.getLiveNftByPosition(pending.positionId);
      if (!position || position.mode !== 'LIVE' || position.status !== 'OPEN' || !nft?.ownershipVerified) {
        throw new Error('The verified LIVE position is no longer open');
      }
    }
    const proposal = executionStore.reviewExitProposal(id, req.body.approve, req.body.reason.trim());
    res.json({
      success: true,
      data: {
        proposal,
        signedByServer: false,
        broadcastByServer: false,
        note: 'Manual exit review recorded. The emergency stop does not prevent preparation of a risk-reducing exit.',
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Exit proposal review failed',
      timestamp: new Date().toISOString(),
    });
  }
});

app.post('/api/execution/exit-proposals/:id/transaction-plan', async (req, res) => {
  if (!isExecutionAdminAuthorized(req.headers.authorization)) {
    res.status(401).json({ success: false, error: 'Unauthorized', timestamp: new Date().toISOString() });
    return;
  }
  try {
    const id = Math.floor(parsePositiveNumber(req.params.id, 'id'));
    let proposal = executionStore.getExitProposal(id);
    if (!proposal) throw new Error('Exit proposal not found');
    if (new Date(proposal.expiresAt).getTime() <= Date.now()) {
      proposal = executionStore.expireExitProposal(id);
    }
    if (proposal.status !== 'APPROVED') throw new Error('An approved unexpired exit proposal is required');
    const position = positionStore.getPosition(proposal.positionId);
    const nft = positionStore.getLiveNftByPosition(proposal.positionId);
    if (!position || position.mode !== 'LIVE' || position.status !== 'OPEN' || !nft?.ownershipVerified) {
      throw new Error('The verified LIVE NFT position is no longer open');
    }
    if (!executionAdapterVerified) {
      executionAdapterVerified = await verifyPositionManagerAdapter();
      if (!executionAdapterVerified) throw new Error('Position Manager bytecode verification failed');
    }
    if (proposal.swapWbnbToUsdt && !exitSwapRouterVerified) {
      exitSwapRouterVerified = await verifyPancakeV3SwapRouter();
      if (!exitSwapRouterVerified) throw new Error('PancakeSwap V3 SwapRouter bytecode verification failed');
    }

    const [state, currentNft, swapAllowance] = await Promise.all([
      captureOnchainPoolState(),
      fetchPancakeV3PositionState({ tokenId: nft.tokenId, expectedWallet: nft.owner }),
      proposal.swapWbnbToUsdt ? fetchWbnbSwapRouterAllowance(nft.owner) : Promise.resolve('0'),
    ]);
    const deadline = Math.floor(Date.now() / 1_000) + 10 * 60;
    const plan = buildFullRangeExitPlan({
      state,
      position: currentNft,
      wallet: nft.owner,
      wbnbSwapRouterAllowance: swapAllowance,
      slippageBps: proposal.slippageBps,
      deadline,
      burnAfterCollect: proposal.burnAfterCollect,
      swapWbnbToUsdt: proposal.swapWbnbToUsdt,
    });
    const storedPlan = executionStore.saveExitTransactionPlan({
      exitProposalId: proposal.id,
      positionId: proposal.positionId,
      wallet: nft.owner,
      referenceBlockNumber: state.blockNumber,
      plan: {
        swapAmountIn: plan.swapAmountIn,
        transactions: plan.transactions,
      },
    });
    executionStore.recordAudit('UNSIGNED_EXIT_PLAN_PREPARED', null, {
      exitProposalId: proposal.id,
      positionId: proposal.positionId,
      tokenId: nft.tokenId,
      liquidity: currentNft.liquidity,
      transactionCount: plan.transactions.length,
      deadline,
    });
    res.json({
      success: true,
      data: {
        proposal,
        position,
        nft,
        currentNft,
        plan,
        immutablePlanEvidence: {
          planHash: storedPlan.planHash,
          referenceBlockNumber: storedPlan.referenceBlockNumber,
          createdAt: storedPlan.createdAt,
        },
        signedByServer: false,
        broadcastByServer: false,
        note: 'Each unsigned transaction must be reviewed and signed in order by the verified NFT owner wallet.',
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Exit transaction plan could not be prepared',
      timestamp: new Date().toISOString(),
    });
  }
});

app.post('/api/execution/exit-proposals/:id/receipts', async (req, res) => {
  if (!isExecutionAdminAuthorized(req.headers.authorization)) {
    res.status(401).json({ success: false, error: 'Unauthorized', timestamp: new Date().toISOString() });
    return;
  }
  let exitProposalId: number | null = null;
  try {
    const id = Math.floor(parsePositiveNumber(req.params.id, 'id'));
    exitProposalId = id;
    const proposal = executionStore.getExitProposal(id);
    const storedPlan = executionStore.getExitTransactionPlan(id);
    if (!proposal || proposal.status !== 'APPROVED' || proposal.settledAt !== null || !storedPlan) {
      throw new Error('Approved unsettled exit proposal with immutable plan is required');
    }
    if (
      !Array.isArray(req.body?.txHashes) ||
      !req.body.txHashes.every((hash: unknown) => typeof hash === 'string')
    ) {
      throw new Error('txHashes must be an ordered array of transaction hashes');
    }
    const position = positionStore.getPosition(proposal.positionId);
    const nft = positionStore.getLiveNftByPosition(proposal.positionId);
    if (!position || position.mode !== 'LIVE' || position.status !== 'OPEN' || !nft?.ownershipVerified) {
      throw new Error('Verified LIVE position is no longer open');
    }
    const state = await captureOnchainPoolState();
    const evidence = await fetchAndVerifyExitReceipts({
      txHashes: req.body.txHashes,
      wallet: storedPlan.wallet,
      expectedTransactions: storedPlan.plan.transactions,
      referenceBlockNumber: storedPlan.referenceBlockNumber,
      planCreatedAt: storedPlan.createdAt,
      proposalExpiresAt: proposal.expiresAt,
      minimumConfirmations: MINT_RECEIPT_MIN_CONFIRMATIONS,
      swapAmountIn: storedPlan.plan.swapAmountIn,
      priceWbnbUsd: state.priceWbnbUsd,
      investmentUsd: position.investmentUsd,
      entryGasUsd: position.entryGasUsd,
    });
    const settlement = executionStore.settleVerifiedExit({
      exitProposalId: id,
      txHashes: evidence.txHashes,
      collectedUsdt: evidence.collectedUsdt,
      collectedWbnb: evidence.collectedWbnb,
      swapUsdtReceived: evidence.swapUsdtReceived,
      residualWbnb: evidence.residualWbnb,
      exitValueUsd: evidence.exitValueUsd,
      exitGasUsd: evidence.exitGasUsd,
      realizedPnlUsd: evidence.realizedPnlUsd,
      finalBlockNumber: evidence.finalBlockNumber,
      confirmations: evidence.confirmations,
      burnAfterCollect: proposal.burnAfterCollect,
    });
    res.status(201).json({
      success: true,
      data: {
        proposal: executionStore.getExitProposal(id),
        settlement,
        position: positionStore.getPosition(proposal.positionId),
        dailyLossUsd: executionStore.getRealizedLossToday(),
        signedByServer: false,
        broadcastByServer: false,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Exit receipt verification failed';
    executionStore.recordAudit('EXIT_RECEIPT_VERIFICATION_FAILED', null, {
      exitProposalId,
      error: message,
    });
    const pending = /not mined|confirmation/i.test(message);
    res
      .status(pending ? 409 : 400)
      .json({ success: false, error: message, timestamp: new Date().toISOString() });
  }
});

// Simulate LP
app.get('/api/simulate', rpcHeavyLimit, async (req, res) => {
  try {
    const investment = parsePositiveNumberOrDefault(req.query.amount, 'amount', 50);

    console.log(`💰 Simulating LP with $${investment}...`);
    const [pair, onchain] = await Promise.all([getWBNBUSDTPair(), captureOnchainPoolState()]);
    const analysis = analyzeWBNBUSDT(pair);
    const simulation = simulateLP(investment, analysis, onchain);

    res.json({
      success: true,
      data: simulation,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Simulation error:', error);
    const isInputError = error instanceof Error && error.message.startsWith('Parameter');
    res.status(isInputError ? 400 : 500).json({
      success: false,
      error: isInputError
        ? safeErrorMessage(error, 'Invalid simulation input')
        : 'Simulation temporarily unavailable',
      code: isInputError ? 'INVALID_INPUT' : upstreamErrorCode(error),
      timestamp: new Date().toISOString(),
    });
  }
});

// Generate an on-demand AI feasibility analysis (cached for 15 minutes)
app.post(
  '/api/lp-analysis',
  (req, res, next) => {
    rateLimitRequest(aiRateLimiter, req, res, next);
  },
  rpcHeavyLimit,
  async (req, res) => {
    try {
      const [pair, onchain] = await Promise.all([getWBNBUSDTPair(), captureOnchainPoolState()]);
      const poolAnalysis = analyzeWBNBUSDT(pair);
      const investmentProjection = buildCurrentInvestmentProjection(poolAnalysis, onchain);
      const cached = getCached<AILPAnalysis>('lp-ai-analysis-v2.7', AI_ANALYSIS_CACHE_TTL);

      if (cached) {
        res.json({
          success: true,
          data: { ...cached, investmentProjection, cached: true },
          timestamp: new Date().toISOString(),
        });
        return;
      }

      const generated = await aiSingleFlight.run('lp-ai-analysis-v2.7', async () => {
        const sharedCached = getCached<AILPAnalysis>('lp-ai-analysis-v2.7', AI_ANALYSIS_CACHE_TTL);
        if (sharedCached) return { analysis: sharedCached, cached: true };
        const metrics = buildLPAnalysisMetrics(poolAnalysis);
        const analysis = await openAiLock.run(() => analyzeLPWithOpenAI(metrics));
        setCache('lp-ai-analysis-v2.7', analysis);
        return { analysis, cached: false };
      });

      res.json({
        success: true,
        data: { ...generated.analysis, investmentProjection, cached: generated.cached },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('AI LP analysis error:', error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      const status = message.includes('OPENAI_API_KEY')
        ? 503
        : error instanceof Error && error.name === 'TimeoutError'
          ? 504
          : 502;

      res.status(status).json({
        success: false,
        error: message.includes('OPENAI_API_KEY')
          ? 'AI analysis is not configured on the server'
          : 'AI analysis is temporarily unavailable',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

// Calculate IL
app.get('/api/il', (req, res) => {
  try {
    const from = parsePositiveNumber(req.query.from, 'from');
    const to = parsePositiveNumber(req.query.to, 'to');
    const invest = parsePositiveNumber(req.query.invest, 'invest');
    const result = calculateIL(from, to, invest);

    res.json({
      success: true,
      data: result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const isInputError = error instanceof Error && error.message.startsWith('Parameter');
    res.status(isInputError ? 400 : 500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    });
  }
});

// ============================================
// 📌 Serve Frontend
// ============================================

registerFrontendAndErrorRoutes(app, join(__dirname, '../public'), safeErrorMessage);

// ============================================
// 📌 Runtime hooks (no listen/timer side effects)
// ============================================

async function createDailyBackup(): Promise<void> {
  const path = await snapshotStore.createBackup(BACKUP_DIR);
  console.log(`💾 SQLite backup ready: ${path}`);
}

function closeStores(): void {
  services.close();
}

export const bnbRuntime = {
  app,
  port: Number(PORT),
  host: HOST,
  schedulerRegistry,
  tasks: {
    capturePoolSnapshot,
    captureOnchainPoolState,
    refreshExecutionAdapterVerification,
    runHourlyPaperAgent,
    evaluateDuePaperDecisions,
    runLearningCycle,
    runReflectionCycle,
    createDailyBackup,
  },
  setShuttingDown(value: boolean) {
    shuttingDown = value;
  },
  getActiveHttpRequests() {
    return activeHttpRequests;
  },
  closeStores,
};

export type BnbRuntime = typeof bnbRuntime;
export default app;
