import { AgentOutcomeRepository } from './agent-outcome-repository.js';
import type { AgentReflection, AgentReflectionInput } from './agent-store.js';

export class AgentReflectionRepository extends AgentOutcomeRepository {
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
}
