import { createHash } from 'node:crypto';
import { EntryExecutionRepository } from './entry-execution-repository.js';
import type {
  ExitExecutionProposal,
  ExitProposalStatus,
  ExitSettlementRecord,
  ExitTransactionPlanRecord,
} from './execution-store.js';

export class ExitExecutionRepository extends EntryExecutionRepository {
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
}
