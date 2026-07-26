import type { ScheduledTaskDefinition } from '../../../shared/runtime/scheduled-task.js';

export interface LpExecutionTaskService {
  refreshAdapterVerification(): unknown;
}

export function createExecutionTasks(service: LpExecutionTaskService): readonly ScheduledTaskDefinition[] {
  return [
    {
      name: 'execution-adapter-verification',
      label: 'Execution adapter verification',
      startupLabel: 'Initial execution adapter verification',
      intervalMs: 60 * 60_000,
      registrationOrder: 30,
      run: () => service.refreshAdapterVerification(),
      runOnStartup: true,
      readinessCritical: false,
    },
  ];
}
