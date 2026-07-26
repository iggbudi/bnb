import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildFullRangeExitPlan,
  fullRangeAmountsForLiquidity,
  PANCAKE_V3_SWAP_ROUTER,
} from './pancakeswap-v3-exit.js';
import type { PancakeV3OnchainState } from '../../market-data/index.js';
import type { PancakeV3PositionState } from './pancakeswap-v3-position-tracker.js';

const wallet = '0x1111111111111111111111111111111111111111';
const sqrtPriceX96 = 3317521175930763235976231709n;
const state = {
  chainId: 56,
  fee: 100,
  tickSpacing: 1,
  sqrtPriceX96: sqrtPriceX96.toString(),
  priceWbnbUsd: 570.37,
} as PancakeV3OnchainState;
const position: PancakeV3PositionState = {
  tokenId: '42',
  owner: wallet,
  blockNumber: 100,
  token0: '0x55d398326f99059ff775485246999027b3197955',
  token1: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',
  fee: 100,
  tickLower: -887272,
  tickUpper: 887272,
  liquidity: '1000000000000000000',
  feeGrowthInside0LastX128: '1',
  feeGrowthInside1LastX128: '2',
  tokensOwed0: '0',
  tokensOwed1: '0',
};

test('calculates both full-range token amounts from NFT liquidity', () => {
  const amounts = fullRangeAmountsForLiquidity(BigInt(position.liquidity), sqrtPriceX96);
  assert.ok(amounts.amount0 > 0n);
  assert.ok(amounts.amount1 > 0n);
  const valueRatio = Number(amounts.amount0) / (Number(amounts.amount1) * state.priceWbnbUsd);
  assert.ok(Math.abs(valueRatio - 1) < 0.01);
});

test('builds decrease, collect, and optional burn calldata without signing', () => {
  const plan = buildFullRangeExitPlan({
    state,
    position,
    wallet,
    wbnbSwapRouterAllowance: '0',
    slippageBps: 100,
    deadline: 1_000_600,
    nowUnix: 1_000_000,
    burnAfterCollect: true,
    swapWbnbToUsdt: false,
  });
  assert.deepEqual(
    plan.transactions.map(transaction => transaction.purpose),
    ['DECREASE_LIQUIDITY', 'COLLECT', 'BURN']
  );
  assert.ok(plan.transactions[0]!.data.startsWith('0x0c49ccbe'));
  assert.equal(plan.transactions[0]!.data.length, 2 + 8 + 5 * 64);
  assert.ok(plan.transactions[1]!.data.startsWith('0xfc6f7865'));
  assert.equal(plan.transactions[1]!.data.length, 2 + 8 + 4 * 64);
  assert.equal(plan.transactions[2]!.data.length, 2 + 8 + 64);
  assert.ok(BigInt(plan.amount0Min) < BigInt(plan.expectedAmount0));
  assert.ok(BigInt(plan.amount1Min) < BigInt(plan.expectedAmount1));
});

test('optionally adds WBNB approval and conservative WBNB to USDT swap', () => {
  const plan = buildFullRangeExitPlan({
    state,
    position,
    wallet,
    wbnbSwapRouterAllowance: '0',
    slippageBps: 100,
    deadline: 1_000_600,
    nowUnix: 1_000_000,
    burnAfterCollect: false,
    swapWbnbToUsdt: true,
  });
  assert.deepEqual(
    plan.transactions.map(transaction => transaction.purpose),
    ['APPROVE_WBNB_SWAP', 'DECREASE_LIQUIDITY', 'COLLECT', 'SWAP_WBNB_TO_USDT']
  );
  assert.equal(plan.transactions[3]!.to, PANCAKE_V3_SWAP_ROUTER);
  assert.ok(plan.transactions[3]!.data.startsWith('0x414bf389'));
  assert.equal(plan.transactions[3]!.data.length, 2 + 8 + 8 * 64);
  assert.ok(BigInt(plan.swapAmountOutMin!) > 0n);
});

test('rejects an exit plan for a non-owner or stale deadline', () => {
  assert.throws(
    () =>
      buildFullRangeExitPlan({
        state,
        position,
        wallet: '0x2222222222222222222222222222222222222222',
        wbnbSwapRouterAllowance: '0',
        slippageBps: 100,
        deadline: 1_000_600,
        nowUnix: 1_000_000,
        burnAfterCollect: false,
        swapWbnbToUsdt: false,
      }),
    /does not own/
  );
  assert.throws(
    () =>
      buildFullRangeExitPlan({
        state,
        position,
        wallet,
        wbnbSwapRouterAllowance: '0',
        slippageBps: 100,
        deadline: 999_999,
        nowUnix: 1_000_000,
        burnAfterCollect: false,
        swapWbnbToUsdt: false,
      }),
    /deadline/
  );
});
