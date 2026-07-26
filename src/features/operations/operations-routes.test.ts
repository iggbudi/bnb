import assert from 'node:assert/strict';
import express from 'express';
import test from 'node:test';

import { registerOperationsRoutes } from './index.js';

test('operations slice owns liveness, readiness, and storage HTTP contracts', async () => {
  const app = express();
  let ready = true;
  registerOperationsRoutes(app, {
    getReadiness: () => ({
      ready,
      checks: { sqlite: { ready, detail: ready ? 'queryable' : 'unavailable' } },
    }),
    getStorageStatus: () => ({ quickCheck: 'ok', backupDirectory: 'backups' }),
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
    for (const path of ['/api/health', '/api/health/live']) {
      const response = await request(path);
      assert.equal(response.status, 200);
      assert.equal(((await response.json()) as { data: { status: string } }).data.status, 'alive');
    }

    const healthy = await request('/api/health/ready');
    assert.equal(healthy.status, 200);
    assert.equal(((await healthy.json()) as { success: boolean }).success, true);

    ready = false;
    const unhealthy = await request('/api/health/ready');
    assert.equal(unhealthy.status, 503);
    assert.equal(((await unhealthy.json()) as { success: boolean }).success, false);

    const storage = await request('/api/operations/storage');
    assert.equal(storage.status, 200);
    assert.deepEqual(((await storage.json()) as { data: unknown }).data, {
      quickCheck: 'ok',
      backupDirectory: 'backups',
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
  }
});
