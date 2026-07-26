import type { LearningExample, LogisticModelData } from '../../learning/index.js';
import { AgentReflectionRepository } from './agent-reflection-repository.js';
import type {
  AgentModelInput,
  AgentModelRecord,
  AgentModelStatus,
  PaperAgentAction,
  PaperAgentPerformance,
} from './agent-store.js';

export class AgentLearningRepository extends AgentReflectionRepository {
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

  outcomeCounts(horizonHours?: 1 | 6 | 24 | 168): {
    total: number;
    evaluated: number;
    skipped: number;
  } {
    const row = this.database
      .prepare(
        `
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'EVALUATED' THEN 1 ELSE 0 END) AS evaluated,
        SUM(CASE WHEN status = 'SKIPPED_DATA_GAP' THEN 1 ELSE 0 END) AS skipped
      FROM paper_agent_outcomes
      WHERE ? IS NULL OR horizon_hours = ?
    `
      )
      .get(horizonHours ?? null, horizonHours ?? null) as {
      total: number;
      evaluated: number | null;
      skipped: number | null;
    };
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
}
