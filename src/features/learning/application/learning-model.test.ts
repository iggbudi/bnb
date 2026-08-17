import assert from 'node:assert/strict';
import test from 'node:test';

import type { PaperAgentDecisionInput } from '../../paper-agent/index.js';
import {
  applyLearningModel,
  predictLPBeatsHold,
  trainWalkForwardCandidate,
  type LearningExample,
} from './learning-model.js';

function examples(count: number): LearningExample[] {
  return Array.from({ length: count }, (_, index) => {
    const label = (index % 2) as 0 | 1;
    return {
      capturedAt: new Date(Date.parse('2026-01-01T00:00:00.000Z') + index * 60 * 60 * 1_000).toISOString(),
      label,
      baselineAction: 'WAIT',
      features: {
        estimatedAPR: label ? 20 : 1,
        volumeLiquidityRatio: label ? 2 : 0.1,
        priceChange1h: 0,
        priceChange6h: 0,
        priceChange24h: 0,
        history1hPriceChangePercent: 0,
        history1hTvlChangePercent: 0,
        history24hPriceChangePercent: 0,
        history24hTvlChangePercent: 0,
        buyRatio24h: 0.5,
      },
    };
  });
}

const baseline: PaperAgentDecisionInput = {
  decisionHour: '2026-07-18T10:00:00.000Z',
  createdAt: '2026-07-18T10:00:00.000Z',
  strategyVersion: 'baseline-v1.0',
  action: 'WAIT',
  reasonCode: 'FEE_YIELD_TOO_LOW',
  confidence: 'medium',
  rationale: 'Baseline wait.',
  investment: 100,
  referencePrice: 600,
  predictedFee24h: 0.1,
  predictedIL24h: 0.05,
  predictedExcessVsHold24h: 0.05,
  features: {
    ...examples(2)[1]!.features,
    predictedNetEdge7d: 0.05,
    predictedLifecycleCostUsd: 0.02,
  },
};

test('requires at least 336 seven-day verdict examples', () => {
  assert.equal(trainWalkForwardCandidate(examples(335)), null);
});

test('trains a transparent logistic model with purged seven-day walk-forward gates', () => {
  const candidate = trainWalkForwardCandidate(examples(400));

  assert.ok(candidate);
  assert.equal(candidate.eligibleForActivation, true);
  assert.ok(candidate.metrics.validationRows >= 40);
  assert.ok(candidate.metrics.accuracyPercent > candidate.metrics.baselineAccuracyPercent);
  assert.ok(predictLPBeatsHold(candidate.model, examples(2)[1]!.features) > 0.9);
  assert.ok(predictLPBeatsHold(candidate.model, examples(2)[0]!.features) < 0.1);
});

test('active model changes soft baseline decisions but preserves hard safety gates', () => {
  const candidate = trainWalkForwardCandidate(examples(400));
  assert.ok(candidate);

  const learned = applyLearningModel(baseline, 'logistic-v1', candidate.model);
  assert.equal(learned.action, 'ENTER_FULL_RANGE');
  assert.equal(learned.strategyVersion, 'logistic-v1');
  assert.equal(learned.reasonCode, 'LEARNING_MODEL_ENTER');

  const protectedDecision = applyLearningModel(
    { ...baseline, reasonCode: 'DATA_INSUFFICIENT' },
    'logistic-v1',
    candidate.model
  );
  assert.equal(protectedDecision.strategyVersion, 'baseline-v1.0');
  assert.equal(protectedDecision.action, 'WAIT');

  const protectedEconomics = applyLearningModel(
    { ...baseline, reasonCode: 'LIFECYCLE_EDGE_TOO_LOW' },
    'logistic-v1',
    candidate.model
  );
  assert.equal(protectedEconomics.strategyVersion, 'baseline-v1.0');
  assert.equal(protectedEconomics.action, 'WAIT');
});

test('inference applies the lifecycle cost gate: no entry when net edge is below minimum', () => {
  const candidate = trainWalkForwardCandidate(examples(400));
  assert.ok(candidate);

  // Probabilitas tinggi (fitur positif) tetapi net edge tidak menutup biaya -> WAIT.
  const expensive = applyLearningModel(
    { ...baseline, features: { ...baseline.features, predictedNetEdge7d: -0.02 } },
    'logistic-v1',
    candidate.model
  );
  assert.equal(expensive.action, 'WAIT');
  assert.equal(expensive.reasonCode, 'LEARNING_MODEL_WAIT');
  assert.ok(String(expensive.rationale).includes('tidak menutup biaya lifecycle'));

  // Net edge cukup -> ENTER.
  const affordable = applyLearningModel(
    { ...baseline, features: { ...baseline.features, predictedNetEdge7d: 0.05 } },
    'logistic-v1',
    candidate.model
  );
  assert.equal(affordable.action, 'ENTER_FULL_RANGE');
  assert.equal(affordable.reasonCode, 'LEARNING_MODEL_ENTER');
  assert.equal(affordable.features.learningNetEdgeUsd, 0.05);
});

test('class diversity gate scales with sample size and reports positive rate', () => {
  // 400 sampel, 1% positif (4) -> minClass = max(10, 8) = 10 > 4 -> ditolak.
  const sparse = examples(400).map((example, index) => ({
    ...example,
    label: index < 4 ? (1 as const) : (0 as const),
  }));
  const sparseCandidate = trainWalkForwardCandidate(sparse);
  assert.ok(sparseCandidate);
  assert.equal(sparseCandidate.eligibleForActivation, false);
  assert.equal(sparseCandidate.gateReason, 'INSUFFICIENT_CLASS_DIVERSITY');
  assert.equal(sparseCandidate.metrics.positiveRate, 0.01);

  // 400 sampel, 3% positif (12) -> minClass = 10 <= 12 -> keragaman lolos.
  const diverse = examples(400).map((example, index) => ({
    ...example,
    label: index % 33 === 0 ? (1 as const) : (0 as const),
  }));
  const diverseCandidate = trainWalkForwardCandidate(diverse);
  assert.ok(diverseCandidate);
  assert.ok(diverseCandidate.metrics.positiveRows >= 10);
  // Gate keragaman lolos (alasan bukan lagi INSUFFICIENT_CLASS_DIVERSITY);
  // akurasi walk-forward pada fitur acak boleh tetap gagal -> NOT_PASSED.
  assert.notEqual(diverseCandidate.gateReason, 'INSUFFICIENT_CLASS_DIVERSITY');
});
