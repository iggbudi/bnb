import type { FeatureSchemaContribution } from '../../../shared/database/schema-contribution.js';
import { createLifecycleActivationSchema } from './lifecycle-activation-store.js';

export const learningSchema: FeatureSchemaContribution = {
  feature: 'learning',
  createSchema: createLifecycleActivationSchema,
};
