import assert from 'node:assert/strict';
import express from 'express';
import test from 'node:test';

import { registerLpExecutionRoutes, type LpExecutionRouteDependencies } from './index.js';

const lifecycleRuntime = {
  activation: { mode: 'SHADOW' },
  activationEligible: false,
  shadowValidation: {
    qualified: false,
    run: { id: 1 },
    blockers: ['MINIMUM_DURATION_NOT_MET'],
  },
};

test('LP execution slice owns lifecycle, position, and execution route contracts', async () => {
  const app = express();
  app.use(express.json());
  const positionStore = {
    getActivePosition: () => null,
    getRecentLiveNfts: () => [],
    count: () => 0,
    getRecentActions: () => [],
    getRecentPositions: () => [],
    getPosition: () => null,
  } as unknown as LpExecutionRouteDependencies['lifecycle']['positionStore'];
  const executionStore = {
    getRecentExitProposals: () => [],
    getExitProposalsForPosition: () => [],
    getRecentAudit: (limit: number) => [{ id: 1, limit }],
  } as unknown as LpExecutionRouteDependencies['lifecycle']['executionStore'];
  const lifecycleActivationStore = {
    getEvents: (limit: number) => [{ id: 1, limit }],
  } as unknown as LpExecutionRouteDependencies['lifecycle']['lifecycleActivationStore'];
  const shadowModeStore = {
    getObservations: (limit: number) => [{ id: 1, limit }],
  } as unknown as LpExecutionRouteDependencies['lifecycle']['shadowModeStore'];
  const agentStore = {} as LpExecutionRouteDependencies['execution']['agentStore'];

  registerLpExecutionRoutes(app, {
    lifecycle: {
      positionStore,
      executionStore,
      lifecycleActivationStore,
      shadowModeStore,
      lifecycleEnabled: false,
      mintReceiptMinimumConfirmations: 3,
      reconcileLifecycle: () => lifecycleRuntime,
      isAdminAuthorized: () => false,
      isExecutionAdapterReady: () => false,
      isExitSwapRouterReady: () => false,
    },
    execution: {
      agentStore,
      executionStore,
      positionStore,
      limits: { maxCapitalUsd: 100, maxDailyLossUsd: 5, proposalExpiryMinutes: 15 },
      mintReceiptMinimumConfirmations: 3,
      getExecutionStatus: () => ({ ready: false, blockers: ['LIVE_EXECUTION_DISABLED'] }),
      isAdminAuthorized: () => false,
      async captureOnchainState() {
        throw new Error('not called');
      },
      isExecutionAdapterReady: () => false,
      setExecutionAdapterReady: () => undefined,
      isExitSwapRouterReady: () => false,
      setExitSwapRouterReady: () => undefined,
    },
  });

  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const address = server.address();
  assert(address && typeof address === 'object');
  const request = (path: string, init?: RequestInit) =>
    fetch(`http://127.0.0.1:${address.port}${path}`, init);

  try {
    const activation = await request('/api/lifecycle/activation');
    assert.equal(activation.status, 200);
    assert.equal(
      ((await activation.json()) as { data: { activationEligible: boolean } }).data.activationEligible,
      false
    );

    const shadow = await request('/api/shadow/status');
    assert.equal(shadow.status, 200);
    assert.equal(((await shadow.json()) as { data: { lifecycleMode: string } }).data.lifecycleMode, 'SHADOW');

    const observations = await request('/api/shadow/observations?limit=12');
    assert.equal(observations.status, 200);
    assert.equal(
      ((await observations.json()) as { data: { observations: Array<{ limit: number }> } }).data
        .observations[0].limit,
      12
    );

    const positions = await request('/api/positions/status');
    assert.equal(positions.status, 200);
    assert.equal(((await positions.json()) as { data: { totalPositions: number } }).data.totalPositions, 0);
    assert.equal((await request('/api/positions/999')).status, 404);

    const execution = await request('/api/execution/status');
    assert.equal(execution.status, 200);
    assert.equal(((await execution.json()) as { data: { ready: boolean } }).data.ready, false);

    const audit = await request('/api/execution/audit?limit=9');
    assert.equal(audit.status, 200);
    assert.equal(
      ((await audit.json()) as { data: { events: Array<{ limit: number }> } }).data.events[0].limit,
      9
    );

    for (const path of [
      '/api/lifecycle/activate-paper',
      '/api/lifecycle/return-to-shadow',
      '/api/shadow/reset',
      '/api/execution/kill-switch',
      '/api/execution/proposals',
      '/api/execution/exit-proposals',
    ]) {
      assert.equal((await request(path, { method: 'POST', body: '{}' })).status, 401);
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
  }
});
