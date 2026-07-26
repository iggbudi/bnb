import { DatabaseSync } from 'node:sqlite';
import { applicationDatabasePath, openApplicationDatabase } from '../../../shared/database/connection.js';
import { prepareStoreSchema, type StoreSchemaOptions } from '../../../shared/database/store-schema.js';

export type ExecutionProposalStatus = 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
export type ExitProposalStatus = ExecutionProposalStatus;

export interface ExecutionControlState {
  killSwitchEngaged: boolean;
  reason: string;
  updatedAt: string;
}

export interface ExecutionProposal {
  id: number;
  decisionId: number;
  createdAt: string;
  expiresAt: string;
  status: ExecutionProposalStatus;
  action: 'ENTER_FULL_RANGE';
  amountUsd: number;
  readiness: Record<string, unknown>;
  reviewedAt: string | null;
  reviewReason: string | null;
}

export interface ExitExecutionProposal {
  id: number;
  positionId: number;
  createdAt: string;
  expiresAt: string;
  status: ExitProposalStatus;
  reason: string;
  slippageBps: number;
  burnAfterCollect: boolean;
  swapWbnbToUsdt: boolean;
  reviewedAt: string | null;
  reviewReason: string | null;
  settledAt: string | null;
}

export interface ExecutionWalletBinding {
  proposalId: number;
  wallet: string;
  createdAt: string;
}

export interface ExitTransactionPlanRecord {
  exitProposalId: number;
  positionId: number;
  wallet: string;
  createdAt: string;
  referenceBlockNumber: number;
  planHash: string;
  plan: {
    swapAmountIn: string | null;
    transactions: Array<{ purpose: string; to: string; data: string; value: string }>;
  };
}

export interface ExitSettlementRecord {
  id: number;
  exitProposalId: number;
  entryProposalId: number;
  positionId: number;
  settledAt: string;
  txHashes: string[];
  collectedUsdt: string;
  collectedWbnb: string;
  swapUsdtReceived: string;
  residualWbnb: string;
  exitValueUsd: number;
  exitGasUsd: number;
  realizedPnlUsd: number;
  finalBlockNumber: number;
  confirmations: number;
}

export interface MintTransactionPlanRecord {
  proposalId: number;
  wallet: string;
  createdAt: string;
  referenceBlockNumber: number;
  amountUsd: number;
  amount0Desired: string;
  amount1Desired: string;
  amount0Min: string;
  amount1Min: string;
  deadline: number;
  mintCalldata: string;
  planHash: string;
}

export interface ExecutionTransaction {
  id: number;
  proposalId: number;
  createdAt: string;
  txHash: string;
  realizedPnlUsd: number | null;
}

export interface ExecutionAuditEvent {
  id: number;
  createdAt: string;
  eventType: string;
  proposalId: number | null;
  details: Record<string, unknown>;
}

export function createExecutionControlSchema(database: DatabaseSync): void {
  database.exec(`

      CREATE TABLE IF NOT EXISTS execution_control (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        kill_switch_engaged INTEGER NOT NULL,
        reason TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      INSERT OR IGNORE INTO execution_control (
        id, kill_switch_engaged, reason, updated_at
      ) VALUES (1, 1, 'Default locked until explicitly unlocked by administrator.', datetime('now'));

      CREATE TABLE IF NOT EXISTS execution_proposals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        decision_id INTEGER NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'EXPIRED')),
        action TEXT NOT NULL CHECK (action = 'ENTER_FULL_RANGE'),
        amount_usd REAL NOT NULL,
        readiness_json TEXT NOT NULL,
        reviewed_at TEXT,
        review_reason TEXT,
        FOREIGN KEY(decision_id) REFERENCES paper_agent_decisions(id)
      );

      CREATE TABLE IF NOT EXISTS execution_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL,
        event_type TEXT NOT NULL,
        proposal_id INTEGER,
        details_json TEXT NOT NULL,
        FOREIGN KEY(proposal_id) REFERENCES execution_proposals(id)
      );

      CREATE TABLE IF NOT EXISTS exit_execution_proposals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        position_id INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'EXPIRED')),
        reason TEXT NOT NULL,
        slippage_bps INTEGER NOT NULL,
        burn_after_collect INTEGER NOT NULL,
        swap_wbnb_to_usdt INTEGER NOT NULL,
        reviewed_at TEXT,
        review_reason TEXT,
        settled_at TEXT,
        FOREIGN KEY(position_id) REFERENCES paper_positions(id)
      );

      CREATE INDEX IF NOT EXISTS idx_exit_proposals_created_at
        ON exit_execution_proposals(created_at DESC);

      CREATE TABLE IF NOT EXISTS execution_wallet_bindings (
        proposal_id INTEGER PRIMARY KEY,
        wallet TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(proposal_id) REFERENCES execution_proposals(id)
      );

      CREATE TABLE IF NOT EXISTS execution_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        proposal_id INTEGER NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        tx_hash TEXT NOT NULL UNIQUE,
        realized_pnl_usd REAL,
        FOREIGN KEY(proposal_id) REFERENCES execution_proposals(id)
      );

      CREATE TABLE IF NOT EXISTS execution_exit_plans (
        exit_proposal_id INTEGER PRIMARY KEY,
        position_id INTEGER NOT NULL,
        wallet TEXT NOT NULL,
        created_at TEXT NOT NULL,
        reference_block_number INTEGER NOT NULL,
        plan_json TEXT NOT NULL,
        plan_hash TEXT NOT NULL UNIQUE,
        FOREIGN KEY(exit_proposal_id) REFERENCES exit_execution_proposals(id)
      );

      CREATE TABLE IF NOT EXISTS execution_exit_settlements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        exit_proposal_id INTEGER NOT NULL UNIQUE,
        entry_proposal_id INTEGER NOT NULL UNIQUE,
        position_id INTEGER NOT NULL UNIQUE,
        settled_at TEXT NOT NULL,
        tx_hashes_json TEXT NOT NULL,
        collected_usdt TEXT NOT NULL,
        collected_wbnb TEXT NOT NULL,
        swap_usdt_received TEXT NOT NULL,
        residual_wbnb TEXT NOT NULL,
        exit_value_usd REAL NOT NULL,
        exit_gas_usd REAL NOT NULL,
        realized_pnl_usd REAL NOT NULL,
        final_block_number INTEGER NOT NULL,
        confirmations INTEGER NOT NULL,
        FOREIGN KEY(exit_proposal_id) REFERENCES exit_execution_proposals(id),
        FOREIGN KEY(entry_proposal_id) REFERENCES execution_proposals(id)
      );

      CREATE TABLE IF NOT EXISTS execution_mint_plans (
        proposal_id INTEGER PRIMARY KEY,
        wallet TEXT NOT NULL,
        created_at TEXT NOT NULL,
        reference_block_number INTEGER NOT NULL,
        amount_usd REAL NOT NULL,
        amount0_desired TEXT NOT NULL,
        amount1_desired TEXT NOT NULL,
        amount0_min TEXT NOT NULL,
        amount1_min TEXT NOT NULL,
        deadline INTEGER NOT NULL,
        mint_calldata TEXT NOT NULL,
        plan_hash TEXT NOT NULL UNIQUE,
        FOREIGN KEY(proposal_id) REFERENCES execution_proposals(id)
      );
    `);
}

export function ensureExecutionControlSchema(database: DatabaseSync): void {
  const columns = database.prepare(`PRAGMA table_info(exit_execution_proposals)`).all() as Array<{
    name: string;
  }>;
  if (!columns.some(column => column.name === 'settled_at')) {
    database.exec(`ALTER TABLE exit_execution_proposals ADD COLUMN settled_at TEXT`);
  }
  database.exec(`
    DROP INDEX IF EXISTS idx_exit_proposals_one_active_per_position;
    CREATE UNIQUE INDEX idx_exit_proposals_one_active_per_position
      ON exit_execution_proposals(position_id)
      WHERE status IN ('PENDING_APPROVAL', 'APPROVED') AND settled_at IS NULL;
  `);
}

import { MintExecutionRepository } from './mint-execution-repository.js';

export class ExecutionStore extends MintExecutionRepository {
  constructor(databasePath = applicationDatabasePath(), schemaOptions: StoreSchemaOptions = {}) {
    const database = openApplicationDatabase(databasePath, { foreignKeys: true });
    try {
      prepareStoreSchema(
        database,
        'lp-execution',
        [
          'execution_control',
          'execution_proposals',
          'execution_audit',
          'exit_execution_proposals',
          'execution_wallet_bindings',
          'execution_transactions',
          'execution_exit_plans',
          'execution_exit_settlements',
          'execution_mint_plans',
        ],
        candidate => {
          createExecutionControlSchema(candidate);
          ensureExecutionControlSchema(candidate);
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
