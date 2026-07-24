import 'dotenv/config';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  assertPositionTransition,
  isTerminalPositionStatus,
  type PositionAction,
  type PositionMode,
  type PositionStatus,
} from './position-lifecycle.js';

export interface PositionRecord {
  id: number;
  mode: PositionMode;
  status: PositionStatus;
  strategy: 'FULL_RANGE';
  createdAt: string;
  updatedAt: string;
  openedAt: string | null;
  closedAt: string | null;
  entryDecisionId: number | null;
  investmentUsd: number;
  entryPrice: number | null;
  token0Amount: string | null;
  token1Amount: string | null;
  entryGasUsd: number;
  exitGasUsd: number;
  accumulatedFeeUsd: number;
  currentValueUsd: number | null;
  liveTokenId: string | null;
  exitReason: string | null;
  accountingVersion: string | null;
  positionLiquidity: string | null;
  feeGrowthGlobal0LastX128: string | null;
  feeGrowthGlobal1LastX128: string | null;
  feeCheckpointBlock: number | null;
  feeCheckpointAt: string | null;
}

export interface PositionActionRecord {
  id: number;
  positionId: number | null;
  createdAt: string;
  action: PositionAction;
  reasonCode: string;
  confidence: 'low' | 'medium' | 'high';
  rationale: string;
  metrics: Record<string, unknown>;
}

export interface PositionEvaluationRecord {
  id: number;
  positionId: number;
  evaluatedAt: string;
  ageHours: number;
  lpValueUsd: number;
  holdValueUsd: number;
  accumulatedFeeUsd: number;
  grossPnlUsd: number;
  netPnlUsd: number;
  differenceVsHoldUsd: number;
  estimatedExitCostUsd: number;
  dataQuality: 'valid' | 'insufficient';
  metrics: Record<string, unknown>;
}

export interface LivePositionNftRecord {
  id: number;
  positionId: number;
  proposalId: number;
  txHash: string;
  wallet: string;
  tokenId: string;
  blockNumber: number;
  blockHash: string;
  blockTimestamp: string;
  confirmationsAtVerification: number;
  token0: string;
  token1: string;
  fee: number;
  tickLower: number;
  tickUpper: number;
  liquidity: string;
  feeGrowthInside0LastX128: string;
  feeGrowthInside1LastX128: string;
  tokensOwed0: string;
  tokensOwed1: string;
  amount0: string;
  amount1: string;
  gasUsed: string;
  effectiveGasPriceWei: string;
  gasCostWei: string;
  owner: string;
  ownershipVerified: boolean;
  verifiedAt: string;
  lastVerifiedAt: string;
}

export interface PositionEventRecord {
  id: number;
  positionId: number;
  createdAt: string;
  eventType: string;
  fromStatus: PositionStatus | null;
  toStatus: PositionStatus | null;
  details: Record<string, unknown>;
}

const DEFAULT_DATABASE_PATH = resolve(process.env.SQLITE_PATH || 'data/bnb-viewer.sqlite');

function startOfUtcHour(value: Date): string {
  const hour = new Date(value);
  hour.setUTCMinutes(0, 0, 0);
  return hour.toISOString();
}

export class PositionStore {
  private readonly database: DatabaseSync;

  constructor(databasePath = DEFAULT_DATABASE_PATH) {
    if (databasePath !== ':memory:') mkdirSync(dirname(databasePath), { recursive: true });
    this.database = new DatabaseSync(databasePath);
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS paper_positions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mode TEXT NOT NULL CHECK (mode IN ('PAPER', 'LIVE')),
        status TEXT NOT NULL CHECK (status IN (
          'PENDING_ENTRY', 'OPEN', 'PENDING_EXIT',
          'CLOSED', 'EMERGENCY_EXITED', 'CANCELLED'
        )),
        strategy TEXT NOT NULL CHECK (strategy = 'FULL_RANGE'),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        opened_at TEXT,
        closed_at TEXT,
        entry_decision_id INTEGER,
        investment_usd REAL NOT NULL,
        entry_price REAL,
        token0_amount TEXT,
        token1_amount TEXT,
        entry_gas_usd REAL NOT NULL DEFAULT 0,
        exit_gas_usd REAL NOT NULL DEFAULT 0,
        accumulated_fee_usd REAL NOT NULL DEFAULT 0,
        current_value_usd REAL,
        live_token_id TEXT,
        exit_reason TEXT,
        accounting_version TEXT,
        position_liquidity TEXT,
        fee_growth_global0_last_x128 TEXT,
        fee_growth_global1_last_x128 TEXT,
        fee_checkpoint_block INTEGER,
        fee_checkpoint_at TEXT,
        FOREIGN KEY(entry_decision_id) REFERENCES paper_agent_decisions(id)
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_paper_positions_one_active
        ON paper_positions((1))
        WHERE status IN ('PENDING_ENTRY', 'OPEN', 'PENDING_EXIT');

      CREATE INDEX IF NOT EXISTS idx_paper_positions_created_at
        ON paper_positions(created_at DESC);

      CREATE TABLE IF NOT EXISTS position_actions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        position_id INTEGER,
        created_at TEXT NOT NULL,
        action_hour TEXT,
        action TEXT NOT NULL CHECK (action IN (
          'WAIT', 'ENTER', 'HOLD', 'REVIEW_7D',
          'REVIEW_14D', 'EXIT', 'EMERGENCY_EXIT'
        )),
        reason_code TEXT NOT NULL,
        confidence TEXT NOT NULL CHECK (confidence IN ('low', 'medium', 'high')),
        rationale TEXT NOT NULL,
        metrics_json TEXT NOT NULL,
        FOREIGN KEY(position_id) REFERENCES paper_positions(id)
      );

      CREATE INDEX IF NOT EXISTS idx_position_actions_position_created
        ON position_actions(position_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS position_evaluations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        position_id INTEGER NOT NULL,
        evaluated_at TEXT NOT NULL,
        evaluation_hour TEXT,
        age_hours REAL NOT NULL,
        lp_value_usd REAL NOT NULL,
        hold_value_usd REAL NOT NULL,
        accumulated_fee_usd REAL NOT NULL,
        gross_pnl_usd REAL NOT NULL,
        net_pnl_usd REAL NOT NULL,
        difference_vs_hold_usd REAL NOT NULL,
        estimated_exit_cost_usd REAL NOT NULL,
        data_quality TEXT NOT NULL CHECK (data_quality IN ('valid', 'insufficient')),
        metrics_json TEXT NOT NULL,
        UNIQUE(position_id, evaluated_at),
        FOREIGN KEY(position_id) REFERENCES paper_positions(id)
      );

      CREATE INDEX IF NOT EXISTS idx_position_evaluations_position_time
        ON position_evaluations(position_id, evaluated_at DESC);

      CREATE TABLE IF NOT EXISTS live_position_nfts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        position_id INTEGER NOT NULL UNIQUE,
        proposal_id INTEGER NOT NULL UNIQUE,
        tx_hash TEXT NOT NULL UNIQUE,
        wallet TEXT NOT NULL,
        token_id TEXT NOT NULL UNIQUE,
        block_number INTEGER NOT NULL,
        block_hash TEXT NOT NULL,
        block_timestamp TEXT NOT NULL,
        confirmations_at_verification INTEGER NOT NULL,
        token0 TEXT NOT NULL,
        token1 TEXT NOT NULL,
        fee INTEGER NOT NULL,
        tick_lower INTEGER NOT NULL,
        tick_upper INTEGER NOT NULL,
        liquidity TEXT NOT NULL,
        fee_growth_inside0_last_x128 TEXT NOT NULL,
        fee_growth_inside1_last_x128 TEXT NOT NULL,
        tokens_owed0 TEXT NOT NULL,
        tokens_owed1 TEXT NOT NULL,
        amount0 TEXT NOT NULL,
        amount1 TEXT NOT NULL,
        gas_used TEXT NOT NULL,
        effective_gas_price_wei TEXT NOT NULL,
        gas_cost_wei TEXT NOT NULL,
        owner TEXT NOT NULL,
        ownership_verified INTEGER NOT NULL,
        verified_at TEXT NOT NULL,
        last_verified_at TEXT NOT NULL,
        FOREIGN KEY(position_id) REFERENCES paper_positions(id)
      );

      CREATE INDEX IF NOT EXISTS idx_live_position_nfts_verified_at
        ON live_position_nfts(verified_at DESC);

      CREATE TABLE IF NOT EXISTS position_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        position_id INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        event_type TEXT NOT NULL,
        from_status TEXT,
        to_status TEXT,
        details_json TEXT NOT NULL,
        FOREIGN KEY(position_id) REFERENCES paper_positions(id)
      );

      CREATE INDEX IF NOT EXISTS idx_position_events_position_time
        ON position_events(position_id, created_at DESC);
    `);

    this.ensureLifecycleColumns();
    this.database.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_position_actions_hourly_idempotency
        ON position_actions(COALESCE(position_id, -1), action_hour, action)
        WHERE action_hour IS NOT NULL;

      CREATE UNIQUE INDEX IF NOT EXISTS idx_position_evaluations_hourly_idempotency
        ON position_evaluations(position_id, evaluation_hour)
        WHERE evaluation_hour IS NOT NULL;
    `);
  }

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

  confirmVerifiedLiveMint(input: {
    proposalId: number;
    decisionId: number;
    investmentUsd: number;
    entryPrice: number;
    entryGasUsd: number;
    txHash: string;
    wallet: string;
    tokenId: string;
    blockNumber: number;
    blockHash: string;
    blockTimestamp: string;
    confirmations: number;
    token0: string;
    token1: string;
    fee: number;
    tickLower: number;
    tickUpper: number;
    liquidity: string;
    feeGrowthInside0LastX128: string;
    feeGrowthInside1LastX128: string;
    tokensOwed0: string;
    tokensOwed1: string;
    amount0: string;
    amount1: string;
    gasUsed: string;
    effectiveGasPriceWei: string;
    gasCostWei: string;
    owner: string;
    verifiedAt?: Date;
  }): { position: PositionRecord; nft: LivePositionNftRecord } {
    const existing = this.getLiveNftByProposal(input.proposalId);
    if (existing) {
      if (
        existing.txHash !== input.txHash.toLowerCase() ||
        existing.tokenId !== input.tokenId ||
        existing.wallet !== input.wallet.toLowerCase()
      )
        throw new Error('Execution proposal is already linked to another live NFT');
      return { position: this.getPosition(existing.positionId)!, nft: existing };
    }
    if (!Number.isInteger(input.proposalId) || input.proposalId <= 0)
      throw new Error('proposalId must be positive');
    if (!Number.isInteger(input.decisionId) || input.decisionId <= 0)
      throw new Error('decisionId must be positive');
    if (!(input.investmentUsd > 0) || !(input.entryPrice > 0) || input.entryGasUsd < 0) {
      throw new Error('Live mint financial values are invalid');
    }
    if (!/^0x[0-9a-fA-F]{64}$/.test(input.txHash) || !/^0x[0-9a-fA-F]{64}$/.test(input.blockHash)) {
      throw new Error('Live mint transaction or block hash is invalid');
    }
    if (!/^0x[0-9a-fA-F]{40}$/.test(input.wallet) || !/^0x[0-9a-fA-F]{40}$/.test(input.owner)) {
      throw new Error('Live mint wallet or owner is invalid');
    }
    if (input.wallet.toLowerCase() !== input.owner.toLowerCase())
      throw new Error('Live NFT ownership is not verified');
    if (BigInt(input.liquidity) <= 0n || BigInt(input.amount0) <= 0n || BigInt(input.amount1) <= 0n) {
      throw new Error('Live mint liquidity and token amounts must be positive');
    }
    const mintedAt = new Date(input.blockTimestamp);
    if (!Number.isFinite(mintedAt.getTime())) throw new Error('Live mint block timestamp is invalid');
    const verifiedAt = input.verifiedAt ?? new Date();

    this.database.exec('BEGIN IMMEDIATE');
    try {
      const active = this.getActivePosition();
      const promotedFromPaper = active !== null;
      let position: PositionRecord;
      if (active) {
        if (
          active.mode !== 'PAPER' ||
          active.entryDecisionId !== input.decisionId ||
          !['PENDING_ENTRY', 'OPEN'].includes(active.status)
        ) {
          throw new Error('Another active position cannot be linked to this live mint');
        }
        this.database
          .prepare(
            `
          UPDATE paper_positions
          SET mode = 'LIVE', updated_at = ?
          WHERE id = ?
        `
          )
          .run(verifiedAt.toISOString(), active.id);
        position = this.getPosition(active.id)!;
      } else {
        position = this.createPosition({
          mode: 'LIVE',
          investmentUsd: input.investmentUsd,
          entryDecisionId: input.decisionId,
          entryPrice: input.entryPrice,
          accountingVersion: 'verified-live-nft-v1',
          now: mintedAt,
        });
      }
      position = this.updateAccounting({
        id: position.id,
        entryPrice: input.entryPrice,
        token0Amount: input.amount0,
        token1Amount: input.amount1,
        entryGasUsd: input.entryGasUsd,
        currentValueUsd: input.investmentUsd,
        liveTokenId: input.tokenId,
        now: verifiedAt,
      });
      if (!promotedFromPaper) {
        this.recordAction({
          positionId: position.id,
          action: 'ENTER',
          reasonCode: 'LIVE_MINT_RECEIPT_VERIFIED',
          confidence: 'high',
          rationale:
            'Live position dibuka hanya setelah receipt, NFT mint, ownership, dan positions(tokenId) terverifikasi.',
          metrics: {
            proposalId: input.proposalId,
            txHash: input.txHash.toLowerCase(),
            tokenId: input.tokenId,
            confirmations: input.confirmations,
          },
          now: mintedAt,
        });
      }
      if (position.status === 'PENDING_ENTRY') {
        position = this.transitionPosition({
          id: position.id,
          toStatus: 'OPEN',
          reason: 'Verified PancakeSwap V3 NFT mint receipt.',
          now: mintedAt,
        });
      }
      this.database
        .prepare(
          `
        INSERT INTO live_position_nfts (
          position_id, proposal_id, tx_hash, wallet, token_id,
          block_number, block_hash, block_timestamp, confirmations_at_verification,
          token0, token1, fee, tick_lower, tick_upper, liquidity,
          fee_growth_inside0_last_x128, fee_growth_inside1_last_x128,
          tokens_owed0, tokens_owed1, amount0, amount1, gas_used,
          effective_gas_price_wei, gas_cost_wei, owner, ownership_verified,
          verified_at, last_verified_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `
        )
        .run(
          position.id,
          input.proposalId,
          input.txHash.toLowerCase(),
          input.wallet.toLowerCase(),
          input.tokenId,
          input.blockNumber,
          input.blockHash.toLowerCase(),
          mintedAt.toISOString(),
          input.confirmations,
          input.token0.toLowerCase(),
          input.token1.toLowerCase(),
          input.fee,
          input.tickLower,
          input.tickUpper,
          input.liquidity,
          input.feeGrowthInside0LastX128,
          input.feeGrowthInside1LastX128,
          input.tokensOwed0,
          input.tokensOwed1,
          input.amount0,
          input.amount1,
          input.gasUsed,
          input.effectiveGasPriceWei,
          input.gasCostWei,
          input.owner.toLowerCase(),
          verifiedAt.toISOString(),
          verifiedAt.toISOString()
        );
      this.database
        .prepare(
          `
        INSERT INTO position_events (
          position_id, created_at, event_type, from_status, to_status, details_json
        ) VALUES (?, ?, 'NFT_MINT_VERIFIED', ?, 'OPEN', ?)
      `
        )
        .run(
          position.id,
          verifiedAt.toISOString(),
          promotedFromPaper ? active!.status : 'PENDING_ENTRY',
          JSON.stringify({
            proposalId: input.proposalId,
            promotedFromPaper,
            txHash: input.txHash.toLowerCase(),
            tokenId: input.tokenId,
            owner: input.owner.toLowerCase(),
            confirmations: input.confirmations,
          })
        );
      this.database.exec('COMMIT');
      return { position, nft: this.getLiveNftByPosition(position.id)! };
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  getLiveNftByPosition(positionId: number): LivePositionNftRecord | null {
    const row = this.database
      .prepare(
        `
      SELECT * FROM live_position_nfts WHERE position_id = ?
    `
      )
      .get(positionId) as Record<string, string | number> | undefined;
    return row ? this.mapLiveNft(row) : null;
  }

  getLiveNftByProposal(proposalId: number): LivePositionNftRecord | null {
    const row = this.database
      .prepare(
        `
      SELECT * FROM live_position_nfts WHERE proposal_id = ?
    `
      )
      .get(proposalId) as Record<string, string | number> | undefined;
    return row ? this.mapLiveNft(row) : null;
  }

  getRecentLiveNfts(limit = 20): LivePositionNftRecord[] {
    const safeLimit = Math.min(100, Math.max(1, Math.floor(limit)));
    const rows = this.database
      .prepare(
        `
      SELECT * FROM live_position_nfts ORDER BY verified_at DESC, id DESC LIMIT ?
    `
      )
      .all(safeLimit) as Array<Record<string, string | number>>;
    return rows.map(row => this.mapLiveNft(row));
  }

  recordAction(input: {
    positionId?: number | null;
    action: PositionAction;
    reasonCode: string;
    confidence: 'low' | 'medium' | 'high';
    rationale: string;
    metrics?: Record<string, unknown>;
    now?: Date;
  }): PositionActionRecord {
    if (input.positionId !== null && input.positionId !== undefined && !this.getPosition(input.positionId)) {
      throw new Error('Position not found');
    }
    const now = input.now ?? new Date();
    const timestamp = now.toISOString();
    const actionHour = startOfUtcHour(now);
    const existing = this.database
      .prepare(
        `
      SELECT * FROM position_actions
      WHERE COALESCE(position_id, -1) = COALESCE(?, -1)
        AND action_hour = ? AND action = ?
    `
      )
      .get(input.positionId ?? null, actionHour, input.action) as
      Record<string, string | number | null> | undefined;
    if (existing) return this.mapAction(existing);

    this.database
      .prepare(
        `
      INSERT OR IGNORE INTO position_actions (
        position_id, created_at, action_hour, action, reason_code,
        confidence, rationale, metrics_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        input.positionId ?? null,
        timestamp,
        actionHour,
        input.action,
        input.reasonCode,
        input.confidence,
        input.rationale,
        JSON.stringify(input.metrics ?? {})
      );
    const row = this.database
      .prepare(
        `
      SELECT * FROM position_actions
      WHERE COALESCE(position_id, -1) = COALESCE(?, -1)
        AND action_hour = ? AND action = ?
    `
      )
      .get(input.positionId ?? null, actionHour, input.action) as
      Record<string, string | number | null> | undefined;
    if (!row) throw new Error('Position action could not be stored');
    return this.mapAction(row);
  }

  recordEvaluation(input: Omit<PositionEvaluationRecord, 'id'>): PositionEvaluationRecord {
    if (!this.getPosition(input.positionId)) throw new Error('Position not found');
    const evaluationHour = startOfUtcHour(new Date(input.evaluatedAt));
    const existing = this.database
      .prepare(
        `
      SELECT * FROM position_evaluations
      WHERE position_id = ? AND evaluation_hour = ?
    `
      )
      .get(input.positionId, evaluationHour) as Record<string, string | number> | undefined;
    if (existing) return this.mapEvaluation(existing);

    this.database
      .prepare(
        `
      INSERT OR IGNORE INTO position_evaluations (
        position_id, evaluated_at, evaluation_hour, age_hours, lp_value_usd,
        hold_value_usd, accumulated_fee_usd, gross_pnl_usd,
        net_pnl_usd, difference_vs_hold_usd, estimated_exit_cost_usd,
        data_quality, metrics_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        input.positionId,
        input.evaluatedAt,
        evaluationHour,
        input.ageHours,
        input.lpValueUsd,
        input.holdValueUsd,
        input.accumulatedFeeUsd,
        input.grossPnlUsd,
        input.netPnlUsd,
        input.differenceVsHoldUsd,
        input.estimatedExitCostUsd,
        input.dataQuality,
        JSON.stringify(input.metrics)
      );
    const row = this.database
      .prepare(
        `
      SELECT * FROM position_evaluations
      WHERE position_id = ? AND evaluation_hour = ?
    `
      )
      .get(input.positionId, evaluationHour) as Record<string, string | number> | undefined;
    if (!row) throw new Error('Position evaluation could not be stored');
    return this.mapEvaluation(row);
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

  getRecentActions(limit = 100): PositionActionRecord[] {
    const safeLimit = Math.min(1_000, Math.max(1, Math.floor(limit)));
    const rows = this.database
      .prepare(
        `
      SELECT * FROM position_actions ORDER BY created_at DESC, id DESC LIMIT ?
    `
      )
      .all(safeLimit) as Array<Record<string, string | number | null>>;
    return rows.map(row => this.mapAction(row));
  }

  getActions(positionId: number, limit = 100): PositionActionRecord[] {
    const safeLimit = Math.min(1_000, Math.max(1, Math.floor(limit)));
    const rows = this.database
      .prepare(
        `
      SELECT * FROM position_actions
      WHERE position_id = ? ORDER BY created_at DESC, id DESC LIMIT ?
    `
      )
      .all(positionId, safeLimit) as Array<Record<string, string | number | null>>;
    return rows.map(row => this.mapAction(row));
  }

  getEvaluations(positionId: number, limit = 100): PositionEvaluationRecord[] {
    const safeLimit = Math.min(10_000, Math.max(1, Math.floor(limit)));
    const rows = this.database
      .prepare(
        `
      SELECT * FROM position_evaluations
      WHERE position_id = ? ORDER BY evaluated_at DESC, id DESC LIMIT ?
    `
      )
      .all(positionId, safeLimit) as Array<Record<string, string | number>>;
    return rows.map(row => this.mapEvaluation(row));
  }

  getEvents(positionId: number, limit = 100): PositionEventRecord[] {
    const safeLimit = Math.min(1_000, Math.max(1, Math.floor(limit)));
    const rows = this.database
      .prepare(
        `
      SELECT * FROM position_events
      WHERE position_id = ? ORDER BY created_at DESC, id DESC LIMIT ?
    `
      )
      .all(positionId, safeLimit) as Array<Record<string, string | number | null>>;
    return rows.map(row => ({
      id: Number(row.id),
      positionId: Number(row.position_id),
      createdAt: String(row.created_at),
      eventType: String(row.event_type),
      fromStatus: row.from_status === null ? null : (String(row.from_status) as PositionStatus),
      toStatus: row.to_status === null ? null : (String(row.to_status) as PositionStatus),
      details: JSON.parse(String(row.details_json)) as Record<string, unknown>,
    }));
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

  private ensureLifecycleColumns(): void {
    const positionColumns = this.database.prepare(`PRAGMA table_info(paper_positions)`).all() as Array<{
      name: string;
    }>;
    const additiveColumns: Array<{ name: string; sql: string }> = [
      { name: 'accounting_version', sql: 'ALTER TABLE paper_positions ADD COLUMN accounting_version TEXT' },
      { name: 'position_liquidity', sql: 'ALTER TABLE paper_positions ADD COLUMN position_liquidity TEXT' },
      {
        name: 'fee_growth_global0_last_x128',
        sql: 'ALTER TABLE paper_positions ADD COLUMN fee_growth_global0_last_x128 TEXT',
      },
      {
        name: 'fee_growth_global1_last_x128',
        sql: 'ALTER TABLE paper_positions ADD COLUMN fee_growth_global1_last_x128 TEXT',
      },
      {
        name: 'fee_checkpoint_block',
        sql: 'ALTER TABLE paper_positions ADD COLUMN fee_checkpoint_block INTEGER',
      },
      { name: 'fee_checkpoint_at', sql: 'ALTER TABLE paper_positions ADD COLUMN fee_checkpoint_at TEXT' },
    ];
    for (const column of additiveColumns) {
      if (!positionColumns.some(existing => existing.name === column.name)) this.database.exec(column.sql);
    }

    const actionColumns = this.database.prepare(`PRAGMA table_info(position_actions)`).all() as Array<{
      name: string;
    }>;
    if (!actionColumns.some(column => column.name === 'action_hour')) {
      this.database.exec(`ALTER TABLE position_actions ADD COLUMN action_hour TEXT`);
      this.database.exec(`
        UPDATE position_actions
        SET action_hour = substr(created_at, 1, 13) || ':00:00.000Z'
        WHERE action_hour IS NULL
      `);
    }

    const evaluationColumns = this.database
      .prepare(`PRAGMA table_info(position_evaluations)`)
      .all() as Array<{ name: string }>;
    if (!evaluationColumns.some(column => column.name === 'evaluation_hour')) {
      this.database.exec(`ALTER TABLE position_evaluations ADD COLUMN evaluation_hour TEXT`);
      this.database.exec(`
        UPDATE position_evaluations
        SET evaluation_hour = substr(evaluated_at, 1, 13) || ':00:00.000Z'
        WHERE evaluation_hour IS NULL
      `);
    }
  }

  private getAction(id: number): PositionActionRecord | null {
    const row = this.database.prepare(`SELECT * FROM position_actions WHERE id = ?`).get(id) as
      Record<string, string | number | null> | undefined;
    return row ? this.mapAction(row) : null;
  }

  private insertEvent(
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

  private mapLiveNft(row: Record<string, string | number>): LivePositionNftRecord {
    return {
      id: Number(row.id),
      positionId: Number(row.position_id),
      proposalId: Number(row.proposal_id),
      txHash: String(row.tx_hash),
      wallet: String(row.wallet),
      tokenId: String(row.token_id),
      blockNumber: Number(row.block_number),
      blockHash: String(row.block_hash),
      blockTimestamp: String(row.block_timestamp),
      confirmationsAtVerification: Number(row.confirmations_at_verification),
      token0: String(row.token0),
      token1: String(row.token1),
      fee: Number(row.fee),
      tickLower: Number(row.tick_lower),
      tickUpper: Number(row.tick_upper),
      liquidity: String(row.liquidity),
      feeGrowthInside0LastX128: String(row.fee_growth_inside0_last_x128),
      feeGrowthInside1LastX128: String(row.fee_growth_inside1_last_x128),
      tokensOwed0: String(row.tokens_owed0),
      tokensOwed1: String(row.tokens_owed1),
      amount0: String(row.amount0),
      amount1: String(row.amount1),
      gasUsed: String(row.gas_used),
      effectiveGasPriceWei: String(row.effective_gas_price_wei),
      gasCostWei: String(row.gas_cost_wei),
      owner: String(row.owner),
      ownershipVerified: Number(row.ownership_verified) === 1,
      verifiedAt: String(row.verified_at),
      lastVerifiedAt: String(row.last_verified_at),
    };
  }

  private mapEvaluation(row: Record<string, string | number>): PositionEvaluationRecord {
    return {
      id: Number(row.id),
      positionId: Number(row.position_id),
      evaluatedAt: String(row.evaluated_at),
      ageHours: Number(row.age_hours),
      lpValueUsd: Number(row.lp_value_usd),
      holdValueUsd: Number(row.hold_value_usd),
      accumulatedFeeUsd: Number(row.accumulated_fee_usd),
      grossPnlUsd: Number(row.gross_pnl_usd),
      netPnlUsd: Number(row.net_pnl_usd),
      differenceVsHoldUsd: Number(row.difference_vs_hold_usd),
      estimatedExitCostUsd: Number(row.estimated_exit_cost_usd),
      dataQuality: String(row.data_quality) as PositionEvaluationRecord['dataQuality'],
      metrics: JSON.parse(String(row.metrics_json)) as Record<string, unknown>,
    };
  }

  private mapAction(row: Record<string, string | number | null>): PositionActionRecord {
    return {
      id: Number(row.id),
      positionId: row.position_id === null ? null : Number(row.position_id),
      createdAt: String(row.created_at),
      action: String(row.action) as PositionAction,
      reasonCode: String(row.reason_code),
      confidence: String(row.confidence) as PositionActionRecord['confidence'],
      rationale: String(row.rationale),
      metrics: JSON.parse(String(row.metrics_json)) as Record<string, unknown>,
    };
  }
}
