import assert from 'node:assert/strict';
import express from 'express';
import test from 'node:test';

import {
  buildPaperAgentStatus,
  registerPaperAgentRoutes,
  type PaperAgentRouteDependencies,
} from './index.js';

function dependencies(): PaperAgentRouteDependencies {
  const store = {
    count: () => 2,
    getRecent: (limit: number) => [{ id: 1, limit }],
    outcomeCounts: (horizon?: number) => ({ total: horizon ?? 4, evaluated: 1, pending: 0 }),
    outcomeInterpretationCounts: () => ({ total: 1, scored: 1, abstained: 0 }),
    outcomeAssessmentCounts: () => ({ total: 1, scored: 0, abstained: 1, skipped: 0 }),
    getRecentOutcomes: (limit: number) => [{ id: 2, source: 'recent', limit }],
    getOutcomeDetails: (horizon: number, limit: number) => [{ id: 3, source: 'detail', horizon, limit }],
    getPerformance: (horizon: number) => ({ horizonHours: horizon, evaluated: 1 }),
    getRecentReflections: (limit: number) => [{ id: 4, limit }],
  } as unknown as PaperAgentRouteDependencies['store'];

  return {
    store,
    policy: {
      strategyVersion: 'paper-test-v1',
      investment: 100,
      entryPolicy: { forecastDays: 7 },
      highRiskAdvisoryPolicy: { executionEnabled: false },
      directionalPaperPolicy: { liveExecutionEnabled: false },
      outcomeInterpretation: { version: 'interpretation-v1', rawOutcomesImmutable: true },
      legacyOutcomeAssessment: { version: 'legacy-v1', operational: false },
      evaluationHorizonsHours: [1, 6, 24, 168],
    },
    getReflectionStatus: () => ({ enabled: true, configured: false }),
    getLearningStatus: () => ({ trainerEnabled: true, examples: 0 }),
    isLearningEnabled: () => false,
  };
}

test('paper agent status rounds the next decision to the following UTC hour', () => {
  const status = buildPaperAgentStatus(dependencies(), new Date('2026-07-26T10:15:30.000Z'));
  assert.equal(status.nextDecisionAt, '2026-07-26T11:00:00.000Z');
  assert.equal(status.totalDecisions, 2);
  assert.equal(status.learningEnabled, false);
});

test('paper agent slice owns status, decision, outcome, performance, and reflection contracts', async () => {
  const app = express();
  registerPaperAgentRoutes(app, dependencies());

  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const address = server.address();
  assert(address && typeof address === 'object');
  const request = (path: string) => fetch(`http://127.0.0.1:${address.port}${path}`);

  try {
    const status = await request('/api/agent/status');
    assert.equal(status.status, 200);
    const statusBody = (await status.json()) as {
      data: { mode: string; strategyVersion: string; totalDecisions: number };
    };
    assert.equal(statusBody.data.mode, 'paper');
    assert.equal(statusBody.data.strategyVersion, 'paper-test-v1');
    assert.equal(statusBody.data.totalDecisions, 2);

    const decisions = await request('/api/agent/decisions?limit=10');
    assert.equal(decisions.status, 200);
    assert.equal(
      ((await decisions.json()) as { data: { decisions: Array<{ limit: number }> } }).data.decisions[0].limit,
      10
    );
    assert.equal((await request('/api/agent/decisions?limit=invalid')).status, 400);

    const recentOutcomes = await request('/api/agent/outcomes?limit=5');
    assert.equal(recentOutcomes.status, 200);
    assert.equal(
      ((await recentOutcomes.json()) as { data: { outcomes: Array<{ source: string }> } }).data.outcomes[0]
        .source,
      'recent'
    );

    const detailedOutcomes = await request('/api/agent/outcomes?horizon=168&limit=6');
    assert.equal(detailedOutcomes.status, 200);
    const detailedBody = (await detailedOutcomes.json()) as {
      data: { horizon: number; outcomes: Array<{ source: string; limit: number }> };
    };
    assert.equal(detailedBody.data.horizon, 168);
    assert.equal(detailedBody.data.outcomes[0].source, 'detail');
    assert.equal(detailedBody.data.outcomes[0].limit, 6);
    assert.equal((await request('/api/agent/outcomes?horizon=2')).status, 400);

    const performance = await request('/api/agent/performance');
    assert.equal(performance.status, 200);
    assert.equal(((await performance.json()) as { data: { horizonHours: number } }).data.horizonHours, 24);

    const reflections = await request('/api/agent/reflections?limit=8');
    assert.equal(reflections.status, 200);
    assert.equal(
      ((await reflections.json()) as { data: { reflections: Array<{ limit: number }> } }).data.reflections[0]
        .limit,
      8
    );
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
  }
});
