import type { ScheduledTaskDefinition } from '../../../shared/runtime/scheduled-task.js';

export interface LearningTaskService {
  runCycle(): unknown;
}

export function createLearningTasks(service: LearningTaskService): readonly ScheduledTaskDefinition[] {
  return [
    {
      name: 'learning',
      label: 'Learning cycle',
      startupLabel: 'Initial learning cycle',
      intervalMs: 60 * 60_000,
      registrationOrder: 70,
      run: () => service.runCycle(),
      runOnStartup: true,
      readinessCritical: false,
    },
  ];
}
