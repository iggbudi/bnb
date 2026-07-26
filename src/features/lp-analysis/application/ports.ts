import type { LearningService } from '../../learning/index.js';
import type { AgentStore } from '../../paper-agent/index.js';
import type { MarketDataService, OnchainStore, SnapshotStore } from '../../market-data/index.js';

export type MarketHistoryReader = Pick<SnapshotStore, 'getStatistics'>;
export type CurrentPoolStateReader = Pick<OnchainStore, 'getRecent'>;
export type PaperAnalysisReader = Pick<
  AgentStore,
  'count' | 'getPerformance' | 'getRecent' | 'getRecentReflections'
>;
export type ActiveModelReader = Pick<LearningService, 'getLifecycleCompatibleActiveModel'>;
export type MarketAnalysisReader = Pick<
  MarketDataService,
  'analyzePair' | 'captureOnchainPoolState' | 'getPair'
>;

export interface ExecutionStatusReaderResult {
  ready: boolean;
  mode: 'LOCKED' | 'MANUAL_APPROVAL';
  blockers: readonly string[];
}

export interface ExecutionStatusReader {
  getExecutionStatus(): ExecutionStatusReaderResult;
}
