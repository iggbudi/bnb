import { PositionActionRepository } from './position-action-repository.js';
import type { LivePositionNftRecord, PositionRecord } from './position-store.js';

export class PositionNftRepository extends PositionActionRepository {
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
}
