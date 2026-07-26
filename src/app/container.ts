import { AgentStore } from '../features/paper-agent/index.js';
import { AggressivePaperStore } from '../features/aggressive-paper/index.js';
import { DirectionalPaperStore } from '../features/directional-paper/index.js';
import { ExecutionStore } from '../features/lp-execution/index.js';
import { LifecycleActivationStore } from '../features/learning/index.js';
import { OnchainStore } from '../features/market-data/index.js';
import { PositionStore } from '../features/lp-execution/index.js';
import { applyApplicationMigrations } from './migrations.js';
import { ShadowModeStore } from '../features/lp-execution/index.js';
import { SnapshotStore } from '../features/market-data/index.js';

export class BnbServiceContainer {
  readonly snapshotStore = new SnapshotStore();
  readonly agentStore = new AgentStore();
  readonly executionStore = new ExecutionStore();
  readonly onchainStore = new OnchainStore();
  readonly positionStore = new PositionStore();
  readonly aggressivePaperStore = new AggressivePaperStore();
  readonly shadowModeStore = new ShadowModeStore();
  readonly lifecycleActivationStore = new LifecycleActivationStore();
  readonly appliedMigrations = applyApplicationMigrations();
  readonly directionalPaperStore = new DirectionalPaperStore();
  private closed = false;

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const store of [
      this.directionalPaperStore,
      this.lifecycleActivationStore,
      this.shadowModeStore,
      this.aggressivePaperStore,
      this.positionStore,
      this.onchainStore,
      this.executionStore,
      this.agentStore,
      this.snapshotStore,
    ]) {
      store.close();
    }
  }
}
