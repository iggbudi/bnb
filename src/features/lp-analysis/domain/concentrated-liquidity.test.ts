import assert from 'node:assert/strict';
import test from 'node:test';

import {
  concentratedAmountsAtPrice,
  concentratedPositionForCapital,
  feeGrowthIncrementUsd,
} from './concentrated-liquidity.js';

const Q128 = 1n << 128n;

test('concentrated position starts at the requested capital and becomes one-sided outside range', () => {
  const position = concentratedPositionForCapital({
    capitalUsd: 50,
    priceUsd: 570,
    tickLower: -63560,
    tickUpper: -63358,
  });
  assert.ok(Math.abs(position.valueUsd - 50) < 1e-8);
  assert.ok(position.amount0Tokens > 0);
  assert.ok(position.amount1Tokens > 0);

  const above = concentratedAmountsAtPrice({
    liquidity: position.liquidity,
    tickLower: position.tickLower,
    tickUpper: position.tickUpper,
    priceUsd: position.priceUpperUsd * 1.01,
  });
  assert.ok(above.amount0Tokens > 0);
  assert.equal(above.amount1Tokens, 0);

  const below = concentratedAmountsAtPrice({
    liquidity: position.liquidity,
    tickLower: position.tickLower,
    tickUpper: position.tickUpper,
    priceUsd: position.priceLowerUsd * 0.99,
  });
  assert.equal(below.amount0Tokens, 0);
  assert.ok(below.amount1Tokens > 0);
});

test('fee growth converts raw X128 deltas and applies in-range occupancy', () => {
  const liquidity = 500_000_000_000_000_000_000n;
  const oneUsdtDelta = (Q128 * 1_000_000_000_000_000_000n) / liquidity;
  const oneMilliBnbDelta = (Q128 * 1_000_000_000_000_000n) / liquidity;
  const fee = feeGrowthIncrementUsd({
    liquidity: liquidity.toString(),
    previousFeeGrowth0X128: '100',
    previousFeeGrowth1X128: '200',
    currentFeeGrowth0X128: (100n + oneUsdtDelta).toString(),
    currentFeeGrowth1X128: (200n + oneMilliBnbDelta).toString(),
    token0Decimals: 18,
    token1Decimals: 18,
    priceToken1Usd: 570,
    occupancyFactor: 0.5,
  });

  assert.ok(Math.abs(fee.token0Fee - 0.5) < 1e-12);
  assert.ok(Math.abs(fee.token1Fee - 0.0005) < 1e-12);
  assert.ok(Math.abs(fee.feeUsd - 0.785) < 1e-12);
});
