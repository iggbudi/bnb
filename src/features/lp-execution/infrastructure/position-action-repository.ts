import { type PositionAction, type PositionStatus } from '../domain/position-lifecycle.js';
import { PositionLifecycleRepository } from './position-lifecycle-repository.js';
import type {
  PositionActionRecord,
  PositionEvaluationRecord,
  PositionEventRecord,
} from './position-store.js';

function startOfUtcHour(value: Date): string {
  const hour = new Date(value);
  hour.setUTCMinutes(0, 0, 0);
  return hour.toISOString();
}

export class PositionActionRepository extends PositionLifecycleRepository {
  recordAction(input: {
    positionId?: number | null;
    action: PositionAction;
    reasonCode: string;
    confidence: 'low' | 'medium' | 'high';
    rationale: string;
    metrics?: Record<string, unknown>;
    now?: Date;
  }): PositionActionRecord {
    if (input.positionId !== null && input.positionId !== undefined && !this.getPosition(input.positionId)) {
      throw new Error('Position not found');
    }
    const now = input.now ?? new Date();
    const timestamp = now.toISOString();
    const actionHour = startOfUtcHour(now);
    const existing = this.database
      .prepare(
        `
      SELECT * FROM position_actions
      WHERE COALESCE(position_id, -1) = COALESCE(?, -1)
        AND action_hour = ? AND action = ?
    `
      )
      .get(input.positionId ?? null, actionHour, input.action) as
      Record<string, string | number | null> | undefined;
    if (existing) return this.mapAction(existing);

    this.database
      .prepare(
        `
      INSERT OR IGNORE INTO position_actions (
        position_id, created_at, action_hour, action, reason_code,
        confidence, rationale, metrics_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        input.positionId ?? null,
        timestamp,
        actionHour,
        input.action,
        input.reasonCode,
        input.confidence,
        input.rationale,
        JSON.stringify(input.metrics ?? {})
      );
    const row = this.database
      .prepare(
        `
      SELECT * FROM position_actions
      WHERE COALESCE(position_id, -1) = COALESCE(?, -1)
        AND action_hour = ? AND action = ?
    `
      )
      .get(input.positionId ?? null, actionHour, input.action) as
      Record<string, string | number | null> | undefined;
    if (!row) throw new Error('Position action could not be stored');
    return this.mapAction(row);
  }

  recordEvaluation(input: Omit<PositionEvaluationRecord, 'id'>): PositionEvaluationRecord {
    if (!this.getPosition(input.positionId)) throw new Error('Position not found');
    const evaluationHour = startOfUtcHour(new Date(input.evaluatedAt));
    const existing = this.database
      .prepare(
        `
      SELECT * FROM position_evaluations
      WHERE position_id = ? AND evaluation_hour = ?
    `
      )
      .get(input.positionId, evaluationHour) as Record<string, string | number> | undefined;
    if (existing) return this.mapEvaluation(existing);

    this.database
      .prepare(
        `
      INSERT OR IGNORE INTO position_evaluations (
        position_id, evaluated_at, evaluation_hour, age_hours, lp_value_usd,
        hold_value_usd, accumulated_fee_usd, gross_pnl_usd,
        net_pnl_usd, difference_vs_hold_usd, estimated_exit_cost_usd,
        data_quality, metrics_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        input.positionId,
        input.evaluatedAt,
        evaluationHour,
        input.ageHours,
        input.lpValueUsd,
        input.holdValueUsd,
        input.accumulatedFeeUsd,
        input.grossPnlUsd,
        input.netPnlUsd,
        input.differenceVsHoldUsd,
        input.estimatedExitCostUsd,
        input.dataQuality,
        JSON.stringify(input.metrics)
      );
    const row = this.database
      .prepare(
        `
      SELECT * FROM position_evaluations
      WHERE position_id = ? AND evaluation_hour = ?
    `
      )
      .get(input.positionId, evaluationHour) as Record<string, string | number> | undefined;
    if (!row) throw new Error('Position evaluation could not be stored');
    return this.mapEvaluation(row);
  }

  getRecentActions(limit = 100): PositionActionRecord[] {
    const safeLimit = Math.min(1_000, Math.max(1, Math.floor(limit)));
    const rows = this.database
      .prepare(
        `
      SELECT * FROM position_actions ORDER BY created_at DESC, id DESC LIMIT ?
    `
      )
      .all(safeLimit) as Array<Record<string, string | number | null>>;
    return rows.map(row => this.mapAction(row));
  }

  getActions(positionId: number, limit = 100): PositionActionRecord[] {
    const safeLimit = Math.min(1_000, Math.max(1, Math.floor(limit)));
    const rows = this.database
      .prepare(
        `
      SELECT * FROM position_actions
      WHERE position_id = ? ORDER BY created_at DESC, id DESC LIMIT ?
    `
      )
      .all(positionId, safeLimit) as Array<Record<string, string | number | null>>;
    return rows.map(row => this.mapAction(row));
  }

  getEvaluations(positionId: number, limit = 100): PositionEvaluationRecord[] {
    const safeLimit = Math.min(10_000, Math.max(1, Math.floor(limit)));
    const rows = this.database
      .prepare(
        `
      SELECT * FROM position_evaluations
      WHERE position_id = ? ORDER BY evaluated_at DESC, id DESC LIMIT ?
    `
      )
      .all(positionId, safeLimit) as Array<Record<string, string | number>>;
    return rows.map(row => this.mapEvaluation(row));
  }

  getEvents(positionId: number, limit = 100): PositionEventRecord[] {
    const safeLimit = Math.min(1_000, Math.max(1, Math.floor(limit)));
    const rows = this.database
      .prepare(
        `
      SELECT * FROM position_events
      WHERE position_id = ? ORDER BY created_at DESC, id DESC LIMIT ?
    `
      )
      .all(positionId, safeLimit) as Array<Record<string, string | number | null>>;
    return rows.map(row => ({
      id: Number(row.id),
      positionId: Number(row.position_id),
      createdAt: String(row.created_at),
      eventType: String(row.event_type),
      fromStatus: row.from_status === null ? null : (String(row.from_status) as PositionStatus),
      toStatus: row.to_status === null ? null : (String(row.to_status) as PositionStatus),
      details: JSON.parse(String(row.details_json)) as Record<string, unknown>,
    }));
  }

  private getAction(id: number): PositionActionRecord | null {
    const row = this.database.prepare(`SELECT * FROM position_actions WHERE id = ?`).get(id) as
      Record<string, string | number | null> | undefined;
    return row ? this.mapAction(row) : null;
  }

  private mapEvaluation(row: Record<string, string | number>): PositionEvaluationRecord {
    return {
      id: Number(row.id),
      positionId: Number(row.position_id),
      evaluatedAt: String(row.evaluated_at),
      ageHours: Number(row.age_hours),
      lpValueUsd: Number(row.lp_value_usd),
      holdValueUsd: Number(row.hold_value_usd),
      accumulatedFeeUsd: Number(row.accumulated_fee_usd),
      grossPnlUsd: Number(row.gross_pnl_usd),
      netPnlUsd: Number(row.net_pnl_usd),
      differenceVsHoldUsd: Number(row.difference_vs_hold_usd),
      estimatedExitCostUsd: Number(row.estimated_exit_cost_usd),
      dataQuality: String(row.data_quality) as PositionEvaluationRecord['dataQuality'],
      metrics: JSON.parse(String(row.metrics_json)) as Record<string, unknown>,
    };
  }

  private mapAction(row: Record<string, string | number | null>): PositionActionRecord {
    return {
      id: Number(row.id),
      positionId: row.position_id === null ? null : Number(row.position_id),
      createdAt: String(row.created_at),
      action: String(row.action) as PositionAction,
      reasonCode: String(row.reason_code),
      confidence: String(row.confidence) as PositionActionRecord['confidence'],
      rationale: String(row.rationale),
      metrics: JSON.parse(String(row.metrics_json)) as Record<string, unknown>,
    };
  }
}
