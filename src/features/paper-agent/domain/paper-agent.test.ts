import assert from 'node:assert/strict';
import test from 'node:test';

import { makeBaselinePaperDecision, type PaperAgentMarketInput } from './paper-agent.js';
import type { HistoricalPeriodStats } from '../../../snapshot-store.js';

const market: PaperAgentMarketInput = {
  price: 600,
  tvl: 1_000_000,
  volume1h: 50_000,
  volume6h: 250_000,
  volume24h: 1_000_000,
  volLiqRatio: 1,
  estimatedFees24h: 100,
  estimatedAPR: 3.65,
  priceChange1h: 0.1,
  priceChange6h: 0.2,
  priceChange24h: 0.2,
  buys24h: 550,
  sells24h: 450,
};

function period(label: HistoricalPeriodStats['label'], coveragePercent: number): HistoricalPeriodStats {
  const hours = { '1h': 1, '24h': 24, '7d': 168, '30d': 720 }[label];
  return {
    label,
    hours,
    count: Math.round((hours * 60 * coveragePercent) / 100),
    expectedCount: hours * 60,
    coveragePercent,
    firstCapturedAt: '2026-07-01T00:00:00.000Z',
    latestCapturedAt: '2026-07-02T00:00:00.000Z',
    price: { first: 599, latest: 600, min: 598, max: 601, average: 599.5, changePercent: 0.17 },
    tvl: {
      first: 1_000_000,
      latest: 1_000_000,
      min: 990_000,
      max: 1_010_000,
      average: 1_000_000,
      changePercent: 0,
    },
    volume24h: { average: 1_000_000, min: 900_000, max: 1_100_000 },
    estimatedAPR: { average: 3.65, min: 3, max: 4 },
  };
}

const completeHistory = [period('1h', 100), period('24h', 100), period('7d', 100), period('30d', 25)];
const economics = {
  entryGasUsd: 0.017,
  exitGasUsd: 0.023,
  applicableSwapSlippageUsd: 0,
  projectedFee24hOnchain: 0.01,
  transactionPath: 'BALANCED_TOKENS_MINT_WITHDRAW' as const,
};

test('lifecycle paper agent waits until seven-day history coverage is sufficient', () => {
  const decision = makeBaselinePaperDecision(
    market,
    [period('1h', 100), period('24h', 100), period('7d', 50)],
    economics,
    new Date('2026-07-18T10:37:00.000Z')
  );

  assert.equal(decision.action, 'WAIT');
  assert.equal(decision.reasonCode, 'DATA_INSUFFICIENT');
  assert.equal(decision.confidence, 'low');
  assert.equal(decision.decisionHour, '2026-07-18T10:00:00.000Z');
});

test('lifecycle paper agent enters only when conservative seven-day net edge passes', () => {
  const decision = makeBaselinePaperDecision(
    { ...market, estimatedFees24h: 1_000 },
    completeHistory,
    { ...economics, projectedFee24hOnchain: 0.1 },
    new Date('2026-07-18T11:01:00.000Z')
  );

  assert.equal(decision.action, 'ENTER_FULL_RANGE');
  assert.equal(decision.reasonCode, 'LIFECYCLE_CONDITIONS_MET');
  assert.equal(decision.investment, 100);
  assert.equal(decision.confidence, 'high');
  assert.ok(Number(decision.features.predictedNetEdge7d) >= 0.01);
  assert.equal(decision.features.transactionPath, 'BALANCED_TOKENS_MINT_WITHDRAW');
});

test('baseline paper agent waits when volatility exceeds its safety limit', () => {
  const decision = makeBaselinePaperDecision({ ...market, priceChange1h: 3.1 }, completeHistory, economics);

  assert.equal(decision.action, 'WAIT');
  assert.equal(decision.reasonCode, 'VOLATILITY_TOO_HIGH');
});

test('lifecycle paper agent waits when seven-day net edge does not cover costs and materiality', () => {
  const decision = makeBaselinePaperDecision(market, completeHistory, economics);
  assert.equal(decision.action, 'WAIT');
  assert.equal(decision.reasonCode, 'LIFECYCLE_EDGE_TOO_LOW');
  assert.ok(Number(decision.features.predictedNetEdge7d) < 0.01);
});

test('lifecycle paper agent fails closed when on-chain costs are unavailable', () => {
  const decision = makeBaselinePaperDecision({ ...market, estimatedFees24h: 1_000 }, completeHistory, null);
  assert.equal(decision.action, 'WAIT');
  assert.equal(decision.reasonCode, 'ONCHAIN_COST_UNAVAILABLE');
});
