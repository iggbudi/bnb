import 'dotenv/config';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { LearningExample, LogisticModelData } from './learning-model.js';

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

const DEFAULT_DATABASE_PATH = resolve(process.env.SQLITE_PATH || 'data/bnb-viewer.sqlite');

export class AgentStore {
  private readonly database: DatabaseSync;

  constructor(databasePath = DEFAULT_DATABASE_PATH) {
    if (databasePath !== ':memory:') {
      mkdirSync(dirname(databasePath), { recursive: true });
    }

    this.database = new DatabaseSync(databasePath);
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;

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

  getByDecisionHour(decisionHour: string): PaperAgentDecision | null {
    const row = this.database
      .prepare(
        `
      SELECT * FROM paper_agent_decisions WHERE decision_hour = ?
    `
      )
      .get(decisionHour) as Record<string, string | number> | undefined;

    return row ? this.mapRow(row) : null;
  }

  saveIfAbsent(decision: PaperAgentDecisionInput): { decision: PaperAgentDecision; created: boolean } {
    const result = this.database
      .prepare(
        `
      INSERT OR IGNORE INTO paper_agent_decisions (
        decision_hour, created_at, strategy_version, action, reason_code,
        confidence, rationale, investment, reference_price,
        predicted_fee_24h, predicted_il_24h,
        predicted_excess_vs_hold_24h, features_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        decision.decisionHour,
        decision.createdAt,
        decision.strategyVersion,
        decision.action,
        decision.reasonCode,
        decision.confidence,
        decision.rationale,
        decision.investment,
        decision.referencePrice,
        decision.predictedFee24h,
        decision.predictedIL24h,
        decision.predictedExcessVsHold24h,
        JSON.stringify(decision.features)
      );

    const saved = this.getByDecisionHour(decision.decisionHour);
    if (!saved) throw new Error('Paper agent decision could not be stored');

    return { decision: saved, created: result.changes === 1 };
  }

  getRecent(limit = 24): PaperAgentDecision[] {
    const safeLimit = Math.min(1_000, Math.max(1, Math.floor(limit)));
    const rows = this.database
      .prepare(
        `
      SELECT * FROM paper_agent_decisions
      ORDER BY decision_hour DESC
      LIMIT ?
    `
      )
      .all(safeLimit) as Array<Record<string, string | number>>;

    return rows.map(row => this.mapRow(row));
  }

  getDueDecisions(horizonHours: 1 | 6 | 24 | 168, now: Date, limit = 100): PaperAgentDecision[] {
    const safeLimit = Math.min(1_000, Math.max(1, Math.floor(limit)));
    const rows = this.database
      .prepare(
        `
      SELECT d.*
      FROM paper_agent_decisions d
      WHERE unixepoch(d.created_at) + (? * 3600) <= unixepoch(?)
        AND NOT EXISTS (
          SELECT 1 FROM paper_agent_outcomes o
          WHERE o.decision_id = d.id AND o.horizon_hours = ?
        )
      ORDER BY d.created_at ASC
      LIMIT ?
    `
      )
      .all(horizonHours, now.toISOString(), horizonHours, safeLimit) as Array<
      Record<string, string | number>
    >;

    return rows.map(row => this.mapRow(row));
  }

  saveOutcomeIfAbsent(outcome: PaperAgentOutcomeInput): { outcome: PaperAgentOutcome; created: boolean } {
    const result = this.database
      .prepare(
        `
      INSERT OR IGNORE INTO paper_agent_outcomes (
        decision_id, horizon_hours, target_at, evaluated_at, status,
        exit_captured_at, exit_price, snapshot_count, estimated_fee,
        hold_value, lp_value_before_fee, lp_value_after_fee,
        il_loss, il_percent, lp_profit_loss_vs_investment, lp_return_percent,
        decision_profit_loss, difference_vs_hold, decision_reward, regret,
        action_correct, note
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        outcome.decisionId,
        outcome.horizonHours,
        outcome.targetAt,
        outcome.evaluatedAt,
        outcome.status,
        outcome.exitCapturedAt,
        outcome.exitPrice,
        outcome.snapshotCount,
        outcome.estimatedFee,
        outcome.holdValue,
        outcome.lpValueBeforeFee,
        outcome.lpValueAfterFee,
        outcome.ilLoss,
        outcome.ilPercent,
        outcome.lpProfitLossVsInvestment,
        outcome.lpReturnPercent,
        outcome.decisionProfitLoss,
        outcome.differenceVsHold,
        outcome.decisionReward,
        outcome.regret,
        outcome.actionCorrect === null ? null : Number(outcome.actionCorrect),
        outcome.note
      );

    const saved = this.getOutcome(outcome.decisionId, outcome.horizonHours);
    if (!saved) throw new Error('Paper agent outcome could not be stored');
    return { outcome: saved, created: result.changes === 1 };
  }

  getOutcome(decisionId: number, horizonHours: 1 | 6 | 24 | 168): PaperAgentOutcome | null {
    const row = this.database
      .prepare(
        `
      SELECT * FROM paper_agent_outcomes
      WHERE decision_id = ? AND horizon_hours = ?
    `
      )
      .get(decisionId, horizonHours) as Record<string, string | number | null> | undefined;
    return row ? this.mapOutcomeRow(row) : null;
  }

  saveOutcomeAssessmentIfAbsent(assessment: PaperAgentOutcomeAssessmentInput): {
    assessment: PaperAgentOutcomeAssessment;
    created: boolean;
  } {
    const result = this.database
      .prepare(
        `
      INSERT OR IGNORE INTO paper_agent_outcome_assessments (
        outcome_id, assessed_at, version, classification, trainable,
        safety_abstention, strict_action_correct, economic_action_correct,
        gross_difference_vs_hold, estimated_entry_gas_usd,
        estimated_exit_gas_usd, estimated_slippage_usd,
        total_lifecycle_cost_usd, economic_difference_vs_hold,
        minimum_actionable_edge_usd, economic_reward, economic_regret,
        gas_source, rationale
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        assessment.outcomeId,
        assessment.assessedAt,
        assessment.version,
        assessment.classification,
        Number(assessment.trainable),
        Number(assessment.safetyAbstention),
        assessment.strictActionCorrect === null ? null : Number(assessment.strictActionCorrect),
        assessment.economicActionCorrect === null ? null : Number(assessment.economicActionCorrect),
        assessment.grossDifferenceVsHold,
        assessment.estimatedEntryGasUsd,
        assessment.estimatedExitGasUsd,
        assessment.estimatedSlippageUsd,
        assessment.totalLifecycleCostUsd,
        assessment.economicDifferenceVsHold,
        assessment.minimumActionableEdgeUsd,
        assessment.economicReward,
        assessment.economicRegret,
        assessment.gasSource,
        assessment.rationale
      );
    const saved = this.getOutcomeAssessment(assessment.outcomeId);
    if (!saved) throw new Error('Outcome economic assessment could not be stored');
    return { assessment: saved, created: result.changes === 1 };
  }

  getOutcomeAssessment(outcomeId: number): PaperAgentOutcomeAssessment | null {
    const row = this.database
      .prepare(
        `
      SELECT * FROM paper_agent_outcome_assessments WHERE outcome_id = ?
    `
      )
      .get(outcomeId) as Record<string, string | number | null> | undefined;
    return row ? this.mapAssessmentRow(row) : null;
  }

  getOutcomesPendingAssessment(limit = 500): PaperAgentOutcomeDetail[] {
    const safeLimit = Math.min(5_000, Math.max(1, Math.floor(limit)));
    const rows = this.database
      .prepare(
        `
      SELECT
        o.*,
        d.decision_hour AS detail_decision_hour,
        d.created_at AS detail_created_at,
        d.strategy_version AS detail_strategy_version,
        d.action AS detail_action,
        d.reason_code AS detail_reason_code,
        d.confidence AS detail_confidence,
        d.investment AS detail_investment,
        d.predicted_fee_24h AS detail_predicted_fee_24h,
        d.predicted_il_24h AS detail_predicted_il_24h,
        d.predicted_excess_vs_hold_24h AS detail_predicted_excess_vs_hold_24h
      FROM paper_agent_outcomes o
      JOIN paper_agent_decisions d ON d.id = o.decision_id
      WHERE NOT EXISTS (
        SELECT 1 FROM paper_agent_outcome_assessments a WHERE a.outcome_id = o.id
      )
      ORDER BY o.evaluated_at ASC, o.id ASC LIMIT ?
    `
      )
      .all(safeLimit) as Array<Record<string, string | number | null>>;
    return rows.map(row => this.mapOutcomeDetailRow(row));
  }

  outcomeAssessmentCounts(): { total: number; scored: number; abstained: number; skipped: number } {
    const row = this.database
      .prepare(
        `
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN trainable = 1 THEN 1 ELSE 0 END) AS scored,
        SUM(CASE WHEN classification = 'ABSTAINED_SAFETY' THEN 1 ELSE 0 END) AS abstained,
        SUM(CASE WHEN classification = 'SKIPPED_DATA_GAP' THEN 1 ELSE 0 END) AS skipped
      FROM paper_agent_outcome_assessments
    `
      )
      .get() as Record<string, number>;
    return {
      total: Number(row.total ?? 0),
      scored: Number(row.scored ?? 0),
      abstained: Number(row.abstained ?? 0),
      skipped: Number(row.skipped ?? 0),
    };
  }

  saveOutcomeInterpretationIfAbsent(interpretation: PaperAgentOutcomeInterpretationInput): {
    interpretation: PaperAgentOutcomeInterpretation;
    created: boolean;
  } {
    const result = this.database
      .prepare(
        `
      INSERT OR IGNORE INTO paper_agent_outcome_interpretations (
        outcome_id, interpreted_at, version, role, classification,
        accuracy_eligible, trainable, economic_action_correct,
        gross_difference_vs_hold, estimated_entry_gas_usd,
        estimated_exit_gas_usd, applicable_swap_slippage_usd,
        total_lifecycle_cost_usd, economic_difference_vs_hold,
        minimum_actionable_edge_usd, economic_reward, economic_regret,
        gas_source, transaction_path, rationale
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        interpretation.outcomeId,
        interpretation.interpretedAt,
        interpretation.version,
        interpretation.role,
        interpretation.classification,
        Number(interpretation.accuracyEligible),
        Number(interpretation.trainable),
        interpretation.economicActionCorrect === null ? null : Number(interpretation.economicActionCorrect),
        interpretation.grossDifferenceVsHold,
        interpretation.estimatedEntryGasUsd,
        interpretation.estimatedExitGasUsd,
        interpretation.applicableSwapSlippageUsd,
        interpretation.totalLifecycleCostUsd,
        interpretation.economicDifferenceVsHold,
        interpretation.minimumActionableEdgeUsd,
        interpretation.economicReward,
        interpretation.economicRegret,
        interpretation.gasSource,
        interpretation.transactionPath,
        interpretation.rationale
      );
    const saved = this.getOutcomeInterpretation(interpretation.outcomeId);
    if (!saved) throw new Error('Outcome lifecycle interpretation could not be stored');
    return { interpretation: saved, created: result.changes === 1 };
  }

  getOutcomeInterpretation(outcomeId: number): PaperAgentOutcomeInterpretation | null {
    const row = this.database
      .prepare(
        `
      SELECT * FROM paper_agent_outcome_interpretations WHERE outcome_id = ?
    `
      )
      .get(outcomeId) as Record<string, string | number | null> | undefined;
    return row ? this.mapInterpretationRow(row) : null;
  }

  getOutcomesPendingInterpretation(limit = 500): PaperAgentOutcomeDetail[] {
    const safeLimit = Math.min(5_000, Math.max(1, Math.floor(limit)));
    const rows = this.database
      .prepare(
        `
      SELECT
        o.*,
        d.decision_hour AS detail_decision_hour,
        d.created_at AS detail_created_at,
        d.strategy_version AS detail_strategy_version,
        d.action AS detail_action,
        d.reason_code AS detail_reason_code,
        d.confidence AS detail_confidence,
        d.investment AS detail_investment,
        d.predicted_fee_24h AS detail_predicted_fee_24h,
        d.predicted_il_24h AS detail_predicted_il_24h,
        d.predicted_excess_vs_hold_24h AS detail_predicted_excess_vs_hold_24h
      FROM paper_agent_outcomes o
      JOIN paper_agent_decisions d ON d.id = o.decision_id
      WHERE NOT EXISTS (
        SELECT 1 FROM paper_agent_outcome_interpretations i WHERE i.outcome_id = o.id
      )
      ORDER BY o.evaluated_at ASC, o.id ASC LIMIT ?
    `
      )
      .all(safeLimit) as Array<Record<string, string | number | null>>;
    return rows.map(row => this.mapOutcomeDetailRow(row));
  }

  outcomeInterpretationCounts(): {
    total: number;
    diagnostic: number;
    scored: number;
    abstained: number;
    skipped: number;
  } {
    const row = this.database
      .prepare(
        `
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN role = 'EARLY_DIAGNOSTIC' THEN 1 ELSE 0 END) AS diagnostic,
        SUM(CASE WHEN accuracy_eligible = 1 THEN 1 ELSE 0 END) AS scored,
        SUM(CASE WHEN classification = 'ABSTAINED_SAFETY' THEN 1 ELSE 0 END) AS abstained,
        SUM(CASE WHEN classification = 'SKIPPED_DATA_GAP' THEN 1 ELSE 0 END) AS skipped
      FROM paper_agent_outcome_interpretations
    `
      )
      .get() as Record<string, number>;
    return {
      total: Number(row.total ?? 0),
      diagnostic: Number(row.diagnostic ?? 0),
      scored: Number(row.scored ?? 0),
      abstained: Number(row.abstained ?? 0),
      skipped: Number(row.skipped ?? 0),
    };
  }

  getRecentOutcomes(limit = 100): PaperAgentOutcome[] {
    const safeLimit = Math.min(1_000, Math.max(1, Math.floor(limit)));
    const rows = this.database
      .prepare(
        `
      SELECT * FROM paper_agent_outcomes
      ORDER BY evaluated_at DESC, id DESC
      LIMIT ?
    `
      )
      .all(safeLimit) as Array<Record<string, string | number | null>>;
    return rows.map(row => this.mapOutcomeRow(row));
  }

  getOutcomeDetails(horizonHours: 1 | 6 | 24 | 168, limit = 100): PaperAgentOutcomeDetail[] {
    const safeLimit = Math.min(1_000, Math.max(1, Math.floor(limit)));
    const rows = this.database
      .prepare(
        `
      SELECT
        o.*,
        d.decision_hour AS detail_decision_hour,
        d.created_at AS detail_created_at,
        d.strategy_version AS detail_strategy_version,
        d.action AS detail_action,
        d.reason_code AS detail_reason_code,
        d.confidence AS detail_confidence,
        d.investment AS detail_investment,
        d.predicted_fee_24h AS detail_predicted_fee_24h,
        d.predicted_il_24h AS detail_predicted_il_24h,
        d.predicted_excess_vs_hold_24h AS detail_predicted_excess_vs_hold_24h
      FROM paper_agent_outcomes o
      JOIN paper_agent_decisions d ON d.id = o.decision_id
      WHERE o.horizon_hours = ?
      ORDER BY o.target_at DESC
      LIMIT ?
    `
      )
      .all(horizonHours, safeLimit) as Array<Record<string, string | number | null>>;

    return rows.map(row => this.mapOutcomeDetailRow(row));
  }

  getOutcomesPendingReflection(limit = 3): PaperAgentOutcomeDetail[] {
    const safeLimit = Math.min(10, Math.max(1, Math.floor(limit)));
    const rows = this.database
      .prepare(
        `
      SELECT
        o.*,
        d.decision_hour AS detail_decision_hour,
        d.created_at AS detail_created_at,
        d.strategy_version AS detail_strategy_version,
        d.action AS detail_action,
        d.reason_code AS detail_reason_code,
        d.confidence AS detail_confidence,
        d.investment AS detail_investment,
        d.predicted_fee_24h AS detail_predicted_fee_24h,
        d.predicted_il_24h AS detail_predicted_il_24h,
        d.predicted_excess_vs_hold_24h AS detail_predicted_excess_vs_hold_24h
      FROM paper_agent_outcomes o
      JOIN paper_agent_decisions d ON d.id = o.decision_id
      JOIN paper_agent_outcome_interpretations i ON i.outcome_id = o.id AND i.trainable = 1
      WHERE o.horizon_hours = 168
        AND o.status = 'EVALUATED'
        AND NOT EXISTS (
          SELECT 1 FROM paper_agent_reflections r WHERE r.outcome_id = o.id
        )
      ORDER BY o.target_at ASC
      LIMIT ?
    `
      )
      .all(safeLimit) as Array<Record<string, string | number | null>>;
    return rows.map(row => this.mapOutcomeDetailRow(row));
  }

  saveReflectionIfAbsent(reflection: AgentReflectionInput): {
    reflection: AgentReflection;
    created: boolean;
  } {
    const result = this.database
      .prepare(
        `
      INSERT OR IGNORE INTO paper_agent_reflections (
        decision_id, outcome_id, created_at, model, prompt_version,
        assessment, confidence, summary, prediction_error_analysis,
        what_worked_json, what_failed_json, lesson, future_checks_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        reflection.decisionId,
        reflection.outcomeId,
        reflection.createdAt,
        reflection.model,
        reflection.promptVersion,
        reflection.assessment,
        reflection.confidence,
        reflection.summary,
        reflection.predictionErrorAnalysis,
        JSON.stringify(reflection.whatWorked),
        JSON.stringify(reflection.whatFailed),
        reflection.lesson,
        JSON.stringify(reflection.futureChecks)
      );
    const saved = this.database
      .prepare(
        `
      SELECT * FROM paper_agent_reflections WHERE outcome_id = ?
    `
      )
      .get(reflection.outcomeId) as Record<string, string | number> | undefined;
    if (!saved) throw new Error('Agent reflection could not be stored');
    return { reflection: this.mapReflectionRow(saved), created: result.changes === 1 };
  }

  getRecentReflections(limit = 20): AgentReflection[] {
    const safeLimit = Math.min(100, Math.max(1, Math.floor(limit)));
    const rows = this.database
      .prepare(
        `
      SELECT * FROM paper_agent_reflections
      ORDER BY created_at DESC, id DESC LIMIT ?
    `
      )
      .all(safeLimit) as Array<Record<string, string | number>>;
    return rows.map(row => this.mapReflectionRow(row));
  }

  reflectionCount(): number {
    const row = this.database
      .prepare(
        `
      SELECT COUNT(*) AS count FROM paper_agent_reflections
    `
      )
      .get() as { count: number };
    return Number(row.count);
  }

  pendingReflectionCount(): number {
    const row = this.database
      .prepare(
        `
      SELECT COUNT(*) AS count
      FROM paper_agent_outcomes o
      WHERE o.horizon_hours = 168
        AND o.status = 'EVALUATED'
        AND EXISTS (
          SELECT 1 FROM paper_agent_outcome_interpretations i
          WHERE i.outcome_id = o.id AND i.trainable = 1
        )
        AND NOT EXISTS (
          SELECT 1 FROM paper_agent_reflections r WHERE r.outcome_id = o.id
        )
    `
      )
      .get() as { count: number };
    return Number(row.count);
  }

  getPerformance(horizonHours: 1 | 6 | 24 | 168): PaperAgentPerformance {
    const row = this.database
      .prepare(
        `
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN o.status = 'EVALUATED' THEN 1 ELSE 0 END) AS evaluated,
        SUM(CASE WHEN o.status = 'EVALUATED' AND i.accuracy_eligible = 1 THEN 1 ELSE 0 END) AS scored,
        SUM(CASE WHEN i.role = 'EARLY_DIAGNOSTIC' THEN 1 ELSE 0 END) AS diagnostic,
        SUM(CASE WHEN i.classification = 'ABSTAINED_SAFETY' THEN 1 ELSE 0 END) AS abstained,
        SUM(CASE WHEN o.status = 'SKIPPED_DATA_GAP' THEN 1 ELSE 0 END) AS skipped,
        SUM(CASE WHEN i.accuracy_eligible = 1 AND i.economic_action_correct = 1 THEN 1 ELSE 0 END) AS correct,
        SUM(CASE WHEN o.status = 'EVALUATED' AND o.action_correct = 1 THEN 1 ELSE 0 END) AS strict_correct,
        SUM(CASE WHEN o.status = 'EVALUATED' AND d.action = 'ENTER_FULL_RANGE' THEN 1 ELSE 0 END) AS enter_count,
        SUM(CASE WHEN o.status = 'EVALUATED' AND d.action = 'WAIT' THEN 1 ELSE 0 END) AS wait_count,
        COALESCE(SUM(CASE WHEN o.status = 'EVALUATED' THEN o.decision_profit_loss ELSE 0 END), 0) AS decision_pnl,
        COALESCE(SUM(CASE WHEN o.status = 'EVALUATED' THEN o.lp_profit_loss_vs_investment ELSE 0 END), 0) AS lp_pnl,
        COALESCE(SUM(CASE WHEN o.status = 'EVALUATED' THEN o.difference_vs_hold ELSE 0 END), 0) AS difference_vs_hold,
        COALESCE(SUM(CASE WHEN i.accuracy_eligible = 1 THEN i.economic_difference_vs_hold ELSE 0 END), 0) AS economic_difference_vs_hold,
        COALESCE(SUM(CASE WHEN o.status = 'EVALUATED' THEN i.total_lifecycle_cost_usd ELSE 0 END), 0) AS lifecycle_cost,
        COALESCE(SUM(CASE WHEN i.accuracy_eligible = 1 THEN i.economic_reward ELSE 0 END), 0) AS reward,
        COALESCE(SUM(CASE WHEN i.accuracy_eligible = 1 THEN i.economic_regret ELSE 0 END), 0) AS regret,
        AVG(CASE
          WHEN i.accuracy_eligible = 1
            AND json_type(d.features_json, '$.predictedNetEdge7d') IN ('integer', 'real')
          THEN ABS(i.economic_difference_vs_hold - json_extract(d.features_json, '$.predictedNetEdge7d'))
          ELSE NULL
        END) AS prediction_error
      FROM paper_agent_outcomes o
      JOIN paper_agent_decisions d ON d.id = o.decision_id
      LEFT JOIN paper_agent_outcome_interpretations i ON i.outcome_id = o.id
      WHERE o.horizon_hours = ?
    `
      )
      .get(horizonHours) as Record<string, number | null>;

    const evaluated = Number(row.evaluated ?? 0);
    const scored = Number(row.scored ?? 0);
    const correct = Number(row.correct ?? 0);
    const strictCorrect = Number(row.strict_correct ?? 0);
    return {
      horizonHours,
      total: Number(row.total ?? 0),
      evaluated,
      scored,
      diagnostic: Number(row.diagnostic ?? 0),
      abstained: Number(row.abstained ?? 0),
      skipped: Number(row.skipped ?? 0),
      correct,
      strictCorrect,
      accuracyPercent: scored > 0 ? (correct / scored) * 100 : null,
      strictAccuracyPercent: evaluated > 0 ? (strictCorrect / evaluated) * 100 : null,
      enterCount: Number(row.enter_count ?? 0),
      waitCount: Number(row.wait_count ?? 0),
      cumulativeDecisionProfitLoss: Number(row.decision_pnl ?? 0),
      cumulativeLPProfitLoss: Number(row.lp_pnl ?? 0),
      cumulativeDifferenceVsHold: Number(row.difference_vs_hold ?? 0),
      cumulativeEconomicDifferenceVsHold: Number(row.economic_difference_vs_hold ?? 0),
      cumulativeLifecycleCost: Number(row.lifecycle_cost ?? 0),
      cumulativeReward: Number(row.reward ?? 0),
      cumulativeRegret: Number(row.regret ?? 0),
      averagePredictionError: row.prediction_error === null ? null : Number(row.prediction_error),
    };
  }

  getLearningExamples(): LearningExample[] {
    const rows = this.database
      .prepare(
        `
      SELECT
        d.created_at AS captured_at,
        d.action AS baseline_action,
        d.features_json,
        i.economic_difference_vs_hold,
        i.minimum_actionable_edge_usd
      FROM paper_agent_outcomes o
      JOIN paper_agent_decisions d ON d.id = o.decision_id
      JOIN paper_agent_outcome_interpretations i ON i.outcome_id = o.id
      WHERE o.horizon_hours = 168 AND o.status = 'EVALUATED' AND i.trainable = 1
      ORDER BY d.created_at ASC
    `
      )
      .all() as Array<Record<string, string | number>>;

    return rows.map(row => {
      const features = JSON.parse(String(row.features_json)) as Record<string, unknown>;
      const storedBaselineAction = features.baselineAction;
      return {
        capturedAt: String(row.captured_at),
        features,
        label: Number(row.economic_difference_vs_hold) >= Number(row.minimum_actionable_edge_usd) ? 1 : 0,
        baselineAction: (storedBaselineAction === 'WAIT' || storedBaselineAction === 'ENTER_FULL_RANGE'
          ? storedBaselineAction
          : String(row.baseline_action)) as PaperAgentAction,
      };
    });
  }

  saveModel(model: AgentModelInput): AgentModelRecord {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      if (model.status === 'ACTIVE') {
        this.database
          .prepare(
            `
          UPDATE paper_agent_models SET status = 'SUPERSEDED'
          WHERE status = 'ACTIVE'
        `
          )
          .run();
      }

      this.database
        .prepare(
          `
        INSERT INTO paper_agent_models (
          version, trained_at, status, training_rows, validation_rows,
          accuracy_percent, baseline_accuracy_percent, brier_score,
          positive_rows, negative_rows, gate_reason, model_json, activated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
        )
        .run(
          model.version,
          model.trainedAt,
          model.status,
          model.trainingRows,
          model.validationRows,
          model.accuracyPercent,
          model.baselineAccuracyPercent,
          model.brierScore,
          model.positiveRows,
          model.negativeRows,
          model.gateReason,
          JSON.stringify(model.model),
          model.activatedAt
        );
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }

    const saved = this.database
      .prepare(
        `
      SELECT * FROM paper_agent_models WHERE version = ?
    `
      )
      .get(model.version) as Record<string, string | number | null> | undefined;
    if (!saved) throw new Error('Agent model could not be stored');
    return this.mapModelRow(saved);
  }

  getActiveModel(): AgentModelRecord | null {
    const row = this.database
      .prepare(
        `
      SELECT * FROM paper_agent_models WHERE status = 'ACTIVE' LIMIT 1
    `
      )
      .get() as Record<string, string | number | null> | undefined;
    return row ? this.mapModelRow(row) : null;
  }

  getLatestModel(): AgentModelRecord | null {
    const row = this.database
      .prepare(
        `
      SELECT * FROM paper_agent_models ORDER BY trained_at DESC, id DESC LIMIT 1
    `
      )
      .get() as Record<string, string | number | null> | undefined;
    return row ? this.mapModelRow(row) : null;
  }

  getRecentModels(limit = 20): AgentModelRecord[] {
    const safeLimit = Math.min(100, Math.max(1, Math.floor(limit)));
    const rows = this.database
      .prepare(
        `
      SELECT * FROM paper_agent_models ORDER BY trained_at DESC, id DESC LIMIT ?
    `
      )
      .all(safeLimit) as Array<Record<string, string | number | null>>;
    return rows.map(row => this.mapModelRow(row));
  }

  outcomeCounts(): { total: number; evaluated: number; skipped: number } {
    const row = this.database
      .prepare(
        `
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'EVALUATED' THEN 1 ELSE 0 END) AS evaluated,
        SUM(CASE WHEN status = 'SKIPPED_DATA_GAP' THEN 1 ELSE 0 END) AS skipped
      FROM paper_agent_outcomes
    `
      )
      .get() as { total: number; evaluated: number | null; skipped: number | null };
    return {
      total: Number(row.total),
      evaluated: Number(row.evaluated ?? 0),
      skipped: Number(row.skipped ?? 0),
    };
  }

  count(): number {
    const row = this.database
      .prepare(
        `
      SELECT COUNT(*) AS count FROM paper_agent_decisions
    `
      )
      .get() as { count: number };
    return Number(row.count);
  }

  close(): void {
    this.database.close();
  }

  private mapReflectionRow(row: Record<string, string | number>): AgentReflection {
    return {
      id: Number(row.id),
      decisionId: Number(row.decision_id),
      outcomeId: Number(row.outcome_id),
      createdAt: String(row.created_at),
      model: String(row.model),
      promptVersion: String(row.prompt_version),
      assessment: String(row.assessment) as AgentReflection['assessment'],
      confidence: String(row.confidence) as AgentReflection['confidence'],
      summary: String(row.summary),
      predictionErrorAnalysis: String(row.prediction_error_analysis),
      whatWorked: JSON.parse(String(row.what_worked_json)) as string[],
      whatFailed: JSON.parse(String(row.what_failed_json)) as string[],
      lesson: String(row.lesson),
      futureChecks: JSON.parse(String(row.future_checks_json)) as string[],
    };
  }

  private mapOutcomeDetailRow(row: Record<string, string | number | null>): PaperAgentOutcomeDetail {
    return {
      ...this.mapOutcomeRow(row),
      decision: {
        decisionHour: String(row.detail_decision_hour),
        createdAt: String(row.detail_created_at),
        strategyVersion: String(row.detail_strategy_version),
        action: String(row.detail_action) as PaperAgentAction,
        reasonCode: String(row.detail_reason_code),
        confidence: String(row.detail_confidence) as PaperAgentConfidence,
        investment: Number(row.detail_investment),
        predictedFee24h: Number(row.detail_predicted_fee_24h),
        predictedIL24h: Number(row.detail_predicted_il_24h),
        predictedExcessVsHold24h: Number(row.detail_predicted_excess_vs_hold_24h),
      },
      assessment: this.getOutcomeAssessment(Number(row.id)),
      interpretation: this.getOutcomeInterpretation(Number(row.id)),
    };
  }

  private mapInterpretationRow(row: Record<string, string | number | null>): PaperAgentOutcomeInterpretation {
    const nullableNumber = (value: string | number | null): number | null =>
      value === null ? null : Number(value);
    const nullableBoolean = (value: string | number | null): boolean | null =>
      value === null ? null : Number(value) === 1;
    return {
      id: Number(row.id),
      outcomeId: Number(row.outcome_id),
      interpretedAt: String(row.interpreted_at),
      version: String(row.version),
      role: String(row.role) as OutcomeInterpretationRole,
      classification: String(row.classification) as OutcomeInterpretationClassification,
      accuracyEligible: Number(row.accuracy_eligible) === 1,
      trainable: Number(row.trainable) === 1,
      economicActionCorrect: nullableBoolean(row.economic_action_correct),
      grossDifferenceVsHold: nullableNumber(row.gross_difference_vs_hold),
      estimatedEntryGasUsd: nullableNumber(row.estimated_entry_gas_usd),
      estimatedExitGasUsd: nullableNumber(row.estimated_exit_gas_usd),
      applicableSwapSlippageUsd: nullableNumber(row.applicable_swap_slippage_usd),
      totalLifecycleCostUsd: nullableNumber(row.total_lifecycle_cost_usd),
      economicDifferenceVsHold: nullableNumber(row.economic_difference_vs_hold),
      minimumActionableEdgeUsd: Number(row.minimum_actionable_edge_usd),
      economicReward: nullableNumber(row.economic_reward),
      economicRegret: nullableNumber(row.economic_regret),
      gasSource: String(row.gas_source) as PaperAgentOutcomeInterpretation['gasSource'],
      transactionPath: String(row.transaction_path) as PaperAgentOutcomeInterpretation['transactionPath'],
      rationale: String(row.rationale),
    };
  }

  private mapAssessmentRow(row: Record<string, string | number | null>): PaperAgentOutcomeAssessment {
    const nullableNumber = (value: string | number | null): number | null =>
      value === null ? null : Number(value);
    const nullableBoolean = (value: string | number | null): boolean | null =>
      value === null ? null : Number(value) === 1;
    return {
      id: Number(row.id),
      outcomeId: Number(row.outcome_id),
      assessedAt: String(row.assessed_at),
      version: String(row.version),
      classification: String(row.classification) as OutcomeAssessmentClassification,
      trainable: Number(row.trainable) === 1,
      safetyAbstention: Number(row.safety_abstention) === 1,
      strictActionCorrect: nullableBoolean(row.strict_action_correct),
      economicActionCorrect: nullableBoolean(row.economic_action_correct),
      grossDifferenceVsHold: nullableNumber(row.gross_difference_vs_hold),
      estimatedEntryGasUsd: nullableNumber(row.estimated_entry_gas_usd),
      estimatedExitGasUsd: nullableNumber(row.estimated_exit_gas_usd),
      estimatedSlippageUsd: nullableNumber(row.estimated_slippage_usd),
      totalLifecycleCostUsd: nullableNumber(row.total_lifecycle_cost_usd),
      economicDifferenceVsHold: nullableNumber(row.economic_difference_vs_hold),
      minimumActionableEdgeUsd: Number(row.minimum_actionable_edge_usd),
      economicReward: nullableNumber(row.economic_reward),
      economicRegret: nullableNumber(row.economic_regret),
      gasSource: String(row.gas_source) as PaperAgentOutcomeAssessment['gasSource'],
      rationale: String(row.rationale),
    };
  }

  private mapModelRow(row: Record<string, string | number | null>): AgentModelRecord {
    return {
      id: Number(row.id),
      version: String(row.version),
      trainedAt: String(row.trained_at),
      status: String(row.status) as AgentModelStatus,
      trainingRows: Number(row.training_rows),
      validationRows: Number(row.validation_rows),
      accuracyPercent: Number(row.accuracy_percent),
      baselineAccuracyPercent: Number(row.baseline_accuracy_percent),
      brierScore: Number(row.brier_score),
      positiveRows: Number(row.positive_rows),
      negativeRows: Number(row.negative_rows),
      gateReason: String(row.gate_reason),
      model: JSON.parse(String(row.model_json)) as LogisticModelData,
      activatedAt: row.activated_at === null ? null : String(row.activated_at),
    };
  }

  private mapOutcomeRow(row: Record<string, string | number | null>): PaperAgentOutcome {
    const nullableNumber = (value: string | number | null): number | null =>
      value === null ? null : Number(value);

    return {
      id: Number(row.id),
      decisionId: Number(row.decision_id),
      horizonHours: Number(row.horizon_hours) as PaperAgentOutcome['horizonHours'],
      targetAt: String(row.target_at),
      evaluatedAt: String(row.evaluated_at),
      status: String(row.status) as PaperAgentOutcomeStatus,
      exitCapturedAt: row.exit_captured_at === null ? null : String(row.exit_captured_at),
      exitPrice: nullableNumber(row.exit_price),
      snapshotCount: Number(row.snapshot_count),
      estimatedFee: nullableNumber(row.estimated_fee),
      holdValue: nullableNumber(row.hold_value),
      lpValueBeforeFee: nullableNumber(row.lp_value_before_fee),
      lpValueAfterFee: nullableNumber(row.lp_value_after_fee),
      ilLoss: nullableNumber(row.il_loss),
      ilPercent: nullableNumber(row.il_percent),
      lpProfitLossVsInvestment: nullableNumber(row.lp_profit_loss_vs_investment),
      lpReturnPercent: nullableNumber(row.lp_return_percent),
      decisionProfitLoss: nullableNumber(row.decision_profit_loss),
      differenceVsHold: nullableNumber(row.difference_vs_hold),
      decisionReward: nullableNumber(row.decision_reward),
      regret: nullableNumber(row.regret),
      actionCorrect: row.action_correct === null ? null : Number(row.action_correct) === 1,
      note: String(row.note),
    };
  }

  private mapRow(row: Record<string, string | number>): PaperAgentDecision {
    return {
      id: Number(row.id),
      decisionHour: String(row.decision_hour),
      createdAt: String(row.created_at),
      strategyVersion: String(row.strategy_version),
      action: String(row.action) as PaperAgentAction,
      reasonCode: String(row.reason_code),
      confidence: String(row.confidence) as PaperAgentConfidence,
      rationale: String(row.rationale),
      investment: Number(row.investment),
      referencePrice: Number(row.reference_price),
      predictedFee24h: Number(row.predicted_fee_24h),
      predictedIL24h: Number(row.predicted_il_24h),
      predictedExcessVsHold24h: Number(row.predicted_excess_vs_hold_24h),
      features: JSON.parse(String(row.features_json)) as Record<string, unknown>,
    };
  }
}
