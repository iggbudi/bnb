import type { FeatureSchemaContribution } from '../../../shared/database/schema-contribution.js';
import { createPaperAgentSchema } from './agent-store.js';

export const paperAgentSchema: FeatureSchemaContribution = {
  feature: 'paper-agent',
  createSchema: createPaperAgentSchema,
};
