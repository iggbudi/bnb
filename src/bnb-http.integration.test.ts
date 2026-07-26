import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';
import type { AddressInfo } from 'node:net';

const directory = mkdtempSync(join(tmpdir(), 'bnb-http-'));
process.env.SQLITE_PATH = join(directory, 'integration.sqlite');
process.env.SQLITE_BACKUP_DIR = join(directory, 'backups');
process.env.OPENAI_API_KEY = '';
process.env.LIVE_EXECUTION_ENABLED = 'false';
process.env.EXECUTION_ADMIN_TOKEN = '';

const { bnbRuntime } = await import('./bnb-app.js');
assert.deepEqual(bnbRuntime.schedulerRegistry.list(), [], 'importing app must not start schedulers');

const server = bnbRuntime.app.listen(0, '127.0.0.1');
await new Promise<void>((resolve, reject) => {
  server.once('listening', resolve);
  server.once('error', reject);
});
const address = server.address() as AddressInfo;
const baseUrl = `http://127.0.0.1:${address.port}`;

async function request(path: string, init?: RequestInit): Promise<{ response: Response; body: any }> {
  const response = await fetch(`${baseUrl}${path}`, init);
  const body = await response.json();
  return { response, body };
}

after(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  bnbRuntime.closeStores();
  rmSync(directory, { recursive: true, force: true });
});

test('public routes expose liveness, readiness model, history, and security headers', async () => {
  const live = await request('/api/health/live');
  assert.equal(live.response.status, 200);
  assert.equal(live.body.data.status, 'alive');
  assert.equal(live.response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(live.response.headers.get('x-frame-options'), 'DENY');

  const history = await request('/api/history/stats');
  assert.equal(history.response.status, 200);
  assert.equal(history.body.data.totalRows, 0);
  assert.equal(history.body.data.periods.length, 4);

  const storage = await request('/api/operations/storage');
  assert.equal(storage.response.status, 200);
  assert.equal(storage.body.data.policy.snapshotRetentionDays, 60);
  assert.equal(storage.body.data.policy.backupRetentionFiles, 21);
  assert.ok(storage.body.data.database.mainBytes > 0);
  assert.equal('databasePath' in storage.body.data.database, false);

  const directional = await request('/api/agent/directional-performance');
  assert.equal(directional.response.status, 200);
  assert.equal(directional.body.data.mode, 'SIMULATION_ONLY');
  assert.equal(directional.body.data.policy.liveExecutionEnabled, false);
  assert.equal(directional.body.data.policy.leverage, 5);

  const execution = await request('/api/execution/status');
  assert.equal(execution.response.status, 200);
  assert.equal(execution.body.data.liveExecutionEnabled, false);
  assert.equal(execution.body.data.control.killSwitchEngaged, true);
  assert.equal(execution.body.data.broadcastAvailable, false);
});

test('admin routes reject missing authorization including risk-reduction exit', async () => {
  const killSwitch = await request('/api/execution/kill-switch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ engaged: true, reason: 'integration test' }),
  });
  assert.equal(killSwitch.response.status, 401);
  assert.equal(killSwitch.body.error, 'Unauthorized');

  const exit = await request('/api/execution/exit-proposals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(exit.response.status, 401);
});

test('CORS rejects untrusted browser origins without leaking stack details', async () => {
  const result = await request('/api/health/live', {
    headers: { Origin: 'https://untrusted.example' },
  });
  assert.equal(result.response.status, 400);
  assert.equal(result.body.error, 'Request rejected');
  assert.equal(JSON.stringify(result.body).includes(directory), false);
});
