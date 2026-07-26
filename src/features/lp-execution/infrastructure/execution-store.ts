import { DatabaseSync } from 'node:sqlite';
import { applicationDatabasePath, openApplicationDatabase } from '../../../shared/database/connection.js';
import { createHash } from 'node:crypto';

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

export class ExecutionStore {
  private readonly database: DatabaseSync;

  constructor(databasePath = applicationDatabasePath()) {
    this.database = openApplicationDatabase(databasePath, { foreignKeys: true });
    createExecutionControlSchema(this.database);
    ensureExecutionControlSchema(this.database);
  }

  getControl(): ExecutionControlState {
    const row = this.database.prepare(`SELECT * FROM execution_control WHERE id = 1`).get() as Record<
      string,
      string | number
    >;
    return {
      killSwitchEngaged: Number(row.kill_switch_engaged) === 1,
      reason: String(row.reason),
      updatedAt: String(row.updated_at),
    };
  }

  setKillSwitch(engaged: boolean, reason: string, now = new Date()): ExecutionControlState {
    this.database
      .prepare(
        `
      UPDATE execution_control
      SET kill_switch_engaged = ?, reason = ?, updated_at = ?
      WHERE id = 1
    `
      )
      .run(Number(engaged), reason, now.toISOString());
    this.addAudit('KILL_SWITCH_CHANGED', null, { engaged, reason }, now);
    return this.getControl();
  }

  createProposal(input: {
    decisionId: number;
    amountUsd: number;
    readiness: Record<string, unknown>;
    expiresAt: string;
    now?: Date;
  }): ExecutionProposal {
    const now = input.now ?? new Date();
    const result = this.database
      .prepare(
        `
      INSERT INTO execution_proposals (
        decision_id, created_at, expires_at, status, action,
        amount_usd, readiness_json, reviewed_at, review_reason
      ) VALUES (?, ?, ?, 'PENDING_APPROVAL', 'ENTER_FULL_RANGE', ?, ?, NULL, NULL)
    `
      )
      .run(
        input.decisionId,
        now.toISOString(),
        input.expiresAt,
        input.amountUsd,
        JSON.stringify(input.readiness)
      );
    const proposal = this.getProposal(Number(result.lastInsertRowid));
    if (!proposal) throw new Error('Execution proposal could not be stored');
    this.addAudit('PROPOSAL_CREATED', proposal.id, { amountUsd: proposal.amountUsd }, now);
    return proposal;
  }

  reviewProposal(id: number, approve: boolean, reason: string, now = new Date()): ExecutionProposal {
    const proposal = this.getProposal(id);
    if (!proposal) throw new Error('Execution proposal not found');
    if (proposal.status !== 'PENDING_APPROVAL') throw new Error('Execution proposal is not pending');
    if (new Date(proposal.expiresAt).getTime() <= now.getTime()) {
      this.database
        .prepare(
          `
        UPDATE execution_proposals SET status = 'EXPIRED', reviewed_at = ?, review_reason = ?
        WHERE id = ?
      `
        )
        .run(now.toISOString(), 'Proposal expired before review.', id);
      this.addAudit('PROPOSAL_EXPIRED', id, {}, now);
      throw new Error('Execution proposal has expired');
    }

    const status: ExecutionProposalStatus = approve ? 'APPROVED' : 'REJECTED';
    this.database
      .prepare(
        `
      UPDATE execution_proposals SET status = ?, reviewed_at = ?, review_reason = ?
      WHERE id = ?
    `
      )
      .run(status, now.toISOString(), reason, id);
    this.addAudit(approve ? 'PROPOSAL_APPROVED' : 'PROPOSAL_REJECTED', id, { reason }, now);
    return this.getProposal(id)!;
  }

  getProposal(id: number): ExecutionProposal | null {
    const row = this.database.prepare(`SELECT * FROM execution_proposals WHERE id = ?`).get(id) as
      Record<string, string | number | null> | undefined;
    return row ? this.mapProposal(row) : null;
  }

  getRecentProposals(limit = 20): ExecutionProposal[] {
    const safeLimit = Math.min(100, Math.max(1, Math.floor(limit)));
    const rows = this.database
      .prepare(
        `
      SELECT * FROM execution_proposals ORDER BY created_at DESC, id DESC LIMIT ?
    `
      )
      .all(safeLimit) as Array<Record<string, string | number | null>>;
    return rows.map(row => this.mapProposal(row));
  }

  createExitProposal(input: {
    positionId: number;
    reason: string;
    slippageBps: number;
    burnAfterCollect: boolean;
    swapWbnbToUsdt: boolean;
    expiresAt: string;
    now?: Date;
  }): ExitExecutionProposal {
    if (!Number.isInteger(input.positionId) || input.positionId <= 0)
      throw new Error('positionId must be positive');
    if (input.reason.trim().length < 5) throw new Error('Exit proposal reason is too short');
    if (!Number.isInteger(input.slippageBps) || input.slippageBps < 10 || input.slippageBps > 500) {
      throw new Error('Slippage must be between 10 and 500 basis points');
    }
    const now = input.now ?? new Date();
    const expiresAt = new Date(input.expiresAt);
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= now.getTime()) {
      throw new Error('Exit proposal expiry must be in the future');
    }
    const staleRows = this.database
      .prepare(
        `
      SELECT id FROM exit_execution_proposals
      WHERE position_id = ? AND settled_at IS NULL
        AND status IN ('PENDING_APPROVAL', 'APPROVED') AND expires_at <= ?
    `
      )
      .all(input.positionId, now.toISOString()) as Array<{ id: number }>;
    if (staleRows.length > 0) {
      this.database
        .prepare(
          `
        UPDATE exit_execution_proposals SET status = 'EXPIRED'
        WHERE position_id = ? AND settled_at IS NULL
          AND status IN ('PENDING_APPROVAL', 'APPROVED') AND expires_at <= ?
      `
        )
        .run(input.positionId, now.toISOString());
      for (const stale of staleRows) {
        this.addAudit('EXIT_PROPOSAL_EXPIRED', null, { exitProposalId: Number(stale.id) }, now);
      }
    }

    let lastInsertRowid: number | bigint = 0;
    try {
      const result = this.database
        .prepare(
          `
        INSERT INTO exit_execution_proposals (
          position_id, created_at, expires_at, status, reason,
          slippage_bps, burn_after_collect, swap_wbnb_to_usdt,
          reviewed_at, review_reason
        ) VALUES (?, ?, ?, 'PENDING_APPROVAL', ?, ?, ?, ?, NULL, NULL)
      `
        )
        .run(
          input.positionId,
          now.toISOString(),
          expiresAt.toISOString(),
          input.reason.trim(),
          input.slippageBps,
          Number(input.burnAfterCollect),
          Number(input.swapWbnbToUsdt)
        );
      lastInsertRowid = result.lastInsertRowid;
    } catch (error) {
      if (error instanceof Error && /UNIQUE constraint/.test(error.message)) {
        throw new Error('Position already has an active exit proposal');
      }
      throw error;
    }
    const proposal = this.getExitProposal(Number(lastInsertRowid));
    if (!proposal) throw new Error('Exit proposal could not be stored');
    this.addAudit(
      'EXIT_PROPOSAL_CREATED',
      null,
      {
        exitProposalId: proposal.id,
        positionId: proposal.positionId,
        reason: proposal.reason,
      },
      now
    );
    return proposal;
  }

  reviewExitProposal(id: number, approve: boolean, reason: string, now = new Date()): ExitExecutionProposal {
    const proposal = this.getExitProposal(id);
    if (!proposal) throw new Error('Exit proposal not found');
    if (proposal.status !== 'PENDING_APPROVAL') throw new Error('Exit proposal is not pending');
    if (new Date(proposal.expiresAt).getTime() <= now.getTime()) {
      this.database
        .prepare(
          `
        UPDATE exit_execution_proposals
        SET status = 'EXPIRED', reviewed_at = ?, review_reason = ? WHERE id = ?
      `
        )
        .run(now.toISOString(), 'Exit proposal expired before review.', id);
      this.addAudit('EXIT_PROPOSAL_EXPIRED', null, { exitProposalId: id }, now);
      throw new Error('Exit proposal has expired');
    }
    const status: ExitProposalStatus = approve ? 'APPROVED' : 'REJECTED';
    this.database
      .prepare(
        `
      UPDATE exit_execution_proposals
      SET status = ?, reviewed_at = ?, review_reason = ? WHERE id = ?
    `
      )
      .run(status, now.toISOString(), reason, id);
    this.addAudit(
      approve ? 'EXIT_PROPOSAL_APPROVED' : 'EXIT_PROPOSAL_REJECTED',
      null,
      {
        exitProposalId: id,
        reason,
      },
      now
    );
    return this.getExitProposal(id)!;
  }

  getExitProposal(id: number): ExitExecutionProposal | null {
    const row = this.database
      .prepare(
        `
      SELECT * FROM exit_execution_proposals WHERE id = ?
    `
      )
      .get(id) as Record<string, string | number | null> | undefined;
    return row ? this.mapExitProposal(row) : null;
  }

  getRecentExitProposals(limit = 20): ExitExecutionProposal[] {
    const safeLimit = Math.min(100, Math.max(1, Math.floor(limit)));
    const rows = this.database
      .prepare(
        `
      SELECT * FROM exit_execution_proposals ORDER BY created_at DESC, id DESC LIMIT ?
    `
      )
      .all(safeLimit) as Array<Record<string, string | number | null>>;
    return rows.map(row => this.mapExitProposal(row));
  }

  getExitProposalsForPosition(positionId: number, limit = 20): ExitExecutionProposal[] {
    const safeLimit = Math.min(100, Math.max(1, Math.floor(limit)));
    const rows = this.database
      .prepare(
        `
      SELECT * FROM exit_execution_proposals
      WHERE position_id = ? ORDER BY created_at DESC, id DESC LIMIT ?
    `
      )
      .all(positionId, safeLimit) as Array<Record<string, string | number | null>>;
    return rows.map(row => this.mapExitProposal(row));
  }

  expireExitProposal(id: number, now = new Date()): ExitExecutionProposal {
    const proposal = this.getExitProposal(id);
    if (!proposal) throw new Error('Exit proposal not found');
    if (!['PENDING_APPROVAL', 'APPROVED'].includes(proposal.status)) return proposal;
    if (new Date(proposal.expiresAt).getTime() > now.getTime()) return proposal;
    this.database
      .prepare(
        `
      UPDATE exit_execution_proposals SET status = 'EXPIRED' WHERE id = ?
    `
      )
      .run(id);
    this.addAudit('EXIT_PROPOSAL_EXPIRED', null, { exitProposalId: id }, now);
    return this.getExitProposal(id)!;
  }

  saveExitTransactionPlan(input: {
    exitProposalId: number;
    positionId: number;
    wallet: string;
    referenceBlockNumber: number;
    plan: ExitTransactionPlanRecord['plan'];
    now?: Date;
  }): ExitTransactionPlanRecord {
    const proposal = this.getExitProposal(input.exitProposalId);
    const wallet = input.wallet.toLowerCase();
    if (
      !proposal ||
      proposal.status !== 'APPROVED' ||
      proposal.settledAt !== null ||
      proposal.positionId !== input.positionId ||
      !/^0x[0-9a-fA-F]{40}$/.test(wallet) ||
      !Number.isInteger(input.referenceBlockNumber) ||
      input.referenceBlockNumber <= 0 ||
      !Array.isArray(input.plan.transactions) ||
      input.plan.transactions.length === 0
    )
      throw new Error('Approved exit proposal and valid immutable plan are required');
    for (const transaction of input.plan.transactions) {
      if (
        typeof transaction.purpose !== 'string' ||
        !/^0x[0-9a-fA-F]{40}$/.test(transaction.to) ||
        !/^0x[0-9a-fA-F]+$/.test(transaction.data) ||
        transaction.value !== '0x0'
      )
        throw new Error('Immutable exit plan contains an invalid transaction');
    }
    const normalizedPlan = {
      swapAmountIn: input.plan.swapAmountIn,
      transactions: input.plan.transactions.map(transaction => ({
        purpose: transaction.purpose,
        to: transaction.to.toLowerCase(),
        data: transaction.data.toLowerCase(),
        value: transaction.value,
      })),
    };
    const canonical = JSON.stringify({
      exitProposalId: input.exitProposalId,
      positionId: input.positionId,
      wallet,
      referenceBlockNumber: input.referenceBlockNumber,
      plan: normalizedPlan,
    });
    const planHash = createHash('sha256').update(canonical).digest('hex');
    const existing = this.getExitTransactionPlan(input.exitProposalId);
    if (existing) {
      if (existing.planHash !== planHash)
        throw new Error('Exit proposal already has a different immutable plan');
      return existing;
    }
    const now = input.now ?? new Date();
    this.database
      .prepare(
        `
      INSERT INTO execution_exit_plans (
        exit_proposal_id, position_id, wallet, created_at,
        reference_block_number, plan_json, plan_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        input.exitProposalId,
        input.positionId,
        wallet,
        now.toISOString(),
        input.referenceBlockNumber,
        JSON.stringify(normalizedPlan),
        planHash
      );
    this.addAudit(
      'IMMUTABLE_EXIT_PLAN_STORED',
      null,
      {
        exitProposalId: input.exitProposalId,
        positionId: input.positionId,
        wallet,
        referenceBlockNumber: input.referenceBlockNumber,
        planHash,
      },
      now
    );
    return this.getExitTransactionPlan(input.exitProposalId)!;
  }

  getExitTransactionPlan(exitProposalId: number): ExitTransactionPlanRecord | null {
    const row = this.database
      .prepare(
        `
      SELECT * FROM execution_exit_plans WHERE exit_proposal_id = ?
    `
      )
      .get(exitProposalId) as Record<string, string | number> | undefined;
    if (!row) return null;
    const plan = JSON.parse(String(row.plan_json)) as ExitTransactionPlanRecord['plan'];
    return {
      exitProposalId: Number(row.exit_proposal_id),
      positionId: Number(row.position_id),
      wallet: String(row.wallet),
      createdAt: String(row.created_at),
      referenceBlockNumber: Number(row.reference_block_number),
      planHash: String(row.plan_hash),
      plan,
    };
  }

  getExitSettlement(exitProposalId: number): ExitSettlementRecord | null {
    const row = this.database
      .prepare(
        `
      SELECT * FROM execution_exit_settlements WHERE exit_proposal_id = ?
    `
      )
      .get(exitProposalId) as Record<string, string | number> | undefined;
    return row ? this.mapExitSettlement(row) : null;
  }

  settleVerifiedExit(input: {
    exitProposalId: number;
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
    burnAfterCollect: boolean;
    now?: Date;
  }): ExitSettlementRecord {
    const existing = this.getExitSettlement(input.exitProposalId);
    if (existing) {
      if (
        JSON.stringify(existing.txHashes) !== JSON.stringify(input.txHashes.map(hash => hash.toLowerCase()))
      ) {
        throw new Error('Exit proposal is already settled with different receipts');
      }
      return existing;
    }
    const proposal = this.getExitProposal(input.exitProposalId);
    const plan = this.getExitTransactionPlan(input.exitProposalId);
    if (!proposal || proposal.status !== 'APPROVED' || proposal.settledAt !== null || !plan) {
      throw new Error('Approved exit proposal with immutable plan is required for settlement');
    }
    if (
      input.txHashes.length !== plan.plan.transactions.length ||
      !input.txHashes.every(hash => /^0x[0-9a-fA-F]{64}$/.test(hash)) ||
      ![input.exitValueUsd, input.exitGasUsd, input.realizedPnlUsd].every(Number.isFinite) ||
      input.exitValueUsd < 0 ||
      input.exitGasUsd < 0 ||
      !Number.isInteger(input.finalBlockNumber) ||
      input.finalBlockNumber <= 0 ||
      !Number.isInteger(input.confirmations) ||
      input.confirmations <= 0
    )
      throw new Error('Verified exit settlement evidence is invalid');
    const live = this.database
      .prepare(
        `
      SELECT n.proposal_id AS entry_proposal_id, n.token_id, p.*
      FROM live_position_nfts n
      JOIN paper_positions p ON p.id = n.position_id
      WHERE n.position_id = ? AND n.owner = ? AND n.ownership_verified = 1
    `
      )
      .get(proposal.positionId, plan.wallet) as Record<string, string | number | null> | undefined;
    if (!live || String(live.mode) !== 'LIVE' || String(live.status) !== 'OPEN') {
      throw new Error('Verified LIVE position is no longer open');
    }
    const entryProposalId = Number(live.entry_proposal_id);
    const executionTransaction = this.getTransactionByProposal(entryProposalId);
    if (!executionTransaction) throw new Error('Verified entry transaction is unavailable');
    const now = input.now ?? new Date();
    const timestamp = now.toISOString();
    const actionHour = `${timestamp.slice(0, 13)}:00:00.000Z`;

    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database
        .prepare(
          `
        INSERT INTO execution_exit_settlements (
          exit_proposal_id, entry_proposal_id, position_id, settled_at,
          tx_hashes_json, collected_usdt, collected_wbnb,
          swap_usdt_received, residual_wbnb, exit_value_usd,
          exit_gas_usd, realized_pnl_usd, final_block_number, confirmations
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
        )
        .run(
          proposal.id,
          entryProposalId,
          proposal.positionId,
          timestamp,
          JSON.stringify(input.txHashes.map(hash => hash.toLowerCase())),
          input.collectedUsdt,
          input.collectedWbnb,
          input.swapUsdtReceived,
          input.residualWbnb,
          input.exitValueUsd,
          input.exitGasUsd,
          input.realizedPnlUsd,
          input.finalBlockNumber,
          input.confirmations
        );
      this.database
        .prepare(
          `
        UPDATE execution_transactions SET realized_pnl_usd = ? WHERE proposal_id = ?
      `
        )
        .run(input.realizedPnlUsd, entryProposalId);
      const positionUpdate = this.database
        .prepare(
          `
        UPDATE paper_positions
        SET status = 'CLOSED', updated_at = ?, closed_at = ?, exit_reason = ?,
            exit_gas_usd = ?, current_value_usd = ?
        WHERE id = ? AND mode = 'LIVE' AND status = 'OPEN'
      `
        )
        .run(
          timestamp,
          timestamp,
          proposal.reason,
          input.exitGasUsd,
          input.exitValueUsd,
          proposal.positionId
        );
      if (positionUpdate.changes !== 1) throw new Error('LIVE position changed during exit settlement');
      this.database
        .prepare(
          `
        UPDATE live_position_nfts
        SET liquidity = '0', ownership_verified = ?, last_verified_at = ?
        WHERE position_id = ?
      `
        )
        .run(input.burnAfterCollect ? 0 : 1, timestamp, proposal.positionId);
      this.database
        .prepare(
          `
        INSERT OR IGNORE INTO position_actions (
          position_id, created_at, action_hour, action, reason_code,
          confidence, rationale, metrics_json
        ) VALUES (?, ?, ?, 'EXIT', 'LIVE_EXIT_RECEIPTS_VERIFIED', 'high', ?, ?)
      `
        )
        .run(
          proposal.positionId,
          timestamp,
          actionHour,
          'Posisi LIVE ditutup setelah seluruh receipt exit sesuai immutable plan terverifikasi.',
          JSON.stringify({
            exitProposalId: proposal.id,
            txHashes: input.txHashes.map(hash => hash.toLowerCase()),
            exitValueUsd: input.exitValueUsd,
            exitGasUsd: input.exitGasUsd,
            realizedPnlUsd: input.realizedPnlUsd,
          })
        );
      this.database
        .prepare(
          `
        INSERT INTO position_events (
          position_id, created_at, event_type, from_status, to_status, details_json
        ) VALUES (?, ?, 'LIVE_EXIT_SETTLED', 'OPEN', 'CLOSED', ?)
      `
        )
        .run(
          proposal.positionId,
          timestamp,
          JSON.stringify({
            exitProposalId: proposal.id,
            finalBlockNumber: input.finalBlockNumber,
            confirmations: input.confirmations,
          })
        );
      this.database
        .prepare(
          `
        UPDATE exit_execution_proposals SET settled_at = ? WHERE id = ?
      `
        )
        .run(timestamp, proposal.id);
      this.addAudit(
        'LIVE_EXIT_RECEIPTS_VERIFIED',
        null,
        {
          exitProposalId: proposal.id,
          entryProposalId,
          positionId: proposal.positionId,
          realizedPnlUsd: input.realizedPnlUsd,
          txHashes: input.txHashes.map(hash => hash.toLowerCase()),
        },
        now
      );
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
    return this.getExitSettlement(input.exitProposalId)!;
  }

  bindProposalWallet(proposalId: number, wallet: string, now = new Date()): ExecutionWalletBinding {
    if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) throw new Error('Invalid EVM wallet address');
    const normalized = wallet.toLowerCase();
    const proposal = this.getProposal(proposalId);
    if (!proposal || proposal.status !== 'APPROVED') {
      throw new Error('An approved execution proposal is required before binding a wallet');
    }
    const existing = this.getProposalWallet(proposalId);
    if (existing) {
      if (existing.wallet !== normalized)
        throw new Error('Execution proposal is already bound to another wallet');
      return existing;
    }
    this.database
      .prepare(
        `
      INSERT INTO execution_wallet_bindings (proposal_id, wallet, created_at)
      VALUES (?, ?, ?)
    `
      )
      .run(proposalId, normalized, now.toISOString());
    this.addAudit('PROPOSAL_WALLET_BOUND', proposalId, { wallet: normalized }, now);
    return this.getProposalWallet(proposalId)!;
  }

  getProposalWallet(proposalId: number): ExecutionWalletBinding | null {
    const row = this.database
      .prepare(
        `
      SELECT * FROM execution_wallet_bindings WHERE proposal_id = ?
    `
      )
      .get(proposalId) as Record<string, string | number> | undefined;
    return row
      ? {
          proposalId: Number(row.proposal_id),
          wallet: String(row.wallet),
          createdAt: String(row.created_at),
        }
      : null;
  }

  saveMintTransactionPlan(input: {
    proposalId: number;
    wallet: string;
    referenceBlockNumber: number;
    amountUsd: number;
    amount0Desired: string;
    amount1Desired: string;
    amount0Min: string;
    amount1Min: string;
    deadline: number;
    mintCalldata: string;
    now?: Date;
  }): MintTransactionPlanRecord {
    const proposal = this.getProposal(input.proposalId);
    const binding = this.getProposalWallet(input.proposalId);
    const wallet = input.wallet.toLowerCase();
    if (!proposal || proposal.status !== 'APPROVED' || !binding || binding.wallet !== wallet) {
      throw new Error('An approved wallet-bound execution proposal is required');
    }
    if (
      !Number.isInteger(input.referenceBlockNumber) ||
      input.referenceBlockNumber <= 0 ||
      !Number.isFinite(input.amountUsd) ||
      input.amountUsd !== proposal.amountUsd ||
      !Number.isSafeInteger(input.deadline) ||
      input.deadline <= 0 ||
      !/^0x[0-9a-fA-F]+$/.test(input.mintCalldata) ||
      ![input.amount0Desired, input.amount1Desired, input.amount0Min, input.amount1Min].every(value =>
        /^\d+$/.test(value)
      )
    )
      throw new Error('Mint transaction plan is invalid');
    const canonical = JSON.stringify({
      proposalId: input.proposalId,
      wallet,
      referenceBlockNumber: input.referenceBlockNumber,
      amountUsd: input.amountUsd,
      amount0Desired: input.amount0Desired,
      amount1Desired: input.amount1Desired,
      amount0Min: input.amount0Min,
      amount1Min: input.amount1Min,
      deadline: input.deadline,
      mintCalldata: input.mintCalldata.toLowerCase(),
    });
    const planHash = createHash('sha256').update(canonical).digest('hex');
    const existing = this.getMintTransactionPlan(input.proposalId);
    if (existing) {
      if (existing.planHash !== planHash) {
        throw new Error('Execution proposal already has a different immutable mint plan');
      }
      return existing;
    }
    const now = input.now ?? new Date();
    this.database
      .prepare(
        `
      INSERT INTO execution_mint_plans (
        proposal_id, wallet, created_at, reference_block_number, amount_usd,
        amount0_desired, amount1_desired, amount0_min, amount1_min,
        deadline, mint_calldata, plan_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        input.proposalId,
        wallet,
        now.toISOString(),
        input.referenceBlockNumber,
        input.amountUsd,
        input.amount0Desired,
        input.amount1Desired,
        input.amount0Min,
        input.amount1Min,
        input.deadline,
        input.mintCalldata.toLowerCase(),
        planHash
      );
    this.addAudit(
      'IMMUTABLE_MINT_PLAN_STORED',
      input.proposalId,
      {
        wallet,
        referenceBlockNumber: input.referenceBlockNumber,
        deadline: input.deadline,
        planHash,
      },
      now
    );
    return this.getMintTransactionPlan(input.proposalId)!;
  }

  getMintTransactionPlan(proposalId: number): MintTransactionPlanRecord | null {
    const row = this.database
      .prepare(
        `
      SELECT * FROM execution_mint_plans WHERE proposal_id = ?
    `
      )
      .get(proposalId) as Record<string, string | number> | undefined;
    return row
      ? {
          proposalId: Number(row.proposal_id),
          wallet: String(row.wallet),
          createdAt: String(row.created_at),
          referenceBlockNumber: Number(row.reference_block_number),
          amountUsd: Number(row.amount_usd),
          amount0Desired: String(row.amount0_desired),
          amount1Desired: String(row.amount1_desired),
          amount0Min: String(row.amount0_min),
          amount1Min: String(row.amount1_min),
          deadline: Number(row.deadline),
          mintCalldata: String(row.mint_calldata),
          planHash: String(row.plan_hash),
        }
      : null;
  }

  recordVerifiedTransaction(proposalId: number, txHash: string, now = new Date()): ExecutionTransaction {
    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) throw new Error('Invalid transaction hash');
    const normalized = txHash.toLowerCase();
    const existing = this.getTransactionByProposal(proposalId);
    if (existing) {
      if (existing.txHash !== normalized)
        throw new Error('Execution proposal already has another verified transaction');
      return existing;
    }
    this.database
      .prepare(
        `
      INSERT INTO execution_transactions (proposal_id, created_at, tx_hash, realized_pnl_usd)
      VALUES (?, ?, ?, NULL)
    `
      )
      .run(proposalId, now.toISOString(), normalized);
    this.addAudit('MINT_TRANSACTION_VERIFIED', proposalId, { txHash: normalized }, now);
    return this.getTransactionByProposal(proposalId)!;
  }

  getTransactionByProposal(proposalId: number): ExecutionTransaction | null {
    const row = this.database
      .prepare(
        `
      SELECT * FROM execution_transactions WHERE proposal_id = ?
    `
      )
      .get(proposalId) as Record<string, string | number | null> | undefined;
    return row
      ? {
          id: Number(row.id),
          proposalId: Number(row.proposal_id),
          createdAt: String(row.created_at),
          txHash: String(row.tx_hash),
          realizedPnlUsd: row.realized_pnl_usd === null ? null : Number(row.realized_pnl_usd),
        }
      : null;
  }

  getRecentAudit(limit = 50): ExecutionAuditEvent[] {
    const safeLimit = Math.min(200, Math.max(1, Math.floor(limit)));
    const rows = this.database
      .prepare(
        `
      SELECT * FROM execution_audit ORDER BY created_at DESC, id DESC LIMIT ?
    `
      )
      .all(safeLimit) as Array<Record<string, string | number | null>>;
    return rows.map(row => ({
      id: Number(row.id),
      createdAt: String(row.created_at),
      eventType: String(row.event_type),
      proposalId: row.proposal_id === null ? null : Number(row.proposal_id),
      details: JSON.parse(String(row.details_json)) as Record<string, unknown>,
    }));
  }

  recordAudit(
    eventType: string,
    proposalId: number | null,
    details: Record<string, unknown>,
    now = new Date()
  ): void {
    this.addAudit(eventType, proposalId, details, now);
  }

  getRealizedLossToday(now = new Date()): number {
    const day = now.toISOString().slice(0, 10);
    const row = this.database
      .prepare(
        `
      SELECT COALESCE(SUM(CASE WHEN realized_pnl_usd < 0 THEN -realized_pnl_usd ELSE 0 END), 0) AS loss
      FROM execution_exit_settlements WHERE substr(settled_at, 1, 10) = ?
    `
      )
      .get(day) as { loss: number };
    return Number(row.loss);
  }

  close(): void {
    this.database.close();
  }

  private mapExitSettlement(row: Record<string, string | number>): ExitSettlementRecord {
    return {
      id: Number(row.id),
      exitProposalId: Number(row.exit_proposal_id),
      entryProposalId: Number(row.entry_proposal_id),
      positionId: Number(row.position_id),
      settledAt: String(row.settled_at),
      txHashes: JSON.parse(String(row.tx_hashes_json)) as string[],
      collectedUsdt: String(row.collected_usdt),
      collectedWbnb: String(row.collected_wbnb),
      swapUsdtReceived: String(row.swap_usdt_received),
      residualWbnb: String(row.residual_wbnb),
      exitValueUsd: Number(row.exit_value_usd),
      exitGasUsd: Number(row.exit_gas_usd),
      realizedPnlUsd: Number(row.realized_pnl_usd),
      finalBlockNumber: Number(row.final_block_number),
      confirmations: Number(row.confirmations),
    };
  }

  private addAudit(
    eventType: string,
    proposalId: number | null,
    details: Record<string, unknown>,
    now: Date
  ): void {
    this.database
      .prepare(
        `
      INSERT INTO execution_audit (created_at, event_type, proposal_id, details_json)
      VALUES (?, ?, ?, ?)
    `
      )
      .run(now.toISOString(), eventType, proposalId, JSON.stringify(details));
  }

  private mapExitProposal(row: Record<string, string | number | null>): ExitExecutionProposal {
    return {
      id: Number(row.id),
      positionId: Number(row.position_id),
      createdAt: String(row.created_at),
      expiresAt: String(row.expires_at),
      status: String(row.status) as ExitProposalStatus,
      reason: String(row.reason),
      slippageBps: Number(row.slippage_bps),
      burnAfterCollect: Number(row.burn_after_collect) === 1,
      swapWbnbToUsdt: Number(row.swap_wbnb_to_usdt) === 1,
      reviewedAt: row.reviewed_at === null ? null : String(row.reviewed_at),
      reviewReason: row.review_reason === null ? null : String(row.review_reason),
      settledAt: row.settled_at === null ? null : String(row.settled_at),
    };
  }

  private mapProposal(row: Record<string, string | number | null>): ExecutionProposal {
    return {
      id: Number(row.id),
      decisionId: Number(row.decision_id),
      createdAt: String(row.created_at),
      expiresAt: String(row.expires_at),
      status: String(row.status) as ExecutionProposalStatus,
      action: 'ENTER_FULL_RANGE',
      amountUsd: Number(row.amount_usd),
      readiness: JSON.parse(String(row.readiness_json)) as Record<string, unknown>,
      reviewedAt: row.reviewed_at === null ? null : String(row.reviewed_at),
      reviewReason: row.review_reason === null ? null : String(row.review_reason),
    };
  }
}
