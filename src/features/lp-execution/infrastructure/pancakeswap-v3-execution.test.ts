import assert from 'node:assert/strict';
import test from 'node:test';

import { buildFullRangeMintPlan, encodeMintFullRange } from './pancakeswap-v3-execution.js';
import { calculateFullRangeTokenAmounts, fullRangeLiquidityForAmounts } from '../../lp-analysis/index.js';
import type { PancakeV3OnchainState } from '../../market-data/index.js';

const state = {
  chainId: 56,
  fee: 100,
  tickSpacing: 1,
  currentTick: -63459,
  priceWbnbUsd: 570,
  token0Decimals: 18,
  token1Decimals: 18,
} as PancakeV3OnchainState;

const walletState = {
  wallet: '0x1111111111111111111111111111111111111111',
  usdtBalance: (100n * 10n ** 18n).toString(),
  wbnbBalance: (1n * 10n ** 18n).toString(),
  usdtAllowance: '0',
  wbnbAllowance: '0',
};

test('calculates approximately balanced USD amounts for a full-range position', () => {
  const amounts = calculateFullRangeTokenAmounts(100, 570, -63459);
  const token0Usd = amounts.amount0Tokens;
  const token1Usd = amounts.amount1Tokens * 570;
  assert.ok(Math.abs(token0Usd - token1Usd) < 0.1);
  assert.ok(Math.abs(token0Usd + token1Usd - 100) < 1e-9);
});

test('derives minted full-range liquidity from both desired token amounts', () => {
  const amounts = calculateFullRangeTokenAmounts(100, 570, -63459);
  const liquidity = fullRangeLiquidityForAmounts(
    amounts.amount0,
    amounts.amount1,
    3317521175930763235976231709n
  );

  assert.ok(liquidity > 2n * 10n ** 18n);
  assert.ok(liquidity < 3n * 10n ** 18n);
});

test('builds approvals and static PancakeSwap V3 mint calldata', () => {
  const plan = buildFullRangeMintPlan({
    state,
    walletState,
    amountUsd: 100,
    slippageBps: 100,
    deadline: 2_000_000_000,
  });

  assert.equal(plan.transactions.length, 3);
  assert.deepEqual(
    plan.transactions.map(tx => tx.purpose),
    ['APPROVE_USDT', 'APPROVE_WBNB', 'MINT_FULL_RANGE']
  );
  assert.ok(plan.transactions[2]!.data.startsWith('0x88316456'));
  assert.equal(plan.transactions[2]!.data.length, 2 + 8 + 11 * 64);
  assert.ok(BigInt(plan.amount0Min) < BigInt(plan.amount0Desired));
  assert.ok(BigInt(plan.amount1Min) < BigInt(plan.amount1Desired));
});

test('mint encoder rejects malformed wallet addresses through plan creation', () => {
  assert.throws(
    () =>
      buildFullRangeMintPlan({
        state,
        walletState: { ...walletState, wallet: '0xbad' },
        amountUsd: 100,
        slippageBps: 100,
        deadline: 2_000_000_000,
      }),
    /Invalid EVM wallet/
  );
});

test('mint calldata contains exactly eleven static tuple words', () => {
  const data = encodeMintFullRange({
    fee: 100,
    amount0Desired: 1n,
    amount1Desired: 2n,
    amount0Min: 1n,
    amount1Min: 1n,
    recipient: walletState.wallet,
    deadline: 2_000_000_000,
  });
  assert.equal(data.length, 2 + 8 + 11 * 64);
});
