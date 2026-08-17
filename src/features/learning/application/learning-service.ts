import type { AgentStore } from '../../paper-agent/index.js';
import {
  MIN_TRAINING_ROWS,
  RETRAIN_EVERY_NEW_OUTCOMES,
  trainWalkForwardCandidate,
} from './learning-model.js';

export interface LearningServiceDependencies {
  store: AgentStore;
  verdictHorizonHours: number;
  log?: (message: string) => void;
}

export class LearningService {
  private readonly log: (message: string) => void;

  constructor(private readonly dependencies: LearningServiceDependencies) {
    this.log = dependencies.log ?? console.log;
  }

  getLifecycleCompatibleActiveModel() {
    const active = this.dependencies.store.getActiveModel();
    return active &&
      active.trainingRows >= MIN_TRAINING_ROWS &&
      active.model.featureNames.includes('predictedNetEdge7d')
      ? active
      : null;
  }

  runCycle(now = new Date()) {
    const examples = this.dependencies.store.getLearningExamples();
    const latestModel = this.dependencies.store.getLatestModel();
    const activeModel = this.getLifecycleCompatibleActiveModel();

    if (examples.length < MIN_TRAINING_ROWS) {
      return {
        status: 'COLLECTING_DATA',
        examples: examples.length,
        minimumExamples: MIN_TRAINING_ROWS,
        activeModel,
        latestModel,
      };
    }

    if (latestModel && examples.length < latestModel.trainingRows + RETRAIN_EVERY_NEW_OUTCOMES) {
      return {
        status: 'WAITING_FOR_NEW_OUTCOMES',
        examples: examples.length,
        minimumExamples: MIN_TRAINING_ROWS,
        nextTrainingAtRows: latestModel.trainingRows + RETRAIN_EVERY_NEW_OUTCOMES,
        activeModel,
        latestModel,
      };
    }

    const candidate = trainWalkForwardCandidate(examples);
    if (!candidate) throw new Error('Learning candidate was unavailable after minimum rows');

    const improvesActive =
      activeModel === null || candidate.metrics.accuracyPercent >= activeModel.accuracyPercent + 1;
    const activate = candidate.eligibleForActivation && improvesActive;
    const timestamp = now.toISOString();
    const version = `logistic-${timestamp.replace(/[-:.TZ]/g, '').slice(0, 14)}-n${examples.length}`;
    const gateReason =
      candidate.eligibleForActivation && !improvesActive ? 'ACTIVE_MODEL_NOT_IMPROVED' : candidate.gateReason;
    const savedModel = this.dependencies.store.saveModel({
      version,
      trainedAt: timestamp,
      status: activate ? 'ACTIVE' : 'REJECTED',
      trainingRows: examples.length,
      validationRows: candidate.metrics.validationRows,
      accuracyPercent: candidate.metrics.accuracyPercent,
      baselineAccuracyPercent: candidate.metrics.baselineAccuracyPercent,
      brierScore: candidate.metrics.brierScore,
      positiveRows: candidate.metrics.positiveRows,
      negativeRows: candidate.metrics.negativeRows,
      gateReason,
      model: candidate.model,
      activatedAt: activate ? timestamp : null,
    });

    this.log(`🎓 Learning model ${savedModel.version}: ${savedModel.status} (${savedModel.gateReason})`);
    return {
      status: savedModel.status,
      examples: examples.length,
      minimumExamples: MIN_TRAINING_ROWS,
      activeModel: this.getLifecycleCompatibleActiveModel(),
      latestModel: savedModel,
    };
  }

  getStatus() {
    const examples = this.dependencies.store.getLearningExamples();
    const latestModel = this.dependencies.store.getLatestModel();
    const positiveRate =
      latestModel && latestModel.positiveRows + latestModel.negativeRows > 0
        ? latestModel.positiveRows / (latestModel.positiveRows + latestModel.negativeRows)
        : null;
    return {
      trainerEnabled: true,
      examples: examples.length,
      minimumExamples: MIN_TRAINING_ROWS,
      progressPercent: Math.min(100, (examples.length / MIN_TRAINING_ROWS) * 100),
      activeModel: this.getLifecycleCompatibleActiveModel(),
      latestModel,
      positiveRate,
      nextTrainingAtRows: latestModel
        ? latestModel.trainingRows + RETRAIN_EVERY_NEW_OUTCOMES
        : MIN_TRAINING_ROWS,
      activationGates: {
        minimumAccuracyPercent: 55,
        improvementOverBaselinePercent: 2,
        maximumBrierScore: 0.25,
        minimumClassRows: 10,
        minimumClassRowsFormula: 'max(10, 2% sampel)',
        retrainEveryNewOutcomes: RETRAIN_EVERY_NEW_OUTCOMES,
        verdictHorizonHours: this.dependencies.verdictHorizonHours,
        purgeRows: this.dependencies.verdictHorizonHours,
      },
    };
  }
}
