import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AsyncLock,
  ConcurrencyGate,
  FixedWindowRateLimiter,
  SchedulerRegistry,
} from './operational-controls.js';

test('SchedulerRegistry skips overlap and records success, errors, and duration', async () => {
  const registry = new SchedulerRegistry();
  let release!: () => void;
  const blocked = new Promise<void>(resolve => {
    release = resolve;
  });
  const first = registry.run('snapshot', async () => {
    await blocked;
    return 42;
  });
  await Promise.resolve();
  assert.deepEqual(await registry.run('snapshot', () => 99), { status: 'ALREADY_RUNNING' });
  assert.equal(registry.list()[0]?.state, 'RUNNING');
  release();
  assert.deepEqual(await first, { status: 'COMPLETED', value: 42 });
  const success = registry.list()[0]!;
  assert.equal(success.state, 'IDLE');
  assert.equal(success.skippedAlreadyRunning, 1);
  assert.ok(success.lastSuccessAt);
  assert.ok(success.lastDurationMs !== null && success.lastDurationMs >= 0);

  await assert.rejects(
    registry.run('outcome', () => {
      throw new Error('database busy');
    }),
    /database busy/
  );
  assert.equal(registry.list().find(item => item.name === 'outcome')?.lastError, 'database busy');
});

test('AsyncLock serializes expensive work', async () => {
  const lock = new AsyncLock();
  const events: string[] = [];
  let release!: () => void;
  const blocked = new Promise<void>(resolve => {
    release = resolve;
  });
  const first = lock.run(async () => {
    events.push('first-start');
    await blocked;
    events.push('first-end');
  });
  const second = lock.run(async () => {
    events.push('second');
  });
  await Promise.resolve();
  assert.deepEqual(events, ['first-start']);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(events, ['first-start', 'first-end', 'second']);
});

test('ConcurrencyGate rejects excess work and releases exactly once', () => {
  const gate = new ConcurrencyGate(1);
  const release = gate.tryAcquire();
  assert.ok(release);
  assert.equal(gate.tryAcquire(), null);
  release?.();
  release?.();
  assert.equal(gate.active, 0);
  assert.ok(gate.tryAcquire());
});

test('FixedWindowRateLimiter returns retry timing and resets its window', () => {
  const limiter = new FixedWindowRateLimiter(2, 60_000);
  assert.equal(limiter.consume('client', 1_000).allowed, true);
  assert.equal(limiter.consume('client', 1_001).allowed, true);
  const denied = limiter.consume('client', 1_002);
  assert.equal(denied.allowed, false);
  assert.equal(denied.retryAfterSeconds, 60);
  assert.equal(limiter.consume('client', 61_001).allowed, true);
});
