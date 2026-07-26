import { AgentStore } from '../features/paper-agent/index.js';
import { AggressivePaperStore } from '../features/aggressive-paper/index.js';
import { DirectionalPaperStore } from '../features/directional-paper/index.js';
import { ExecutionStore, PositionStore, ShadowModeStore } from '../features/lp-execution/index.js';
import { LifecycleActivationStore } from '../features/learning/index.js';
import { OnchainStore, SnapshotStore } from '../features/market-data/index.js';
import { applicationDatabasePath } from '../shared/database/connection.js';
import type { AppliedMigration } from '../shared/database/migration-runner.js';
import { bootstrapApplicationDatabase } from './database-bootstrap.js';

interface ClosableStore {
  close(): void;
}

export class BnbServiceContainer {
  readonly snapshotStore: SnapshotStore;
  readonly agentStore: AgentStore;
  readonly executionStore: ExecutionStore;
  readonly onchainStore: OnchainStore;
  readonly positionStore: PositionStore;
  readonly aggressivePaperStore: AggressivePaperStore;
  readonly shadowModeStore: ShadowModeStore;
  readonly lifecycleActivationStore: LifecycleActivationStore;
  readonly directionalPaperStore: DirectionalPaperStore;
  readonly appliedMigrations: AppliedMigration[];
  private readonly stores: ClosableStore[] = [];
  private closed = false;

  constructor(databasePath = applicationDatabasePath()) {
    this.appliedMigrations = bootstrapApplicationDatabase(databasePath);
    try {
      this.snapshotStore = this.track(new SnapshotStore(databasePath));
      this.agentStore = this.track(new AgentStore(databasePath));
      this.executionStore = this.track(new ExecutionStore(databasePath));
      this.onchainStore = this.track(new OnchainStore(databasePath));
      this.positionStore = this.track(new PositionStore(databasePath));
      this.aggressivePaperStore = this.track(new AggressivePaperStore(databasePath));
      this.shadowModeStore = this.track(new ShadowModeStore(databasePath));
      this.lifecycleActivationStore = this.track(new LifecycleActivationStore(databasePath));
      this.directionalPaperStore = this.track(new DirectionalPaperStore(databasePath));
    } catch (error) {
      this.close();
      throw new Error('Service container initialization failed', { cause: error });
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const store of [...this.stores].reverse()) store.close();
  }

  private track<T extends ClosableStore>(store: T): T {
    this.stores.push(store);
    return store;
  }
}
