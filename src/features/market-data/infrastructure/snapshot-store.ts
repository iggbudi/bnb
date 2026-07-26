import { existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import { applicationDatabasePath, openApplicationDatabase } from '../../../shared/database/connection.js';
import { prepareStoreSchema, type StoreSchemaOptions } from '../../../shared/database/store-schema.js';

export interface PoolSnapshotInput {
  price: number;
  tvl: number;
  volume24h: number;
  volume6h: number;
  volume1h: number;
  volLiqRatio: number;
  estimatedFees24h: number;
  estimatedAPR: number;
  priceChange1h: number;
  priceChange6h: number;
  priceChange24h: number;
  txns24h: { buys: number; sells: number };
  wbnbInPool: number;
  usdtInPool: number;
  pairAddress: string;
}

export interface PoolSnapshot extends PoolSnapshotInput {
  capturedAt: string;
}

export interface HistoricalPeriodStats {
  label: '1h' | '24h' | '7d' | '30d';
  hours: number;
  count: number;
  expectedCount: number;
  coveragePercent: number;
  firstCapturedAt: string | null;
  latestCapturedAt: string | null;
  price: {
    first: number | null;
    latest: number | null;
    min: number | null;
    max: number | null;
    average: number | null;
    changePercent: number | null;
  };
  tvl: {
    first: number | null;
    latest: number | null;
    min: number | null;
    max: number | null;
    average: number | null;
    changePercent: number | null;
  };
  volume24h: { average: number | null; min: number | null; max: number | null };
  estimatedAPR: { average: number | null; min: number | null; max: number | null };
}

export interface ChartPoint {
  capturedAt: string;
  price: number;
  tvl: number;
  volume24h: number;
  estimatedAPR: number;
}

export interface WalCheckpointResult {
  busy: number;
  logFrames: number;
  checkpointedFrames: number;
}

export interface DatabaseStorageStats {
  databasePath: string;
  mainBytes: number;
  walBytes: number;
  shmBytes: number;
  totalBytes: number;
  pageCount: number;
  pageSize: number;
  freePages: number;
}

export function createMarketSnapshotSchema(database: DatabaseSync): void {
  database.exec(`

      CREATE TABLE IF NOT EXISTS pool_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        captured_minute INTEGER NOT NULL UNIQUE,
        captured_at TEXT NOT NULL,
        pair_address TEXT NOT NULL,
        price REAL NOT NULL,
        tvl REAL NOT NULL,
        volume_24h REAL NOT NULL,
        volume_6h REAL NOT NULL,
        volume_1h REAL NOT NULL,
        vol_liq_ratio REAL NOT NULL,
        estimated_fees_24h REAL NOT NULL,
        estimated_apr REAL NOT NULL,
        price_change_1h REAL NOT NULL,
        price_change_6h REAL NOT NULL,
        price_change_24h REAL NOT NULL,
        buys_24h INTEGER NOT NULL,
        sells_24h INTEGER NOT NULL,
        wbnb_in_pool REAL NOT NULL,
        usdt_in_pool REAL NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_pool_snapshots_captured_minute
        ON pool_snapshots(captured_minute);
    `);
}

export class SnapshotStore {
  private readonly database: DatabaseSync;
  private readonly databasePath: string;

  constructor(databasePath = applicationDatabasePath(), schemaOptions: StoreSchemaOptions = {}) {
    this.databasePath = databasePath;
    this.database = openApplicationDatabase(databasePath);
    try {
      prepareStoreSchema(
        this.database,
        'market-data',
        ['pool_snapshots'],
        createMarketSnapshotSchema,
        schemaOptions
      );
    } catch (error) {
      this.database.close();
      throw error;
    }
  }

  save(snapshot: PoolSnapshotInput, capturedAt = new Date()): void {
    const capturedMinute = Math.floor(capturedAt.getTime() / 60_000) * 60_000;
    const timestamp = new Date(capturedMinute).toISOString();

    this.database
      .prepare(
        `
      INSERT INTO pool_snapshots (
        captured_minute, captured_at, pair_address, price, tvl,
        volume_24h, volume_6h, volume_1h, vol_liq_ratio,
        estimated_fees_24h, estimated_apr,
        price_change_1h, price_change_6h, price_change_24h,
        buys_24h, sells_24h, wbnb_in_pool, usdt_in_pool
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
      ON CONFLICT(captured_minute) DO UPDATE SET
        captured_at = excluded.captured_at,
        pair_address = excluded.pair_address,
        price = excluded.price,
        tvl = excluded.tvl,
        volume_24h = excluded.volume_24h,
        volume_6h = excluded.volume_6h,
        volume_1h = excluded.volume_1h,
        vol_liq_ratio = excluded.vol_liq_ratio,
        estimated_fees_24h = excluded.estimated_fees_24h,
        estimated_apr = excluded.estimated_apr,
        price_change_1h = excluded.price_change_1h,
        price_change_6h = excluded.price_change_6h,
        price_change_24h = excluded.price_change_24h,
        buys_24h = excluded.buys_24h,
        sells_24h = excluded.sells_24h,
        wbnb_in_pool = excluded.wbnb_in_pool,
        usdt_in_pool = excluded.usdt_in_pool
    `
      )
      .run(
        capturedMinute,
        timestamp,
        snapshot.pairAddress,
        snapshot.price,
        snapshot.tvl,
        snapshot.volume24h,
        snapshot.volume6h,
        snapshot.volume1h,
        snapshot.volLiqRatio,
        snapshot.estimatedFees24h,
        snapshot.estimatedAPR,
        snapshot.priceChange1h,
        snapshot.priceChange6h,
        snapshot.priceChange24h,
        snapshot.txns24h.buys,
        snapshot.txns24h.sells,
        snapshot.wbnbInPool,
        snapshot.usdtInPool
      );
  }

  getHistory(hours = 24, limit = 1_440): PoolSnapshot[] {
    const since = Date.now() - hours * 60 * 60 * 1_000;
    const rows = this.database
      .prepare(
        `
      SELECT
        captured_at AS capturedAt,
        pair_address AS pairAddress,
        price,
        tvl,
        volume_24h AS volume24h,
        volume_6h AS volume6h,
        volume_1h AS volume1h,
        vol_liq_ratio AS volLiqRatio,
        estimated_fees_24h AS estimatedFees24h,
        estimated_apr AS estimatedAPR,
        price_change_1h AS priceChange1h,
        price_change_6h AS priceChange6h,
        price_change_24h AS priceChange24h,
        buys_24h AS buys24h,
        sells_24h AS sells24h,
        wbnb_in_pool AS wbnbInPool,
        usdt_in_pool AS usdtInPool
      FROM pool_snapshots
      WHERE captured_minute >= ?
      ORDER BY captured_minute DESC
      LIMIT ?
    `
      )
      .all(since, limit) as Array<Record<string, string | number>>;

    return rows.reverse().map(row => this.mapSnapshotRow(row));
  }

  getSnapshotsBetween(from: Date, to: Date): PoolSnapshot[] {
    const rows = this.database
      .prepare(
        `
      SELECT
        captured_at AS capturedAt, pair_address AS pairAddress,
        price, tvl, volume_24h AS volume24h, volume_6h AS volume6h,
        volume_1h AS volume1h, vol_liq_ratio AS volLiqRatio,
        estimated_fees_24h AS estimatedFees24h,
        estimated_apr AS estimatedAPR, price_change_1h AS priceChange1h,
        price_change_6h AS priceChange6h, price_change_24h AS priceChange24h,
        buys_24h AS buys24h, sells_24h AS sells24h,
        wbnb_in_pool AS wbnbInPool, usdt_in_pool AS usdtInPool
      FROM pool_snapshots
      WHERE captured_minute >= ? AND captured_minute <= ?
      ORDER BY captured_minute ASC
    `
      )
      .all(from.getTime(), to.getTime()) as Array<Record<string, string | number>>;

    return rows.map(row => this.mapSnapshotRow(row));
  }

  getSnapshotAtOrBefore(at: Date, maxAgeMs = 15 * 60 * 1_000): PoolSnapshot | null {
    const row = this.database
      .prepare(
        `
      SELECT
        captured_at AS capturedAt, pair_address AS pairAddress,
        price, tvl, volume_24h AS volume24h, volume_6h AS volume6h,
        volume_1h AS volume1h, vol_liq_ratio AS volLiqRatio,
        estimated_fees_24h AS estimatedFees24h,
        estimated_apr AS estimatedAPR, price_change_1h AS priceChange1h,
        price_change_6h AS priceChange6h, price_change_24h AS priceChange24h,
        buys_24h AS buys24h, sells_24h AS sells24h,
        wbnb_in_pool AS wbnbInPool, usdt_in_pool AS usdtInPool
      FROM pool_snapshots
      WHERE captured_minute <= ? AND captured_minute >= ?
      ORDER BY captured_minute DESC
      LIMIT 1
    `
      )
      .get(at.getTime(), at.getTime() - maxAgeMs) as Record<string, string | number> | undefined;

    return row ? this.mapSnapshotRow(row) : null;
  }

  getChartHistory(hours = 24, maxPoints = 240): ChartPoint[] {
    const since = Date.now() - hours * 60 * 60 * 1_000;
    const bucketMs = Math.max(60_000, Math.ceil((hours * 60) / maxPoints) * 60_000);
    const rows = this.database
      .prepare(
        `
      SELECT
        MIN(captured_minute) AS capturedMinute,
        AVG(price) AS price,
        AVG(tvl) AS tvl,
        AVG(volume_24h) AS volume24h,
        AVG(estimated_apr) AS estimatedAPR
      FROM pool_snapshots
      WHERE captured_minute >= ?
      GROUP BY CAST(captured_minute / ? AS INTEGER)
      ORDER BY capturedMinute ASC
    `
      )
      .all(since, bucketMs) as Array<Record<string, number>>;

    return rows.map(row => ({
      capturedAt: new Date(Number(row.capturedMinute)).toISOString(),
      price: Number(row.price),
      tvl: Number(row.tvl),
      volume24h: Number(row.volume24h),
      estimatedAPR: Number(row.estimatedAPR),
    }));
  }

  getStatistics(): HistoricalPeriodStats[] {
    const periods: Array<{ label: HistoricalPeriodStats['label']; hours: number }> = [
      { label: '1h', hours: 1 },
      { label: '24h', hours: 24 },
      { label: '7d', hours: 24 * 7 },
      { label: '30d', hours: 24 * 30 },
    ];

    return periods.map(({ label, hours }) => {
      const since = Date.now() - hours * 60 * 60 * 1_000;
      const aggregate = this.database
        .prepare(
          `
        SELECT
          COUNT(*) AS count,
          MIN(captured_at) AS firstCapturedAt,
          MAX(captured_at) AS latestCapturedAt,
          MIN(price) AS priceMin,
          MAX(price) AS priceMax,
          AVG(price) AS priceAverage,
          MIN(tvl) AS tvlMin,
          MAX(tvl) AS tvlMax,
          AVG(tvl) AS tvlAverage,
          MIN(volume_24h) AS volumeMin,
          MAX(volume_24h) AS volumeMax,
          AVG(volume_24h) AS volumeAverage,
          MIN(estimated_apr) AS aprMin,
          MAX(estimated_apr) AS aprMax,
          AVG(estimated_apr) AS aprAverage
        FROM pool_snapshots
        WHERE captured_minute >= ?
      `
        )
        .get(since) as Record<string, string | number | null>;

      const first = this.database
        .prepare(
          `
        SELECT price, tvl FROM pool_snapshots
        WHERE captured_minute >= ? ORDER BY captured_minute ASC LIMIT 1
      `
        )
        .get(since) as { price: number; tvl: number } | undefined;
      const latest = this.database
        .prepare(
          `
        SELECT price, tvl FROM pool_snapshots
        WHERE captured_minute >= ? ORDER BY captured_minute DESC LIMIT 1
      `
        )
        .get(since) as { price: number; tvl: number } | undefined;
      const count = Number(aggregate.count);
      const changePercent = (start?: number, end?: number): number | null =>
        start && end ? ((end - start) / start) * 100 : null;
      const nullableNumber = (value: string | number | null): number | null =>
        value === null ? null : Number(value);

      return {
        label,
        hours,
        count,
        expectedCount: hours * 60,
        coveragePercent: Math.min(100, (count / (hours * 60)) * 100),
        firstCapturedAt: aggregate.firstCapturedAt === null ? null : String(aggregate.firstCapturedAt),
        latestCapturedAt: aggregate.latestCapturedAt === null ? null : String(aggregate.latestCapturedAt),
        price: {
          first: first?.price ?? null,
          latest: latest?.price ?? null,
          min: nullableNumber(aggregate.priceMin),
          max: nullableNumber(aggregate.priceMax),
          average: nullableNumber(aggregate.priceAverage),
          changePercent: changePercent(first?.price, latest?.price),
        },
        tvl: {
          first: first?.tvl ?? null,
          latest: latest?.tvl ?? null,
          min: nullableNumber(aggregate.tvlMin),
          max: nullableNumber(aggregate.tvlMax),
          average: nullableNumber(aggregate.tvlAverage),
          changePercent: changePercent(first?.tvl, latest?.tvl),
        },
        volume24h: {
          average: nullableNumber(aggregate.volumeAverage),
          min: nullableNumber(aggregate.volumeMin),
          max: nullableNumber(aggregate.volumeMax),
        },
        estimatedAPR: {
          average: nullableNumber(aggregate.aprAverage),
          min: nullableNumber(aggregate.aprMin),
          max: nullableNumber(aggregate.aprMax),
        },
      };
    });
  }

  private mapSnapshotRow(row: Record<string, string | number>): PoolSnapshot {
    return {
      capturedAt: String(row.capturedAt),
      pairAddress: String(row.pairAddress),
      price: Number(row.price),
      tvl: Number(row.tvl),
      volume24h: Number(row.volume24h),
      volume6h: Number(row.volume6h),
      volume1h: Number(row.volume1h),
      volLiqRatio: Number(row.volLiqRatio),
      estimatedFees24h: Number(row.estimatedFees24h),
      estimatedAPR: Number(row.estimatedAPR),
      priceChange1h: Number(row.priceChange1h),
      priceChange6h: Number(row.priceChange6h),
      priceChange24h: Number(row.priceChange24h),
      txns24h: {
        buys: Number(row.buys24h),
        sells: Number(row.sells24h),
      },
      wbnbInPool: Number(row.wbnbInPool),
      usdtInPool: Number(row.usdtInPool),
    };
  }

  async createBackup(backupDirectory = resolve('backups'), now = new Date()): Promise<string> {
    if (this.databasePath === ':memory:') {
      throw new Error('Cannot back up an in-memory database');
    }

    mkdirSync(backupDirectory, { recursive: true });
    const date = now.toISOString().slice(0, 10);
    const target = resolve(backupDirectory, `bnb-viewer-${date}.sqlite`);
    const temporary = `${target}.tmp`;
    if (existsSync(temporary)) rmSync(temporary);

    await backup(this.database, temporary);
    renameSync(temporary, target);
    return target;
  }

  deleteOlderThan(retentionDays: number, now = new Date()): number {
    if (!Number.isFinite(retentionDays) || retentionDays <= 0) {
      throw new Error('Snapshot retention days must be positive');
    }
    const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1_000).toISOString();
    const result = this.database.prepare('DELETE FROM pool_snapshots WHERE captured_at < ?').run(cutoff);
    return Number(result.changes);
  }

  checkpointWal(mode: 'PASSIVE' | 'TRUNCATE' = 'PASSIVE'): WalCheckpointResult {
    const row = this.database.prepare(`PRAGMA wal_checkpoint(${mode})`).get() as Record<string, number>;
    return {
      busy: Number(row.busy ?? 0),
      logFrames: Number(row.log ?? 0),
      checkpointedFrames: Number(row.checkpointed ?? 0),
    };
  }

  getStorageStats(): DatabaseStorageStats {
    const pragmaNumber = (name: 'page_count' | 'page_size' | 'freelist_count'): number => {
      const row = this.database.prepare(`PRAGMA ${name}`).get() as Record<string, number>;
      return Number(row[name] ?? 0);
    };
    const size = (path: string): number => {
      if (this.databasePath === ':memory:' || !existsSync(path)) return 0;
      return statSync(path).size;
    };
    const mainBytes = size(this.databasePath);
    const walBytes = size(`${this.databasePath}-wal`);
    const shmBytes = size(`${this.databasePath}-shm`);
    return {
      databasePath: this.databasePath === ':memory:' ? ':memory:' : this.databasePath,
      mainBytes,
      walBytes,
      shmBytes,
      totalBytes: mainBytes + walBytes + shmBytes,
      pageCount: pragmaNumber('page_count'),
      pageSize: pragmaNumber('page_size'),
      freePages: pragmaNumber('freelist_count'),
    };
  }

  count(): number {
    const row = this.database.prepare('SELECT COUNT(*) AS total FROM pool_snapshots').get() as {
      total: number;
    };
    return Number(row.total);
  }

  close(): void {
    this.database.close();
  }
}
