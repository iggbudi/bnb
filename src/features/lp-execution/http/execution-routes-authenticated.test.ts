import assert from 'node:assert/strict';
import express from 'express';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { AgentStore, type PaperAgentDecisionInput } from '../../paper-agent/index.js';
import type { PancakeV3OnchainState } from '../../market-data/index.js';
import { ExecutionStore } from '../infrastructure/execution-store.js';
import { PositionStore } from '../infrastructure/position-store.js';
import { registerExecutionControlRoutes, type ExecutionChainAdapter } from './execution-routes.js';

const WALLET = '0x1111111111111111111111111111111111111111';
const USDT = '0x55d398326f99059ff775485246999027b3197955';
const WBNB = '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c';
const TX_HASH = `0x${'12'.repeat(32)}`;
const BLOCK_HASH = `0x${'34'.repeat(32)}`;
const AUTHORIZATION = 'Bearer deterministic-test-token';

const decision: PaperAgentDecisionInput = {
  decisionHour: '2026-07-26T15:00:00.000Z',
  createdAt: '2026-07-26T15:00:00.000Z',
  strategyVersion: 'logistic-test',
  action: 'ENTER_FULL_RANGE',
  reasonCode: 'TEST_ENTRY',
  confidence: 'high',
  rationale: 'Deterministic authenticated route fixture.',
  investment: 50,
  referencePrice: 570,
  predictedFee24h: 1,
  predictedIL24h: 0.1,
  predictedExcessVsHold24h: 0.9,
  features: {},
};

const onchain = {
  chainId: 56,
  poolAddress: '0x172fcd41e0913e95784454622d1c3724f546f849',
  blockNumber: 1000,
  blockTimestamp: '2026-07-26T15:00:10.000Z',
  capturedAt: '2026-07-26T15:00:11.000Z',
  token0: USDT,
  token1: WBNB,
  token0Symbol: 'USDT',
  token1Symbol: 'WBNB',
  token0Decimals: 18,
  token1Decimals: 18,
  sqrtPriceX96: '3317521175930763235976231709',
  currentTick: -63459,
  tickSpacing: 1,
  fee: 100,
  feePercent: 0.01,
  protocolFeeShareToken0Bps: 3300,
  protocolFeeShareToken1Bps: 3300,
  unlocked: true,
  activeLiquidity: '1000000000000000000000000',
  feeGrowthGlobal0X128: '1000',
  feeGrowthGlobal1X128: '2000',
  priceWbnbUsd: 570,
  ranges: [],
  gas: {
    gasPriceWei: '1000000000',
    gasPriceGwei: 1,
    assumedMintGasUnits: 500000,
    assumedRebalanceGasUnits: 800000,
    estimatedMintCostBnb: 0.0005,
    estimatedMintCostUsd: 0.285,
    estimatedRebalanceCostBnb: 0.0008,
    estimatedRebalanceCostUsd: 0.456,
    note: 'test',
  },
  readOnly: true,
} satisfies PancakeV3OnchainState;

function body(value: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { authorization: AUTHORIZATION, 'content-type': 'application/json' },
    body: JSON.stringify(value),
  };
}

test('authenticated entry and risk-reducing exit preserve immutable evidence and fail closed', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'bnb-execution-http-'));
  const databasePath = join(directory, 'test.sqlite');
  const agentStore = new AgentStore(databasePath);
  const savedDecision = agentStore.saveIfAbsent(decision).decision;
  const executionStore = new ExecutionStore(databasePath);
  const positionStore = new PositionStore(databasePath);
  let mintFailure: Error | null = null;
  let exitFailure: Error | null = null;

  const chainAdapter: ExecutionChainAdapter = {
    async fetchWalletTokenState(wallet) {
      assert.equal(wallet.toLowerCase(), WALLET);
      return {
        wallet: WALLET,
        usdtBalance: (100n * 10n ** 18n).toString(),
        wbnbBalance: (1n * 10n ** 18n).toString(),
        usdtAllowance: '0',
        wbnbAllowance: '0',
      };
    },
    async verifyPositionManagerAdapter() {
      return true;
    },
    async fetchAndVerifyMintReceipt() {
      if (mintFailure) throw mintFailure;
      return {
        transactionHash: TX_HASH,
        wallet: WALLET,
        tokenId: '42',
        owner: WALLET,
        blockNumber: 1001,
        blockHash: BLOCK_HASH,
        blockTimestamp: '2026-07-26T15:00:20.000Z',
        confirmations: 5,
        token0: USDT,
        token1: WBNB,
        fee: 100,
        tickLower: -887272,
        tickUpper: 887272,
        liquidity: '1000000000000000000',
        feeGrowthInside0LastX128: '1000',
        feeGrowthInside1LastX128: '2000',
        tokensOwed0: '0',
        tokensOwed1: '0',
        amount0: (25n * 10n ** 18n).toString(),
        amount1: (4n * 10n ** 16n).toString(),
        amount0Desired: (25n * 10n ** 18n).toString(),
        amount1Desired: (4n * 10n ** 16n).toString(),
        amount0Min: (24n * 10n ** 18n).toString(),
        amount1Min: (3n * 10n ** 16n).toString(),
        deadline: Math.floor(Date.now() / 1000) + 300,
        mintCalldata: '0x00',
        gasUsed: '500000',
        effectiveGasPriceWei: '1000000000',
        gasCostWei: '500000000000000',
      };
    },
    verifyMintAgainstImmutablePlan() {
      return undefined;
    },
    async fetchPositionState() {
      return {
        tokenId: '42',
        owner: WALLET,
        blockNumber: 1002,
        token0: USDT,
        token1: WBNB,
        fee: 100,
        tickLower: -887272,
        tickUpper: 887272,
        liquidity: '1000000000000000000',
        feeGrowthInside0LastX128: '1000',
        feeGrowthInside1LastX128: '2000',
        tokensOwed0: '0',
        tokensOwed1: '0',
      };
    },
    async fetchWbnbSwapRouterAllowance() {
      return '0';
    },
    async verifySwapRouter() {
      return true;
    },
    async fetchAndVerifyExitReceipts() {
      if (exitFailure) throw exitFailure;
      return {
        txHashes: [`0x${'56'.repeat(32)}`, `0x${'57'.repeat(32)}`, `0x${'58'.repeat(32)}`],
        collectedUsdt: (40n * 10n ** 18n).toString(),
        collectedWbnb: '0',
        swappedWbnb: '0',
        swapUsdtReceived: '0',
        residualWbnb: '0',
        exitValueUsd: 40,
        exitGasCostWei: '500000000000000',
        exitGasUsd: 0.5,
        realizedPnlUsd: -10.5,
        finalBlockNumber: 1003,
        confirmations: 5,
      };
    },
  };

  const app = express();
  app.use(express.json());
  registerExecutionControlRoutes(app, {
    agentStore,
    executionStore,
    positionStore,
    limits: { maxCapitalUsd: 100, maxDailyLossUsd: 5, proposalExpiryMinutes: 15 },
    mintReceiptMinimumConfirmations: 3,
    getExecutionStatus: () => ({
      ready: !executionStore.getControl().killSwitchEngaged,
      blockers: executionStore.getControl().killSwitchEngaged ? ['EMERGENCY_STOP_ENGAGED'] : [],
    }),
    isAdminAuthorized: authorization => authorization === AUTHORIZATION,
    captureOnchainState: async () => onchain,
    isExecutionAdapterReady: () => true,
    setExecutionAdapterReady: () => undefined,
    isExitSwapRouterReady: () => true,
    setExitSwapRouterReady: () => undefined,
    chainAdapter,
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const address = server.address();
  assert(address && typeof address === 'object');
  const request = (path: string, init?: RequestInit) =>
    fetch(`http://127.0.0.1:${address.port}${path}`, init);

  try {
    assert.equal(
      (await request('/api/execution/kill-switch', body({ engaged: false, reason: 'x' }))).status,
      400
    );
    assert.equal(
      (
        await request('/api/execution/proposals', {
          ...body({ amountUsd: 50 }),
          headers: { authorization: 'Bearer wrong-token', 'content-type': 'application/json' },
        })
      ).status,
      401
    );
    assert.equal(
      (await request('/api/execution/proposals', body({ amountUsd: { malformed: true } }))).status,
      409,
      'readiness must fail closed before parsing a payload while emergency stop is engaged'
    );
    assert.equal(
      (await request('/api/execution/proposals', body({ amountUsd: 50 }))).status,
      409,
      'emergency stop must block entry even with valid authorization'
    );
    assert.equal(
      (await request('/api/execution/kill-switch', body({ engaged: false, reason: 'Test unlock only.' })))
        .status,
      200
    );

    assert.equal(
      (await request('/api/execution/proposals', body({ amountUsd: { malformed: true } }))).status,
      400
    );
    const createdResponse = await request('/api/execution/proposals', body({ amountUsd: 50 }));
    assert.equal(createdResponse.status, 201, await createdResponse.clone().text());
    const proposal = (await createdResponse.json()) as { data: { id: number } };
    assert.equal(savedDecision.id > 0, true);
    const proposalId = proposal.data.id;

    assert.equal(
      (
        await request(
          `/api/execution/proposals/${proposalId}/review`,
          body({ approve: true, reason: 'Manual deterministic approval.' })
        )
      ).status,
      200
    );
    assert.equal(
      (
        await request(
          `/api/execution/proposals/${proposalId}/review`,
          body({ approve: true, reason: 'Illegal repeated approval.' })
        )
      ).status,
      400
    );
    assert.equal(
      (
        await request(
          `/api/execution/proposals/${proposalId}/transaction-plan`,
          body({ wallet: 'not-a-wallet', slippageBps: 100 })
        )
      ).status,
      400
    );
    const planResponse = await request(
      `/api/execution/proposals/${proposalId}/transaction-plan`,
      body({ wallet: WALLET, slippageBps: 100 })
    );
    assert.equal(planResponse.status, 200);
    const plan = (await planResponse.json()) as { data: { immutablePlanEvidence: { planHash: string } } };
    assert.match(plan.data.immutablePlanEvidence.planHash, /^[0-9a-f]{64}$/);

    mintFailure = new Error('RPC timeout while waiting for confirmation');
    assert.equal(
      (await request(`/api/execution/proposals/${proposalId}/mint-receipt`, body({ txHash: TX_HASH })))
        .status,
      409
    );
    mintFailure = new Error('calldata mismatch');
    assert.equal(
      (await request(`/api/execution/proposals/${proposalId}/mint-receipt`, body({ txHash: TX_HASH })))
        .status,
      400
    );
    mintFailure = null;
    assert.equal(
      (await request(`/api/execution/proposals/${proposalId}/mint-receipt`, body({ txHash: TX_HASH })))
        .status,
      201
    );
    const replay = await request(
      `/api/execution/proposals/${proposalId}/mint-receipt`,
      body({ txHash: TX_HASH })
    );
    assert.equal(replay.status, 200);
    assert.equal(((await replay.json()) as { data: { idempotent: boolean } }).data.idempotent, true);
    assert.equal(
      (
        await request(
          `/api/execution/proposals/${proposalId}/mint-receipt`,
          body({ txHash: `0x${'78'.repeat(32)}` })
        )
      ).status,
      400
    );

    assert.equal(
      (await request('/api/execution/kill-switch', body({ engaged: true, reason: 'Risk lock restored.' })))
        .status,
      200
    );
    const active = positionStore.getActivePosition();
    assert(active);
    const exitCreated = await request(
      '/api/execution/exit-proposals',
      body({ positionId: active.id, reason: 'Reduce risk immediately.', swapWbnbToUsdt: false })
    );
    assert.equal(exitCreated.status, 201, 'emergency stop must not block an authorized risk-reducing exit');
    const exitProposalId = ((await exitCreated.json()) as { data: { proposal: { id: number } } }).data
      .proposal.id;
    assert.equal(
      (
        await request(
          `/api/execution/exit-proposals/${exitProposalId}/review`,
          body({ approve: true, reason: 'Manual risk reduction approval.' })
        )
      ).status,
      200
    );
    const exitPlan = await request(
      `/api/execution/exit-proposals/${exitProposalId}/transaction-plan`,
      body({})
    );
    assert.equal(exitPlan.status, 200);

    exitFailure = new Error('RPC confirmation timeout');
    assert.equal(
      (
        await request(
          `/api/execution/exit-proposals/${exitProposalId}/receipts`,
          body({ txHashes: [`0x${'56'.repeat(32)}`] })
        )
      ).status,
      409
    );
    exitFailure = null;
    const settled = await request(
      `/api/execution/exit-proposals/${exitProposalId}/receipts`,
      body({ txHashes: [`0x${'56'.repeat(32)}`] })
    );
    assert.equal(settled.status, 201, await settled.clone().text());
    assert.equal(positionStore.getPosition(active.id)?.status, 'CLOSED');
    assert.equal(executionStore.getRealizedLossToday() > 10, true);
    assert.equal(
      (
        await request(
          `/api/execution/exit-proposals/${exitProposalId}/receipts`,
          body({ txHashes: [`0x${'56'.repeat(32)}`] })
        )
      ).status,
      400
    );
    assert.equal(
      executionStore.getRecentAudit(100).some(event => event.eventType.includes('FAILED')),
      true
    );
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
    positionStore.close();
    executionStore.close();
    agentStore.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
