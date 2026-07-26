import type { Express } from 'express';
import { parsePositiveNumber, parsePositiveNumberOrDefault } from '../../../shared/http/validation.js';
import { buildFullRangeExitPlan } from '../infrastructure/pancakeswap-v3-exit.js';
import { resolveExecutionChainAdapter, type ExecutionRouteDependencies } from './execution-routes.js';

export function registerExitProposalRoutes(app: Express, dependencies: ExecutionRouteDependencies): void {
  const { executionStore, positionStore } = dependencies;
  const chainAdapter = resolveExecutionChainAdapter(dependencies);
  const EXECUTION_CONFIG = { limits: dependencies.limits };
  const isExecutionAdminAuthorized = dependencies.isAdminAuthorized;
  const captureOnchainPoolState = dependencies.captureOnchainState;

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
        const verified = await chainAdapter.verifyPositionManagerAdapter();
        dependencies.setExecutionAdapterReady(verified);
        if (!verified) throw new Error('Position Manager bytecode verification failed');
      }
      if (proposal.swapWbnbToUsdt && !dependencies.isExitSwapRouterReady()) {
        const verified = await chainAdapter.verifySwapRouter();
        dependencies.setExitSwapRouterReady(verified);
        if (!verified) throw new Error('PancakeSwap V3 SwapRouter bytecode verification failed');
      }

      const [state, currentNft, swapAllowance] = await Promise.all([
        captureOnchainPoolState(),
        chainAdapter.fetchPositionState({ tokenId: nft.tokenId, expectedWallet: nft.owner }),
        proposal.swapWbnbToUsdt ? chainAdapter.fetchWbnbSwapRouterAllowance(nft.owner) : Promise.resolve('0'),
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
}
