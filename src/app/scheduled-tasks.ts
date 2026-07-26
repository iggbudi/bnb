import { createAggressivePaperTasks } from '../features/aggressive-paper/index.js';
import {
  createDirectionalPaperTasks,
  type DirectionalPaperTaskService,
} from '../features/directional-paper/index.js';
import { createLearningTasks, type LearningTaskService } from '../features/learning/index.js';
import { createLpAnalysisTasks } from '../features/lp-analysis/index.js';
import { createExecutionTasks, type LpExecutionTaskService } from '../features/lp-execution/index.js';
import { createMarketDataTasks, type MarketDataTaskService } from '../features/market-data/index.js';
import { createOperationsTasks, type OperationsTaskService } from '../features/operations/index.js';
import { createPaperAgentTasks, type PaperAgentTaskService } from '../features/paper-agent/index.js';
import type { ScheduledTaskDefinition } from '../shared/runtime/scheduled-task.js';

export interface BnbScheduledTaskServices {
  directionalPaper: DirectionalPaperTaskService;
  learning: LearningTaskService;
  lpExecution: LpExecutionTaskService;
  marketData: MarketDataTaskService;
  operations: OperationsTaskService;
  paperAgent: PaperAgentTaskService;
}

export function createBnbScheduledTasks(
  services: BnbScheduledTaskServices
): readonly ScheduledTaskDefinition[] {
  const tasks = [
    ...createMarketDataTasks(services.marketData),
    ...createLpAnalysisTasks(),
    ...createPaperAgentTasks(services.paperAgent),
    ...createAggressivePaperTasks(),
    ...createDirectionalPaperTasks(services.directionalPaper),
    ...createLearningTasks(services.learning),
    ...createExecutionTasks(services.lpExecution),
    ...createOperationsTasks(services.operations),
  ];
  return tasks.sort((left, right) => left.registrationOrder - right.registrationOrder);
}
