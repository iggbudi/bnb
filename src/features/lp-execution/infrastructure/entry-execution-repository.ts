import type { DatabaseSync } from 'node:sqlite';
import type {
  ExecutionAuditEvent,
  ExecutionControlState,
  ExecutionProposal,
  ExecutionProposalStatus,
  ExecutionTransaction,
} from './execution-store.js';

export class EntryExecutionRepository {
  constructor(protected readonly database: DatabaseSync) {}

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
  protected addAudit(
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
}
