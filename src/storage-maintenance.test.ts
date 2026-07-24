import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { OnchainStore } from './onchain-store.js';
import type { PancakeV3OnchainState } from './pancakeswap-v3-onchain.js';
import { SnapshotStore, type PoolSnapshotInput } from './snapshot-store.js';
import {
  boundedIntegerEnvironment,
  getBackupStorageStats,
  pruneDailyBackups,
  StorageMaintenanceService,
} from './storage-maintenance.js';

const market: PoolSnapshotInput = {
  price: 600,
  tvl: 1_000_000,
  volume24h: 100_000,
  volume6h: 25_000,
  volume1h: 5_000,
  volLiqRatio: 0.1,
  estimatedFees24h: 10,
  estimatedAPR: 0.365,
  priceChange1h: 0,
  priceChange6h: 0,
  priceChange24h: 0,
  txns24h: { buys: 1, sells: 1 },
  wbnbInPool: 1_000,
  usdtInPool: 600_000,
  pairAddress: '0xpool',
};

function onchain(blockNumber: number, capturedAt: Date): PancakeV3OnchainState {
  return {
    blockNumber,
    blockTimestamp: capturedAt.toISOString(),
    capturedAt: capturedAt.toISOString(),
    currentTick: -63_000,
    activeLiquidity: '1000',
    feeGrowthGlobal0X128: '1',
    feeGrowthGlobal1X128: '2',
    priceWbnbUsd: 600,
    gas: { gasPriceWei: '1000000000' },
  } as PancakeV3OnchainState;
}

test('snapshot stores delete observations beyond the configured retention window', () => {
  const now = new Date('2026-07-25T00:00:00.000Z');
  const marketStore = new SnapshotStore(':memory:');
  const chainStore = new OnchainStore(':memory:');
  try {
    marketStore.save(market, new Date('2026-05-01T00:00:00.000Z'));
    marketStore.save(market, new Date('2026-07-01T00:00:00.000Z'));
    chainStore.saveIfAbsent(onchain(1, new Date('2026-05-01T00:00:00.000Z')));
    chainStore.saveIfAbsent(onchain(2, new Date('2026-07-01T00:00:00.000Z')));

    assert.equal(marketStore.deleteOlderThan(60, now), 1);
    assert.equal(chainStore.deleteOlderThan(60, now), 1);
    assert.equal(marketStore.count(), 1);
    assert.equal(chainStore.count(), 1);
    assert.throws(() => marketStore.deleteOlderThan(0), /must be positive/);
    assert.throws(() => chainStore.deleteOlderThan(0), /must be positive/);
  } finally {
    chainStore.close();
    marketStore.close();
  }
});

test('backup pruning retains only dated daily files and preserves migration backups', () => {
  const directory = mkdtempSync(join(tmpdir(), 'bnb-backup-retention-'));
  try {
    for (let day = 1; day <= 20; day++) {
      writeFileSync(join(directory, `bnb-viewer-2026-06-${String(day).padStart(2, '0')}.sqlite`), 'daily');
    }
    const protectedBackup = 'bnb-viewer-pre-p2-2026-07-24T21-39-10-624Z.sqlite';
    writeFileSync(join(directory, protectedBackup), 'protected');

    const removed = pruneDailyBackups(directory, 14);
    assert.equal(removed.length, 6);
    assert.equal(existsSync(join(directory, protectedBackup)), true);
    const stats = getBackupStorageStats(directory);
    assert.equal(stats.dailyFiles, 14);
    assert.equal(stats.protectedFiles, 1);
    assert.equal(stats.latestDailyBackup, 'bnb-viewer-2026-06-20.sqlite');
    assert.throws(() => pruneDailyBackups(directory, 0), /positive integer/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('storage maintenance backs up, prunes snapshots, checkpoints WAL, and reports sizes', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'bnb-storage-maintenance-'));
  const databasePath = join(directory, 'data.sqlite');
  const backupDirectory = join(directory, 'backups');
  const marketStore = new SnapshotStore(databasePath);
  const chainStore = new OnchainStore(databasePath);
  const now = new Date('2026-07-25T00:00:00.000Z');
  try {
    marketStore.save(market, new Date('2026-05-01T00:00:00.000Z'));
    marketStore.save(market, new Date('2026-07-24T00:00:00.000Z'));
    chainStore.saveIfAbsent(onchain(1, new Date('2026-05-01T00:00:00.000Z')));
    chainStore.saveIfAbsent(onchain(2, new Date('2026-07-24T00:00:00.000Z')));

    const maintenance = new StorageMaintenanceService(marketStore, chainStore, backupDirectory, {
      snapshotRetentionDays: 60,
      backupRetentionFiles: 14,
    });
    const result = await maintenance.run(now);
    assert.equal(result.deletedMarketSnapshots, 1);
    assert.equal(result.deletedOnchainSnapshots, 1);
    assert.equal(result.backupCreated, 'bnb-viewer-2026-07-25.sqlite');
    assert.ok(result.database.mainBytes > 0);
    assert.ok(result.database.pageCount > 0);
    assert.equal(result.backups.dailyFiles, 1);
    assert.equal(result.walCheckpoint.busy, 0);
    assert.equal(maintenance.getStatus().lastError, null);
    assert.deepEqual(
      readdirSync(backupDirectory).filter(file => file.endsWith('.tmp')),
      []
    );
  } finally {
    chainStore.close();
    marketStore.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('retention environment values are clamped to safe operational bounds', () => {
  const previous = process.env.TEST_RETENTION;
  try {
    process.env.TEST_RETENTION = '2';
    assert.equal(boundedIntegerEnvironment('TEST_RETENTION', 60, 30, 90), 30);
    process.env.TEST_RETENTION = '200';
    assert.equal(boundedIntegerEnvironment('TEST_RETENTION', 60, 30, 90), 90);
    process.env.TEST_RETENTION = 'invalid';
    assert.equal(boundedIntegerEnvironment('TEST_RETENTION', 60, 30, 90), 60);
  } finally {
    if (previous === undefined) delete process.env.TEST_RETENTION;
    else process.env.TEST_RETENTION = previous;
  }
});
