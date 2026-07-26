import type { ScheduledTaskDefinition } from '../../../shared/runtime/scheduled-task.js';

export interface PaperAgentTaskService {
  runHourly(): unknown;
  evaluateDueDecisions(): unknown;
  runReflectionCycle(): unknown;
}

export function createPaperAgentTasks(service: PaperAgentTaskService): readonly ScheduledTaskDefinition[] {
  return [
    {
      name: 'paper-lifecycle',
      label: 'Paper agent',
      startupLabel: 'Initial paper agent',
      intervalMs: 60_000,
      registrationOrder: 40,
      run: () => service.runHourly(),
      runOnStartup: true,
      readinessCritical: true,
    },
    {
      name: 'paper-outcome',
      label: 'Paper outcome evaluator',
      startupLabel: 'Initial paper outcome evaluator',
      intervalMs: 60_000,
      registrationOrder: 60,
      run: () => service.evaluateDueDecisions(),
      runOnStartup: true,
      readinessCritical: true,
    },
    {
      name: 'reflection',
      label: 'Agent reflection cycle',
      startupLabel: 'Initial agent reflection',
      intervalMs: 60 * 60_000,
      registrationOrder: 80,
      run: () => service.runReflectionCycle(),
      runOnStartup: true,
      readinessCritical: false,
    },
  ];
}
