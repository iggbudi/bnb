import type {
  AggressivePaperActionRecord,
  AggressivePaperEvaluationRecord,
  AggressivePaperPerformance,
  AggressivePaperPosition,
  AggressiveProjectionEvidence,
} from './aggressive-paper-store.js';
import { AggressivePositionRepository } from './aggressive-position-repository.js';

const PROJECTION_EVIDENCE_MIN_COMPLETED_POSITIONS = 30;
const PROJECTION_EVIDENCE_MIN_CALENDAR_DAYS = 30;

export class AggressivePerformanceRepository extends AggressivePositionRepository {
  getRecentPositions(limit = 20): AggressivePaperPosition[] {
    const safeLimit = Math.min(100, Math.max(1, Math.floor(limit)));
    const rows = this.database
      .prepare(
        `
      SELECT * FROM aggressive_paper_positions ORDER BY opened_at DESC, id DESC LIMIT ?
    `
      )
      .all(safeLimit) as Array<Record<string, string | number | null>>;
    return rows.map(row => this.mapPosition(row));
  }

  getActions(positionId: number, limit = 100): AggressivePaperActionRecord[] {
    const safeLimit = Math.min(1_000, Math.max(1, Math.floor(limit)));
    const rows = this.database
      .prepare(
        `
      SELECT * FROM aggressive_paper_actions
      WHERE position_id = ? ORDER BY created_at DESC, id DESC LIMIT ?
    `
      )
      .all(positionId, safeLimit) as Array<Record<string, string | number | null>>;
    return rows.map(row => this.mapAction(row));
  }

  getEvaluations(positionId: number, limit = 1_000): AggressivePaperEvaluationRecord[] {
    const safeLimit = Math.min(10_000, Math.max(1, Math.floor(limit)));
    const rows = this.database
      .prepare(
        `
      SELECT * FROM aggressive_paper_evaluations
      WHERE position_id = ? ORDER BY evaluated_at DESC, id DESC LIMIT ?
    `
      )
      .all(positionId, safeLimit) as Array<Record<string, string | number>>;
    return rows.map(row => this.mapEvaluation(row));
  }

  getLatestAction(): AggressivePaperActionRecord | null {
    const row = this.database
      .prepare(
        `
      SELECT * FROM aggressive_paper_actions ORDER BY created_at DESC, id DESC LIMIT 1
    `
      )
      .get() as Record<string, string | number | null> | undefined;
    return row ? this.mapAction(row) : null;
  }

  getLatestEvaluation(positionId?: number): AggressivePaperEvaluationRecord | null {
    const row =
      positionId === undefined
        ? this.database
            .prepare(
              `
          SELECT * FROM aggressive_paper_evaluations ORDER BY evaluated_at DESC, id DESC LIMIT 1
        `
            )
            .get()
        : this.database
            .prepare(
              `
          SELECT * FROM aggressive_paper_evaluations
          WHERE position_id = ? ORDER BY evaluated_at DESC, id DESC LIMIT 1
        `
            )
            .get(positionId);
    return row ? this.mapEvaluation(row as Record<string, string | number>) : null;
  }

  getAvailableCapital(initialCapitalUsd: number): number {
    const active = this.getActivePosition();
    if (active) return active.investmentUsd;
    const latest = this.getRecentPositions(1)[0];
    return latest?.status === 'CLOSED' ? latest.netLiquidationValueUsd : initialCapitalUsd;
  }

  getPerformance(initialCapitalUsd: number, now = new Date()): AggressivePaperPerformance {
    const positions = this.getRecentPositions(100).reverse();
    const activePosition = positions.find(position => position.status === 'OPEN') ?? null;
    const closed = positions.filter(position => position.status === 'CLOSED');
    const latestPosition = positions.at(-1) ?? null;
    const portfolioValueUsd =
      activePosition?.netLiquidationValueUsd ?? latestPosition?.netLiquidationValueUsd ?? initialCapitalUsd;
    const realizedPnlUsd = closed.reduce(
      (sum, position) => sum + position.netLiquidationValueUsd - position.investmentUsd,
      0
    );
    const unrealizedPnlUsd = activePosition
      ? activePosition.netLiquidationValueUsd - activePosition.investmentUsd
      : 0;
    const winningPositions = closed.filter(
      position => position.netLiquidationValueUsd > position.investmentUsd
    ).length;
    const losingPositions = closed.filter(
      position => position.netLiquidationValueUsd < position.investmentUsd
    ).length;
    const allEvaluations = this.database
      .prepare(
        `
      SELECT * FROM aggressive_paper_evaluations ORDER BY evaluated_at ASC, id ASC
    `
      )
      .all() as Array<Record<string, string | number>>;
    let peak = initialCapitalUsd;
    let maxDrawdownPercent = 0;
    for (const row of allEvaluations) {
      const value = Number(row.net_liquidation_value_usd);
      peak = Math.max(peak, value);
      if (peak > 0) maxDrawdownPercent = Math.max(maxDrawdownPercent, ((peak - value) / peak) * 100);
    }

    const projectionRows = this.database
      .prepare(
        `
      SELECT
        p.opened_at,
        p.closed_at,
        p.investment_usd,
        p.net_liquidation_value_usd,
        p.close_reason,
        e.metrics_json
      FROM aggressive_paper_positions p
      LEFT JOIN aggressive_paper_evaluations e ON e.id = (
        SELECT first_e.id
        FROM aggressive_paper_evaluations first_e
        WHERE first_e.position_id = p.id
        ORDER BY first_e.age_hours ASC, first_e.id ASC
        LIMIT 1
      )
      WHERE p.status = 'CLOSED'
      ORDER BY p.opened_at ASC, p.id ASC
    `
      )
      .all() as Array<Record<string, string | number | null>>;
    const projectedReturns = projectionRows
      .map(row => {
        if (row.metrics_json === null) return null;
        const metrics = JSON.parse(String(row.metrics_json)) as Record<string, unknown>;
        const value = Number(metrics.projectedNetReturn30dPercent);
        return Number.isFinite(value) ? value : null;
      })
      .filter((value): value is number => value !== null);
    const holdHours = projectionRows
      .map(row => {
        if (row.closed_at === null) return null;
        const value = (Date.parse(String(row.closed_at)) - Date.parse(String(row.opened_at))) / 3_600_000;
        return Number.isFinite(value) && value >= 0 ? value : null;
      })
      .filter((value): value is number => value !== null);
    const realizedCycleReturns = projectionRows.map(
      row => (Number(row.net_liquidation_value_usd) / Number(row.investment_usd) - 1) * 100
    );
    const firstOpenedAt = positions[0]?.openedAt;
    const observedCalendarDays = firstOpenedAt
      ? Math.max(0, (now.getTime() - Date.parse(firstOpenedAt)) / 86_400_000)
      : 0;
    const evidenceBlockers: string[] = [];
    if (closed.length < PROJECTION_EVIDENCE_MIN_COMPLETED_POSITIONS) {
      evidenceBlockers.push('INSUFFICIENT_COMPLETED_POSITIONS');
    }
    if (observedCalendarDays < PROJECTION_EVIDENCE_MIN_CALENDAR_DAYS) {
      evidenceBlockers.push('INSUFFICIENT_CALENDAR_DURATION');
    }
    const average = (values: number[]): number | null =>
      values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    const projectionEvidence: AggressiveProjectionEvidence = {
      status: evidenceBlockers.length === 0 ? 'OBSERVATION_READY' : 'INSUFFICIENT_SAMPLE',
      minimumCompletedPositions: PROJECTION_EVIDENCE_MIN_COMPLETED_POSITIONS,
      minimumObservedCalendarDays: PROJECTION_EVIDENCE_MIN_CALENDAR_DAYS,
      completedPositions: closed.length,
      observedCalendarDays,
      averageHoldHours: average(holdHours),
      averageProjectedNetReturn30dPercent: average(projectedReturns),
      averageRealizedCycleReturnPercent: average(realizedCycleReturns),
      targetHitRatePercent:
        closed.length > 0
          ? (closed.filter(position => position.closeReason === 'TAKE_PROFIT_10_PERCENT').length /
              closed.length) *
            100
          : null,
      noFeasibleRecenterRatePercent:
        closed.length > 0
          ? (closed.filter(position => position.closeReason === 'NO_FEASIBLE_RECENTER').length /
              closed.length) *
            100
          : null,
      blockers: evidenceBlockers,
      executionAuthority: false,
    };

    const annualizedReturnPercent =
      observedCalendarDays > 0 && portfolioValueUsd > 0
        ? (Math.pow(portfolioValueUsd / initialCapitalUsd, 365 / observedCalendarDays) - 1) * 100
        : null;

    return {
      initialCapitalUsd,
      portfolioValueUsd,
      portfolioPnlUsd: portfolioValueUsd - initialCapitalUsd,
      portfolioReturnPercent: (portfolioValueUsd / initialCapitalUsd - 1) * 100,
      annualizedReturnPercent,
      realizedPnlUsd,
      unrealizedPnlUsd,
      totalFeesUsd: positions.reduce((sum, position) => sum + position.accumulatedFeeUsd, 0),
      totalCostsIfExitUsd: positions.reduce(
        (sum, position) => sum + position.totalCostUsd + position.estimatedExitCostUsd,
        0
      ),
      completedPositions: closed.length,
      winningPositions,
      losingPositions,
      winRatePercent: closed.length > 0 ? (winningPositions / closed.length) * 100 : null,
      targetHits: closed.filter(position => position.closeReason === 'TAKE_PROFIT_10_PERCENT').length,
      stopLosses: closed.filter(position => position.closeReason === 'STOP_LOSS_5_PERCENT').length,
      totalRecenters: positions.reduce((sum, position) => sum + position.recenterCount, 0),
      maxDrawdownPercent,
      activePosition,
      latestEvaluation: activePosition
        ? this.getLatestEvaluation(activePosition.id)
        : this.getLatestEvaluation(),
      latestAction: this.getLatestAction(),
      projectionEvidence,
    };
  }

  count(): number {
    const row = this.database.prepare(`SELECT COUNT(*) AS count FROM aggressive_paper_positions`).get() as {
      count: number;
    };
    return Number(row.count);
  }

  close(): void {
    this.database.close();
  }
}
