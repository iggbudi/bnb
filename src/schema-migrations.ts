import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { createDirectionalPaperSchema } from './directional-paper-store.js';

export interface SchemaMigration {
  version: number;
  name: string;
  up(database: DatabaseSync): void;
}

export interface AppliedMigration {
  version: number;
  name: string;
  appliedAt: string;
}

export class SchemaMigrationRunner {
  constructor(
    private readonly databasePath: string,
    private readonly migrations: readonly SchemaMigration[]
  ) {}

  migrate(): AppliedMigration[] {
    if (this.databasePath !== ':memory:') {
      mkdirSync(dirname(this.databasePath), { recursive: true });
    }
    const database = new DatabaseSync(this.databasePath);
    try {
      database.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at TEXT NOT NULL
        );
      `);
      this.validateDefinitions();
      const appliedVersions = new Set(
        (database.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: number }>).map(
          row => Number(row.version)
        )
      );

      for (const migration of this.migrations) {
        if (appliedVersions.has(migration.version)) continue;
        database.exec('BEGIN IMMEDIATE');
        try {
          migration.up(database);
          database
            .prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
            .run(migration.version, migration.name, new Date().toISOString());
          database.exec('COMMIT');
        } catch (error) {
          database.exec('ROLLBACK');
          throw new Error(`Schema migration ${migration.version} (${migration.name}) failed`, {
            cause: error,
          });
        }
      }

      return (
        database
          .prepare('SELECT version, name, applied_at FROM schema_migrations ORDER BY version')
          .all() as Array<Record<string, string | number>>
      ).map(row => ({
        version: Number(row.version),
        name: String(row.name),
        appliedAt: String(row.applied_at),
      }));
    } finally {
      database.close();
    }
  }

  private validateDefinitions(): void {
    let previous = 0;
    const versions = new Set<number>();
    for (const migration of this.migrations) {
      if (
        !Number.isInteger(migration.version) ||
        migration.version <= previous ||
        versions.has(migration.version)
      ) {
        throw new Error('Schema migrations must have unique, strictly increasing positive versions');
      }
      if (!migration.name.trim()) throw new Error('Schema migration name must not be empty');
      versions.add(migration.version);
      previous = migration.version;
    }
  }
}

export const APPLICATION_MIGRATIONS: readonly SchemaMigration[] = [
  {
    version: 1,
    name: 'baseline_existing_store_schema',
    up(database) {
      database.exec(`
        CREATE TABLE IF NOT EXISTS application_metadata (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
    },
  },
  {
    version: 2,
    name: 'operational_query_indexes',
    up(database) {
      database.exec(`
        CREATE INDEX IF NOT EXISTS idx_pool_snapshots_captured_at
          ON pool_snapshots(captured_at DESC);
        CREATE INDEX IF NOT EXISTS idx_onchain_snapshots_captured_at_v2
          ON onchain_pool_snapshots(captured_at DESC);
      `);
    },
  },
  {
    version: 3,
    name: 'directional_perpetual_paper_ledger',
    up(database) {
      createDirectionalPaperSchema(database);
    },
  },
];

export const APPLICATION_SCHEMA_VERSION = APPLICATION_MIGRATIONS.at(-1)?.version ?? 0;

export function applicationDatabasePath(): string {
  return resolve(process.env.SQLITE_PATH || 'data/bnb-viewer.sqlite');
}

export function applyApplicationMigrations(databasePath = applicationDatabasePath()): AppliedMigration[] {
  return new SchemaMigrationRunner(databasePath, APPLICATION_MIGRATIONS).migrate();
}
