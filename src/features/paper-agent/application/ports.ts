import type { AggressivePaperService } from '../../aggressive-paper/index.js';
import type { LearningService } from '../../learning/index.js';
import type {
  MarketDataService,
  OnchainStore,
  SnapshotStore,
  WbnbUsdtAnalysis,
  PancakeV3OnchainState,
} from '../../market-data/index.js';
import type { ShadowModeStore } from '../../lp-execution/index.js';
import type { AgentStore, PaperAgentDecision } from '../infrastructure/agent-store.js';
import type { PaperPositionLifecycleResult } from '../../lp-execution/index.js';

export type PaperAgentRepository = Pick<
  AgentStore,
  | 'getByDecisionHour'
  | 'getDueDecisions'
  | 'getOutcomesPendingAssessment'
  | 'getOutcomesPendingInterpretation'
  | 'getOutcomesPendingReflection'
  | 'getRecentReflections'
  | 'pendingReflectionCount'
  | 'reflectionCount'
  | 'saveIfAbsent'
  | 'saveOutcomeAssessmentIfAbsent'
  | 'saveOutcomeIfAbsent'
  | 'saveOutcomeInterpretationIfAbsent'
  | 'saveReflectionIfAbsent'
>;
export type MarketHistoryReader = Pick<
  SnapshotStore,
  'getSnapshotAtOrBefore' | 'getSnapshotsBetween' | 'getStatistics'
>;
export type CurrentPoolStateReader = Pick<OnchainStore, 'getAtOrBefore' | 'getRecent'>;
export type ActiveModelReader = Pick<LearningService, 'getLifecycleCompatibleActiveModel'>;
export type MarketCapturePort = Pick<MarketDataService, 'captureOnchainPoolState' | 'capturePoolSnapshot'>;
export type AggressivePaperLifecyclePort = Pick<AggressivePaperService, 'buildCurrentPlan' | 'runLifecycle'>;
export type ShadowValidationWriter = Pick<ShadowModeStore, 'recordFailure' | 'recordSuccess'>;

export interface PositionLifecyclePort {
  run(
    signal: PaperAgentDecision,
    market: WbnbUsdtAnalysis,
    onchain: PancakeV3OnchainState | null,
    now: Date
  ): PaperPositionLifecycleResult;
}
