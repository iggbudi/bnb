import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import test from 'node:test';

const statusScript = resolve('scripts/status-background.sh');

function readiness(appliedVersion: number) {
  return JSON.stringify({
    success: appliedVersion === 4,
    data: {
      ready: appliedVersion === 4,
      deployment: {
        application: 'bnb-lp-analyzer',
        revision: 'test-revision',
        builtAt: '2026-07-26T00:00:00Z',
        startedAt: '2026-07-26T00:00:01Z',
        entryPoint: 'dist/app/server.js',
        schema: {
          expectedVersion: 4,
          appliedVersion,
          latestMigration: appliedVersion === 4 ? 'feature_schema_ownership_registry' : 'legacy',
        },
      },
    },
  });
}

test('background status rejects live stale processes and accepts matching deployment identity', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'bnb-background-status-'));
  const procRoot = join(directory, 'proc');
  const runDirectory = join(directory, 'run');
  const fakeCurl = join(directory, 'curl');
  mkdirSync(runDirectory);
  writeFileSync(join(directory, '.env'), 'PORT=3001\n');
  writeFileSync(fakeCurl, '#!/bin/sh\nprintf %s "$FAKE_RESPONSE"\n');
  chmodSync(fakeCurl, 0o700);

  const sleeper = spawn('sleep', ['30']);
  assert(sleeper.pid);
  const processDirectory = join(procRoot, String(sleeper.pid));
  mkdirSync(processDirectory, { recursive: true });
  writeFileSync(join(runDirectory, 'server.pid'), `${sleeper.pid}\n`);

  const runStatus = (command: string, response: string) => {
    writeFileSync(join(processDirectory, 'cmdline'), command.replaceAll(' ', '\0') + '\0');
    return spawnSync('bash', [statusScript], {
      encoding: 'utf8',
      env: {
        ...process.env,
        APP_DIR: directory,
        PROC_ROOT: procRoot,
        CURL_BIN: fakeCurl,
        EXPECTED_RELEASE_REVISION: 'test-revision',
        EXPECTED_SCHEMA_VERSION: '4',
        FAKE_RESPONSE: response,
      },
    });
  };

  try {
    const wrongEntryPoint = runStatus('node dist/server-bnb.js', readiness(4));
    assert.equal(wrongEntryPoint.status, 1);
    assert.match(wrongEntryPoint.stdout, /Status: stale.*expected 'node dist\/app\/server\.js'/);

    const staleSchema = runStatus('node dist/app/server.js', readiness(3));
    assert.equal(staleSchema.status, 1);
    assert.match(staleSchema.stdout, /deployment identity\/readiness tidak sesuai/);

    const current = runStatus('node dist/app/server.js', readiness(4));
    assert.equal(current.status, 0, current.stderr);
    assert.match(current.stdout, /revision=test-revision, schema=4/);
  } finally {
    sleeper.kill('SIGTERM');
    await new Promise(resolve => sleeper.once('exit', resolve));
    rmSync(directory, { recursive: true, force: true });
  }
});
