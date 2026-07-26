import type { DatabaseSync } from 'node:sqlite';

export interface FeatureSchemaContribution {
  feature: string;
  createSchema(database: DatabaseSync): void;
}
