import { aggressivePaperSchema } from '../features/aggressive-paper/index.js';
import { createDirectionalPaperSchema, directionalPaperSchema } from '../features/directional-paper/index.js';
import { learningSchema } from '../features/learning/index.js';
import { lpExecutionSchema } from '../features/lp-execution/index.js';
import { marketDataSchema } from '../features/market-data/index.js';
import { paperAgentSchema } from '../features/paper-agent/index.js';
import { applicationDatabasePath } from '../shared/database/connection.js';
import {
  SchemaMigrationRunner,
  type AppliedMigration,
  type SchemaMigration,
} from '../shared/database/migration-runner.js';

export const FEATURE_SCHEMA_CONTRIBUTIONS = [
  marketDataSchema,
  paperAgentSchema,
  aggressivePaperSchema,
  directionalPaperSchema,
  learningSchema,
  lpExecutionSchema,
] as const;

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
  {
    version: 4,
    name: 'feature_schema_ownership_registry',
    up(database) {
      for (const contribution of FEATURE_SCHEMA_CONTRIBUTIONS) {
        contribution.createSchema(database);
      }
    },
  },
];

export const APPLICATION_SCHEMA_VERSION = APPLICATION_MIGRATIONS.at(-1)?.version ?? 0;

export function applyApplicationMigrations(databasePath = applicationDatabasePath()): AppliedMigration[] {
  return new SchemaMigrationRunner(databasePath, APPLICATION_MIGRATIONS).migrate();
}
