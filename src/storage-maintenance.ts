import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';

import type { OnchainStore } from './onchain-store.js';
import type { DatabaseStorageStats, SnapshotStore, WalCheckpointResult } from './snapshot-store.js';

const DAILY_BACKUP_PATTERN = /^bnb-viewer-\d{4}-\d{2}-\d{2}\.sqlite$/;

export interface StorageRetentionPolicy {
  snapshotRetentionDays: number;
  backupRetentionFiles: number;
}

export interface BackupStorageStats {
  directory: string;
  dailyFiles: number;
  protectedFiles: number;
  totalBytes: number;
  latestDailyBackup: string | null;
}

export interface StorageMaintenanceResult {
  startedAt: string;
  completedAt: string;
  backupCreated: string;
  deletedMarketSnapshots: number;
  deletedOnchainSnapshots: number;
  deletedDailyBackups: string[];
  walCheckpoint: WalCheckpointResult;
  database: Omit<DatabaseStorageStats, 'databasePath'>;
  backups: BackupStorageStats;
}

export function boundedIntegerEnvironment(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(parsed)));
}

export function storageRetentionPolicy(): StorageRetentionPolicy {
  return {
    snapshotRetentionDays: boundedIntegerEnvironment('SNAPSHOT_RETENTION_DAYS', 60, 30, 90),
    backupRetentionFiles: boundedIntegerEnvironment('BACKUP_RETENTION_FILES', 21, 14, 30),
  };
}

function backupFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).filter(file => file.endsWith('.sqlite'));
}

export function getBackupStorageStats(backupDirectory: string): BackupStorageStats {
  const directory = resolve(backupDirectory);
  const files = backupFiles(directory);
  const daily = files
    .filter(file => DAILY_BACKUP_PATTERN.test(file))
    .sort()
    .reverse();
  return {
    directory: basename(directory),
    dailyFiles: daily.length,
    protectedFiles: files.length - daily.length,
    totalBytes: files.reduce((total, file) => total + statSync(resolve(directory, file)).size, 0),
    latestDailyBackup: daily[0] ?? null,
  };
}

export function pruneDailyBackups(backupDirectory: string, maximumFiles: number): string[] {
  if (!Number.isInteger(maximumFiles) || maximumFiles < 1) {
    throw new Error('Backup retention file count must be a positive integer');
  }
  const directory = resolve(backupDirectory);
  const daily = backupFiles(directory)
    .filter(file => DAILY_BACKUP_PATTERN.test(file))
    .sort()
    .reverse();
  const removed = daily.slice(maximumFiles);
  for (const file of removed) rmSync(resolve(directory, file));
  return removed;
}

function publicDatabaseStats(stats: DatabaseStorageStats): Omit<DatabaseStorageStats, 'databasePath'> {
  const { databasePath: _databasePath, ...publicStats } = stats;
  return publicStats;
}

export class StorageMaintenanceService {
  private lastResult: StorageMaintenanceResult | null = null;
  private lastErrorAt: string | null = null;
  private lastError: string | null = null;

  constructor(
    private readonly snapshotStore: SnapshotStore,
    private readonly onchainStore: OnchainStore,
    private readonly backupDirectory: string,
    readonly policy = storageRetentionPolicy()
  ) {}

  async run(now = new Date()): Promise<StorageMaintenanceResult> {
    const startedAt = now.toISOString();
    try {
      // Preserve one consistent pre-retention recovery point before deleting old observations.
      const backupCreated = await this.snapshotStore.createBackup(this.backupDirectory, now);
      const deletedMarketSnapshots = this.snapshotStore.deleteOlderThan(
        this.policy.snapshotRetentionDays,
        now
      );
      const deletedOnchainSnapshots = this.onchainStore.deleteOlderThan(
        this.policy.snapshotRetentionDays,
        now
      );
      const walCheckpoint = this.snapshotStore.checkpointWal('PASSIVE');
      const deletedDailyBackups = pruneDailyBackups(this.backupDirectory, this.policy.backupRetentionFiles);
      const result: StorageMaintenanceResult = {
        startedAt,
        completedAt: new Date().toISOString(),
        backupCreated: basename(backupCreated),
        deletedMarketSnapshots,
        deletedOnchainSnapshots,
        deletedDailyBackups,
        walCheckpoint,
        database: publicDatabaseStats(this.snapshotStore.getStorageStats()),
        backups: getBackupStorageStats(this.backupDirectory),
      };
      this.lastResult = result;
      this.lastErrorAt = null;
      this.lastError = null;
      return result;
    } catch (error) {
      this.lastErrorAt = new Date().toISOString();
      this.lastError =
        error instanceof Error ? `${error.name}: storage maintenance failed` : 'Storage maintenance failed';
      throw error;
    }
  }

  getStatus() {
    return {
      policy: this.policy,
      database: publicDatabaseStats(this.snapshotStore.getStorageStats()),
      backups: getBackupStorageStats(this.backupDirectory),
      lastResult: this.lastResult,
      lastErrorAt: this.lastErrorAt,
      lastError: this.lastError,
    };
  }
}
