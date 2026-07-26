import assert from 'node:assert/strict';
import test from 'node:test';

import { registerBnbSchedulers } from './app/register-schedulers.js';
import { createBnbScheduledTasks } from './app/scheduled-tasks.js';
import { SchedulerRegistry } from './shared/runtime/operational-controls.js';

function createTaskFixture(calls: string[]) {
  return createBnbScheduledTasks({
    marketData: {
      capturePoolSnapshot: () => calls.push('market-snapshot'),
      captureOnchainPoolState: () => calls.push('onchain-snapshot'),
    },
    lpExecution: {
      refreshAdapterVerification: () => calls.push('execution-adapter-verification'),
    },
    paperAgent: {
      runHourly: () => calls.push('paper-lifecycle'),
      evaluateDueDecisions: () => calls.push('paper-outcome'),
      runReflectionCycle: () => calls.push('reflection'),
    },
    directionalPaper: {
      runCycle: () => calls.push('directional-paper'),
    },
    learning: {
      runCycle: () => calls.push('learning'),
    },
    operations: {
      runStorageMaintenance: () => calls.push('storage-maintenance'),
    },
  });
}

const expectedTasks = [
  ['market-snapshot', 'Background snapshot', 'Initial snapshot', 60_000, true],
  ['onchain-snapshot', 'On-chain snapshot', 'Initial on-chain snapshot', 5 * 60_000, true],
  [
    'execution-adapter-verification',
    'Execution adapter verification',
    'Initial execution adapter verification',
    60 * 60_000,
    false,
  ],
  ['paper-lifecycle', 'Paper agent', 'Initial paper agent', 60_000, true],
  ['directional-paper', 'Directional paper agent', 'Initial directional paper agent', 60_000, true],
  ['paper-outcome', 'Paper outcome evaluator', 'Initial paper outcome evaluator', 60_000, true],
  ['learning', 'Learning cycle', 'Initial learning cycle', 60 * 60_000, false],
  ['reflection', 'Agent reflection cycle', 'Initial agent reflection', 60 * 60_000, false],
  ['storage-maintenance', 'Storage maintenance', 'Initial storage maintenance', 24 * 60 * 60_000, true],
] as const;

test('feature task contributions preserve the scheduler baseline', () => {
  const tasks = createTaskFixture([]);
  assert.deepEqual(
    tasks.map(task => [task.name, task.label, task.startupLabel, task.intervalMs, task.readinessCritical]),
    expectedTasks
  );
  assert.equal(
    tasks.every(task => task.runOnStartup),
    true
  );
  assert.equal(new Set(tasks.map(task => task.name)).size, tasks.length);
  assert.deepEqual(
    tasks.map(task => task.registrationOrder),
    [10, 20, 30, 40, 50, 60, 70, 80, 90]
  );
});

test('scheduler registers every contributed task once and runs startup tasks in baseline order', async () => {
  const calls: string[] = [];
  const scheduledTasks = createTaskFixture(calls);
  const schedulerRegistry = new SchedulerRegistry();
  const runtime = { schedulerRegistry, scheduledTasks };
  const controller = registerBnbSchedulers(runtime);
  controller.stop();
  await new Promise<void>(resolve => setImmediate(resolve));

  assert.deepEqual(
    schedulerRegistry.listTaskMetadata().map(task => task.name),
    expectedTasks.map(task => task[0])
  );
  assert.deepEqual(
    calls,
    expectedTasks.map(task => task[0])
  );
  assert.equal(schedulerRegistry.list().length, expectedTasks.length);
  assert.throws(() => registerBnbSchedulers(runtime), /already registered/);
});
