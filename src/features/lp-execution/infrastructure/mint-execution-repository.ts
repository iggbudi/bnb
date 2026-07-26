import { createHash } from 'node:crypto';
import type { ExecutionWalletBinding, MintTransactionPlanRecord } from './execution-store.js';
import { ExitExecutionRepository } from './exit-execution-repository.js';

export class MintExecutionRepository extends ExitExecutionRepository {
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
}
