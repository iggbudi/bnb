import { timingSafeEqual } from 'node:crypto';
import type { AgentStore } from '../../../agent-store.js';
import type { ExecutionStore } from '../../../execution-store.js';
import type { LifecycleActivationStore } from '../../../lifecycle-activation-store.js';
import type { PositionStore } from '../../../position-store.js';
import type { ShadowModeStore } from '../../../shadow-mode-store.js';
import type { LearningService } from '../../learning/index.js';
import type { MarketDataService } from '../../market-data/index.js';
import { evaluateExecutionReadiness, type ExecutionLimits } from '../domain/execution-control.js';
import { verifyPositionManagerAdapter } from '../infrastructure/pancakeswap-v3-execution.js';
import { PANCAKE_V3_SWAP_ROUTER, verifyPancakeV3SwapRouter } from '../infrastructure/pancakeswap-v3-exit.js';

export interface ExecutionServiceConfig {
  liveExecutionEnabled: boolean;
  adminToken: string;
  limits: ExecutionLimits;
}

export interface ExecutionServiceDependencies {
  agentStore: AgentStore;
  executionStore: ExecutionStore;
  lifecycleActivationStore: LifecycleActivationStore;
  positionStore: PositionStore;
  shadowModeStore: ShadowModeStore;
  learningService: LearningService;
  marketDataService: MarketDataService;
  config: ExecutionServiceConfig;
  positionLifecycleEnabled: boolean;
  mintReceiptMinimumConfirmations: number;
  logError?: (message: string) => void;
}

export class ExecutionService {
  private executionAdapterVerified = false;
  private exitSwapRouterVerified = false;
  private readonly logError: (message: string) => void;

  constructor(private readonly dependencies: ExecutionServiceDependencies) {
    this.logError = dependencies.logError ?? console.error;
  }

  async refreshAdapterVerification(): Promise<boolean> {
    const [positionManagerResult, swapRouterResult] = await Promise.allSettled([
      verifyPositionManagerAdapter(),
      verifyPancakeV3SwapRouter(),
    ]);
    this.executionAdapterVerified =
      positionManagerResult.status === 'fulfilled' && positionManagerResult.value;
    this.exitSwapRouterVerified = swapRouterResult.status === 'fulfilled' && swapRouterResult.value;
    if (!this.executionAdapterVerified) {
      this.logError('Execution adapter verification error: Position Manager bytecode verification failed');
    }
    if (!this.exitSwapRouterVerified) {
      this.logError(
        'Optional exit swap adapter verification error: PancakeSwap V3 SwapRouter verification failed'
      );
    }
    return this.executionAdapterVerified;
  }

  reconcileLifecycleActivation(now = new Date()) {
    const shadowValidation = this.dependencies.shadowModeStore.refreshQualification(now);
    let activation = this.dependencies.lifecycleActivationStore.getState();
    if (activation.mode === 'PAPER_ACTIVE' && !shadowValidation.qualified) {
      activation = this.dependencies.lifecycleActivationStore.returnToShadow(
        `Automatic fail-closed rollback: ${shadowValidation.blockers.join(', ')}`,
        now
      );
      this.dependencies.executionStore.recordAudit(
        'LIFECYCLE_AUTO_RETURNED_TO_SHADOW',
        null,
        { shadowRunId: shadowValidation.run.id, blockers: shadowValidation.blockers },
        now
      );
    }
    return {
      activation,
      shadowValidation,
      activationEligible: this.dependencies.positionLifecycleEnabled && shadowValidation.qualified,
    };
  }

  getStatus(now = new Date()) {
    const control = this.dependencies.executionStore.getControl();
    const performance168h = this.dependencies.agentStore.getPerformance(168);
    const latestDecision = this.dependencies.agentStore.getRecent(1)[0] ?? null;
    const realizedLossTodayUsd = this.dependencies.executionStore.getRealizedLossToday(now);
    const lifecycleRuntime = this.reconcileLifecycleActivation(now);
    const shadowValidation = lifecycleRuntime.shadowValidation;
    const onchainReady = this.dependencies.marketDataService.getOnchainHealth().ready;
    const readiness = evaluateExecutionReadiness({
      liveExecutionEnabled: this.dependencies.config.liveExecutionEnabled,
      adminTokenConfigured: this.dependencies.config.adminToken.length >= 32,
      onchainAdapterReady: this.executionAdapterVerified && onchainReady,
      shadowValidationQualified: shadowValidation.qualified,
      paperLifecycleActive: lifecycleRuntime.activation.mode === 'PAPER_ACTIVE',
      killSwitchEngaged: control.killSwitchEngaged,
      activeModel: this.dependencies.learningService.getLifecycleCompatibleActiveModel(),
      performance168h,
      latestDecision,
      realizedLossTodayUsd,
      now,
      limits: this.dependencies.config.limits,
    });

    return {
      ...readiness,
      control,
      limits: this.dependencies.config.limits,
      realizedLossTodayUsd,
      shadowValidation,
      lifecycleActivation: lifecycleRuntime.activation,
      liveExecutionEnabled: this.dependencies.config.liveExecutionEnabled,
      adminTokenConfigured: this.dependencies.config.adminToken.length >= 32,
      onchainDataAdapterReady: onchainReady,
      onchainExecutionAdapterReady: this.executionAdapterVerified && onchainReady,
      privateKeyStoredByServer: false,
      unsignedTransactionPlanningAvailable: this.executionAdapterVerified,
      mintReceiptVerificationAvailable: this.executionAdapterVerified,
      mintReceiptMinimumConfirmations: this.dependencies.mintReceiptMinimumConfirmations,
      trackedLiveNfts: this.dependencies.positionStore.getRecentLiveNfts(10),
      unsignedExitPlanningAvailable: this.executionAdapterVerified,
      optionalExitSwapAvailable: this.exitSwapRouterVerified,
      exitSwapRouter: PANCAKE_V3_SWAP_ROUTER,
      recentExitProposals: this.dependencies.executionStore.getRecentExitProposals(10),
      transactionSigningAvailable: false,
      broadcastAvailable: false,
      approvalEffect:
        'Approval permits preparation of an unsigned full-range mint plan; an external wallet must explicitly sign every transaction.',
      recentProposals: this.dependencies.executionStore.getRecentProposals(10),
    };
  }

  isAdminAuthorized(authorization: string | undefined): boolean {
    const expectedToken = this.dependencies.config.adminToken;
    if (expectedToken.length < 32 || !authorization?.startsWith('Bearer ')) return false;
    const provided = Buffer.from(authorization.slice('Bearer '.length));
    const expected = Buffer.from(expectedToken);
    return provided.length === expected.length && timingSafeEqual(provided, expected);
  }

  isExecutionAdapterReady(): boolean {
    return this.executionAdapterVerified;
  }

  setExecutionAdapterReady(value: boolean): void {
    this.executionAdapterVerified = value;
  }

  isExitSwapRouterReady(): boolean {
    return this.exitSwapRouterVerified;
  }

  setExitSwapRouterReady(value: boolean): void {
    this.exitSwapRouterVerified = value;
  }
}
