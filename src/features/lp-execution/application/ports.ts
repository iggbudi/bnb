import type { LifecycleActivationStore, LearningService } from '../../learning/index.js';
import type { MarketDataService } from '../../market-data/index.js';
import type { AgentStore } from '../../paper-agent/index.js';
import type { ExecutionStore } from '../infrastructure/execution-store.js';
import type { PositionStore } from '../infrastructure/position-store.js';
import type { ShadowModeStore } from '../infrastructure/shadow-mode-store.js';

export type PaperDecisionReader = Pick<AgentStore, 'getPerformance' | 'getRecent'>;
export type ActiveModelReader = Pick<LearningService, 'getLifecycleCompatibleActiveModel'>;
export type CurrentPoolHealthReader = Pick<MarketDataService, 'getOnchainHealth'>;
export type ExecutionControlRepository = Pick<
  ExecutionStore,
  'getControl' | 'getRealizedLossToday' | 'getRecentExitProposals' | 'getRecentProposals' | 'recordAudit'
>;
export type LifecycleActivationPort = Pick<LifecycleActivationStore, 'getState' | 'returnToShadow'>;
export type PositionReader = Pick<PositionStore, 'getRecentLiveNfts'>;
export type ShadowValidationPort = Pick<ShadowModeStore, 'refreshQualification'>;
