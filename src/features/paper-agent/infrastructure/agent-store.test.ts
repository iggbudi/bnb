import assert from 'node:assert/strict';
import test from 'node:test';

import { AgentStore, type PaperAgentDecisionInput } from './agent-store.js';

const decision: PaperAgentDecisionInput = {
  decisionHour: '2026-07-18T10:00:00.000Z',
  createdAt: '2026-07-18T10:01:00.000Z',
  strategyVersion: 'baseline-v1.0',
  action: 'WAIT',
  reasonCode: 'DATA_INSUFFICIENT',
  confidence: 'low',
  rationale: 'Coverage belum cukup.',
  investment: 100,
  referencePrice: 600,
  predictedFee24h: 0.01,
  predictedIL24h: 0.02,
  predictedExcessVsHold24h: -0.01,
  features: { history24hCoveragePercent: 50 },
};

test('stores at most one immutable paper decision per hour', () => {
  const store = new AgentStore(':memory:', { initializeSchema: true });

  try {
    const first = store.saveIfAbsent(decision);
    const duplicate = store.saveIfAbsent({
      ...decision,
      action: 'ENTER_FULL_RANGE',
      reasonCode: 'SHOULD_NOT_REPLACE',
    });

    assert.equal(first.created, true);
    assert.equal(duplicate.created, false);
    assert.equal(duplicate.decision.action, 'WAIT');
    assert.equal(store.count(), 1);
    assert.deepEqual(store.getRecent(5)[0]?.features, decision.features);
  } finally {
    store.close();
  }
});

test('stores one outcome per decision and horizon and removes it from due work', () => {
  const store = new AgentStore(':memory:', { initializeSchema: true });

  try {
    const savedDecision = store.saveIfAbsent(decision).decision;
    assert.equal(store.getDueDecisions(1, new Date('2026-07-18T11:02:00.000Z')).length, 1);

    const outcome = {
      decisionId: savedDecision.id,
      horizonHours: 1 as const,
      targetAt: '2026-07-18T11:01:00.000Z',
      evaluatedAt: '2026-07-18T11:02:00.000Z',
      status: 'EVALUATED' as const,
      exitCapturedAt: '2026-07-18T11:01:00.000Z',
      exitPrice: 601,
      snapshotCount: 60,
      estimatedFee: 0.01,
      holdValue: 100.08,
      lpValueBeforeFee: 100.08,
      lpValueAfterFee: 100.09,
      ilLoss: 0.001,
      ilPercent: 0.001,
      lpProfitLossVsInvestment: 0.09,
      lpReturnPercent: 0.09,
      decisionProfitLoss: 0,
      differenceVsHold: 0.01,
      decisionReward: -0.01,
      regret: 0.01,
      actionCorrect: false,
      note: 'Evaluasi test.',
    };

    const savedOutcome = store.saveOutcomeIfAbsent(outcome).outcome;
    assert.equal(store.saveOutcomeIfAbsent(outcome).created, false);
    assert.equal(store.saveOutcomeIfAbsent({ ...outcome, note: 'Tidak boleh menimpa.' }).created, false);
    store.saveOutcomeAssessmentIfAbsent({
      outcomeId: savedOutcome.id,
      assessedAt: '2026-07-18T11:02:01.000Z',
      version: 'economic-v1.0',
      classification: 'INCORRECT',
      trainable: true,
      safetyAbstention: false,
      strictActionCorrect: false,
      economicActionCorrect: false,
      grossDifferenceVsHold: 0.01,
      estimatedEntryGasUsd: 0.01,
      estimatedExitGasUsd: 0.01,
      estimatedSlippageUsd: 0.005,
      totalLifecycleCostUsd: 0.025,
      economicDifferenceVsHold: -0.015,
      minimumActionableEdgeUsd: 0.01,
      economicReward: -0.015,
      economicRegret: 0.015,
      gasSource: 'HISTORICAL_ONCHAIN',
      rationale: 'Test assessment.',
    });
    store.saveOutcomeInterpretationIfAbsent({
      outcomeId: savedOutcome.id,
      interpretedAt: '2026-07-18T11:02:02.000Z',
      version: 'lifecycle-v2.0',
      role: 'EARLY_DIAGNOSTIC',
      classification: 'DIAGNOSTIC_EARLY',
      accuracyEligible: false,
      trainable: false,
      economicActionCorrect: null,
      grossDifferenceVsHold: 0.01,
      estimatedEntryGasUsd: 0.01,
      estimatedExitGasUsd: 0.01,
      applicableSwapSlippageUsd: 0,
      totalLifecycleCostUsd: 0.02,
      economicDifferenceVsHold: -0.01,
      minimumActionableEdgeUsd: 0.01,
      economicReward: null,
      economicRegret: null,
      gasSource: 'HISTORICAL_ONCHAIN',
      transactionPath: 'BALANCED_TOKENS_MINT_WITHDRAW',
      rationale: 'Early diagnostic test.',
    });
    assert.equal(store.getDueDecisions(1, new Date('2026-07-18T11:03:00.000Z')).length, 0);
    assert.equal(store.getRecentOutcomes(1)[0]?.note, 'Evaluasi test.');
    assert.equal(store.getOutcomeDetails(1, 1)[0]?.decision.action, 'WAIT');
    assert.deepEqual(store.outcomeCounts(), { total: 1, evaluated: 1, skipped: 0 });

    const performance = store.getPerformance(1);
    assert.equal(performance.evaluated, 1);
    assert.equal(performance.correct, 0);
    assert.equal(performance.accuracyPercent, null);
    assert.equal(performance.waitCount, 1);
    assert.equal(performance.cumulativeDecisionProfitLoss, 0);
    assert.equal(performance.scored, 0);
    assert.equal(performance.diagnostic, 1);
    assert.equal(performance.abstained, 0);
    assert.equal(performance.strictAccuracyPercent, 0);
    assert.equal(performance.cumulativeRegret, 0);

    const outcome168 = store.saveOutcomeIfAbsent({
      ...outcome,
      horizonHours: 168,
      targetAt: '2026-07-25T10:01:00.000Z',
      evaluatedAt: '2026-07-25T10:02:00.000Z',
    }).outcome;
    store.saveOutcomeAssessmentIfAbsent({
      outcomeId: outcome168.id,
      assessedAt: '2026-07-25T10:02:01.000Z',
      version: 'economic-v1.0',
      classification: 'INCORRECT',
      trainable: true,
      safetyAbstention: false,
      strictActionCorrect: false,
      economicActionCorrect: false,
      grossDifferenceVsHold: 0.01,
      estimatedEntryGasUsd: 0.01,
      estimatedExitGasUsd: 0.01,
      estimatedSlippageUsd: 0.005,
      totalLifecycleCostUsd: 0.025,
      economicDifferenceVsHold: 0.02,
      minimumActionableEdgeUsd: 0.01,
      economicReward: -0.02,
      economicRegret: 0.02,
      gasSource: 'HISTORICAL_ONCHAIN',
      rationale: 'Legacy 168h test assessment.',
    });
    store.saveOutcomeInterpretationIfAbsent({
      outcomeId: outcome168.id,
      interpretedAt: '2026-07-25T10:02:02.000Z',
      version: 'lifecycle-v2.0',
      role: 'ENTRY_VERDICT',
      classification: 'INCORRECT',
      accuracyEligible: true,
      trainable: true,
      economicActionCorrect: false,
      // gross positif namun economic negatif: label training memakai GROSS
      // (model belajar edge bruto; biaya lifecycle diterapkan di inferensi).
      grossDifferenceVsHold: 0.04,
      estimatedEntryGasUsd: 0.01,
      estimatedExitGasUsd: 0.01,
      applicableSwapSlippageUsd: 0,
      totalLifecycleCostUsd: 0.06,
      economicDifferenceVsHold: -0.02,
      minimumActionableEdgeUsd: 0.01,
      economicReward: -0.02,
      economicRegret: 0.02,
      gasSource: 'HISTORICAL_ONCHAIN',
      transactionPath: 'BALANCED_TOKENS_MINT_WITHDRAW',
      rationale: '168h entry verdict test.',
    });
    const learningExamples = store.getLearningExamples();
    assert.equal(learningExamples.length, 1);
    assert.equal(learningExamples[0]?.label, 1);
    assert.equal(learningExamples[0]?.baselineAction, 'WAIT');
    assert.equal(store.getOutcomesPendingReflection().length, 1);
    assert.deepEqual(store.outcomeCounts(), { total: 2, evaluated: 2, skipped: 0 });
    assert.deepEqual(store.outcomeCounts(1), { total: 1, evaluated: 1, skipped: 0 });
    assert.deepEqual(store.outcomeCounts(168), { total: 1, evaluated: 1, skipped: 0 });
    assert.deepEqual(store.outcomeCounts(6), { total: 0, evaluated: 0, skipped: 0 });

    const reflection = {
      decisionId: savedDecision.id,
      outcomeId: outcome168.id,
      createdAt: '2026-07-25T10:03:00.000Z',
      model: 'test-model',
      promptVersion: '1.0',
      assessment: 'incorrect' as const,
      confidence: 'medium' as const,
      summary: 'WAIT tidak mengungguli keputusan counterfactual.',
      predictionErrorAnalysis: 'Fee diprediksi terlalu rendah.',
      whatWorked: ['Hard safety tetap aktif.'],
      whatFailed: ['Prediksi fee meleset.'],
      lesson: 'Pantau akselerasi volume satu jam.',
      futureChecks: ['Bandingkan volume.', 'Ukur error fee.'],
    };
    assert.equal(store.saveReflectionIfAbsent(reflection).created, true);
    assert.equal(store.saveReflectionIfAbsent(reflection).created, false);
    assert.equal(store.getOutcomesPendingReflection().length, 0);
    assert.equal(store.reflectionCount(), 1);
    assert.equal(store.getRecentReflections(1)[0]?.lesson, reflection.lesson);
  } finally {
    store.close();
  }
});

test('excludes safety abstentions from accuracy, learning, and reflection queues', () => {
  const store = new AgentStore(':memory:', { initializeSchema: true });
  try {
    const savedDecision = store.saveIfAbsent(decision).decision;
    const outcome = store.saveOutcomeIfAbsent({
      decisionId: savedDecision.id,
      horizonHours: 168,
      targetAt: '2026-07-25T10:01:00.000Z',
      evaluatedAt: '2026-07-25T10:02:00.000Z',
      status: 'EVALUATED',
      exitCapturedAt: '2026-07-19T10:01:00.000Z',
      exitPrice: 601,
      snapshotCount: 1_440,
      estimatedFee: 0.02,
      holdValue: 100.08,
      lpValueBeforeFee: 100.08,
      lpValueAfterFee: 100.1,
      ilLoss: 0.001,
      ilPercent: 0.001,
      lpProfitLossVsInvestment: 0.1,
      lpReturnPercent: 0.1,
      decisionProfitLoss: 0,
      differenceVsHold: 0.02,
      decisionReward: -0.02,
      regret: 0.02,
      actionCorrect: false,
      note: 'Raw strict outcome.',
    }).outcome;
    store.saveOutcomeAssessmentIfAbsent({
      outcomeId: outcome.id,
      assessedAt: '2026-07-19T10:02:01.000Z',
      version: 'economic-v1.0',
      classification: 'ABSTAINED_SAFETY',
      trainable: false,
      safetyAbstention: true,
      strictActionCorrect: false,
      economicActionCorrect: null,
      grossDifferenceVsHold: 0.02,
      estimatedEntryGasUsd: 0.01,
      estimatedExitGasUsd: 0.02,
      estimatedSlippageUsd: 0.1,
      totalLifecycleCostUsd: 0.13,
      economicDifferenceVsHold: -0.11,
      minimumActionableEdgeUsd: 0.01,
      economicReward: null,
      economicRegret: null,
      gasSource: 'HISTORICAL_ONCHAIN',
      rationale: 'Legacy safety abstention test.',
    });
    store.saveOutcomeInterpretationIfAbsent({
      outcomeId: outcome.id,
      interpretedAt: '2026-07-25T10:02:02.000Z',
      version: 'lifecycle-v2.0',
      role: 'SAFETY_ABSTENTION',
      classification: 'ABSTAINED_SAFETY',
      accuracyEligible: false,
      trainable: false,
      economicActionCorrect: null,
      grossDifferenceVsHold: 0.02,
      estimatedEntryGasUsd: 0.01,
      estimatedExitGasUsd: 0.02,
      applicableSwapSlippageUsd: 0,
      totalLifecycleCostUsd: 0.03,
      economicDifferenceVsHold: -0.01,
      minimumActionableEdgeUsd: 0.01,
      economicReward: null,
      economicRegret: null,
      gasSource: 'HISTORICAL_ONCHAIN',
      transactionPath: 'BALANCED_TOKENS_MINT_WITHDRAW',
      rationale: 'Safety abstention test.',
    });

    const performance = store.getPerformance(168);
    assert.equal(performance.evaluated, 1);
    assert.equal(performance.scored, 0);
    assert.equal(performance.abstained, 1);
    assert.equal(performance.accuracyPercent, null);
    assert.equal(performance.strictAccuracyPercent, 0);
    assert.equal(store.getLearningExamples().length, 0);
    assert.equal(store.getOutcomesPendingReflection().length, 0);
    assert.equal(store.pendingReflectionCount(), 0);
  } finally {
    store.close();
  }
});

test('versions learning models and keeps only one active model', () => {
  const store = new AgentStore(':memory:', { initializeSchema: true });
  const model = {
    featureNames: ['estimatedAPR'] as const,
    means: [5],
    standardDeviations: [2],
    weights: [1],
    bias: 0,
    decisionThreshold: 0.55,
  };

  try {
    store.saveModel({
      version: 'logistic-v1',
      trainedAt: '2026-07-18T10:00:00.000Z',
      status: 'ACTIVE',
      trainingRows: 100,
      validationRows: 40,
      accuracyPercent: 60,
      baselineAccuracyPercent: 55,
      brierScore: 0.2,
      positiveRows: 50,
      negativeRows: 50,
      gateReason: 'WALK_FORWARD_GATES_PASSED',
      model: model as never,
      activatedAt: '2026-07-18T10:00:00.000Z',
    });
    store.saveModel({
      version: 'logistic-v2',
      trainedAt: '2026-07-19T10:00:00.000Z',
      status: 'ACTIVE',
      trainingRows: 124,
      validationRows: 50,
      accuracyPercent: 63,
      baselineAccuracyPercent: 55,
      brierScore: 0.18,
      positiveRows: 62,
      negativeRows: 62,
      gateReason: 'WALK_FORWARD_GATES_PASSED',
      model: model as never,
      activatedAt: '2026-07-19T10:00:00.000Z',
    });

    assert.equal(store.getActiveModel()?.version, 'logistic-v2');
    assert.equal(store.getRecentModels(2)[1]?.status, 'SUPERSEDED');
  } finally {
    store.close();
  }
});
