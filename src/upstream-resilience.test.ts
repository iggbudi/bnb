import assert from 'node:assert/strict';
import test from 'node:test';

import { fetchJsonWithRetry, SingleFlight, UpstreamError, withRetry } from './upstream-resilience.js';

test('SingleFlight deduplicates ten callers and recovers after a shared failure', async () => {
  const flights = new SingleFlight();
  let calls = 0;
  let release!: () => void;
  const blocked = new Promise<void>(resolve => {
    release = resolve;
  });
  const callers = Array.from({ length: 10 }, () =>
    flights.run('pool', async () => {
      calls++;
      await blocked;
      return { block: 123 };
    })
  );
  await Promise.resolve();
  assert.equal(calls, 1);
  release();
  const values = await Promise.all(callers);
  assert.equal(calls, 1);
  assert.ok(values.every(value => value.block === 123));

  await assert.rejects(
    flights.run('failure', async () => {
      throw new Error('offline');
    }),
    /offline/
  );
  assert.equal(await flights.run('failure', async () => 'recovered'), 'recovered');
  assert.equal(flights.size, 0);
});

test('withRetry uses bounded exponential retries and does not retry malformed data', async () => {
  let attempts = 0;
  const delays: number[] = [];
  const result = await withRetry(
    async () => {
      attempts++;
      if (attempts < 3) throw new UpstreamError('UPSTREAM_NETWORK', 'network failed');
      return 'ok';
    },
    {
      attempts: 3,
      baseDelayMs: 100,
      random: () => 0.5,
      sleep: async delay => {
        delays.push(delay);
      },
    }
  );
  assert.equal(result, 'ok');
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [100, 200]);

  attempts = 0;
  await assert.rejects(
    withRetry(
      async () => {
        attempts++;
        throw new UpstreamError('UPSTREAM_MALFORMED', 'bad JSON');
      },
      { attempts: 3, sleep: async () => undefined }
    ),
    /bad JSON/
  );
  assert.equal(attempts, 1);
});

test('fetchJsonWithRetry distinguishes timeout, HTTP, malformed JSON, and network errors', async () => {
  const timeoutFetch = async () => {
    const error = new Error('timed out');
    error.name = 'TimeoutError';
    throw error;
  };
  await assert.rejects(
    fetchJsonWithRetry(
      'https://upstream.invalid',
      {},
      { attempts: 1, fetchImpl: timeoutFetch as typeof fetch }
    ),
    (error: unknown) => error instanceof UpstreamError && error.code === 'UPSTREAM_TIMEOUT'
  );

  await assert.rejects(
    fetchJsonWithRetry(
      'https://upstream.invalid',
      {},
      {
        attempts: 1,
        fetchImpl: (async () => new Response('', { status: 503 })) as typeof fetch,
      }
    ),
    (error: unknown) =>
      error instanceof UpstreamError && error.code === 'UPSTREAM_HTTP' && error.status === 503
  );

  await assert.rejects(
    fetchJsonWithRetry(
      'https://upstream.invalid',
      {},
      {
        attempts: 1,
        fetchImpl: (async () => new Response('{bad', { status: 200 })) as typeof fetch,
      }
    ),
    (error: unknown) => error instanceof UpstreamError && error.code === 'UPSTREAM_MALFORMED'
  );

  await assert.rejects(
    fetchJsonWithRetry(
      'https://upstream.invalid',
      {},
      {
        attempts: 1,
        fetchImpl: (async () => {
          throw new TypeError('socket closed');
        }) as typeof fetch,
      }
    ),
    (error: unknown) => error instanceof UpstreamError && error.code === 'UPSTREAM_NETWORK'
  );
});
