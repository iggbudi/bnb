import assert from 'node:assert/strict';
import test from 'node:test';

import type { PaperAgentDecision } from '../infrastructure/agent-store.js';
import { evaluatePaperDecision, makeSkippedPaperOutcome } from './paper-agent-evaluator.js';
import type { PoolSnapshot } from '../../market-data/index.js';

const observedFee = {
  amountUsd: 1,
  token0Fee: 0.5,
  token1Fee: 0.001,
  liquidity: '1000000000000000000',
  entryBlockNumber: 100,
  exitBlockNumber: 200,
  accountingVersion: 'v3-fee-growth-v1',
};

const decision: PaperAgentDecision = {
  id: 1,
  decisionHour: '2026-07-18T10:00:00.000Z',
  createdAt: '2026-07-18T10:00:00.000Z',
  strategyVersion: 'baseline-v1.0',
  action: 'ENTER_FULL_RANGE',
  reasonCode: 'BASELINE_CONDITIONS_MET',
  confidence: 'high',
  rationale: 'Kondisi memenuhi baseline.',
  investment: 100,
  referencePrice: 100,
  predictedFee24h: 1,
  predictedIL24h: 0.4,
  predictedExcessVsHold24h: 0.6,
  features: {},
};

function snapshot(minute: number, volume1h = 100_000_000): PoolSnapshot {
  return {
    capturedAt: new Date(Date.parse('2026-07-18T10:00:00.000Z') + minute * 60_000).toISOString(),
    pairAddress: '0xpool',
    price: minute === 60 ? 120 : 100 + minute / 3,
    tvl: 1_000_000,
    volume24h: volume1h * 24,
    volume6h: volume1h * 6,
    volume1h,
    volLiqRatio: 1,
    estimatedFees24h: volume1h * 24 * 0.0001,
    estimatedAPR: 10,
    priceChange1h: 1,
    priceChange6h: 2,
    priceChange24h: 3,
    txns24h: { buys: 100, sells: 100 },
    wbnbInPool: 1_000,
    usdtInPool: 500_000,
  };
}

test('evaluates an ENTER decision against HOLD after one hour', () => {
  const snapshots = Array.from({ length: 60 }, (_, index) => snapshot(index + 1));
  const outcome = evaluatePaperDecision(
    decision,
    1,
    snapshots[59]!,
    snapshots,
    observedFee,
    new Date('2026-07-18T11:01:00.000Z')
  );

  assert.equal(outcome.status, 'EVALUATED');
  assert.equal(outcome.snapshotCount, 60);
  assert.ok(Math.abs((outcome.estimatedFee ?? 0) - 1) < 1e-12);
  assert.ok((outcome.differenceVsHold ?? 0) > 0);
  assert.equal(outcome.actionCorrect, true);
  assert.equal(outcome.regret, 0);
  assert.equal(outcome.decisionProfitLoss, outcome.lpProfitLossVsInvestment);
});

test('evaluates WAIT as correct when counterfactual LP underperforms HOLD', () => {
  const snapshots = Array.from({ length: 60 }, (_, index) => snapshot(index + 1, 100_000));
  const outcome = evaluatePaperDecision({ ...decision, action: 'WAIT' }, 1, snapshots[59]!, snapshots, {
    ...observedFee,
    amountUsd: 0.001,
  });

  assert.ok((outcome.differenceVsHold ?? 0) < 0);
  assert.equal(outcome.actionCorrect, true);
  assert.equal(outcome.decisionProfitLoss, 0);
  assert.ok((outcome.decisionReward ?? 0) > 0);
});

test('creates a non-trainable skipped outcome for a history gap', () => {
  const outcome = makeSkippedPaperOutcome(
    decision,
    6,
    new Date('2026-07-18T16:20:00.000Z'),
    10,
    'Coverage tidak cukup.'
  );

  assert.equal(outcome.status, 'SKIPPED_DATA_GAP');
  assert.equal(outcome.actionCorrect, null);
  assert.equal(outcome.lpProfitLossVsInvestment, null);
});
