import assert from 'node:assert/strict';
import test from 'node:test';

import { simulateFullRangeLP, type FullRangeSimulationInput } from './lp-simulator.js';

const input: FullRangeSimulationInput = {
  investment: 100,
  currentPrice: 570,
  volume24h: 50_000_000,
  poolFeeRate: 0.0001,
  activeLiquidity: '5251067881774866728578051',
  sqrtPriceX96: '3317521175930763235976231709',
  currentTick: -63459,
  token0Decimals: 18,
  token1Decimals: 18,
  protocolFeeShareToken0Bps: 3300,
  protocolFeeShareToken1Bps: 3300,
  entryGasUsd: 0.02,
  exitGasUsd: 0.03,
  assetSymbol: 'BNB',
  priceChanges: [0, 100],
};

test('uses active V3 liquidity and deducts the PancakeSwap protocol fee share', () => {
  const result = simulateFullRangeLP(input);

  assert.equal(result.grossPoolFees24h, 5_000);
  assert.ok(Math.abs(result.netLpPoolFees24h - 3_350) < 1e-9);
  assert.equal(result.protocolFeeShareBps, 3_300);
  assert.ok(result.shareOfActiveLiquidity > 0);
  assert.ok(result.shareOfActiveLiquidity < 0.000001);
  assert.ok(Math.abs(result.dailyFee - result.shareOfActiveLiquidity * 3_350) < 1e-12);
  assert.ok(Math.abs(result.apr - result.yearlyFee) < 1e-12);
});

test('separates P/L versus initial capital from performance versus HOLD', () => {
  const result = simulateFullRangeLP(input);
  const unchanged = result.ilScenarios[0]!;
  const doubled = result.ilScenarios[1]!;

  assert.equal(unchanged.holdValue, 100);
  assert.equal(unchanged.lpValueBeforeFee, 100);
  assert.ok(Math.abs(unchanged.lpValueAfterFee - (100 + result.monthlyFee)) < 1e-12);
  assert.ok(
    Math.abs(unchanged.profitLossVsInvestment - (result.monthlyFee - result.totalLifecycleGasUsd)) < 1e-12
  );
  assert.ok(Math.abs(doubled.lpValueBeforeFee - Math.sqrt(2) * 100) < 1e-12);
  assert.ok(doubled.profitLossVsInvestment > 40);
  assert.ok(doubled.differenceVsHold < 0);
});

test('rejects impossible price scenarios and on-chain liquidity', () => {
  assert.throws(() => simulateFullRangeLP({ ...input, priceChanges: [-100] }), /greater than -100%/);
  assert.throws(() => simulateFullRangeLP({ ...input, activeLiquidity: '0' }), /must be positive/);
});
