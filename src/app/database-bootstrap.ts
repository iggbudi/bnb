import { applicationDatabasePath, openApplicationDatabase } from '../shared/database/connection.js';
import type { AppliedMigration } from '../shared/database/migration-runner.js';
import { APPLICATION_MIGRATIONS, FEATURE_SCHEMA_CONTRIBUTIONS } from './migrations.js';
import { SchemaMigrationRunner } from '../shared/database/migration-runner.js';

/**
 * Establishes the complete application schema before any store is opened.
 *
 * The feature contributions are the single schema definition source. They are
 * reconciled transactionally first because historical migration v1 assumed
 * store-created tables already existed; migrations v1-v4 remain immutable.
 */
export function bootstrapApplicationDatabase(databasePath = applicationDatabasePath()): AppliedMigration[] {
  const database = openApplicationDatabase(databasePath, { foreignKeys: true });
  try {
    database.exec('BEGIN IMMEDIATE');
    try {
      for (const contribution of FEATURE_SCHEMA_CONTRIBUTIONS) {
        contribution.createSchema(database);
      }
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw new Error('Application schema bootstrap failed', { cause: error });
    }
  } finally {
    database.close();
  }

  return new SchemaMigrationRunner(databasePath, APPLICATION_MIGRATIONS).migrate();
}
