import type { ScheduledTaskDefinition } from '../../../shared/runtime/scheduled-task.js';

export interface OperationsTaskService {
  runStorageMaintenance(): unknown;
}

export function createOperationsTasks(service: OperationsTaskService): readonly ScheduledTaskDefinition[] {
  return [
    {
      name: 'storage-maintenance',
      label: 'Storage maintenance',
      startupLabel: 'Initial storage maintenance',
      intervalMs: 24 * 60 * 60_000,
      registrationOrder: 90,
      run: () => service.runStorageMaintenance(),
      runOnStartup: true,
      readinessCritical: true,
    },
  ];
}
