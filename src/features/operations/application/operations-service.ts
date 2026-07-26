import type { AgentStore } from '../../../agent-store.js';
import type { DirectionalPaperStore } from '../../../directional-paper-store.js';
import type { OnchainStore } from '../../../onchain-store.js';
import type { SnapshotStore } from '../../../snapshot-store.js';
import { safeErrorMessage } from '../../../shared/http/errors.js';
import type {
  AsyncLock,
  ConcurrencyGate,
  SchedulerRegistry,
} from '../../../shared/runtime/operational-controls.js';
import type { StorageMaintenanceService } from './storage-maintenance.js';

export interface AppliedMigrationView {
  version: number;
  name: string;
}

export interface OperationsServiceDependencies {
  snapshotStore: SnapshotStore;
  onchainStore: OnchainStore;
  agentStore: AgentStore;
  directionalPaperStore: DirectionalPaperStore;
  storageMaintenance: StorageMaintenanceService;
  schedulerRegistry: SchedulerRegistry;
  rpcHeavyGate: ConcurrencyGate;
  openAiLock: AsyncLock;
  applicationSchemaVersion: number;
  getAppliedMigrations(): readonly AppliedMigrationView[];
  getActiveHttpRequests(): number;
  isShuttingDown(): boolean;
  log?: (message: string) => void;
}

export class OperationsService {
  private readonly log: (message: string) => void;

  constructor(private readonly dependencies: OperationsServiceDependencies) {
    this.log = dependencies.log ?? console.log;
  }

  getReadiness(now = Date.now()) {
    const checks: Record<string, { ready: boolean; detail: string }> = {};
    try {
      this.dependencies.snapshotStore.count();
      this.dependencies.onchainStore.count();
      this.dependencies.agentStore.count();
      this.dependencies.directionalPaperStore.getRecentRuns(1);
      checks.sqlite = { ready: true, detail: 'read/write stores are queryable' };
    } catch {
      checks.sqlite = { ready: false, detail: 'SQLite query failed' };
    }

    const latestMigration = this.dependencies.getAppliedMigrations().at(-1);
    checks.schemaMigrations = {
      ready: latestMigration?.version === this.dependencies.applicationSchemaVersion,
      detail: latestMigration
        ? `version=${latestMigration.version}, name=${latestMigration.name}`
        : 'no schema migration recorded',
    };

    const latestMarket = this.dependencies.snapshotStore.getHistory(24, 1)[0] ?? null;
    const latestOnchain = this.dependencies.onchainStore.getRecent(1)[0] ?? null;
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

    const schedulers = this.dependencies.schedulerRegistry.list().map(status => ({
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
        [
          'market-snapshot',
          'onchain-snapshot',
          'paper-lifecycle',
          'directional-paper',
          'paper-outcome',
          'storage-maintenance',
        ].includes(status.name) &&
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
      ready: !this.dependencies.isShuttingDown(),
      detail: this.dependencies.isShuttingDown() ? 'shutdown in progress' : 'accepting traffic',
    };
    return {
      ready: Object.values(checks).every(check => check.ready),
      checks,
      schedulers,
      activeHttpRequests: this.dependencies.getActiveHttpRequests(),
      rpcHeavyActive: this.dependencies.rpcHeavyGate.active,
      openAiActive: this.dependencies.openAiLock.active,
    };
  }

  getStorageStatus() {
    return this.dependencies.storageMaintenance.getStatus();
  }

  async runStorageMaintenance(): Promise<void> {
    const result = await this.dependencies.storageMaintenance.run();
    this.log(
      `💾 Storage maintenance: backup=${result.backupCreated}, marketDeleted=${result.deletedMarketSnapshots}, onchainDeleted=${result.deletedOnchainSnapshots}, backupsDeleted=${result.deletedDailyBackups.length}, walBusy=${result.walCheckpoint.busy}`
    );
  }
}
