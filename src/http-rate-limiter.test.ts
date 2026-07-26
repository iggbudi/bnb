import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import test from 'node:test';

import { loadBnbAppConfig } from './app/config.js';
import { createBnbHttpApp } from './app/create-app.js';

async function withServer(trustProxy: boolean, run: (baseUrl: string) => Promise<void>): Promise<void> {
  const config = loadBnbAppConfig({
    PORT: '0',
    TRUST_PROXY: String(trustProxy),
    API_RATE_LIMIT_PER_MINUTE: '1',
  });
  const { app } = createBnbHttpApp(config, 'public');
  app.get('/api/test-rate-limit', (_req, res) => res.json({ success: true }));
  const server: Server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('HTTP test server did not bind');
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
  }
}

test('HTTP limiter returns Retry-After and ignores forwarded IPs without TRUST_PROXY', async () => {
  await withServer(false, async baseUrl => {
    const first = await fetch(`${baseUrl}/api/test-rate-limit`, {
      headers: { 'X-Forwarded-For': '198.51.100.1' },
    });
    const denied = await fetch(`${baseUrl}/api/test-rate-limit`, {
      headers: { 'X-Forwarded-For': '198.51.100.2' },
    });
    assert.equal(first.status, 200);
    assert.equal(denied.status, 429);
    assert.equal(denied.headers.get('retry-after'), '60');
  });
});

test('HTTP limiter keys trusted forwarded clients separately with TRUST_PROXY', async () => {
  await withServer(true, async baseUrl => {
    const request = (ip: string) =>
      fetch(`${baseUrl}/api/test-rate-limit`, { headers: { 'X-Forwarded-For': ip } });
    assert.equal((await request('198.51.100.1')).status, 200);
    assert.equal((await request('198.51.100.2')).status, 200);
    assert.equal((await request('198.51.100.2')).status, 429);
  });
});
