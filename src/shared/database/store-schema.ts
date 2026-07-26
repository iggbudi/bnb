import type { DatabaseSync } from 'node:sqlite';

export interface StoreSchemaOptions {
  /** Test/fixture compatibility only. Production startup must bootstrap centrally. */
  initializeSchema?: boolean;
}

export function prepareStoreSchema(
  database: DatabaseSync,
  feature: string,
  requiredTables: readonly string[],
  createSchema: (database: DatabaseSync) => void,
  options: StoreSchemaOptions
): void {
  if (options.initializeSchema) createSchema(database);
  const missing = requiredTables.filter(table => {
    return !database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
  });
  if (missing.length > 0) {
    throw new Error(
      `Database schema for ${feature} is not initialized; missing: ${missing.join(', ')}. Run application bootstrap first.`
    );
  }
}
