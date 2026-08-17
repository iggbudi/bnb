/**
 * ============================================
 * 📚 BNB LP Analyzer - WBNB/USDT Focused API
 * ============================================
 *
 * API khusus untuk WBNB/USDT di PancakeSwap
 */

import 'dotenv/config';
import { type NextFunction, type Request, type Response } from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { LpAnalysisService } from '../features/lp-analysis/index.js';
import { registerFrontendAndErrorRoutes } from './register-fallback-routes.js';
import { APPLICATION_SCHEMA_VERSION } from './migrations.js';
import { getApplicationReleaseIdentity } from './release.js';
import { OperationsService, StorageMaintenanceService } from '../features/operations/index.js';
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
  AggressivePaperService,
} from '../features/aggressive-paper/index.js';
import { PaperAgentService } from '../features/paper-agent/index.js';
import { DirectionalPaperService } from '../features/directional-paper/index.js';
import {
  DEFAULT_DIRECTIONAL_CONFIG,
  DIRECTIONAL_STRATEGY_VERSION,
} from '../features/directional-paper/index.js';
import { MarketDataService } from '../features/market-data/index.js';
import { ExecutionService, processPaperPositionLifecycle } from '../features/lp-execution/index.js';
import { registerAggressivePaperRoutes } from '../features/aggressive-paper/index.js';
import { registerDirectionalPaperRoutes } from '../features/directional-paper/index.js';
import { registerLearningRoutes } from '../features/learning/index.js';
import { registerLpAnalysisRoutes } from '../features/lp-analysis/index.js';
import { registerLpExecutionRoutes } from '../features/lp-execution/index.js';
import { registerMarketDataRoutes } from '../features/market-data/index.js';
import { registerOperationsRoutes } from '../features/operations/index.js';
import { registerPaperAgentRoutes } from '../features/paper-agent/index.js';
import { LearningService } from '../features/learning/index.js';
import {
  HIGH_RISK_FEE_RETENTION_FACTOR,
  HIGH_RISK_HISTORY_WINDOW_HOURS,
  HIGH_RISK_MAX_RECENTERS_PER_MONTH,
  HIGH_RISK_MIN_HISTORY_COVERAGE_PERCENT,
  HIGH_RISK_RECENTER_SLIPPAGE_BPS,
  HIGH_RISK_STOP_LOSS_PERCENT,
  HIGH_RISK_TARGET_MONTHLY_RETURN_PERCENT,
} from '../features/aggressive-paper/index.js';
import { AsyncLock, ConcurrencyGate, SchedulerRegistry } from '../shared/runtime/operational-controls.js';
import {
  ENTRY_VERDICT_HORIZON_HOURS,
  OUTCOME_INTERPRETATION_VERSION,
} from '../features/paper-agent/index.js';
import {
  ASSUMED_ENTRY_GAS_UNITS,
  ASSUMED_EXIT_GAS_UNITS,
  ECONOMIC_SLIPPAGE_BPS_PER_LEG,
  MINIMUM_ACTIONABLE_EDGE_USD,
  OUTCOME_ASSESSMENT_VERSION,
} from '../features/paper-agent/index.js';
import {
  ENTRY_FEE_RETENTION_FACTOR,
  ENTRY_FORECAST_DAYS,
  ENTRY_HISTORY_COVERAGE_PERCENT,
  ENTRY_MINIMUM_NET_EDGE_USD,
  PAPER_AGENT_INVESTMENT,
  PAPER_AGENT_STRATEGY_VERSION,
} from '../features/paper-agent/index.js';
import { PAPER_AGENT_HORIZONS } from '../features/paper-agent/index.js';
import { safeErrorMessage } from '../shared/http/errors.js';
import { SingleFlight } from '../shared/runtime/upstream-resilience.js';
import { loadBnbAppConfig } from './config.js';
import { BnbServiceContainer } from './container.js';
import { createBnbHttpApp } from './create-app.js';
import { createBnbScheduledTasks } from './scheduled-tasks.js';

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

const EXECUTION_CONFIG = config.execution;
const POSITION_LIFECYCLE_ENABLED = config.positionLifecycleEnabled;
const AGGRESSIVE_PAPER_ENABLED = config.aggressivePaperEnabled;
const DIRECTIONAL_PAPER_ENABLED = config.directionalPaperEnabled;
const MINT_RECEIPT_MIN_CONFIRMATIONS = config.mintReceiptMinimumConfirmations;
// Config directional untuk layanan forward; flag breakeven mengikuti kebijakan aplikasi
// (DIRECTIONAL_OPPOSING_BREAKEVEN, default aktif). Guardrail: max drawdown & long-only.
const DIRECTIONAL_CONFIG = {
  ...DEFAULT_DIRECTIONAL_CONFIG,
  opposingExitAtBreakeven: config.directionalOpposingBreakeven,
  shortEnabled: config.directionalShortEnabled,
  maxDrawdownHaltPercent: config.directionalMaxDrawdownPercent,
};
const learningService = new LearningService({
  store: agentStore,
  verdictHorizonHours: ENTRY_VERDICT_HORIZON_HOURS,
});
const aggressivePaperService = new AggressivePaperService({
  store: aggressivePaperStore,
  snapshotStore,
  enabled: AGGRESSIVE_PAPER_ENABLED,
});
const directionalPaperService = new DirectionalPaperService({
  store: directionalPaperStore,
  snapshotStore,
  enabled: DIRECTIONAL_PAPER_ENABLED,
  config: DIRECTIONAL_CONFIG,
});
const marketDataService = new MarketDataService(snapshotStore, onchainStore);
const getWBNBUSDTPair = marketDataService.getPair.bind(marketDataService);
const analyzeWBNBUSDT = marketDataService.analyzePair.bind(marketDataService);
const capturePoolSnapshot = marketDataService.capturePoolSnapshot.bind(marketDataService);
const captureOnchainPoolState = marketDataService.captureOnchainPoolState.bind(marketDataService);
const executionService = new ExecutionService({
  agentStore,
  executionStore,
  lifecycleActivationStore,
  positionStore,
  shadowModeStore,
  learningService,
  marketDataService,
  config: EXECUTION_CONFIG,
  positionLifecycleEnabled: POSITION_LIFECYCLE_ENABLED,
  mintReceiptMinimumConfirmations: MINT_RECEIPT_MIN_CONFIRMATIONS,
});
const buildCurrentHighRiskPlan = aggressivePaperService.buildCurrentPlan.bind(aggressivePaperService);
const getLearningStatus = learningService.getStatus.bind(learningService);
let shuttingDown = false;

const schedulerRegistry = new SchedulerRegistry();
const aiSingleFlight = new SingleFlight();
const openAiLock = new AsyncLock();
const paperAgentService = new PaperAgentService({
  agentStore,
  onchainStore,
  shadowModeStore,
  snapshotStore,
  marketDataService,
  aggressivePaperService,
  learningService,
  openAiLock,
  openAiConfigured: config.openAiConfigured,
  positionLifecycleEnabled: POSITION_LIFECYCLE_ENABLED,
  runPaperPositionLifecycle: (signal, market, onchain, now) =>
    processPaperPositionLifecycle({
      signal,
      market: { price: market.price, tvl: market.tvl, volume1h: market.volume1h },
      onchain,
      positionStore,
      snapshotStore,
      now,
    }),
  reconcileLifecycleActivation: now => executionService.reconcileLifecycleActivation(now),
});
const getReflectionStatus = paperAgentService.getReflectionStatus.bind(paperAgentService);
const lpAnalysisService = new LpAnalysisService({
  agentStore,
  snapshotStore,
  onchainStore,
  marketDataService,
  learningService,
  getExecutionStatus: () => executionService.getStatus(),
  openAiLock,
  aiSingleFlight,
});
const rpcHeavyGate = new ConcurrencyGate(config.rpcHeavyConcurrency);
const operationsService = new OperationsService({
  snapshotStore,
  onchainStore,
  agentStore,
  directionalPaperStore,
  storageMaintenance,
  schedulerRegistry,
  rpcHeavyGate,
  openAiLock,
  applicationSchemaVersion: APPLICATION_SCHEMA_VERSION,
  deploymentIdentity: getApplicationReleaseIdentity(),
  getAppliedMigrations: () => services.appliedMigrations,
  getActiveHttpRequests: http.getActiveHttpRequests,
  isShuttingDown: () => shuttingDown,
});
const scheduledTasks = createBnbScheduledTasks({
  marketData: marketDataService,
  paperAgent: paperAgentService,
  directionalPaper: directionalPaperService,
  learning: learningService,
  lpExecution: executionService,
  operations: operationsService,
});

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

// ============================================
// 📌 API Routes
// ============================================

registerOperationsRoutes(app, {
  getReadiness: () => operationsService.getReadiness(),
  getStorageStatus: () => operationsService.getStorageStatus(),
});

registerMarketDataRoutes(app, {
  snapshotStore,
  onchainStore,
  onchainMiddleware: rpcHeavyLimit,
  captureMarketSnapshot: capturePoolSnapshot,
  captureOnchainState: captureOnchainPoolState,
  getOnchainHealth: () => marketDataService.getOnchainHealth(),
  isExecutionAdapterReady: () => executionService.isExecutionAdapterReady(),
});

registerLpExecutionRoutes(app, {
  lifecycle: {
    positionStore,
    executionStore,
    lifecycleActivationStore,
    shadowModeStore,
    lifecycleEnabled: POSITION_LIFECYCLE_ENABLED,
    mintReceiptMinimumConfirmations: MINT_RECEIPT_MIN_CONFIRMATIONS,
    reconcileLifecycle: () => executionService.reconcileLifecycleActivation(),
    isAdminAuthorized: authorization => executionService.isAdminAuthorized(authorization),
    isExecutionAdapterReady: () => executionService.isExecutionAdapterReady(),
    isExitSwapRouterReady: () => executionService.isExitSwapRouterReady(),
  },
  execution: {
    agentStore,
    executionStore,
    positionStore,
    limits: EXECUTION_CONFIG.limits,
    mintReceiptMinimumConfirmations: MINT_RECEIPT_MIN_CONFIRMATIONS,
    getExecutionStatus: () => executionService.getStatus(),
    isAdminAuthorized: authorization => executionService.isAdminAuthorized(authorization),
    captureOnchainState: captureOnchainPoolState,
    isExecutionAdapterReady: () => executionService.isExecutionAdapterReady(),
    setExecutionAdapterReady: value => executionService.setExecutionAdapterReady(value),
    isExitSwapRouterReady: () => executionService.isExitSwapRouterReady(),
    setExitSwapRouterReady: value => executionService.setExitSwapRouterReady(value),
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
  config: DIRECTIONAL_CONFIG,
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
  isLearningEnabled: () => learningService.getLifecycleCompatibleActiveModel() !== null,
});

registerLearningRoutes(app, {
  store: agentStore,
  getLearningStatus,
});

registerLpAnalysisRoutes(app, {
  rpcMiddleware: rpcHeavyLimit,
  aiRateLimitMiddleware: http.limitAiRequests,
  simulate: investment => lpAnalysisService.simulate(investment),
  generateAiAnalysis: () => lpAnalysisService.generateAiAnalysis(),
});

// ============================================
// 📌 Serve Frontend
// ============================================

registerFrontendAndErrorRoutes(app, join(__dirname, '../../public'), safeErrorMessage);

// ============================================
// 📌 Runtime hooks (no listen/timer side effects)
// ============================================

function closeStores(): void {
  services.close();
}

export const bnbRuntime = {
  app,
  port: config.port,
  host: config.host,
  shutdownTimeoutMs: config.shutdownTimeoutMs,
  schedulerRegistry,
  scheduledTasks,
  setShuttingDown(value: boolean) {
    shuttingDown = value;
  },
  getActiveHttpRequests: http.getActiveHttpRequests,
  closeStores,
};

export type BnbRuntime = typeof bnbRuntime;
export default app;
