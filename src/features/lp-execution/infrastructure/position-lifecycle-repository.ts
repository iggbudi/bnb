import type { DatabaseSync } from 'node:sqlite';
import {
  assertPositionTransition,
  isTerminalPositionStatus,
  type PositionMode,
  type PositionStatus,
} from '../domain/position-lifecycle.js';
import type { PositionRecord } from './position-store.js';

export class PositionLifecycleRepository {
  constructor(protected readonly database: DatabaseSync) {}

  createPosition(input: {
    mode: PositionMode;
    investmentUsd: number;
    entryDecisionId?: number | null;
    entryPrice?: number | null;
    accountingVersion?: string | null;
    now?: Date;
  }): PositionRecord {
    if (!Number.isFinite(input.investmentUsd) || input.investmentUsd <= 0) {
      throw new Error('Position investment must be a positive finite number');
    }
    if (this.getActivePosition()) throw new Error('An active position already exists');
    const now = input.now ?? new Date();
    const timestamp = now.toISOString();

    const ownsTransaction = !this.database.isTransaction;
    if (ownsTransaction) this.database.exec('BEGIN IMMEDIATE');
    try {
      const result = this.database
        .prepare(
          `
        INSERT INTO paper_positions (
          mode, status, strategy, created_at, updated_at,
          entry_decision_id, investment_usd, entry_price, accounting_version
        ) VALUES (?, 'PENDING_ENTRY', 'FULL_RANGE', ?, ?, ?, ?, ?, ?)
      `
        )
        .run(
          input.mode,
          timestamp,
          timestamp,
          input.entryDecisionId ?? null,
          input.investmentUsd,
          input.entryPrice ?? null,
          input.accountingVersion ?? null
        );
      const id = Number(result.lastInsertRowid);
      this.insertEvent(
        id,
        'POSITION_CREATED',
        null,
        'PENDING_ENTRY',
        {
          mode: input.mode,
          investmentUsd: input.investmentUsd,
        },
        now
      );
      if (ownsTransaction) this.database.exec('COMMIT');
      return this.getPosition(id)!;
    } catch (error) {
      if (ownsTransaction) this.database.exec('ROLLBACK');
      throw error;
    }
  }

  transitionPosition(input: {
    id: number;
    toStatus: PositionStatus;
    reason: string;
    details?: Record<string, unknown>;
    now?: Date;
  }): PositionRecord {
    const current = this.getPosition(input.id);
    if (!current) throw new Error('Position not found');
    assertPositionTransition(current.status, input.toStatus);
    const now = input.now ?? new Date();
    const timestamp = now.toISOString();
    const openedAt = input.toStatus === 'OPEN' && current.openedAt === null ? timestamp : current.openedAt;
    const closedAt = isTerminalPositionStatus(input.toStatus) ? timestamp : current.closedAt;
    const exitReason = isTerminalPositionStatus(input.toStatus) ? input.reason : current.exitReason;

    const ownsTransaction = !this.database.isTransaction;
    if (ownsTransaction) this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database
        .prepare(
          `
        UPDATE paper_positions
        SET status = ?, updated_at = ?, opened_at = ?, closed_at = ?, exit_reason = ?
        WHERE id = ? AND status = ?
      `
        )
        .run(input.toStatus, timestamp, openedAt, closedAt, exitReason, input.id, current.status);
      this.insertEvent(
        input.id,
        'STATUS_CHANGED',
        current.status,
        input.toStatus,
        { reason: input.reason, ...(input.details ?? {}) },
        now
      );
      if (ownsTransaction) this.database.exec('COMMIT');
      return this.getPosition(input.id)!;
    } catch (error) {
      if (ownsTransaction) this.database.exec('ROLLBACK');
      throw error;
    }
  }

  updateAccounting(input: {
    id: number;
    entryPrice?: number | null;
    token0Amount?: string | null;
    token1Amount?: string | null;
    entryGasUsd?: number;
    exitGasUsd?: number;
    accumulatedFeeUsd?: number;
    currentValueUsd?: number | null;
    liveTokenId?: string | null;
    accountingVersion?: string | null;
    positionLiquidity?: string | null;
    feeGrowthGlobal0LastX128?: string | null;
    feeGrowthGlobal1LastX128?: string | null;
    feeCheckpointBlock?: number | null;
    feeCheckpointAt?: string | null;
    now?: Date;
  }): PositionRecord {
    const current = this.getPosition(input.id);
    if (!current) throw new Error('Position not found');
    const finiteNonNegative = (value: number | undefined, name: string): void => {
      if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
        throw new Error(`${name} must be a non-negative finite number`);
      }
    };
    finiteNonNegative(input.entryGasUsd, 'entryGasUsd');
    finiteNonNegative(input.exitGasUsd, 'exitGasUsd');
    finiteNonNegative(input.accumulatedFeeUsd, 'accumulatedFeeUsd');
    finiteNonNegative(input.currentValueUsd ?? undefined, 'currentValueUsd');
    const timestamp = (input.now ?? new Date()).toISOString();

    this.database
      .prepare(
        `
      UPDATE paper_positions SET
        updated_at = ?,
        entry_price = ?,
        token0_amount = ?,
        token1_amount = ?,
        entry_gas_usd = ?,
        exit_gas_usd = ?,
        accumulated_fee_usd = ?,
        current_value_usd = ?,
        live_token_id = ?,
        accounting_version = ?,
        position_liquidity = ?,
        fee_growth_global0_last_x128 = ?,
        fee_growth_global1_last_x128 = ?,
        fee_checkpoint_block = ?,
        fee_checkpoint_at = ?
      WHERE id = ?
    `
      )
      .run(
        timestamp,
        input.entryPrice === undefined ? current.entryPrice : input.entryPrice,
        input.token0Amount === undefined ? current.token0Amount : input.token0Amount,
        input.token1Amount === undefined ? current.token1Amount : input.token1Amount,
        input.entryGasUsd ?? current.entryGasUsd,
        input.exitGasUsd ?? current.exitGasUsd,
        input.accumulatedFeeUsd ?? current.accumulatedFeeUsd,
        input.currentValueUsd === undefined ? current.currentValueUsd : input.currentValueUsd,
        input.liveTokenId === undefined ? current.liveTokenId : input.liveTokenId,
        input.accountingVersion === undefined ? current.accountingVersion : input.accountingVersion,
        input.positionLiquidity === undefined ? current.positionLiquidity : input.positionLiquidity,
        input.feeGrowthGlobal0LastX128 === undefined
          ? current.feeGrowthGlobal0LastX128
          : input.feeGrowthGlobal0LastX128,
        input.feeGrowthGlobal1LastX128 === undefined
          ? current.feeGrowthGlobal1LastX128
          : input.feeGrowthGlobal1LastX128,
        input.feeCheckpointBlock === undefined ? current.feeCheckpointBlock : input.feeCheckpointBlock,
        input.feeCheckpointAt === undefined ? current.feeCheckpointAt : input.feeCheckpointAt,
        input.id
      );
    return this.getPosition(input.id)!;
  }

  getPosition(id: number): PositionRecord | null {
    const row = this.database.prepare(`SELECT * FROM paper_positions WHERE id = ?`).get(id) as
      Record<string, string | number | null> | undefined;
    return row ? this.mapPosition(row) : null;
  }

  getActivePosition(): PositionRecord | null {
    const row = this.database
      .prepare(
        `
      SELECT * FROM paper_positions
      WHERE status IN ('PENDING_ENTRY', 'OPEN', 'PENDING_EXIT')
      ORDER BY id DESC LIMIT 1
    `
      )
      .get() as Record<string, string | number | null> | undefined;
    return row ? this.mapPosition(row) : null;
  }

  getRecentPositions(limit = 20): PositionRecord[] {
    const safeLimit = Math.min(100, Math.max(1, Math.floor(limit)));
    const rows = this.database
      .prepare(
        `
      SELECT * FROM paper_positions ORDER BY created_at DESC, id DESC LIMIT ?
    `
      )
      .all(safeLimit) as Array<Record<string, string | number | null>>;
    return rows.map(row => this.mapPosition(row));
  }

  count(): number {
    const row = this.database.prepare(`SELECT COUNT(*) AS count FROM paper_positions`).get() as {
      count: number;
    };
    return Number(row.count);
  }

  close(): void {
    this.database.close();
  }
  protected insertEvent(
    positionId: number,
    eventType: string,
    fromStatus: PositionStatus | null,
    toStatus: PositionStatus | null,
    details: Record<string, unknown>,
    now: Date
  ): void {
    this.database
      .prepare(
        `
      INSERT INTO position_events (
        position_id, created_at, event_type, from_status, to_status, details_json
      ) VALUES (?, ?, ?, ?, ?, ?)
    `
      )
      .run(positionId, now.toISOString(), eventType, fromStatus, toStatus, JSON.stringify(details));
  }

  private mapPosition(row: Record<string, string | number | null>): PositionRecord {
    return {
      id: Number(row.id),
      mode: String(row.mode) as PositionMode,
      status: String(row.status) as PositionStatus,
      strategy: 'FULL_RANGE',
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      openedAt: row.opened_at === null ? null : String(row.opened_at),
      closedAt: row.closed_at === null ? null : String(row.closed_at),
      entryDecisionId: row.entry_decision_id === null ? null : Number(row.entry_decision_id),
      investmentUsd: Number(row.investment_usd),
      entryPrice: row.entry_price === null ? null : Number(row.entry_price),
      token0Amount: row.token0_amount === null ? null : String(row.token0_amount),
      token1Amount: row.token1_amount === null ? null : String(row.token1_amount),
      entryGasUsd: Number(row.entry_gas_usd),
      exitGasUsd: Number(row.exit_gas_usd),
      accumulatedFeeUsd: Number(row.accumulated_fee_usd),
      currentValueUsd: row.current_value_usd === null ? null : Number(row.current_value_usd),
      liveTokenId: row.live_token_id === null ? null : String(row.live_token_id),
      exitReason: row.exit_reason === null ? null : String(row.exit_reason),
      accountingVersion: row.accounting_version === null ? null : String(row.accounting_version),
      positionLiquidity: row.position_liquidity === null ? null : String(row.position_liquidity),
      feeGrowthGlobal0LastX128:
        row.fee_growth_global0_last_x128 === null ? null : String(row.fee_growth_global0_last_x128),
      feeGrowthGlobal1LastX128:
        row.fee_growth_global1_last_x128 === null ? null : String(row.fee_growth_global1_last_x128),
      feeCheckpointBlock: row.fee_checkpoint_block === null ? null : Number(row.fee_checkpoint_block),
      feeCheckpointAt: row.fee_checkpoint_at === null ? null : String(row.fee_checkpoint_at),
    };
  }
}
