import type { SchedulerRegistry } from '../shared/runtime/operational-controls.js';
import type { ScheduledTaskDefinition } from '../shared/runtime/scheduled-task.js';

export interface BnbSchedulerController {
  stop(): void;
}

export interface BnbSchedulerRuntime {
  schedulerRegistry: SchedulerRegistry;
  scheduledTasks: readonly ScheduledTaskDefinition[];
}

export function registerBnbSchedulers(runtime: BnbSchedulerRuntime): BnbSchedulerController {
  const timers: NodeJS.Timeout[] = [];

  const run = (task: ScheduledTaskDefinition, label: string): void => {
    void runtime.schedulerRegistry.run(task.name, task.run).catch(error => {
      console.error(`${label} error:`, error);
    });
  };

  runtime.schedulerRegistry.registerTasks(runtime.scheduledTasks);
  for (const task of runtime.scheduledTasks) {
    const timer = setInterval(() => run(task, task.label), task.intervalMs);
    timer.unref();
    timers.push(timer);
  }
  for (const task of runtime.scheduledTasks) {
    if (task.runOnStartup) run(task, task.startupLabel ?? task.label);
  }

  return {
    stop() {
      for (const timer of timers) clearInterval(timer);
      timers.length = 0;
    },
  };
}
