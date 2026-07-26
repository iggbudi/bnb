import type { Express } from 'express';
import { parsePositiveNumber } from '../../../shared/http/validation.js';
import { resolveExecutionChainAdapter, type ExecutionRouteDependencies } from './execution-routes.js';

export function registerExitSettlementRoutes(app: Express, dependencies: ExecutionRouteDependencies): void {
  const { executionStore, positionStore } = dependencies;
  const chainAdapter = resolveExecutionChainAdapter(dependencies);
  const MINT_RECEIPT_MIN_CONFIRMATIONS = dependencies.mintReceiptMinimumConfirmations;
  const isExecutionAdminAuthorized = dependencies.isAdminAuthorized;
  const captureOnchainPoolState = dependencies.captureOnchainState;

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
      const evidence = await chainAdapter.fetchAndVerifyExitReceipts({
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
