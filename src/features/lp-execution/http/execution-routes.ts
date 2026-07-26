import type { Express } from 'express';

import type { AgentStore } from '../../../agent-store.js';
import type { ExecutionStore } from '../../../execution-store.js';
import {
  buildFullRangeMintPlan,
  fetchWalletTokenState,
  verifyPositionManagerAdapter,
} from '../infrastructure/pancakeswap-v3-execution.js';
import {
  buildFullRangeExitPlan,
  fetchWbnbSwapRouterAllowance,
  verifyPancakeV3SwapRouter,
} from '../infrastructure/pancakeswap-v3-exit.js';
import { fetchAndVerifyExitReceipts } from '../infrastructure/pancakeswap-v3-exit-tracker.js';
import {
  fetchAndVerifyPancakeV3MintReceipt,
  fetchPancakeV3PositionState,
  verifyMintAgainstImmutablePlan,
} from '../infrastructure/pancakeswap-v3-position-tracker.js';
import type { PancakeV3OnchainState } from '../infrastructure/pancakeswap-v3-onchain.js';
import type { PositionStore } from '../../../position-store.js';
import { parsePositiveNumber, parsePositiveNumberOrDefault } from '../../../validation.js';

export interface ExecutionStatusView {
  ready: boolean;
  blockers: readonly string[];
  [key: string]: unknown;
}

export interface ExecutionRouteDependencies {
  agentStore: AgentStore;
  executionStore: ExecutionStore;
  positionStore: PositionStore;
  limits: {
    maxCapitalUsd: number;
    maxDailyLossUsd: number;
    proposalExpiryMinutes: number;
  };
  mintReceiptMinimumConfirmations: number;
  getExecutionStatus(): ExecutionStatusView;
  isAdminAuthorized(authorization: string | undefined): boolean;
  captureOnchainState(): Promise<PancakeV3OnchainState>;
  isExecutionAdapterReady(): boolean;
  setExecutionAdapterReady(value: boolean): void;
  isExitSwapRouterReady(): boolean;
  setExitSwapRouterReady(value: boolean): void;
}

export function registerExecutionControlRoutes(app: Express, dependencies: ExecutionRouteDependencies): void {
  const { agentStore, executionStore, positionStore } = dependencies;
  const EXECUTION_CONFIG = { limits: dependencies.limits };
  const MINT_RECEIPT_MIN_CONFIRMATIONS = dependencies.mintReceiptMinimumConfirmations;
  const getExecutionStatus = dependencies.getExecutionStatus;
  const isExecutionAdminAuthorized = dependencies.isAdminAuthorized;
  const captureOnchainPoolState = dependencies.captureOnchainState;

  app.get('/api/execution/status', (req, res) => {
    res.json({
      success: true,
      data: getExecutionStatus(),
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/execution/audit', (req, res) => {
    try {
      const requestedLimit =
        req.query.limit === undefined ? 50 : parsePositiveNumber(req.query.limit, 'limit');
      const limit = Math.min(200, Math.max(1, Math.floor(requestedLimit)));
      res.json({
        success: true,
        data: { events: executionStore.getRecentAudit(limit) },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : 'Invalid audit parameters',
        timestamp: new Date().toISOString(),
      });
    }
  });

  app.post('/api/execution/kill-switch', (req, res) => {
    if (!isExecutionAdminAuthorized(req.headers.authorization)) {
      res.status(401).json({ success: false, error: 'Unauthorized', timestamp: new Date().toISOString() });
      return;
    }
    if (
      typeof req.body?.engaged !== 'boolean' ||
      typeof req.body?.reason !== 'string' ||
      req.body.reason.trim().length < 5
    ) {
      res.status(400).json({
        success: false,
        error: 'engaged boolean and reason are required',
        timestamp: new Date().toISOString(),
      });
      return;
    }
    const control = executionStore.setKillSwitch(req.body.engaged, req.body.reason.trim());
    res.json({
      success: true,
      data: { control, execution: getExecutionStatus() },
      timestamp: new Date().toISOString(),
    });
  });

  app.post('/api/execution/proposals', (req, res) => {
    if (!isExecutionAdminAuthorized(req.headers.authorization)) {
      res.status(401).json({ success: false, error: 'Unauthorized', timestamp: new Date().toISOString() });
      return;
    }

    try {
      const status = getExecutionStatus();
      if (!status.ready) {
        executionStore.recordAudit('PROPOSAL_BLOCKED', null, { blockers: status.blockers });
        res.status(409).json({
          success: false,
          error: 'Execution readiness gates are not satisfied',
          data: status,
          timestamp: new Date().toISOString(),
        });
        return;
      }

      const amountUsd = parsePositiveNumberOrDefault(
        req.body?.amountUsd,
        'amountUsd',
        EXECUTION_CONFIG.limits.maxCapitalUsd
      );
      if (amountUsd > EXECUTION_CONFIG.limits.maxCapitalUsd) {
        throw new Error(`Parameter "amountUsd" must not exceed ${EXECUTION_CONFIG.limits.maxCapitalUsd}`);
      }
      const decision = agentStore.getRecent(1)[0];
      if (!decision) throw new Error('No agent decision is available');
      const expiresAt = new Date(
        Date.now() + EXECUTION_CONFIG.limits.proposalExpiryMinutes * 60 * 1_000
      ).toISOString();
      const proposal = executionStore.createProposal({
        decisionId: decision.id,
        amountUsd,
        readiness: status as unknown as Record<string, unknown>,
        expiresAt,
      });
      res.status(201).json({ success: true, data: proposal, timestamp: new Date().toISOString() });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : 'Proposal could not be created',
        timestamp: new Date().toISOString(),
      });
    }
  });

  app.post('/api/execution/proposals/:id/review', (req, res) => {
    if (!isExecutionAdminAuthorized(req.headers.authorization)) {
      res.status(401).json({ success: false, error: 'Unauthorized', timestamp: new Date().toISOString() });
      return;
    }

    try {
      const id = parsePositiveNumber(req.params.id, 'id');
      if (
        typeof req.body?.approve !== 'boolean' ||
        typeof req.body?.reason !== 'string' ||
        req.body.reason.trim().length < 5
      ) {
        throw new Error('approve boolean and reason are required');
      }
      if (req.body.approve) {
        const status = getExecutionStatus();
        if (!status.ready) {
          executionStore.recordAudit(
            'APPROVAL_BLOCKED',
            executionStore.getProposal(Math.floor(id)) ? Math.floor(id) : null,
            { blockers: status.blockers }
          );
          res.status(409).json({
            success: false,
            error: 'Execution readiness gates are not satisfied',
            data: status,
            timestamp: new Date().toISOString(),
          });
          return;
        }
      }
      const proposal = executionStore.reviewProposal(
        Math.floor(id),
        req.body.approve,
        req.body.reason.trim()
      );
      res.json({
        success: true,
        data: {
          proposal,
          transactionSigned: false,
          transactionBroadcast: false,
          note: 'Manual review recorded. No private key is stored and no transaction was broadcast.',
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : 'Proposal review failed',
        timestamp: new Date().toISOString(),
      });
    }
  });

  app.post('/api/execution/proposals/:id/transaction-plan', async (req, res) => {
    if (!isExecutionAdminAuthorized(req.headers.authorization)) {
      res.status(401).json({ success: false, error: 'Unauthorized', timestamp: new Date().toISOString() });
      return;
    }

    try {
      const id = Math.floor(parsePositiveNumber(req.params.id, 'id'));
      const proposal = executionStore.getProposal(id);
      if (!proposal || proposal.status !== 'APPROVED') {
        throw new Error('An approved execution proposal is required');
      }
      if (new Date(proposal.expiresAt).getTime() <= Date.now()) {
        throw new Error('Approved execution proposal has expired');
      }
      const status = getExecutionStatus();
      if (!status.ready) {
        executionStore.recordAudit('TRANSACTION_PLAN_BLOCKED', id, { blockers: status.blockers });
        res.status(409).json({
          success: false,
          error: 'Execution readiness gates are not satisfied',
          data: status,
          timestamp: new Date().toISOString(),
        });
        return;
      }
      if (typeof req.body?.wallet !== 'string') throw new Error('wallet is required');
      const slippageBps =
        req.body?.slippageBps === undefined ? 100 : parsePositiveNumber(req.body.slippageBps, 'slippageBps');
      const [state, walletState] = await Promise.all([
        captureOnchainPoolState(),
        fetchWalletTokenState(req.body.wallet),
      ]);
      const deadline = Math.floor(Date.now() / 1_000) + 10 * 60;
      const plan = buildFullRangeMintPlan({
        state,
        walletState,
        amountUsd: proposal.amountUsd,
        slippageBps: Math.floor(slippageBps),
        deadline,
      });
      executionStore.bindProposalWallet(id, plan.recipient);
      const mintTransaction = plan.transactions.find(
        transaction => transaction.purpose === 'MINT_FULL_RANGE'
      );
      if (!mintTransaction) throw new Error('Mint transaction is missing from the generated plan');
      const storedPlan = executionStore.saveMintTransactionPlan({
        proposalId: id,
        wallet: plan.recipient,
        referenceBlockNumber: state.blockNumber,
        amountUsd: plan.amountUsd,
        amount0Desired: plan.amount0Desired,
        amount1Desired: plan.amount1Desired,
        amount0Min: plan.amount0Min,
        amount1Min: plan.amount1Min,
        deadline: plan.deadline,
        mintCalldata: mintTransaction.data,
      });
      executionStore.recordAudit('UNSIGNED_TRANSACTION_PLAN_PREPARED', id, {
        recipient: plan.recipient,
        amountUsd: plan.amountUsd,
        transactionCount: plan.transactions.length,
        deadline: plan.deadline,
      });
      res.json({
        success: true,
        data: {
          proposal,
          walletState,
          plan,
          immutablePlanEvidence: {
            planHash: storedPlan.planHash,
            referenceBlockNumber: storedPlan.referenceBlockNumber,
            createdAt: storedPlan.createdAt,
          },
          transactionSigned: false,
          transactionBroadcast: false,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : 'Transaction plan could not be prepared',
        timestamp: new Date().toISOString(),
      });
    }
  });

  app.post('/api/execution/proposals/:id/mint-receipt', async (req, res) => {
    if (!isExecutionAdminAuthorized(req.headers.authorization)) {
      res.status(401).json({ success: false, error: 'Unauthorized', timestamp: new Date().toISOString() });
      return;
    }

    let proposalId: number | null = null;
    try {
      const id = Math.floor(parsePositiveNumber(req.params.id, 'id'));
      const proposal = executionStore.getProposal(id);
      if (!proposal || proposal.status !== 'APPROVED') {
        throw new Error('An approved execution proposal is required');
      }
      proposalId = id;
      if (typeof req.body?.txHash !== 'string') throw new Error('txHash is required');
      const txHash = req.body.txHash.toLowerCase();
      if (!/^0x[0-9a-f]{64}$/.test(txHash)) throw new Error('Invalid transaction hash');
      const binding = executionStore.getProposalWallet(id);
      const storedPlan = executionStore.getMintTransactionPlan(id);
      if (!binding || !storedPlan) throw new Error('Prepare and persist an immutable transaction plan first');

      const existing = positionStore.getLiveNftByProposal(id);
      if (existing) {
        if (existing.txHash !== txHash)
          throw new Error('Execution proposal is already linked to another live NFT');
        const transaction = executionStore.recordVerifiedTransaction(id, txHash);
        res.json({
          success: true,
          data: {
            proposal,
            position: positionStore.getPosition(existing.positionId),
            nft: existing,
            transaction,
            idempotent: true,
            signedByServer: false,
            broadcastByServer: false,
            onchainTransactionObserved: true,
          },
          timestamp: new Date().toISOString(),
        });
        return;
      }

      if (!dependencies.isExecutionAdapterReady()) {
        const verified = await verifyPositionManagerAdapter();
        dependencies.setExecutionAdapterReady(verified);
        if (!verified) throw new Error('Position Manager bytecode verification failed');
      }
      const verified = await fetchAndVerifyPancakeV3MintReceipt({
        txHash,
        wallet: binding.wallet,
        minimumConfirmations: MINT_RECEIPT_MIN_CONFIRMATIONS,
      });
      verifyMintAgainstImmutablePlan({
        verified,
        proposalCreatedAt: proposal.createdAt,
        proposalExpiresAt: proposal.expiresAt,
        plan: storedPlan,
        proposalAmountUsd: proposal.amountUsd,
      });
      const state = await captureOnchainPoolState();
      const entryGasUsd = (Number(BigInt(verified.gasCostWei)) / 1e18) * state.priceWbnbUsd;
      const tracked = positionStore.confirmVerifiedLiveMint({
        proposalId: id,
        decisionId: proposal.decisionId,
        investmentUsd: proposal.amountUsd,
        entryPrice: state.priceWbnbUsd,
        entryGasUsd,
        txHash: verified.transactionHash,
        wallet: verified.wallet,
        tokenId: verified.tokenId,
        blockNumber: verified.blockNumber,
        blockHash: verified.blockHash,
        blockTimestamp: verified.blockTimestamp,
        confirmations: verified.confirmations,
        token0: verified.token0,
        token1: verified.token1,
        fee: verified.fee,
        tickLower: verified.tickLower,
        tickUpper: verified.tickUpper,
        liquidity: verified.liquidity,
        feeGrowthInside0LastX128: verified.feeGrowthInside0LastX128,
        feeGrowthInside1LastX128: verified.feeGrowthInside1LastX128,
        tokensOwed0: verified.tokensOwed0,
        tokensOwed1: verified.tokensOwed1,
        amount0: verified.amount0,
        amount1: verified.amount1,
        gasUsed: verified.gasUsed,
        effectiveGasPriceWei: verified.effectiveGasPriceWei,
        gasCostWei: verified.gasCostWei,
        owner: verified.owner,
      });
      const transaction = executionStore.recordVerifiedTransaction(id, txHash);
      res.status(201).json({
        success: true,
        data: {
          proposal,
          position: tracked.position,
          nft: tracked.nft,
          transaction,
          idempotent: false,
          signedByServer: false,
          broadcastByServer: false,
          onchainTransactionObserved: true,
          note: 'External-wallet mint receipt, NFT ownership, liquidity, ticks, and fee checkpoints were verified on BSC.',
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Mint receipt verification failed';
      executionStore.recordAudit('MINT_RECEIPT_VERIFICATION_FAILED', proposalId, { error: message });
      const pending = /not mined|confirmation/i.test(message);
      res.status(pending ? 409 : 400).json({
        success: false,
        error: message,
        timestamp: new Date().toISOString(),
      });
    }
  });

  app.post('/api/execution/exit-proposals', (req, res) => {
    if (!isExecutionAdminAuthorized(req.headers.authorization)) {
      res.status(401).json({ success: false, error: 'Unauthorized', timestamp: new Date().toISOString() });
      return;
    }
    try {
      const positionId = Math.floor(parsePositiveNumber(req.body?.positionId, 'positionId'));
      if (typeof req.body?.reason !== 'string' || req.body.reason.trim().length < 5) {
        throw new Error('reason is required and must contain at least 5 characters');
      }
      if (req.body?.burnAfterCollect !== undefined && typeof req.body.burnAfterCollect !== 'boolean') {
        throw new Error('burnAfterCollect must be a boolean');
      }
      if (req.body?.swapWbnbToUsdt !== undefined && typeof req.body.swapWbnbToUsdt !== 'boolean') {
        throw new Error('swapWbnbToUsdt must be a boolean');
      }
      const position = positionStore.getPosition(positionId);
      const nft = positionStore.getLiveNftByPosition(positionId);
      if (!position || position.mode !== 'LIVE' || position.status !== 'OPEN' || !nft?.ownershipVerified) {
        throw new Error('An open verified LIVE NFT position is required');
      }
      const slippageBps = Math.floor(parsePositiveNumberOrDefault(req.body?.slippageBps, 'slippageBps', 100));
      const expiresAt = new Date(
        Date.now() + EXECUTION_CONFIG.limits.proposalExpiryMinutes * 60 * 1_000
      ).toISOString();
      const proposal = executionStore.createExitProposal({
        positionId,
        reason: req.body.reason.trim(),
        slippageBps,
        burnAfterCollect: req.body?.burnAfterCollect ?? true,
        swapWbnbToUsdt: req.body?.swapWbnbToUsdt ?? false,
        expiresAt,
      });
      res.status(201).json({
        success: true,
        data: {
          proposal,
          position,
          nft,
          note: 'Exit proposal requires a separate manual approval and never signs or broadcasts a transaction.',
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : 'Exit proposal could not be created',
        timestamp: new Date().toISOString(),
      });
    }
  });

  app.post('/api/execution/exit-proposals/:id/review', (req, res) => {
    if (!isExecutionAdminAuthorized(req.headers.authorization)) {
      res.status(401).json({ success: false, error: 'Unauthorized', timestamp: new Date().toISOString() });
      return;
    }
    try {
      const id = Math.floor(parsePositiveNumber(req.params.id, 'id'));
      if (
        typeof req.body?.approve !== 'boolean' ||
        typeof req.body?.reason !== 'string' ||
        req.body.reason.trim().length < 5
      ) {
        throw new Error('approve boolean and reason are required');
      }
      const pending = executionStore.getExitProposal(id);
      if (!pending) throw new Error('Exit proposal not found');
      if (req.body.approve) {
        const position = positionStore.getPosition(pending.positionId);
        const nft = positionStore.getLiveNftByPosition(pending.positionId);
        if (!position || position.mode !== 'LIVE' || position.status !== 'OPEN' || !nft?.ownershipVerified) {
          throw new Error('The verified LIVE position is no longer open');
        }
      }
      const proposal = executionStore.reviewExitProposal(id, req.body.approve, req.body.reason.trim());
      res.json({
        success: true,
        data: {
          proposal,
          signedByServer: false,
          broadcastByServer: false,
          note: 'Manual exit review recorded. The emergency stop does not prevent preparation of a risk-reducing exit.',
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : 'Exit proposal review failed',
        timestamp: new Date().toISOString(),
      });
    }
  });

  app.post('/api/execution/exit-proposals/:id/transaction-plan', async (req, res) => {
    if (!isExecutionAdminAuthorized(req.headers.authorization)) {
      res.status(401).json({ success: false, error: 'Unauthorized', timestamp: new Date().toISOString() });
      return;
    }
    try {
      const id = Math.floor(parsePositiveNumber(req.params.id, 'id'));
      let proposal = executionStore.getExitProposal(id);
      if (!proposal) throw new Error('Exit proposal not found');
      if (new Date(proposal.expiresAt).getTime() <= Date.now()) {
        proposal = executionStore.expireExitProposal(id);
      }
      if (proposal.status !== 'APPROVED') throw new Error('An approved unexpired exit proposal is required');
      const position = positionStore.getPosition(proposal.positionId);
      const nft = positionStore.getLiveNftByPosition(proposal.positionId);
      if (!position || position.mode !== 'LIVE' || position.status !== 'OPEN' || !nft?.ownershipVerified) {
        throw new Error('The verified LIVE NFT position is no longer open');
      }
      if (!dependencies.isExecutionAdapterReady()) {
        const verified = await verifyPositionManagerAdapter();
        dependencies.setExecutionAdapterReady(verified);
        if (!verified) throw new Error('Position Manager bytecode verification failed');
      }
      if (proposal.swapWbnbToUsdt && !dependencies.isExitSwapRouterReady()) {
        const verified = await verifyPancakeV3SwapRouter();
        dependencies.setExitSwapRouterReady(verified);
        if (!verified) throw new Error('PancakeSwap V3 SwapRouter bytecode verification failed');
      }

      const [state, currentNft, swapAllowance] = await Promise.all([
        captureOnchainPoolState(),
        fetchPancakeV3PositionState({ tokenId: nft.tokenId, expectedWallet: nft.owner }),
        proposal.swapWbnbToUsdt ? fetchWbnbSwapRouterAllowance(nft.owner) : Promise.resolve('0'),
      ]);
      const deadline = Math.floor(Date.now() / 1_000) + 10 * 60;
      const plan = buildFullRangeExitPlan({
        state,
        position: currentNft,
        wallet: nft.owner,
        wbnbSwapRouterAllowance: swapAllowance,
        slippageBps: proposal.slippageBps,
        deadline,
        burnAfterCollect: proposal.burnAfterCollect,
        swapWbnbToUsdt: proposal.swapWbnbToUsdt,
      });
      const storedPlan = executionStore.saveExitTransactionPlan({
        exitProposalId: proposal.id,
        positionId: proposal.positionId,
        wallet: nft.owner,
        referenceBlockNumber: state.blockNumber,
        plan: {
          swapAmountIn: plan.swapAmountIn,
          transactions: plan.transactions,
        },
      });
      executionStore.recordAudit('UNSIGNED_EXIT_PLAN_PREPARED', null, {
        exitProposalId: proposal.id,
        positionId: proposal.positionId,
        tokenId: nft.tokenId,
        liquidity: currentNft.liquidity,
        transactionCount: plan.transactions.length,
        deadline,
      });
      res.json({
        success: true,
        data: {
          proposal,
          position,
          nft,
          currentNft,
          plan,
          immutablePlanEvidence: {
            planHash: storedPlan.planHash,
            referenceBlockNumber: storedPlan.referenceBlockNumber,
            createdAt: storedPlan.createdAt,
          },
          signedByServer: false,
          broadcastByServer: false,
          note: 'Each unsigned transaction must be reviewed and signed in order by the verified NFT owner wallet.',
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : 'Exit transaction plan could not be prepared',
        timestamp: new Date().toISOString(),
      });
    }
  });

  app.post('/api/execution/exit-proposals/:id/receipts', async (req, res) => {
    if (!isExecutionAdminAuthorized(req.headers.authorization)) {
      res.status(401).json({ success: false, error: 'Unauthorized', timestamp: new Date().toISOString() });
      return;
    }
    let exitProposalId: number | null = null;
    try {
      const id = Math.floor(parsePositiveNumber(req.params.id, 'id'));
      exitProposalId = id;
      const proposal = executionStore.getExitProposal(id);
      const storedPlan = executionStore.getExitTransactionPlan(id);
      if (!proposal || proposal.status !== 'APPROVED' || proposal.settledAt !== null || !storedPlan) {
        throw new Error('Approved unsettled exit proposal with immutable plan is required');
      }
      if (
        !Array.isArray(req.body?.txHashes) ||
        !req.body.txHashes.every((hash: unknown) => typeof hash === 'string')
      ) {
        throw new Error('txHashes must be an ordered array of transaction hashes');
      }
      const position = positionStore.getPosition(proposal.positionId);
      const nft = positionStore.getLiveNftByPosition(proposal.positionId);
      if (!position || position.mode !== 'LIVE' || position.status !== 'OPEN' || !nft?.ownershipVerified) {
        throw new Error('Verified LIVE position is no longer open');
      }
      const state = await captureOnchainPoolState();
      const evidence = await fetchAndVerifyExitReceipts({
        txHashes: req.body.txHashes,
        wallet: storedPlan.wallet,
        expectedTransactions: storedPlan.plan.transactions,
        referenceBlockNumber: storedPlan.referenceBlockNumber,
        planCreatedAt: storedPlan.createdAt,
        proposalExpiresAt: proposal.expiresAt,
        minimumConfirmations: MINT_RECEIPT_MIN_CONFIRMATIONS,
        swapAmountIn: storedPlan.plan.swapAmountIn,
        priceWbnbUsd: state.priceWbnbUsd,
        investmentUsd: position.investmentUsd,
        entryGasUsd: position.entryGasUsd,
      });
      const settlement = executionStore.settleVerifiedExit({
        exitProposalId: id,
        txHashes: evidence.txHashes,
        collectedUsdt: evidence.collectedUsdt,
        collectedWbnb: evidence.collectedWbnb,
        swapUsdtReceived: evidence.swapUsdtReceived,
        residualWbnb: evidence.residualWbnb,
        exitValueUsd: evidence.exitValueUsd,
        exitGasUsd: evidence.exitGasUsd,
        realizedPnlUsd: evidence.realizedPnlUsd,
        finalBlockNumber: evidence.finalBlockNumber,
        confirmations: evidence.confirmations,
        burnAfterCollect: proposal.burnAfterCollect,
      });
      res.status(201).json({
        success: true,
        data: {
          proposal: executionStore.getExitProposal(id),
          settlement,
          position: positionStore.getPosition(proposal.positionId),
          dailyLossUsd: executionStore.getRealizedLossToday(),
          signedByServer: false,
          broadcastByServer: false,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Exit receipt verification failed';
      executionStore.recordAudit('EXIT_RECEIPT_VERIFICATION_FAILED', null, {
        exitProposalId,
        error: message,
      });
      const pending = /not mined|confirmation/i.test(message);
      res
        .status(pending ? 409 : 400)
        .json({ success: false, error: message, timestamp: new Date().toISOString() });
    }
  });
}
