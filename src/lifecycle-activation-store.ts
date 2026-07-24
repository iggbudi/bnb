import 'dotenv/config';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const DEFAULT_DATABASE_PATH = resolve(process.env.SQLITE_PATH || 'data/bnb-viewer.sqlite');

export type LifecycleRuntimeMode = 'SHADOW' | 'PAPER_ACTIVE';

export interface LifecycleActivationState {
  mode: LifecycleRuntimeMode;
  updatedAt: string;
  activatedAt: string | null;
  qualifiedShadowRunId: number | null;
  reason: string;
  paperOnly: true;
  liveExecutionChanged: false;
}

export interface LifecycleActivationEvent {
  id: number;
  createdAt: string;
  eventType: 'PAPER_ACTIVATED' | 'RETURNED_TO_SHADOW';
  fromMode: LifecycleRuntimeMode;
  toMode: LifecycleRuntimeMode;
  shadowRunId: number | null;
  reason: string;
}

export class LifecycleActivationStore {
  private readonly database: DatabaseSync;

  constructor(databasePath = DEFAULT_DATABASE_PATH, now = new Date()) {
    if (databasePath !== ':memory:') mkdirSync(dirname(databasePath), { recursive: true });
    this.database = new DatabaseSync(databasePath);
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;

      CREATE TABLE IF NOT EXISTS lifecycle_activation_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        mode TEXT NOT NULL CHECK (mode IN ('SHADOW', 'PAPER_ACTIVE')),
        updated_at TEXT NOT NULL,
        activated_at TEXT,
        qualified_shadow_run_id INTEGER,
        reason TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS lifecycle_activation_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL,
        event_type TEXT NOT NULL CHECK (event_type IN ('PAPER_ACTIVATED', 'RETURNED_TO_SHADOW')),
        from_mode TEXT NOT NULL CHECK (from_mode IN ('SHADOW', 'PAPER_ACTIVE')),
        to_mode TEXT NOT NULL CHECK (to_mode IN ('SHADOW', 'PAPER_ACTIVE')),
        shadow_run_id INTEGER,
        reason TEXT NOT NULL
      );
    `);
    this.database
      .prepare(
        `
      INSERT OR IGNORE INTO lifecycle_activation_state (
        id, mode, updated_at, activated_at, qualified_shadow_run_id, reason
      ) VALUES (1, 'SHADOW', ?, NULL, NULL, 'Stage G defaults to shadow until every activation gate passes.')
    `
      )
      .run(now.toISOString());
  }

  getState(): LifecycleActivationState {
    const row = this.database
      .prepare(`SELECT * FROM lifecycle_activation_state WHERE id = 1`)
      .get() as Record<string, string | number | null>;
    return {
      mode: String(row.mode) as LifecycleRuntimeMode,
      updatedAt: String(row.updated_at),
      activatedAt: row.activated_at === null ? null : String(row.activated_at),
      qualifiedShadowRunId: row.qualified_shadow_run_id === null ? null : Number(row.qualified_shadow_run_id),
      reason: String(row.reason),
      paperOnly: true,
      liveExecutionChanged: false,
    };
  }

  activatePaper(input: {
    shadowQualified: boolean;
    shadowRunId: number;
    shadowBlockers: string[];
    confirmPaperOnly: boolean;
    reason: string;
    now?: Date;
  }): LifecycleActivationState {
    if (!input.confirmPaperOnly) throw new Error('confirmPaperOnly=true is required');
    if (input.reason.trim().length < 5) throw new Error('Activation reason is too short');
    if (!input.shadowQualified) {
      throw new Error(`SHADOW_VALIDATION_NOT_QUALIFIED: ${input.shadowBlockers.join(', ')}`);
    }
    if (!Number.isInteger(input.shadowRunId) || input.shadowRunId <= 0) {
      throw new Error('A qualified shadow run is required');
    }
    const current = this.getState();
    if (current.mode === 'PAPER_ACTIVE') return current;
    const now = input.now ?? new Date();
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database
        .prepare(
          `
        UPDATE lifecycle_activation_state
        SET mode = 'PAPER_ACTIVE', updated_at = ?, activated_at = ?,
            qualified_shadow_run_id = ?, reason = ?
        WHERE id = 1 AND mode = 'SHADOW'
      `
        )
        .run(now.toISOString(), now.toISOString(), input.shadowRunId, input.reason.trim());
      this.insertEvent(
        'PAPER_ACTIVATED',
        'SHADOW',
        'PAPER_ACTIVE',
        input.shadowRunId,
        input.reason.trim(),
        now
      );
      this.database.exec('COMMIT');
      return this.getState();
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  returnToShadow(reason: string, now = new Date()): LifecycleActivationState {
    if (reason.trim().length < 5) throw new Error('Return-to-shadow reason is too short');
    const current = this.getState();
    if (current.mode === 'SHADOW') return current;
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database
        .prepare(
          `
        UPDATE lifecycle_activation_state
        SET mode = 'SHADOW', updated_at = ?, reason = ? WHERE id = 1
      `
        )
        .run(now.toISOString(), reason.trim());
      this.insertEvent(
        'RETURNED_TO_SHADOW',
        'PAPER_ACTIVE',
        'SHADOW',
        current.qualifiedShadowRunId,
        reason.trim(),
        now
      );
      this.database.exec('COMMIT');
      return this.getState();
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  getEvents(limit = 100): LifecycleActivationEvent[] {
    const safeLimit = Math.min(500, Math.max(1, Math.floor(limit)));
    const rows = this.database
      .prepare(
        `
      SELECT * FROM lifecycle_activation_events ORDER BY created_at DESC, id DESC LIMIT ?
    `
      )
      .all(safeLimit) as Array<Record<string, string | number | null>>;
    return rows.map(row => ({
      id: Number(row.id),
      createdAt: String(row.created_at),
      eventType: String(row.event_type) as LifecycleActivationEvent['eventType'],
      fromMode: String(row.from_mode) as LifecycleRuntimeMode,
      toMode: String(row.to_mode) as LifecycleRuntimeMode,
      shadowRunId: row.shadow_run_id === null ? null : Number(row.shadow_run_id),
      reason: String(row.reason),
    }));
  }

  close(): void {
    this.database.close();
  }

  private insertEvent(
    eventType: LifecycleActivationEvent['eventType'],
    fromMode: LifecycleRuntimeMode,
    toMode: LifecycleRuntimeMode,
    shadowRunId: number | null,
    reason: string,
    now: Date
  ): void {
    this.database
      .prepare(
        `
      INSERT INTO lifecycle_activation_events (
        created_at, event_type, from_mode, to_mode, shadow_run_id, reason
      ) VALUES (?, ?, ?, ?, ?, ?)
    `
      )
      .run(now.toISOString(), eventType, fromMode, toMode, shadowRunId, reason);
  }
}
