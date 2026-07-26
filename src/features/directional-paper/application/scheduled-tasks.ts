import type { ScheduledTaskDefinition } from '../../../shared/runtime/scheduled-task.js';

export interface DirectionalPaperTaskService {
  runCycle(): unknown;
}

export function createDirectionalPaperTasks(
  service: DirectionalPaperTaskService
): readonly ScheduledTaskDefinition[] {
  return [
    {
      name: 'directional-paper',
      label: 'Directional paper agent',
      startupLabel: 'Initial directional paper agent',
      intervalMs: 60_000,
      registrationOrder: 50,
      run: () => service.runCycle(),
      runOnStartup: true,
      readinessCritical: true,
    },
  ];
}
