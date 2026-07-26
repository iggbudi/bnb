import type { Express } from 'express';
import { parsePositiveNumber } from '../../../shared/http/validation.js';
import { buildFullRangeMintPlan } from '../infrastructure/pancakeswap-v3-execution.js';
import { resolveExecutionChainAdapter, type ExecutionRouteDependencies } from './execution-routes.js';

export function registerMintSettlementRoutes(app: Express, dependencies: ExecutionRouteDependencies): void {
  const { executionStore, positionStore } = dependencies;
  const chainAdapter = resolveExecutionChainAdapter(dependencies);
  const MINT_RECEIPT_MIN_CONFIRMATIONS = dependencies.mintReceiptMinimumConfirmations;
  const getExecutionStatus = dependencies.getExecutionStatus;
  const isExecutionAdminAuthorized = dependencies.isAdminAuthorized;
  const captureOnchainPoolState = dependencies.captureOnchainState;

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
        chainAdapter.fetchWalletTokenState(req.body.wallet),
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
        const verified = await chainAdapter.verifyPositionManagerAdapter();
        dependencies.setExecutionAdapterReady(verified);
        if (!verified) throw new Error('Position Manager bytecode verification failed');
      }
      const verified = await chainAdapter.fetchAndVerifyMintReceipt({
        txHash,
        wallet: binding.wallet,
        minimumConfirmations: MINT_RECEIPT_MIN_CONFIRMATIONS,
      });
      chainAdapter.verifyMintAgainstImmutablePlan({
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
}
