import assert from 'node:assert/strict';
import express from 'express';
import test from 'node:test';

import { registerLpAnalysisRoutes } from './index.js';

test('LP analysis slice owns simulation, AI analysis, and IL HTTP contracts', async () => {
  const app = express();
  let rpcCalls = 0;
  let aiRateLimitCalls = 0;
  const simulatedInvestments: number[] = [];

  registerLpAnalysisRoutes(app, {
    rpcMiddleware: (_req, _res, next) => {
      rpcCalls++;
      next();
    },
    aiRateLimitMiddleware: (_req, _res, next) => {
      aiRateLimitCalls++;
      next();
    },
    async simulate(investment) {
      simulatedInvestments.push(investment);
      return { investment, estimatedNetProfit: 1.25 };
    },
    async generateAiAnalysis() {
      return { recommendation: 'WAIT', cached: false };
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
    const defaultSimulation = await request('/api/simulate');
    assert.equal(defaultSimulation.status, 200);
    assert.equal(((await defaultSimulation.json()) as { data: { investment: number } }).data.investment, 50);

    const customSimulation = await request('/api/simulate?amount=75');
    assert.equal(customSimulation.status, 200);
    assert.deepEqual(simulatedInvestments, [50, 75]);

    const aiAnalysis = await request('/api/lp-analysis', { method: 'POST' });
    assert.equal(aiAnalysis.status, 200);
    const aiBody = (await aiAnalysis.json()) as {
      success: boolean;
      data: { recommendation: string; cached: boolean };
      timestamp: string;
    };
    assert.equal(aiBody.success, true);
    assert.equal(aiBody.data.recommendation, 'WAIT');
    assert.equal(aiBody.data.cached, false);
    assert.ok(Number.isFinite(Date.parse(aiBody.timestamp)));

    const il = await request('/api/il?from=600&to=660&invest=100');
    assert.equal(il.status, 200);
    const ilBody = (await il.json()) as { data: { initialInvestment: number; lpValue: number } };
    assert.equal(ilBody.data.initialInvestment, 100);
    assert.ok(ilBody.data.lpValue > 0);
    assert.equal((await request('/api/il?from=0&to=660&invest=100')).status, 400);

    assert.equal(rpcCalls, 3);
    assert.equal(aiRateLimitCalls, 1);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
  }
});
