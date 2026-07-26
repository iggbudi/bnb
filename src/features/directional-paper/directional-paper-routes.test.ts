import assert from 'node:assert/strict';
import express from 'express';
import test from 'node:test';

import { DEFAULT_DIRECTIONAL_CONFIG } from './index.js';
import { registerDirectionalPaperRoutes, type DirectionalPaperRouteDependencies } from './index.js';

test('directional paper slice owns performance and position HTTP contracts', async () => {
  const app = express();
  const store = {
    getLatestRun: () => null,
    getPerformance: () => null,
    getRecentRuns: () => [],
    getRecentPositions: () => [],
    getRecentDecisions: () => [],
    getPosition: (id: number) => (id === 7 ? { id: 7, side: 'LONG' } : null),
    getFills: (id: number) => [{ id: 1, positionId: id }],
    getRecentEvaluations: (id: number) => [{ id: 2, positionId: id }],
  } as unknown as DirectionalPaperRouteDependencies['store'];

  registerDirectionalPaperRoutes(app, {
    store,
    enabled: true,
    strategyVersion: 'directional-test-v1',
    config: DEFAULT_DIRECTIONAL_CONFIG,
  });

  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const address = server.address();
  assert(address && typeof address === 'object');
  const request = (path: string) => fetch(`http://127.0.0.1:${address.port}${path}`);

  try {
    const performance = await request('/api/agent/directional-performance');
    assert.equal(performance.status, 200);
    const performanceBody = (await performance.json()) as {
      success: boolean;
      data: { enabled: boolean; strategyVersion: string; policy: { liveExecutionEnabled: boolean } };
    };
    assert.equal(performanceBody.success, true);
    assert.equal(performanceBody.data.enabled, true);
    assert.equal(performanceBody.data.strategyVersion, 'directional-test-v1');
    assert.equal(performanceBody.data.policy.liveExecutionEnabled, false);

    const position = await request('/api/agent/directional-positions/7');
    assert.equal(position.status, 200);
    const positionBody = (await position.json()) as {
      data: { position: { id: number }; fills: unknown[]; evaluations: unknown[] };
    };
    assert.equal(positionBody.data.position.id, 7);
    assert.equal(positionBody.data.fills.length, 1);
    assert.equal(positionBody.data.evaluations.length, 1);

    assert.equal((await request('/api/agent/directional-positions/999')).status, 404);
    assert.equal((await request('/api/agent/directional-positions/not-a-number')).status, 400);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
  }
});
