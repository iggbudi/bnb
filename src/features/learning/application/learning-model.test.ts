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
  features: examples(2)[1]!.features,
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
