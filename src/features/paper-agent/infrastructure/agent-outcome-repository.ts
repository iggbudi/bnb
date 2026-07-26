import { AgentDecisionRepository } from './agent-decision-repository.js';
import type {
  OutcomeAssessmentClassification,
  OutcomeInterpretationClassification,
  OutcomeInterpretationRole,
  PaperAgentAction,
  PaperAgentConfidence,
  PaperAgentOutcome,
  PaperAgentOutcomeAssessment,
  PaperAgentOutcomeAssessmentInput,
  PaperAgentOutcomeDetail,
  PaperAgentOutcomeInput,
  PaperAgentOutcomeInterpretation,
  PaperAgentOutcomeInterpretationInput,
  PaperAgentOutcomeStatus,
} from './agent-store.js';

export class AgentOutcomeRepository extends AgentDecisionRepository {
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
}
