import { DatabaseSync } from 'node:sqlite';
import { applicationDatabasePath, openApplicationDatabase } from '../../../shared/database/connection.js';
import type { PancakeV3OnchainState } from '../../lp-execution/index.js';

export interface OnchainPoolSnapshot {
  blockNumber: number;
  blockTimestamp: string;
  capturedAt: string;
  currentTick: number;
  activeLiquidity: string;
  feeGrowthGlobal0X128: string;
  feeGrowthGlobal1X128: string;
  gasPriceWei: string;
  priceWbnbUsd: number;
}

export function createOnchainSnapshotSchema(database: DatabaseSync): void {
  database.exec(`

      CREATE TABLE IF NOT EXISTS onchain_pool_snapshots (
        block_number INTEGER PRIMARY KEY,
        block_timestamp TEXT NOT NULL,
        captured_at TEXT NOT NULL,
        current_tick INTEGER NOT NULL,
        active_liquidity TEXT NOT NULL,
        fee_growth_global_0_x128 TEXT NOT NULL,
        fee_growth_global_1_x128 TEXT NOT NULL,
        gas_price_wei TEXT NOT NULL,
        price_wbnb_usd REAL NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_onchain_pool_snapshots_captured_at
        ON onchain_pool_snapshots(captured_at DESC);
    `);
}

export class OnchainStore {
  private readonly database: DatabaseSync;

  constructor(databasePath = applicationDatabasePath()) {
    this.database = openApplicationDatabase(databasePath);
    createOnchainSnapshotSchema(this.database);
  }

  saveIfAbsent(state: PancakeV3OnchainState): boolean {
    const result = this.database
      .prepare(
        `
      INSERT OR IGNORE INTO onchain_pool_snapshots (
        block_number, block_timestamp, captured_at, current_tick,
        active_liquidity, fee_growth_global_0_x128,
        fee_growth_global_1_x128, gas_price_wei, price_wbnb_usd
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        state.blockNumber,
        state.blockTimestamp,
        state.capturedAt,
        state.currentTick,
        state.activeLiquidity,
        state.feeGrowthGlobal0X128,
        state.feeGrowthGlobal1X128,
        state.gas.gasPriceWei,
        state.priceWbnbUsd
      );
    return result.changes === 1;
  }

  getRecent(limit = 100): OnchainPoolSnapshot[] {
    const safeLimit = Math.min(10_000, Math.max(1, Math.floor(limit)));
    const rows = this.database
      .prepare(
        `
      SELECT * FROM onchain_pool_snapshots
      ORDER BY block_number DESC LIMIT ?
    `
      )
      .all(safeLimit) as Array<Record<string, string | number>>;
    return rows.map(row => this.mapRow(row));
  }

  getAtOrBefore(timestamp: string): OnchainPoolSnapshot | null {
    const row = this.database
      .prepare(
        `
      SELECT * FROM onchain_pool_snapshots
      WHERE captured_at <= ? ORDER BY captured_at DESC, block_number DESC LIMIT 1
    `
      )
      .get(timestamp) as Record<string, string | number> | undefined;
    return row ? this.mapRow(row) : null;
  }

  deleteOlderThan(retentionDays: number, now = new Date()): number {
    if (!Number.isFinite(retentionDays) || retentionDays <= 0) {
      throw new Error('On-chain snapshot retention days must be positive');
    }
    const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1_000).toISOString();
    const result = this.database
      .prepare('DELETE FROM onchain_pool_snapshots WHERE captured_at < ?')
      .run(cutoff);
    return Number(result.changes);
  }

  count(): number {
    const row = this.database.prepare(`SELECT COUNT(*) AS count FROM onchain_pool_snapshots`).get() as {
      count: number;
    };
    return Number(row.count);
  }

  close(): void {
    this.database.close();
  }

  private mapRow(row: Record<string, string | number>): OnchainPoolSnapshot {
    return {
      blockNumber: Number(row.block_number),
      blockTimestamp: String(row.block_timestamp),
      capturedAt: String(row.captured_at),
      currentTick: Number(row.current_tick),
      activeLiquidity: String(row.active_liquidity),
      feeGrowthGlobal0X128: String(row.fee_growth_global_0_x128),
      feeGrowthGlobal1X128: String(row.fee_growth_global_1_x128),
      gasPriceWei: String(row.gas_price_wei),
      priceWbnbUsd: Number(row.price_wbnb_usd),
    };
  }
}
