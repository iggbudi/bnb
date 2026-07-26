import type { PaperAgentDecisionInput } from '../../../agent-store.js';

export const LEARNING_FEATURE_NAMES = [
  'estimatedAPR',
  'volumeLiquidityRatio',
  'priceChange1h',
  'priceChange6h',
  'priceChange24h',
  'history1hPriceChangePercent',
  'history1hTvlChangePercent',
  'history24hPriceChangePercent',
  'history24hTvlChangePercent',
  'history7dPriceChangePercent',
  'history7dPriceRangePercent',
  'predictedFee7d',
  'predictedIL7d',
  'predictedLifecycleCostUsd',
  'predictedNetEdge7d',
  'buyRatio24h',
] as const;

export type LearningFeatureName = (typeof LEARNING_FEATURE_NAMES)[number];

export interface LearningExample {
  capturedAt: string;
  features: Record<string, unknown>;
  label: 0 | 1;
  baselineAction: 'WAIT' | 'ENTER_FULL_RANGE';
}

export interface LogisticModelData {
  featureNames: LearningFeatureName[];
  means: number[];
  standardDeviations: number[];
  weights: number[];
  bias: number;
  decisionThreshold: number;
}

export interface WalkForwardMetrics {
  validationRows: number;
  accuracyPercent: number;
  baselineAccuracyPercent: number;
  brierScore: number;
  positiveRows: number;
  negativeRows: number;
}

export interface LearningCandidate {
  model: LogisticModelData;
  metrics: WalkForwardMetrics;
  eligibleForActivation: boolean;
  gateReason: string;
}

export const MIN_TRAINING_ROWS = 336;
export const RETRAIN_EVERY_NEW_OUTCOMES = 24;
const MIN_CLASS_ROWS = 10;
const DECISION_THRESHOLD = 0.55;

function finiteFeature(features: Record<string, unknown>, name: LearningFeatureName): number {
  const value = Number(features[name]);
  return Number.isFinite(value) ? value : 0;
}

function sigmoid(value: number): number {
  if (value >= 0) {
    const exp = Math.exp(-value);
    return 1 / (1 + exp);
  }
  const exp = Math.exp(value);
  return exp / (1 + exp);
}

function fitLogisticModel(examples: LearningExample[]): LogisticModelData {
  const vectors = examples.map(example =>
    LEARNING_FEATURE_NAMES.map(name => finiteFeature(example.features, name))
  );
  const means = LEARNING_FEATURE_NAMES.map(
    (_, index) => vectors.reduce((sum, vector) => sum + vector[index]!, 0) / vectors.length
  );
  const standardDeviations = LEARNING_FEATURE_NAMES.map((_, index) => {
    const variance =
      vectors.reduce((sum, vector) => {
        const delta = vector[index]! - means[index]!;
        return sum + delta * delta;
      }, 0) / vectors.length;
    return Math.max(1e-9, Math.sqrt(variance));
  });
  const normalized = vectors.map(vector =>
    vector.map((value, index) => (value - means[index]!) / standardDeviations[index]!)
  );

  const weights = new Array<number>(LEARNING_FEATURE_NAMES.length).fill(0);
  let bias = 0;
  const learningRate = 0.05;
  const l2 = 0.01;

  for (let epoch = 0; epoch < 500; epoch++) {
    const weightGradients = new Array<number>(weights.length).fill(0);
    let biasGradient = 0;

    for (let row = 0; row < normalized.length; row++) {
      const vector = normalized[row]!;
      const logit = bias + weights.reduce((sum, weight, index) => sum + weight * vector[index]!, 0);
      const error = sigmoid(logit) - examples[row]!.label;
      biasGradient += error;
      for (let index = 0; index < weights.length; index++) {
        weightGradients[index] += error * vector[index]!;
      }
    }

    bias -= (learningRate * biasGradient) / normalized.length;
    for (let index = 0; index < weights.length; index++) {
      const gradient = weightGradients[index]! / normalized.length + l2 * weights[index]!;
      weights[index] -= learningRate * gradient;
    }
  }

  return {
    featureNames: [...LEARNING_FEATURE_NAMES],
    means,
    standardDeviations,
    weights,
    bias,
    decisionThreshold: DECISION_THRESHOLD,
  };
}

export function predictLPBeatsHold(model: LogisticModelData, features: Record<string, unknown>): number {
  const logit =
    model.bias +
    model.featureNames.reduce((sum, name, index) => {
      const normalized =
        (finiteFeature(features, name) - model.means[index]!) / model.standardDeviations[index]!;
      return sum + model.weights[index]! * normalized;
    }, 0);
  return sigmoid(logit);
}

export function trainWalkForwardCandidate(examples: LearningExample[]): LearningCandidate | null {
  if (examples.length < MIN_TRAINING_ROWS) return null;

  const sorted = [...examples].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
  const positiveRows = sorted.filter(example => example.label === 1).length;
  const negativeRows = sorted.length - positiveRows;
  const finalModel = fitLogisticModel(sorted);

  if (positiveRows < MIN_CLASS_ROWS || negativeRows < MIN_CLASS_ROWS) {
    return {
      model: finalModel,
      metrics: {
        validationRows: 0,
        accuracyPercent: 0,
        baselineAccuracyPercent: 0,
        brierScore: 1,
        positiveRows,
        negativeRows,
      },
      eligibleForActivation: false,
      gateReason: 'INSUFFICIENT_CLASS_DIVERSITY',
    };
  }

  const initialTrainingRows = Math.floor(sorted.length * 0.6);
  const blockSize = Math.max(1, Math.floor((sorted.length - initialTrainingRows) / 4));
  const purgeRows = 168; // Prevent overlapping seven-day labels from leaking into the next fold.
  const predictions: Array<{ probability: number; label: 0 | 1; baseline: 0 | 1 }> = [];

  for (let start = initialTrainingRows; start < sorted.length; start += blockSize) {
    const training = sorted.slice(0, Math.max(1, start - purgeRows));
    const validation = sorted.slice(start, Math.min(sorted.length, start + blockSize));
    if (validation.length === 0) break;
    const foldModel = fitLogisticModel(training);
    for (const example of validation) {
      predictions.push({
        probability: predictLPBeatsHold(foldModel, example.features),
        label: example.label,
        baseline: example.baselineAction === 'ENTER_FULL_RANGE' ? 1 : 0,
      });
    }
  }

  const modelCorrect = predictions.filter(
    item => (item.probability >= DECISION_THRESHOLD ? 1 : 0) === item.label
  ).length;
  const baselineCorrect = predictions.filter(item => item.baseline === item.label).length;
  const accuracyPercent = (modelCorrect / predictions.length) * 100;
  const baselineAccuracyPercent = (baselineCorrect / predictions.length) * 100;
  const brierScore =
    predictions.reduce((sum, item) => sum + (item.probability - item.label) ** 2, 0) / predictions.length;
  const eligibleForActivation =
    accuracyPercent >= 55 && accuracyPercent >= baselineAccuracyPercent + 2 && brierScore < 0.25;

  return {
    model: finalModel,
    metrics: {
      validationRows: predictions.length,
      accuracyPercent,
      baselineAccuracyPercent,
      brierScore,
      positiveRows,
      negativeRows,
    },
    eligibleForActivation,
    gateReason: eligibleForActivation ? 'WALK_FORWARD_GATES_PASSED' : 'WALK_FORWARD_GATES_NOT_PASSED',
  };
}

export function applyLearningModel(
  baseline: PaperAgentDecisionInput,
  modelVersion: string,
  model: LogisticModelData
): PaperAgentDecisionInput {
  const hardSafetyReasons = new Set([
    'DATA_INSUFFICIENT',
    'INVALID_MARKET_DATA',
    'ONCHAIN_COST_UNAVAILABLE',
    'LIFECYCLE_EDGE_TOO_LOW',
    'VOLATILITY_TOO_HIGH',
    'TVL_DECLINING',
  ]);
  if (hardSafetyReasons.has(baseline.reasonCode)) return baseline;

  const probability = predictLPBeatsHold(model, baseline.features);
  const enter = probability >= model.decisionThreshold;
  const distance = Math.abs(probability - model.decisionThreshold);
  const confidence = distance >= 0.25 ? 'high' : distance >= 0.1 ? 'medium' : 'low';

  return {
    ...baseline,
    strategyVersion: modelVersion,
    action: enter ? 'ENTER_FULL_RANGE' : 'WAIT',
    reasonCode: enter ? 'LEARNING_MODEL_ENTER' : 'LEARNING_MODEL_WAIT',
    confidence,
    rationale: `Model walk-forward memperkirakan peluang LP mengalahkan HOLD ${(probability * 100).toFixed(1)}% (threshold ${(model.decisionThreshold * 100).toFixed(1)}%).`,
    features: {
      ...baseline.features,
      baselineAction: baseline.action,
      learningModelVersion: modelVersion,
      learningProbability: probability,
      learningThreshold: model.decisionThreshold,
    },
  };
}
