import assert from 'node:assert/strict';
import test from 'node:test';

import { buildHighRiskStrategyPlan, type HighRiskStrategyInput } from './high-risk-strategy.js';

const input: HighRiskStrategyInput = {
  investment: 100,
  currentPrice: 570,
  volume24h: 48_500_000,
  conservativeVolume24h: 48_500_000,
  poolFeeRate: 0.0001,
  activeLiquidity: '5250000000000000000000000',
  sqrtPriceX96: '3317521175930763235976231709',
  currentTick: -63459,
  tickSpacing: 1,
  token0Decimals: 18,
  token1Decimals: 18,
  protocolFeeShareToken0Bps: 3300,
  protocolFeeShareToken1Bps: 3300,
  entryGasUsd: 0.017,
  exitGasUsd: 0.023,
  historyWindowHours: 168,
  historyCoveragePercent: 100,
  historyPrices: Array.from({ length: 168 }, () => 570),
  rangeCandidatesPercent: [0.4, 0.5, 1],
};

test('selects the widest concentrated range that still meets the monthly target', () => {
  const plan = buildHighRiskStrategyPlan(input);

  assert.equal(plan.status, 'CANDIDATE_FOUND');
  assert.equal(plan.advisoryAction, 'PAPER_TEST_CONCENTRATED');
  assert.equal(plan.executionEnabled, false);
  assert.equal(plan.selectedRange?.rangePercent, 0.5);
  assert.ok((plan.selectedRange?.projectedNetReturn30dPercent ?? 0) >= 10);
  assert.equal(plan.selectedRange?.historicalOccupancyPercent, 100);
  assert.ok(Math.abs((plan.selectedRange?.plannedLifecycleCostUsd ?? 0) - 0.6) < 1e-12);
});

test('deducts protocol fee, volume and retention haircuts, gas, and recenter slippage', () => {
  const withProtocolFee = buildHighRiskStrategyPlan({
    ...input,
    conservativeVolume24h: input.volume24h / 2,
  });
  const withoutProtocolFee = buildHighRiskStrategyPlan({
    ...input,
    conservativeVolume24h: input.volume24h / 2,
    protocolFeeShareToken0Bps: 0,
    protocolFeeShareToken1Bps: 0,
  });
  const candidate = withProtocolFee.candidates[0]!;

  assert.equal(withProtocolFee.historyWindowHours, 168);
  assert.equal(withProtocolFee.volumeHaircutFactor, 0.5);
  assert.ok(withoutProtocolFee.candidates[0]!.idealFee30dUsd > candidate.idealFee30dUsd);
  assert.ok(candidate.retainedFee30dUsd < candidate.idealFee30dUsd);
  assert.ok(
    Math.abs(
      candidate.projectedNetProfit30dUsd - (candidate.retainedFee30dUsd - candidate.plannedLifecycleCostUsd)
    ) < 1e-12
  );
  assert.ok(candidate.stressDown5ReturnPercent < -4);
  assert.ok(candidate.stressUp5ReturnPercent < 1);
});

test('refuses a recommendation when history coverage is insufficient', () => {
  const plan = buildHighRiskStrategyPlan({
    ...input,
    historyCoveragePercent: 50,
  });

  assert.equal(plan.status, 'DATA_INSUFFICIENT');
  assert.equal(plan.advisoryAction, 'WAIT');
  assert.equal(plan.selectedRange, null);
});

test('reports an infeasible target when conservative volume cannot cover costs', () => {
  const plan = buildHighRiskStrategyPlan({
    ...input,
    volume24h: 50_000_000,
    conservativeVolume24h: 100_000,
  });

  assert.equal(plan.status, 'TARGET_NOT_FEASIBLE');
  assert.equal(plan.advisoryAction, 'WAIT');
  assert.equal(plan.selectedRange, null);
});
