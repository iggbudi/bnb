import assert from 'node:assert/strict';
import test from 'node:test';

import {
  estimateFullRangeFeeBetweenCheckpoints,
  fullRangeFeeGrowthIncrement,
  fullRangeLiquidityForCapital,
  projectFullRangeFee24h,
  sqrtPriceX96AtTick,
} from './full-range-fee.js';

const Q128 = 1n << 128n;

test('derives positive full-range liquidity from capital and tick', () => {
  const liquidity = fullRangeLiquidityForCapital({
    investmentUsd: 100,
    priceWbnbUsd: 570,
    currentTick: -63459,
  });
  assert.ok(liquidity > 0n);
  assert.ok(sqrtPriceX96AtTick(-63459) > 0n);
});

test('projects fees from active V3 liquidity rather than TVL pro-rata', () => {
  const fee = projectFullRangeFee24h({
    investmentUsd: 100,
    priceWbnbUsd: 570,
    currentTick: -63459,
    activeLiquidity: '4068530752036634963893194',
    volume24h: 50_000_000,
    poolFeeRate: 0.0001,
    protocolFeeShareToken0Bps: 3300,
    protocolFeeShareToken1Bps: 3300,
  });
  assert.ok(fee > 0);
  assert.ok(fee < 1);
});

test('converts global V3 fee growth into position token fees', () => {
  const liquidity = 1_000_000_000_000_000_000n;
  const result = fullRangeFeeGrowthIncrement({
    liquidity: liquidity.toString(),
    previousFeeGrowthGlobal0X128: '0',
    previousFeeGrowthGlobal1X128: '0',
    currentFeeGrowthGlobal0X128: (Q128 / 100n).toString(),
    currentFeeGrowthGlobal1X128: (Q128 / 1_000n).toString(),
    priceWbnbUsd: 500,
  });
  assert.ok(Math.abs(result.token0Fee - 0.01) < 1e-12);
  assert.ok(Math.abs(result.token1Fee - 0.001) < 1e-12);
  assert.ok(Math.abs(result.feeUsd - 0.51) < 1e-12);
});

test('estimates counterfactual full-range fee from immutable checkpoints', () => {
  const result = estimateFullRangeFeeBetweenCheckpoints({
    investmentUsd: 100,
    entry: {
      blockNumber: 100,
      capturedAt: '2026-07-01T00:00:00.000Z',
      currentTick: -63459,
      feeGrowthGlobal0X128: '1000',
      feeGrowthGlobal1X128: '2000',
      priceWbnbUsd: 570,
    },
    exit: {
      blockNumber: 200,
      capturedAt: '2026-07-01T01:00:00.000Z',
      currentTick: -63400,
      feeGrowthGlobal0X128: (Q128 + 1000n).toString(),
      feeGrowthGlobal1X128: (Q128 / 100n + 2000n).toString(),
      priceWbnbUsd: 575,
    },
  });
  assert.ok(BigInt(result.liquidity) > 0n);
  assert.ok(result.token0Fee > 0);
  assert.ok(result.token1Fee > 0);
  assert.ok(result.feeUsd > result.token0Fee);
});
