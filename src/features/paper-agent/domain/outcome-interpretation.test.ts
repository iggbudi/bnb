import assert from 'node:assert/strict';
import test from 'node:test';

import type { PaperAgentOutcomeDetail } from '../infrastructure/agent-store.js';
import { interpretPaperOutcomeLifecycle } from './outcome-interpretation.js';

function outcome(
  horizonHours: 1 | 6 | 24 | 168,
  action: 'WAIT' | 'ENTER_FULL_RANGE'
): PaperAgentOutcomeDetail {
  return {
    id: horizonHours,
    decisionId: 1,
    horizonHours,
    targetAt: '2026-07-25T10:00:00.000Z',
    evaluatedAt: '2026-07-25T10:00:01.000Z',
    status: 'EVALUATED',
    exitCapturedAt: '2026-07-25T10:00:00.000Z',
    exitPrice: 570,
    snapshotCount: horizonHours * 60,
    estimatedFee: 0.2,
    holdValue: 100,
    lpValueBeforeFee: 100,
    lpValueAfterFee: 100.2,
    ilLoss: 0,
    ilPercent: 0,
    lpProfitLossVsInvestment: 0.2,
    lpReturnPercent: 0.2,
    decisionProfitLoss: action === 'ENTER_FULL_RANGE' ? 0.2 : 0,
    differenceVsHold: 0.2,
    decisionReward: 0.2,
    regret: 0,
    actionCorrect: true,
    note: 'Raw outcome.',
    decision: {
      decisionHour: '2026-07-18T10:00:00.000Z',
      createdAt: '2026-07-18T10:00:00.000Z',
      strategyVersion: 'lifecycle-v2.1',
      action,
      reasonCode: action === 'WAIT' ? 'FEE_YIELD_TOO_LOW' : 'LIFECYCLE_CONDITIONS_MET',
      confidence: 'high',
      investment: 100,
      predictedFee24h: 0.03,
      predictedIL24h: 0.01,
      predictedExcessVsHold24h: 0.02,
    },
    assessment: null,
    interpretation: null,
  };
}

const gas = {
  entryGasUsd: 0.017,
  exitGasUsd: 0.023,
  gasSource: 'HISTORICAL_ONCHAIN' as const,
};

test('treats 1h, 6h, and 24h outcomes as non-trainable diagnostics', () => {
  for (const horizon of [1, 6, 24] as const) {
    const interpreted = interpretPaperOutcomeLifecycle(outcome(horizon, 'ENTER_FULL_RANGE'), gas);
    assert.equal(interpreted.role, 'EARLY_DIAGNOSTIC');
    assert.equal(interpreted.classification, 'DIAGNOSTIC_EARLY');
    assert.equal(interpreted.accuracyEligible, false);
    assert.equal(interpreted.trainable, false);
    assert.equal(interpreted.economicActionCorrect, null);
  }
});

test('uses the 168h net outcome as the entry verdict', () => {
  const interpreted = interpretPaperOutcomeLifecycle(outcome(168, 'ENTER_FULL_RANGE'), gas);
  assert.equal(interpreted.role, 'ENTRY_VERDICT');
  assert.equal(interpreted.classification, 'CORRECT');
  assert.equal(interpreted.accuracyEligible, true);
  assert.equal(interpreted.trainable, true);
  assert.equal(interpreted.economicDifferenceVsHold, 0.16);
});

test('costs only transaction-path gas and no implicit whole-notional swap slippage', () => {
  const interpreted = interpretPaperOutcomeLifecycle(outcome(168, 'ENTER_FULL_RANGE'), gas);
  assert.equal(interpreted.transactionPath, 'BALANCED_TOKENS_MINT_WITHDRAW');
  assert.equal(interpreted.applicableSwapSlippageUsd, 0);
  assert.equal(interpreted.totalLifecycleCostUsd, 0.04);
});

test('keeps legacy and pre-fee-growth signals diagnostic even at 168h', () => {
  for (const strategyVersion of ['baseline-v1.0', 'lifecycle-v2.0']) {
    const value = outcome(168, 'ENTER_FULL_RANGE');
    value.decision.strategyVersion = strategyVersion;
    const interpreted = interpretPaperOutcomeLifecycle(value, gas);
    assert.equal(interpreted.role, 'EARLY_DIAGNOSTIC');
    assert.equal(interpreted.accuracyEligible, false);
    assert.equal(interpreted.trainable, false);
  }
});

test('keeps safety waits outside the seven-day verdict denominator', () => {
  const value = outcome(168, 'WAIT');
  value.decision.reasonCode = 'DATA_INSUFFICIENT';
  const interpreted = interpretPaperOutcomeLifecycle(value, gas);
  assert.equal(interpreted.role, 'SAFETY_ABSTENTION');
  assert.equal(interpreted.classification, 'ABSTAINED_SAFETY');
  assert.equal(interpreted.accuracyEligible, false);
});
