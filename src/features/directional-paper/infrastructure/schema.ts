import type { FeatureSchemaContribution } from '../../../shared/database/schema-contribution.js';
import { createDirectionalPaperSchema } from './directional-paper-store.js';

export const directionalPaperSchema: FeatureSchemaContribution = {
  feature: 'directional-paper',
  createSchema: createDirectionalPaperSchema,
};
