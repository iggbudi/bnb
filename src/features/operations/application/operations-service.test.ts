import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AsyncLock,
  ConcurrencyGate,
  SchedulerRegistry,
} from '../../../shared/runtime/operational-controls.js';
import type { ScheduledTaskDefinition } from '../../../shared/runtime/scheduled-task.js';
import { OperationsService, type OperationsServiceDependencies } from '../index.js';

function createService(schedulerRegistry: SchedulerRegistry): OperationsService {
  const capturedAt = new Date().toISOString();
  return new OperationsService({
    snapshotStore: {
      count: () => 1,
      getHistory: () => [{ capturedAt }],
    },
    onchainStore: {
      count: () => 1,
      getRecent: () => [{ capturedAt }],
    },
    agentStore: { count: () => 1 },
    directionalPaperStore: { getRecentRuns: () => [] },
    storageMaintenance: {
      getStatus: () => ({}),
      run: async () => ({
        backupCreated: true,
        deletedMarketSnapshots: 0,
        deletedOnchainSnapshots: 0,
        deletedDailyBackups: [],
        walCheckpoint: { busy: 0 },
      }),
    },
    schedulerRegistry,
    rpcHeavyGate: new ConcurrencyGate(1),
    openAiLock: new AsyncLock(),
    applicationSchemaVersion: 4,
    getAppliedMigrations: () => [{ version: 4, name: 'current' }],
    getActiveHttpRequests: () => 0,
    isShuttingDown: () => false,
    log: () => undefined,
  } as unknown as OperationsServiceDependencies);
}

function task(name: string, readinessCritical: boolean): ScheduledTaskDefinition {
  return {
    name,
    label: name,
    intervalMs: 60_000,
    registrationOrder: 1,
    readinessCritical,
    run: () => {
      throw new Error(`${name} failed`);
    },
  };
}

test('readiness derives critical scheduler failures from contributed task metadata', async () => {
  const schedulerRegistry = new SchedulerRegistry();
  const critical = task('feature-critical', true);
  const advisory = task('feature-advisory', false);
  schedulerRegistry.registerTasks([critical, advisory]);
  await assert.rejects(schedulerRegistry.run(critical.name, critical.run), /feature-critical failed/);
  await assert.rejects(schedulerRegistry.run(advisory.name, advisory.run), /feature-advisory failed/);

  const readiness = createService(schedulerRegistry).getReadiness();
  assert.equal(readiness.checks.schedulers.ready, false);
  assert.equal(readiness.checks.schedulers.detail, 'failed=feature-critical');
});
