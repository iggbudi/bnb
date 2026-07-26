import { DatabaseSync } from 'node:sqlite';
import { applicationDatabasePath, openApplicationDatabase } from '../../../shared/database/connection.js';
import { prepareStoreSchema, type StoreSchemaOptions } from '../../../shared/database/store-schema.js';
import { type PositionAction, type PositionMode, type PositionStatus } from '../domain/position-lifecycle.js';

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

export function createPositionLifecycleSchema(database: DatabaseSync): void {
  database.exec(`

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
}

export function ensurePositionLifecycleSchema(database: DatabaseSync): void {
  const positionColumns = database.prepare(`PRAGMA table_info(paper_positions)`).all() as Array<{
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
    if (!positionColumns.some(existing => existing.name === column.name)) database.exec(column.sql);
  }

  const actionColumns = database.prepare(`PRAGMA table_info(position_actions)`).all() as Array<{
    name: string;
  }>;
  if (!actionColumns.some(column => column.name === 'action_hour')) {
    database.exec(`ALTER TABLE position_actions ADD COLUMN action_hour TEXT`);
    database.exec(`
        UPDATE position_actions
        SET action_hour = substr(created_at, 1, 13) || ':00:00.000Z'
        WHERE action_hour IS NULL
      `);
  }

  const evaluationColumns = database.prepare(`PRAGMA table_info(position_evaluations)`).all() as Array<{
    name: string;
  }>;
  if (!evaluationColumns.some(column => column.name === 'evaluation_hour')) {
    database.exec(`ALTER TABLE position_evaluations ADD COLUMN evaluation_hour TEXT`);
    database.exec(`
        UPDATE position_evaluations
        SET evaluation_hour = substr(evaluated_at, 1, 13) || ':00:00.000Z'
        WHERE evaluation_hour IS NULL
      `);
  }
  database.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_position_actions_hourly_idempotency
      ON position_actions(COALESCE(position_id, -1), action_hour, action)
      WHERE action_hour IS NOT NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_position_evaluations_hourly_idempotency
      ON position_evaluations(position_id, evaluation_hour)
      WHERE evaluation_hour IS NOT NULL;
  `);
}

import { PositionNftRepository } from './position-nft-repository.js';

export class PositionStore extends PositionNftRepository {
  constructor(databasePath = applicationDatabasePath(), schemaOptions: StoreSchemaOptions = {}) {
    const database = openApplicationDatabase(databasePath, { foreignKeys: true });
    try {
      prepareStoreSchema(
        database,
        'lp-execution',
        [
          'paper_positions',
          'position_actions',
          'position_evaluations',
          'live_position_nfts',
          'position_events',
        ],
        candidate => {
          createPositionLifecycleSchema(candidate);
          ensurePositionLifecycleSchema(candidate);
        },
        schemaOptions
      );
    } catch (error) {
      database.close();
      throw error;
    }
    super(database);
  }
}
