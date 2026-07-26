import assert from 'node:assert/strict';
import test from 'node:test';

import type { PaperAgentOutcomeDetail } from '../infrastructure/agent-store.js';
import { assessPaperOutcomeEconomics, gasCostUsd } from './outcome-assessment.js';

function outcome(overrides: Partial<PaperAgentOutcomeDetail> = {}): PaperAgentOutcomeDetail {
  return {
    id: 1,
    decisionId: 1,
    horizonHours: 1,
    targetAt: '2026-07-18T13:00:00.000Z',
    evaluatedAt: '2026-07-18T13:00:01.000Z',
    status: 'EVALUATED',
    exitCapturedAt: '2026-07-18T13:00:00.000Z',
    exitPrice: 570,
    snapshotCount: 60,
    estimatedFee: 0.001,
    holdValue: 100,
    lpValueBeforeFee: 100,
    lpValueAfterFee: 100.001,
    ilLoss: 0,
    ilPercent: 0,
    lpProfitLossVsInvestment: 0.001,
    lpReturnPercent: 0.001,
    decisionProfitLoss: 0,
    differenceVsHold: 0.001,
    decisionReward: -0.001,
    regret: 0.001,
    actionCorrect: false,
    note: 'Raw strict outcome.',
    decision: {
      decisionHour: '2026-07-18T12:00:00.000Z',
      createdAt: '2026-07-18T12:00:00.000Z',
      strategyVersion: 'lifecycle-v2.0',
      action: 'WAIT',
      reasonCode: 'DATA_INSUFFICIENT',
      confidence: 'low',
      investment: 100,
      predictedFee24h: 0.03,
      predictedIL24h: 0.01,
      predictedExcessVsHold24h: 0.02,
    },
    assessment: null,
    interpretation: null,
    ...overrides,
  };
}

const gas = {
  entryGasUsd: 0.014,
  exitGasUsd: 0.023,
  gasSource: 'HISTORICAL_ONCHAIN' as const,
};

test('classifies DATA_INSUFFICIENT WAIT as a non-trainable safety abstention', () => {
  const assessment = assessPaperOutcomeEconomics(outcome(), gas, new Date('2026-07-18T13:01:00.000Z'));
  assert.equal(assessment.classification, 'ABSTAINED_SAFETY');
  assert.equal(assessment.trainable, false);
  assert.equal(assessment.economicActionCorrect, null);
  assert.equal(assessment.strictActionCorrect, false);
  assert.ok((assessment.economicDifferenceVsHold ?? 0) < 0);
  assert.ok((assessment.totalLifecycleCostUsd ?? 0) > gas.entryGasUsd + gas.exitGasUsd);
});

test('uses net lifecycle economics and an actionable edge for scored decisions', () => {
  const scored = outcome({
    decision: {
      ...outcome().decision,
      reasonCode: 'FEE_YIELD_TOO_LOW',
    },
  });
  const assessment = assessPaperOutcomeEconomics(scored, gas);
  assert.equal(assessment.classification, 'CORRECT');
  assert.equal(assessment.trainable, true);
  assert.equal(assessment.economicActionCorrect, true);
  assert.ok((assessment.economicReward ?? 0) > 0);
});

test('marks an ENTER incorrect when gross edge does not cover lifecycle costs', () => {
  const entered = outcome({
    decisionProfitLoss: 0.001,
    decision: {
      ...outcome().decision,
      action: 'ENTER_FULL_RANGE',
      reasonCode: 'BASELINE_CONDITIONS_MET',
      confidence: 'high',
    },
  });
  const assessment = assessPaperOutcomeEconomics(entered, gas);
  assert.equal(assessment.classification, 'INCORRECT');
  assert.equal(assessment.economicActionCorrect, false);
  assert.ok((assessment.economicRegret ?? 0) > 0);
});

test('converts gas units and BNB price into USD cost', () => {
  assert.equal(gasCostUsd('50000000', 600_000, 570), 0.0171);
});
