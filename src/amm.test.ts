import assert from 'node:assert/strict';
import test from 'node:test';

import { calculateIL, calculateLPInvestmentProjection } from './amm.js';

test('calculateIL returns equal values when price is unchanged', () => {
  const result = calculateIL(100, 100, 10_000);

  assert.equal(result.holdValue, 10_000);
  assert.equal(result.lpValue, 10_000);
  assert.equal(result.ilLoss, 0);
  assert.equal(result.ilPercent, 0);
});

test('calculateIL values model a 50/50 full-range position', () => {
  const result = calculateIL(100, 50, 10_000);

  assert.equal(result.holdValue, 7_500);
  assert.ok(Math.abs(result.lpValue - 7_071.067811865476) < 1e-9);
  assert.ok(Math.abs(result.ilLoss - 428.93218813452404) < 1e-9);
  assert.ok(Math.abs(result.ilPercent - 5.719095841793653) < 1e-9);
});

test('impermanent loss percentage is symmetric for reciprocal price moves', () => {
  const down = calculateIL(100, 50, 10_000);
  const up = calculateIL(100, 200, 10_000);

  assert.ok(Math.abs(down.ilPercent - up.ilPercent) < 1e-12);
  assert.ok(down.ilLoss >= 0);
  assert.ok(up.ilLoss >= 0);
});

test('calculateLPInvestmentProjection shows profit and loss for a $100 position', () => {
  const result = calculateLPInvestmentProjection(100, 120, 20, 0.05);

  assert.equal(result.initialPrice, 100);
  assert.ok(Math.abs(result.holdValue - 110) < 1e-9);
  assert.ok(Math.abs(result.lpValueBeforeFee - 109.54451150103323) < 1e-9);
  assert.ok(Math.abs(result.lpValueAfterFee - 109.59451150103323) < 1e-9);
  assert.ok(Math.abs(result.profitLossVsInvestment - 9.59451150103323) < 1e-9);
  assert.ok(Math.abs(result.differenceVsHold - -0.40548849896676975) < 1e-9);
});

test('calculateLPInvestmentProjection rejects a price change of -100%', () => {
  assert.throws(() => calculateLPInvestmentProjection(100, 1, -100, 0.01), /valid positive values/);
});
