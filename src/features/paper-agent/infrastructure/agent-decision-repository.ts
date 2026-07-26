import type { DatabaseSync } from 'node:sqlite';
import type {
  PaperAgentAction,
  PaperAgentConfidence,
  PaperAgentDecision,
  PaperAgentDecisionInput,
} from './agent-store.js';

export class AgentDecisionRepository {
  constructor(protected readonly database: DatabaseSync) {}

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
