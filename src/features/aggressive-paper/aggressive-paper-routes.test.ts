import assert from 'node:assert/strict';
import express from 'express';
import test from 'node:test';

import { registerAggressivePaperRoutes, type AggressivePaperRouteDependencies } from './index.js';

test('aggressive paper slice owns plan, performance, and position HTTP contracts', async () => {
  const app = express();
  let rejectPlan = false;
  const store = {
    getPerformance: () => ({ activePosition: null, completedPositions: 0 }),
    getRecentPositions: () => [],
    getActions: (id: number) => [{ id: 1, positionId: id }],
    getEvaluations: (id: number) => [{ id: 2, positionId: id }],
    getPosition: (id: number) => (id === 7 ? { id: 7, status: 'OPEN' } : null),
  } as unknown as AggressivePaperRouteDependencies['store'];

  registerAggressivePaperRoutes(app, {
    store,
    enabled: true,
    strategyVersion: 'aggressive-test-v1',
    policy: {
      initialCapitalUsd: 50,
      targetReturnPercent: 10,
      stopLossPercent: 5,
      outOfRangeConfirmationMinutes: 60,
      maxRecentersPerCycle: 4,
      recenterSlippageBps: 10,
      maxHoldHours: 720,
      normalCooldownHours: 6,
      riskCooldownHours: 24,
    },
    highRiskPlanMiddleware: (_req, _res, next) => next(),
    async loadHighRiskPlan() {
      if (rejectPlan) throw new Error('plan source unavailable');
      return { recommendation: 'WAIT' };
    },
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
    const plan = await request('/api/agent/high-risk-plan');
    assert.equal(plan.status, 200);
    assert.deepEqual(((await plan.json()) as { data: unknown }).data, { recommendation: 'WAIT' });

    rejectPlan = true;
    const unavailablePlan = await request('/api/agent/high-risk-plan');
    assert.equal(unavailablePlan.status, 503);
    assert.equal(((await unavailablePlan.json()) as { error: string }).error, 'plan source unavailable');

    const performance = await request('/api/agent/aggressive-performance');
    assert.equal(performance.status, 200);
    const performanceBody = (await performance.json()) as {
      data: {
        enabled: boolean;
        strategyVersion: string;
        policy: { liveExecutionEnabled?: boolean; onePositionAtATime: boolean };
        liveExecutionEnabled: boolean;
      };
    };
    assert.equal(performanceBody.data.enabled, true);
    assert.equal(performanceBody.data.strategyVersion, 'aggressive-test-v1');
    assert.equal(performanceBody.data.liveExecutionEnabled, false);
    assert.equal(performanceBody.data.policy.onePositionAtATime, true);

    const position = await request('/api/agent/aggressive-positions/7');
    assert.equal(position.status, 200);
    const positionBody = (await position.json()) as {
      data: { position: { id: number }; actions: unknown[]; evaluations: unknown[] };
    };
    assert.equal(positionBody.data.position.id, 7);
    assert.equal(positionBody.data.actions.length, 1);
    assert.equal(positionBody.data.evaluations.length, 1);

    assert.equal((await request('/api/agent/aggressive-positions/999')).status, 404);
    assert.equal((await request('/api/agent/aggressive-positions/not-a-number')).status, 400);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
  }
});
