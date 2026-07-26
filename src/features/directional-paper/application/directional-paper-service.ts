import { DirectionalPaperStore } from '../../../directional-paper-store.js';
import { SnapshotStore } from '../../../snapshot-store.js';
import { runDirectionalForwardCycle } from './directional-paper-manager.js';
import {
  DEFAULT_DIRECTIONAL_CONFIG,
  type DirectionalStrategyConfig,
} from '../domain/directional-strategy.js';

export interface DirectionalPaperServiceDependencies {
  store: DirectionalPaperStore;
  snapshotStore: SnapshotStore;
  enabled: boolean;
  config?: Readonly<DirectionalStrategyConfig>;
  log?: (message: string) => void;
}

export class DirectionalPaperService {
  private readonly config: Readonly<DirectionalStrategyConfig>;
  private readonly log: (message: string) => void;

  constructor(private readonly dependencies: DirectionalPaperServiceDependencies) {
    this.config = dependencies.config ?? DEFAULT_DIRECTIONAL_CONFIG;
    this.log = dependencies.log ?? console.log;
  }

  runCycle(now = new Date()) {
    if (!this.dependencies.enabled) return null;
    const performance = runDirectionalForwardCycle({
      store: this.dependencies.store,
      snapshotStore: this.dependencies.snapshotStore,
      config: this.config,
      now,
    });
    const latest = performance?.latestDecision;
    if (latest && latest.action !== 'WAIT' && latest.action !== 'HOLD') {
      this.log(`📈 Directional paper: ${latest.action} (${latest.reasonCode})`);
    }
    return performance;
  }
}
