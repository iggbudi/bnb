import type { FeatureSchemaContribution } from '../../../shared/database/schema-contribution.js';
import { createOnchainSnapshotSchema } from './onchain-store.js';
import { createMarketSnapshotSchema } from './snapshot-store.js';

export const marketDataSchema: FeatureSchemaContribution = {
  feature: 'market-data',
  createSchema(database) {
    createMarketSnapshotSchema(database);
    createOnchainSnapshotSchema(database);
  },
};
