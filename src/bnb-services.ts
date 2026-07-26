import { AgentStore } from './agent-store.js';
import { AggressivePaperStore } from './aggressive-paper-store.js';
import { DirectionalPaperStore } from './directional-paper-store.js';
import { ExecutionStore } from './execution-store.js';
import { LifecycleActivationStore } from './lifecycle-activation-store.js';
import { OnchainStore } from './onchain-store.js';
import { PositionStore } from './position-store.js';
import { applyApplicationMigrations } from './schema-migrations.js';
import { ShadowModeStore } from './shadow-mode-store.js';
import { SnapshotStore } from './snapshot-store.js';

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
