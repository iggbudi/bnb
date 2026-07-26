import { DatabaseSync } from 'node:sqlite';
import { applicationDatabasePath, openApplicationDatabase } from '../../../shared/database/connection.js';
import { prepareStoreSchema, type StoreSchemaOptions } from '../../../shared/database/store-schema.js';
import type { LogisticModelData } from '../../learning/index.js';

export type PaperAgentAction = 'WAIT' | 'ENTER_FULL_RANGE';
export type PaperAgentConfidence = 'low' | 'medium' | 'high';

export interface PaperAgentDecisionInput {
  decisionHour: string;
  createdAt: string;
  strategyVersion: string;
  action: PaperAgentAction;
  reasonCode: string;
  confidence: PaperAgentConfidence;
  rationale: string;
  investment: number;
  referencePrice: number;
  predictedFee24h: number;
  predictedIL24h: number;
  predictedExcessVsHold24h: number;
  features: Record<string, unknown>;
}

export interface PaperAgentDecision extends PaperAgentDecisionInput {
  id: number;
}

export type PaperAgentOutcomeStatus = 'EVALUATED' | 'SKIPPED_DATA_GAP';

export interface PaperAgentOutcomeInput {
  decisionId: number;
  horizonHours: 1 | 6 | 24 | 168;
  targetAt: string;
  evaluatedAt: string;
  status: PaperAgentOutcomeStatus;
  exitCapturedAt: string | null;
  exitPrice: number | null;
  snapshotCount: number;
  estimatedFee: number | null;
  holdValue: number | null;
  lpValueBeforeFee: number | null;
  lpValueAfterFee: number | null;
  ilLoss: number | null;
  ilPercent: number | null;
  lpProfitLossVsInvestment: number | null;
  lpReturnPercent: number | null;
  decisionProfitLoss: number | null;
  differenceVsHold: number | null;
  decisionReward: number | null;
  regret: number | null;
  actionCorrect: boolean | null;
  note: string;
}

export interface PaperAgentOutcome extends PaperAgentOutcomeInput {
  id: number;
}

export type OutcomeAssessmentClassification =
  'CORRECT' | 'INCORRECT' | 'ABSTAINED_SAFETY' | 'SKIPPED_DATA_GAP';

export interface PaperAgentOutcomeAssessmentInput {
  outcomeId: number;
  assessedAt: string;
  version: string;
  classification: OutcomeAssessmentClassification;
  trainable: boolean;
  safetyAbstention: boolean;
  strictActionCorrect: boolean | null;
  economicActionCorrect: boolean | null;
  grossDifferenceVsHold: number | null;
  estimatedEntryGasUsd: number | null;
  estimatedExitGasUsd: number | null;
  estimatedSlippageUsd: number | null;
  totalLifecycleCostUsd: number | null;
  economicDifferenceVsHold: number | null;
  minimumActionableEdgeUsd: number;
  economicReward: number | null;
  economicRegret: number | null;
  gasSource: 'HISTORICAL_ONCHAIN' | 'CURRENT_FALLBACK';
  rationale: string;
}

export interface PaperAgentOutcomeAssessment extends PaperAgentOutcomeAssessmentInput {
  id: number;
}

export type OutcomeInterpretationRole =
  'EARLY_DIAGNOSTIC' | 'ENTRY_VERDICT' | 'SAFETY_ABSTENTION' | 'DATA_GAP';

export type OutcomeInterpretationClassification =
  'DIAGNOSTIC_EARLY' | 'CORRECT' | 'INCORRECT' | 'ABSTAINED_SAFETY' | 'SKIPPED_DATA_GAP';

export interface PaperAgentOutcomeInterpretationInput {
  outcomeId: number;
  interpretedAt: string;
  version: string;
  role: OutcomeInterpretationRole;
  classification: OutcomeInterpretationClassification;
  accuracyEligible: boolean;
  trainable: boolean;
  economicActionCorrect: boolean | null;
  grossDifferenceVsHold: number | null;
  estimatedEntryGasUsd: number | null;
  estimatedExitGasUsd: number | null;
  applicableSwapSlippageUsd: number | null;
  totalLifecycleCostUsd: number | null;
  economicDifferenceVsHold: number | null;
  minimumActionableEdgeUsd: number;
  economicReward: number | null;
  economicRegret: number | null;
  gasSource: 'HISTORICAL_ONCHAIN' | 'CURRENT_FALLBACK';
  transactionPath: 'BALANCED_TOKENS_MINT_WITHDRAW';
  rationale: string;
}

export interface PaperAgentOutcomeInterpretation extends PaperAgentOutcomeInterpretationInput {
  id: number;
}

export interface PaperAgentOutcomeDetail extends PaperAgentOutcome {
  decision: {
    decisionHour: string;
    createdAt: string;
    strategyVersion: string;
    action: PaperAgentAction;
    reasonCode: string;
    confidence: PaperAgentConfidence;
    investment: number;
    predictedFee24h: number;
    predictedIL24h: number;
    predictedExcessVsHold24h: number;
  };
  assessment: PaperAgentOutcomeAssessment | null;
  interpretation: PaperAgentOutcomeInterpretation | null;
}

export interface PaperAgentPerformance {
  horizonHours: 1 | 6 | 24 | 168;
  total: number;
  evaluated: number;
  scored: number;
  diagnostic: number;
  abstained: number;
  skipped: number;
  correct: number;
  strictCorrect: number;
  accuracyPercent: number | null;
  strictAccuracyPercent: number | null;
  enterCount: number;
  waitCount: number;
  cumulativeDecisionProfitLoss: number;
  cumulativeLPProfitLoss: number;
  cumulativeDifferenceVsHold: number;
  cumulativeEconomicDifferenceVsHold: number;
  cumulativeLifecycleCost: number;
  cumulativeReward: number;
  cumulativeRegret: number;
  averagePredictionError: number | null;
}

export type AgentModelStatus = 'ACTIVE' | 'REJECTED' | 'SUPERSEDED';

export interface AgentModelInput {
  version: string;
  trainedAt: string;
  status: AgentModelStatus;
  trainingRows: number;
  validationRows: number;
  accuracyPercent: number;
  baselineAccuracyPercent: number;
  brierScore: number;
  positiveRows: number;
  negativeRows: number;
  gateReason: string;
  model: LogisticModelData;
  activatedAt: string | null;
}

export interface AgentModelRecord extends AgentModelInput {
  id: number;
}

export interface AgentReflectionInput {
  decisionId: number;
  outcomeId: number;
  createdAt: string;
  model: string;
  promptVersion: string;
  assessment: 'correct' | 'partially_correct' | 'incorrect';
  confidence: 'low' | 'medium' | 'high';
  summary: string;
  predictionErrorAnalysis: string;
  whatWorked: string[];
  whatFailed: string[];
  lesson: string;
  futureChecks: string[];
}

export interface AgentReflection extends AgentReflectionInput {
  id: number;
}

export function createPaperAgentSchema(database: DatabaseSync): void {
  database.exec(`

      CREATE TABLE IF NOT EXISTS paper_agent_decisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        decision_hour TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        strategy_version TEXT NOT NULL,
        action TEXT NOT NULL CHECK (action IN ('WAIT', 'ENTER_FULL_RANGE')),
        reason_code TEXT NOT NULL,
        confidence TEXT NOT NULL CHECK (confidence IN ('low', 'medium', 'high')),
        rationale TEXT NOT NULL,
        investment REAL NOT NULL,
        reference_price REAL NOT NULL,
        predicted_fee_24h REAL NOT NULL,
        predicted_il_24h REAL NOT NULL,
        predicted_excess_vs_hold_24h REAL NOT NULL,
        features_json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_paper_agent_decisions_created_at
        ON paper_agent_decisions(created_at DESC);

      CREATE TABLE IF NOT EXISTS paper_agent_outcomes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        decision_id INTEGER NOT NULL,
        horizon_hours INTEGER NOT NULL CHECK (horizon_hours IN (1, 6, 24, 168)),
        target_at TEXT NOT NULL,
        evaluated_at TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('EVALUATED', 'SKIPPED_DATA_GAP')),
        exit_captured_at TEXT,
        exit_price REAL,
        snapshot_count INTEGER NOT NULL,
        estimated_fee REAL,
        hold_value REAL,
        lp_value_before_fee REAL,
        lp_value_after_fee REAL,
        il_loss REAL,
        il_percent REAL,
        lp_profit_loss_vs_investment REAL,
        lp_return_percent REAL,
        decision_profit_loss REAL,
        difference_vs_hold REAL,
        decision_reward REAL,
        regret REAL,
        action_correct INTEGER,
        note TEXT NOT NULL,
        UNIQUE(decision_id, horizon_hours),
        FOREIGN KEY(decision_id) REFERENCES paper_agent_decisions(id)
      );

      CREATE INDEX IF NOT EXISTS idx_paper_agent_outcomes_evaluated_at
        ON paper_agent_outcomes(evaluated_at DESC);

      CREATE TABLE IF NOT EXISTS paper_agent_outcome_assessments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        outcome_id INTEGER NOT NULL UNIQUE,
        assessed_at TEXT NOT NULL,
        version TEXT NOT NULL,
        classification TEXT NOT NULL CHECK (classification IN (
          'CORRECT', 'INCORRECT', 'ABSTAINED_SAFETY', 'SKIPPED_DATA_GAP'
        )),
        trainable INTEGER NOT NULL,
        safety_abstention INTEGER NOT NULL,
        strict_action_correct INTEGER,
        economic_action_correct INTEGER,
        gross_difference_vs_hold REAL,
        estimated_entry_gas_usd REAL,
        estimated_exit_gas_usd REAL,
        estimated_slippage_usd REAL,
        total_lifecycle_cost_usd REAL,
        economic_difference_vs_hold REAL,
        minimum_actionable_edge_usd REAL NOT NULL,
        economic_reward REAL,
        economic_regret REAL,
        gas_source TEXT NOT NULL CHECK (gas_source IN ('HISTORICAL_ONCHAIN', 'CURRENT_FALLBACK')),
        rationale TEXT NOT NULL,
        FOREIGN KEY(outcome_id) REFERENCES paper_agent_outcomes(id)
      );

      CREATE INDEX IF NOT EXISTS idx_outcome_assessments_classification
        ON paper_agent_outcome_assessments(classification, assessed_at DESC);

      CREATE TABLE IF NOT EXISTS paper_agent_outcome_interpretations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        outcome_id INTEGER NOT NULL UNIQUE,
        interpreted_at TEXT NOT NULL,
        version TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN (
          'EARLY_DIAGNOSTIC', 'ENTRY_VERDICT', 'SAFETY_ABSTENTION', 'DATA_GAP'
        )),
        classification TEXT NOT NULL CHECK (classification IN (
          'DIAGNOSTIC_EARLY', 'CORRECT', 'INCORRECT',
          'ABSTAINED_SAFETY', 'SKIPPED_DATA_GAP'
        )),
        accuracy_eligible INTEGER NOT NULL,
        trainable INTEGER NOT NULL,
        economic_action_correct INTEGER,
        gross_difference_vs_hold REAL,
        estimated_entry_gas_usd REAL,
        estimated_exit_gas_usd REAL,
        applicable_swap_slippage_usd REAL,
        total_lifecycle_cost_usd REAL,
        economic_difference_vs_hold REAL,
        minimum_actionable_edge_usd REAL NOT NULL,
        economic_reward REAL,
        economic_regret REAL,
        gas_source TEXT NOT NULL CHECK (gas_source IN ('HISTORICAL_ONCHAIN', 'CURRENT_FALLBACK')),
        transaction_path TEXT NOT NULL CHECK (transaction_path = 'BALANCED_TOKENS_MINT_WITHDRAW'),
        rationale TEXT NOT NULL,
        FOREIGN KEY(outcome_id) REFERENCES paper_agent_outcomes(id)
      );

      CREATE INDEX IF NOT EXISTS idx_outcome_interpretations_role
        ON paper_agent_outcome_interpretations(role, classification, interpreted_at DESC);

      CREATE TABLE IF NOT EXISTS paper_agent_models (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        version TEXT NOT NULL UNIQUE,
        trained_at TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'REJECTED', 'SUPERSEDED')),
        training_rows INTEGER NOT NULL,
        validation_rows INTEGER NOT NULL,
        accuracy_percent REAL NOT NULL,
        baseline_accuracy_percent REAL NOT NULL,
        brier_score REAL NOT NULL,
        positive_rows INTEGER NOT NULL,
        negative_rows INTEGER NOT NULL,
        gate_reason TEXT NOT NULL,
        model_json TEXT NOT NULL,
        activated_at TEXT
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_paper_agent_one_active_model
        ON paper_agent_models(status) WHERE status = 'ACTIVE';

      CREATE TABLE IF NOT EXISTS paper_agent_reflections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        decision_id INTEGER NOT NULL UNIQUE,
        outcome_id INTEGER NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        model TEXT NOT NULL,
        prompt_version TEXT NOT NULL,
        assessment TEXT NOT NULL CHECK (assessment IN ('correct', 'partially_correct', 'incorrect')),
        confidence TEXT NOT NULL CHECK (confidence IN ('low', 'medium', 'high')),
        summary TEXT NOT NULL,
        prediction_error_analysis TEXT NOT NULL,
        what_worked_json TEXT NOT NULL,
        what_failed_json TEXT NOT NULL,
        lesson TEXT NOT NULL,
        future_checks_json TEXT NOT NULL,
        FOREIGN KEY(decision_id) REFERENCES paper_agent_decisions(id),
        FOREIGN KEY(outcome_id) REFERENCES paper_agent_outcomes(id)
      );

      CREATE INDEX IF NOT EXISTS idx_paper_agent_reflections_created_at
        ON paper_agent_reflections(created_at DESC);
    `);
}

import { AgentLearningRepository } from './agent-learning-repository.js';

export class AgentStore extends AgentLearningRepository {
  constructor(databasePath = applicationDatabasePath(), schemaOptions: StoreSchemaOptions = {}) {
    const database = openApplicationDatabase(databasePath);
    try {
      prepareStoreSchema(
        database,
        'paper-agent',
        [
          'paper_agent_decisions',
          'paper_agent_outcomes',
          'paper_agent_outcome_assessments',
          'paper_agent_outcome_interpretations',
          'paper_agent_models',
          'paper_agent_reflections',
        ],
        createPaperAgentSchema,
        schemaOptions
      );
    } catch (error) {
      database.close();
      throw error;
    }
    super(database);
  }
}
