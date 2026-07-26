import type { FeatureSchemaContribution } from '../../../shared/database/schema-contribution.js';
import { createAggressivePaperSchema } from './aggressive-paper-store.js';

export const aggressivePaperSchema: FeatureSchemaContribution = {
  feature: 'aggressive-paper',
  createSchema: createAggressivePaperSchema,
};
