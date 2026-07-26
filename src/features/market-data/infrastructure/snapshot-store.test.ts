import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { SnapshotStore, type PoolSnapshotInput } from './snapshot-store.js';

const snapshot: PoolSnapshotInput = {
  price: 2_000,
  tvl: 10_000_000,
  volume24h: 5_000_000,
  volume6h: 1_000_000,
  volume1h: 100_000,
  volLiqRatio: 0.5,
  estimatedFees24h: 2_500,
  estimatedAPR: 9.125,
  priceChange1h: 0.1,
  priceChange6h: -0.2,
  priceChange24h: 1.5,
  txns24h: { buys: 100, sells: 80 },
  wbnbInPool: 2_500,
  usdtInPool: 5_000_000,
  pairAddress: '0xpool',
};

test('stores and reads a pool snapshot', () => {
  const store = new SnapshotStore(':memory:', { initializeSchema: true });
  const capturedAt = new Date();
  store.save(snapshot, capturedAt);

  assert.equal(store.count(), 1);
  const [saved] = store.getHistory(24, 100);
  const expectedMinute = Math.floor(capturedAt.getTime() / 60_000) * 60_000;
  assert.equal(saved.capturedAt, new Date(expectedMinute).toISOString());
  assert.equal(saved.price, snapshot.price);
  assert.deepEqual(saved.txns24h, snapshot.txns24h);
  store.close();
});

test('upserts repeated snapshots within the same minute', () => {
  const store = new SnapshotStore(':memory:', { initializeSchema: true });
  const minute = Math.floor(Date.now() / 60_000) * 60_000;
  store.save(snapshot, new Date(minute + 1_000));
  store.save({ ...snapshot, price: 2_100 }, new Date(minute + 59_000));

  assert.equal(store.count(), 1);
  assert.equal(store.getHistory(24, 100)[0].price, 2_100);
  store.close();
});

test('returns downsampled chart data and period statistics', () => {
  const store = new SnapshotStore(':memory:', { initializeSchema: true });
  const minute = Math.floor(Date.now() / 60_000) * 60_000;
  store.save(snapshot, new Date(minute - 60_000));
  store.save({ ...snapshot, price: 2_100, tvl: 11_000_000 }, new Date(minute));

  const chart = store.getChartHistory(1, 60);
  const oneHour = store.getStatistics().find(period => period.label === '1h');
  assert.equal(chart.length, 2);
  assert.equal(oneHour?.count, 2);
  assert.equal(oneHour?.price.first, 2_000);
  assert.equal(oneHour?.price.latest, 2_100);
  assert.ok((oneHour?.price.changePercent ?? 0) > 4.9);
  store.close();
});

test('reads snapshots between decision and outcome timestamps', () => {
  const store = new SnapshotStore(':memory:', { initializeSchema: true });
  const start = new Date('2026-07-18T10:00:00.000Z');
  store.save(snapshot, start);
  store.save({ ...snapshot, price: 2_010 }, new Date('2026-07-18T10:01:00.000Z'));
  store.save({ ...snapshot, price: 2_020 }, new Date('2026-07-18T10:02:00.000Z'));

  const between = store.getSnapshotsBetween(
    new Date('2026-07-18T10:00:30.000Z'),
    new Date('2026-07-18T10:02:30.000Z')
  );
  const exit = store.getSnapshotAtOrBefore(new Date('2026-07-18T10:02:30.000Z'));

  assert.deepEqual(
    between.map(item => item.price),
    [2_010, 2_020]
  );
  assert.equal(exit?.price, 2_020);
  assert.equal(store.getSnapshotAtOrBefore(new Date('2026-07-18T11:00:00.000Z'), 5 * 60_000), null);
  store.close();
});

test('creates a consistent SQLite backup file', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'bnb-viewer-'));
  const databasePath = join(directory, 'source.sqlite');
  const store = new SnapshotStore(databasePath, { initializeSchema: true });
  store.save(snapshot);

  const backupPath = await store.createBackup(join(directory, 'backups'));
  assert.ok(existsSync(backupPath));
  const backupStore = new SnapshotStore(backupPath, { initializeSchema: true });
  assert.equal(backupStore.count(), 1);
  backupStore.close();
  store.close();
  rmSync(directory, { recursive: true, force: true });
});
