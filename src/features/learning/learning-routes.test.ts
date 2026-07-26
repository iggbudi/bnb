import assert from 'node:assert/strict';
import express from 'express';
import test from 'node:test';

import { registerLearningRoutes, type LearningRouteDependencies } from './index.js';

test('learning slice owns model status and history HTTP contract', async () => {
  const app = express();
  const store = {
    getRecentModels: (limit: number) => [{ id: 1, version: 'model-v1', limit }],
  } as unknown as LearningRouteDependencies['store'];
  registerLearningRoutes(app, {
    store,
    getLearningStatus: () => ({
      trainerEnabled: true,
      examples: 42,
      minimumExamples: 336,
      activeModel: null,
    }),
  });

  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const address = server.address();
  assert(address && typeof address === 'object');

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/agent/models`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      success: boolean;
      data: {
        trainerEnabled: boolean;
        examples: number;
        models: Array<{ version: string; limit: number }>;
      };
    };
    assert.equal(body.success, true);
    assert.equal(body.data.trainerEnabled, true);
    assert.equal(body.data.examples, 42);
    assert.equal(body.data.models[0].version, 'model-v1');
    assert.equal(body.data.models[0].limit, 20);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
  }
});
