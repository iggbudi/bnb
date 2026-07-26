import type { FeatureSchemaContribution } from '../../../shared/database/schema-contribution.js';
import { createExecutionControlSchema, ensureExecutionControlSchema } from './execution-store.js';
import { createPositionLifecycleSchema, ensurePositionLifecycleSchema } from './position-store.js';
import { createShadowModeSchema } from './shadow-mode-store.js';

export const lpExecutionSchema: FeatureSchemaContribution = {
  feature: 'lp-execution',
  createSchema(database) {
    createPositionLifecycleSchema(database);
    ensurePositionLifecycleSchema(database);
    createShadowModeSchema(database);
    createExecutionControlSchema(database);
    ensureExecutionControlSchema(database);
  },
};
