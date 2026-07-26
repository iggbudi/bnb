import type { DatabaseSync } from 'node:sqlite';
import { openApplicationDatabase } from './connection.js';

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
    const database = openApplicationDatabase(this.databasePath);
    try {
      database.exec(`
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
