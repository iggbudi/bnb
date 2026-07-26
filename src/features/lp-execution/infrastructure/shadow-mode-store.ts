import { DatabaseSync } from 'node:sqlite';
import { applicationDatabasePath, openApplicationDatabase } from '../../../shared/database/connection.js';
import { FULL_RANGE_FEE_ACCOUNTING_VERSION } from '../../lp-analysis/index.js';
import type { PaperAgentDecision } from '../../paper-agent/index.js';
import type { PaperPositionLifecycleResult } from '../application/paper-position-manager.js';

const TARGET_DAYS = 14;
const REQUIRED_COVERAGE_PERCENT = 95;

export interface ShadowRunRecord {
  id: number;
  startedAt: string;
  targetEndAt: string;
  endedAt: string | null;
  status: 'RUNNING' | 'QUALIFIED' | 'RESET';
  reason: string;
}

export interface ShadowObservationRecord {
  id: number;
  runId: number;
  observedHour: string;
  observedAt: string;
  decisionId: number | null;
  signalAction: string | null;
  lifecycleAction: string | null;
  reasonCode: string | null;
  positionId: number | null;
  positionStatus: string | null;
  evaluationId: number | null;
  dataQuality: string | null;
  success: boolean;
  hadError: boolean;
  errorMessage: string | null;
}

export interface ShadowValidationStatus {
  mode: 'SHADOW';
  targetDays: 14;
  requiredCoveragePercent: 95;
  run: ShadowRunRecord;
  elapsedHours: number;
  remainingHours: number;
  expectedHourlyObservations: number;
  observedHours: number;
  successfulHours: number;
  errorHours: number;
  coveragePercent: number;
  completed14dPaperPositions: number;
  valid14dFinalEvaluations: number;
  qualified: boolean;
  blockers: string[];
}

function startOfUtcHour(value: Date): string {
  const hour = new Date(value);
  hour.setUTCMinutes(0, 0, 0);
  return hour.toISOString();
}

export function createShadowModeSchema(database: DatabaseSync): void {
  database.exec(`

      CREATE TABLE IF NOT EXISTS lifecycle_shadow_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at TEXT NOT NULL,
        target_end_at TEXT NOT NULL,
        ended_at TEXT,
        status TEXT NOT NULL CHECK (status IN ('RUNNING', 'QUALIFIED', 'RESET')),
        reason TEXT NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_shadow_runs_one_current
        ON lifecycle_shadow_runs((1))
        WHERE status IN ('RUNNING', 'QUALIFIED');

      CREATE TABLE IF NOT EXISTS lifecycle_shadow_observations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id INTEGER NOT NULL,
        observed_hour TEXT NOT NULL,
        observed_at TEXT NOT NULL,
        decision_id INTEGER,
        signal_action TEXT,
        lifecycle_action TEXT,
        reason_code TEXT,
        position_id INTEGER,
        position_status TEXT,
        evaluation_id INTEGER,
        data_quality TEXT,
        success INTEGER NOT NULL,
        had_error INTEGER NOT NULL,
        error_message TEXT,
        UNIQUE(run_id, observed_hour),
        FOREIGN KEY(run_id) REFERENCES lifecycle_shadow_runs(id)
      );

      CREATE INDEX IF NOT EXISTS idx_shadow_observations_hour
        ON lifecycle_shadow_observations(run_id, observed_hour DESC);
    `);
}

export class ShadowModeStore {
  private readonly database: DatabaseSync;

  constructor(databasePath = applicationDatabasePath(), now = new Date()) {
    this.database = openApplicationDatabase(databasePath, { foreignKeys: true });
    createShadowModeSchema(this.database);
    this.ensureCurrentRun(now, 'Stage F shadow validation started.');
  }

  ensureCurrentRun(now = new Date(), reason = 'Shadow validation started.'): ShadowRunRecord {
    const current = this.getCurrentRun();
    if (current) return current;
    const targetEndAt = new Date(now.getTime() + TARGET_DAYS * 24 * 60 * 60 * 1_000);
    const result = this.database
      .prepare(
        `
      INSERT INTO lifecycle_shadow_runs (
        started_at, target_end_at, ended_at, status, reason
      ) VALUES (?, ?, NULL, 'RUNNING', ?)
    `
      )
      .run(now.toISOString(), targetEndAt.toISOString(), reason);
    return this.getRun(Number(result.lastInsertRowid))!;
  }

  recordSuccess(
    decision: PaperAgentDecision,
    result: PaperPositionLifecycleResult,
    now = new Date()
  ): ShadowObservationRecord {
    const run = this.ensureCurrentRun(now);
    const hour = startOfUtcHour(now);
    const existing = this.getObservationByHour(run.id, hour);
    if (existing?.success) return existing;
    this.database
      .prepare(
        `
      INSERT INTO lifecycle_shadow_observations (
        run_id, observed_hour, observed_at, decision_id, signal_action,
        lifecycle_action, reason_code, position_id, position_status,
        evaluation_id, data_quality, success, had_error, error_message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, NULL)
      ON CONFLICT(run_id, observed_hour) DO UPDATE SET
        observed_at = excluded.observed_at,
        decision_id = excluded.decision_id,
        signal_action = excluded.signal_action,
        lifecycle_action = excluded.lifecycle_action,
        reason_code = excluded.reason_code,
        position_id = excluded.position_id,
        position_status = excluded.position_status,
        evaluation_id = excluded.evaluation_id,
        data_quality = excluded.data_quality,
        success = 1
    `
      )
      .run(
        run.id,
        hour,
        now.toISOString(),
        decision.id,
        decision.action,
        result.action,
        result.reasonCode,
        result.position?.id ?? null,
        result.position?.status ?? null,
        result.evaluation?.id ?? null,
        result.evaluation?.dataQuality ?? null
      );
    if (now.getTime() >= new Date(run.targetEndAt).getTime()) this.refreshQualification(now);
    return this.getObservationByHour(run.id, hour)!;
  }

  recordFailure(
    decision: PaperAgentDecision | null,
    error: unknown,
    now = new Date()
  ): ShadowObservationRecord {
    const run = this.ensureCurrentRun(now);
    const hour = startOfUtcHour(now);
    const message = error instanceof Error ? error.message : 'Unknown shadow lifecycle error';
    this.database
      .prepare(
        `
      INSERT INTO lifecycle_shadow_observations (
        run_id, observed_hour, observed_at, decision_id, signal_action,
        lifecycle_action, reason_code, position_id, position_status,
        evaluation_id, data_quality, success, had_error, error_message
      ) VALUES (?, ?, ?, ?, ?, NULL, 'SHADOW_PROCESSING_ERROR', NULL, NULL, NULL, NULL, 0, 1, ?)
      ON CONFLICT(run_id, observed_hour) DO UPDATE SET
        observed_at = excluded.observed_at,
        decision_id = COALESCE(excluded.decision_id, decision_id),
        signal_action = COALESCE(excluded.signal_action, signal_action),
        success = 0,
        had_error = 1,
        error_message = excluded.error_message
    `
      )
      .run(
        run.id,
        hour,
        now.toISOString(),
        decision?.id ?? null,
        decision?.action ?? null,
        message.slice(0, 1_000)
      );
    this.database
      .prepare(
        `
      UPDATE lifecycle_shadow_runs SET status = 'RUNNING' WHERE id = ?
    `
      )
      .run(run.id);
    return this.getObservationByHour(run.id, hour)!;
  }

  getStatus(now = new Date()): ShadowValidationStatus {
    const run = this.ensureCurrentRun(now);
    const elapsedHours = Math.max(0, (now.getTime() - new Date(run.startedAt).getTime()) / (60 * 60 * 1_000));
    const expectedHourlyObservations = Math.max(1, Math.floor(elapsedHours) + 1);
    const counts = this.database
      .prepare(
        `
      SELECT
        COUNT(*) AS observed,
        COALESCE(SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END), 0) AS successful,
        COALESCE(SUM(CASE WHEN had_error = 1 THEN 1 ELSE 0 END), 0) AS errors
      FROM lifecycle_shadow_observations WHERE run_id = ?
    `
      )
      .get(run.id) as { observed: number; successful: number; errors: number };
    const coveragePercent = Math.min(100, (Number(counts.successful) / expectedHourlyObservations) * 100);
    const completed = this.database
      .prepare(
        `
      SELECT COUNT(*) AS count
      FROM paper_positions pp
      JOIN paper_agent_decisions d ON d.id = pp.entry_decision_id
      WHERE pp.mode = 'PAPER' AND pp.status = 'CLOSED'
        AND pp.opened_at >= ? AND pp.closed_at IS NOT NULL
        AND pp.accounting_version = ?
        AND (d.strategy_version = 'lifecycle-v2.1' OR d.strategy_version LIKE 'logistic-%')
        AND (julianday(pp.closed_at) - julianday(pp.opened_at)) * 24 >= 335
        AND pp.exit_reason = 'PAPER_MAX_HOLD_REACHED'
    `
      )
      .get(run.startedAt, FULL_RANGE_FEE_ACCOUNTING_VERSION) as { count: number };
    const validFinal = this.database
      .prepare(
        `
      SELECT COUNT(DISTINCT pe.position_id) AS count
      FROM position_evaluations pe
      JOIN paper_positions pp ON pp.id = pe.position_id
      JOIN paper_agent_decisions d ON d.id = pp.entry_decision_id
      WHERE pp.mode = 'PAPER' AND pp.opened_at >= ?
        AND pp.accounting_version = ?
        AND (d.strategy_version = 'lifecycle-v2.1' OR d.strategy_version LIKE 'logistic-%')
        AND pe.age_hours >= 335 AND pe.data_quality = 'valid'
        AND json_extract(pe.metrics_json, '$.accountingVersion') = ?
    `
      )
      .get(run.startedAt, FULL_RANGE_FEE_ACCOUNTING_VERSION, FULL_RANGE_FEE_ACCOUNTING_VERSION) as {
      count: number;
    };

    const blockers: string[] = [];
    if (elapsedHours < TARGET_DAYS * 24) blockers.push('SHADOW_MINIMUM_14_DAYS_NOT_REACHED');
    if (coveragePercent < REQUIRED_COVERAGE_PERCENT) blockers.push('SHADOW_HOURLY_COVERAGE_BELOW_95_PERCENT');
    if (Number(counts.errors) > 0) blockers.push('SHADOW_PROCESSING_ERRORS_PRESENT');
    if (Number(completed.count) < 1) blockers.push('NO_COMPLETED_14D_PAPER_POSITION');
    if (Number(validFinal.count) < 1) blockers.push('NO_VALID_14D_FINAL_EVALUATION');

    return {
      mode: 'SHADOW',
      targetDays: TARGET_DAYS,
      requiredCoveragePercent: REQUIRED_COVERAGE_PERCENT,
      run,
      elapsedHours,
      remainingHours: Math.max(0, TARGET_DAYS * 24 - elapsedHours),
      expectedHourlyObservations,
      observedHours: Number(counts.observed),
      successfulHours: Number(counts.successful),
      errorHours: Number(counts.errors),
      coveragePercent,
      completed14dPaperPositions: Number(completed.count),
      valid14dFinalEvaluations: Number(validFinal.count),
      qualified: blockers.length === 0,
      blockers,
    };
  }

  refreshQualification(now = new Date()): ShadowValidationStatus {
    const status = this.getStatus(now);
    const persistedStatus = status.qualified ? 'QUALIFIED' : 'RUNNING';
    if (status.run.status !== persistedStatus) {
      this.database
        .prepare(
          `
        UPDATE lifecycle_shadow_runs SET status = ? WHERE id = ?
      `
        )
        .run(persistedStatus, status.run.id);
      return this.getStatus(now);
    }
    return status;
  }

  reset(reason: string, now = new Date()): ShadowValidationStatus {
    if (reason.trim().length < 5) throw new Error('Shadow reset reason is too short');
    const current = this.getCurrentRun();
    if (current) {
      this.database
        .prepare(
          `
        UPDATE lifecycle_shadow_runs
        SET status = 'RESET', ended_at = ? WHERE id = ?
      `
        )
        .run(now.toISOString(), current.id);
    }
    this.ensureCurrentRun(now, reason.trim());
    return this.getStatus(now);
  }

  getObservations(limit = 336): ShadowObservationRecord[] {
    const run = this.getCurrentRun();
    if (!run) return [];
    const safeLimit = Math.min(1_000, Math.max(1, Math.floor(limit)));
    const rows = this.database
      .prepare(
        `
      SELECT * FROM lifecycle_shadow_observations
      WHERE run_id = ? ORDER BY observed_hour DESC LIMIT ?
    `
      )
      .all(run.id, safeLimit) as Array<Record<string, string | number | null>>;
    return rows.map(row => this.mapObservation(row));
  }

  close(): void {
    this.database.close();
  }

  private getCurrentRun(): ShadowRunRecord | null {
    const row = this.database
      .prepare(
        `
      SELECT * FROM lifecycle_shadow_runs
      WHERE status IN ('RUNNING', 'QUALIFIED') ORDER BY id DESC LIMIT 1
    `
      )
      .get() as Record<string, string | number | null> | undefined;
    return row ? this.mapRun(row) : null;
  }

  private getRun(id: number): ShadowRunRecord | null {
    const row = this.database.prepare(`SELECT * FROM lifecycle_shadow_runs WHERE id = ?`).get(id) as
      Record<string, string | number | null> | undefined;
    return row ? this.mapRun(row) : null;
  }

  private getObservationByHour(runId: number, hour: string): ShadowObservationRecord | null {
    const row = this.database
      .prepare(
        `
      SELECT * FROM lifecycle_shadow_observations WHERE run_id = ? AND observed_hour = ?
    `
      )
      .get(runId, hour) as Record<string, string | number | null> | undefined;
    return row ? this.mapObservation(row) : null;
  }

  private mapRun(row: Record<string, string | number | null>): ShadowRunRecord {
    return {
      id: Number(row.id),
      startedAt: String(row.started_at),
      targetEndAt: String(row.target_end_at),
      endedAt: row.ended_at === null ? null : String(row.ended_at),
      status: String(row.status) as ShadowRunRecord['status'],
      reason: String(row.reason),
    };
  }

  private mapObservation(row: Record<string, string | number | null>): ShadowObservationRecord {
    return {
      id: Number(row.id),
      runId: Number(row.run_id),
      observedHour: String(row.observed_hour),
      observedAt: String(row.observed_at),
      decisionId: row.decision_id === null ? null : Number(row.decision_id),
      signalAction: row.signal_action === null ? null : String(row.signal_action),
      lifecycleAction: row.lifecycle_action === null ? null : String(row.lifecycle_action),
      reasonCode: row.reason_code === null ? null : String(row.reason_code),
      positionId: row.position_id === null ? null : Number(row.position_id),
      positionStatus: row.position_status === null ? null : String(row.position_status),
      evaluationId: row.evaluation_id === null ? null : Number(row.evaluation_id),
      dataQuality: row.data_quality === null ? null : String(row.data_quality),
      success: Number(row.success) === 1,
      hadError: Number(row.had_error) === 1,
      errorMessage: row.error_message === null ? null : String(row.error_message),
    };
  }
}
