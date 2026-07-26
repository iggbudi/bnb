import type { BnbRuntime } from './runtime.js';

export interface BnbSchedulerController {
  stop(): void;
}

export function registerBnbSchedulers(runtime: BnbRuntime): BnbSchedulerController {
  const timers: NodeJS.Timeout[] = [];

  const run = <T>(name: string, label: string, task: () => Promise<T> | T): void => {
    void runtime.schedulerRegistry.run(name, task).catch(error => {
      console.error(`${label} error:`, error);
    });
  };

  const schedule = (
    name: string,
    label: string,
    intervalMs: number,
    task: () => Promise<unknown> | unknown
  ): void => {
    const timer = setInterval(() => run(name, label, task), intervalMs);
    timer.unref();
    timers.push(timer);
  };

  const { tasks } = runtime;
  schedule('market-snapshot', 'Background snapshot', 60_000, tasks.capturePoolSnapshot);
  schedule('onchain-snapshot', 'On-chain snapshot', 5 * 60_000, tasks.captureOnchainPoolState);
  schedule(
    'execution-adapter-verification',
    'Execution adapter verification',
    60 * 60_000,
    tasks.refreshExecutionAdapterVerification
  );
  schedule('paper-lifecycle', 'Paper agent', 60_000, tasks.runHourlyPaperAgent);
  schedule('directional-paper', 'Directional paper agent', 60_000, tasks.runDirectionalPaperCycle);
  schedule('paper-outcome', 'Paper outcome evaluator', 60_000, tasks.evaluateDuePaperDecisions);
  schedule('learning', 'Learning cycle', 60 * 60_000, tasks.runLearningCycle);
  schedule('reflection', 'Agent reflection cycle', 60 * 60_000, tasks.runReflectionCycle);
  schedule('storage-maintenance', 'Storage maintenance', 24 * 60 * 60_000, tasks.runStorageMaintenance);

  run('market-snapshot', 'Initial snapshot', tasks.capturePoolSnapshot);
  run('onchain-snapshot', 'Initial on-chain snapshot', tasks.captureOnchainPoolState);
  run(
    'execution-adapter-verification',
    'Initial execution adapter verification',
    tasks.refreshExecutionAdapterVerification
  );
  run('paper-lifecycle', 'Initial paper agent', tasks.runHourlyPaperAgent);
  run('directional-paper', 'Initial directional paper agent', tasks.runDirectionalPaperCycle);
  run('paper-outcome', 'Initial paper outcome evaluator', tasks.evaluateDuePaperDecisions);
  run('learning', 'Initial learning cycle', tasks.runLearningCycle);
  run('reflection', 'Initial agent reflection', tasks.runReflectionCycle);
  run('storage-maintenance', 'Initial storage maintenance', tasks.runStorageMaintenance);

  return {
    stop() {
      for (const timer of timers) clearInterval(timer);
      timers.length = 0;
    },
  };
}
