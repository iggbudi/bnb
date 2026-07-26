import assert from 'node:assert/strict';
import express from 'express';
import test from 'node:test';

import { UpstreamError } from '../../shared/runtime/upstream-resilience.js';
import { registerMarketDataRoutes, type MarketDataRouteDependencies } from './index.js';

test('market data slice owns market, history, and on-chain HTTP contracts', async () => {
  const app = express();
  let marketError: Error | null = null;
  const snapshotStore = {
    getHistory: (hours: number, limit: number) => [{ id: 1, hours, limit }],
    getChartHistory: (hours: number, points: number) => [{ timestamp: 'now', hours, points }],
    getStatistics: () => [{ label: '24h', coveragePercent: 100 }],
    count: () => 12,
  } as unknown as MarketDataRouteDependencies['snapshotStore'];
  const onchainStore = {
    count: () => 4,
    getRecent: (limit: number) => [{ id: 2, limit }],
  } as unknown as MarketDataRouteDependencies['onchainStore'];

  registerMarketDataRoutes(app, {
    snapshotStore,
    onchainStore,
    onchainMiddleware: (_req, _res, next) => next(),
    async captureMarketSnapshot() {
      if (marketError) throw marketError;
      return { price: 600, symbol: 'WBNB/USDT' };
    },
    async captureOnchainState() {
      return { priceWbnbUsd: 600 } as Awaited<ReturnType<MarketDataRouteDependencies['captureOnchainState']>>;
    },
    getOnchainHealth: () => ({ ready: true, lastError: null }),
    isExecutionAdapterReady: () => false,
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
    const market = await request('/api/wbnbusdt');
    assert.equal(market.status, 200);
    assert.equal(((await market.json()) as { data: { price: number } }).data.price, 600);

    marketError = new UpstreamError(
      'UPSTREAM_TIMEOUT',
      'request to https://provider.example/rpc?token=secret timed out'
    );
    const failedMarket = await request('/api/wbnbusdt');
    assert.equal(failedMarket.status, 504);
    const failedMarketBody = (await failedMarket.json()) as { code: string; error: string };
    assert.equal(failedMarketBody.code, 'UPSTREAM_TIMEOUT');
    assert.doesNotMatch(failedMarketBody.error, /provider|secret/);

    const history = await request('/api/history?hours=12&limit=25');
    assert.equal(history.status, 200);
    const historyBody = (await history.json()) as {
      data: { hours: number; count: number; snapshots: Array<{ limit: number }> };
    };
    assert.equal(historyBody.data.hours, 12);
    assert.equal(historyBody.data.count, 1);
    assert.equal(historyBody.data.snapshots[0].limit, 25);
    assert.equal((await request('/api/history?hours=721')).status, 400);

    const chart = await request('/api/history/chart?hours=6&points=50');
    assert.equal(chart.status, 200);
    assert.equal(((await chart.json()) as { data: { count: number } }).data.count, 1);

    const stats = await request('/api/history/stats');
    assert.equal(stats.status, 200);
    assert.equal(((await stats.json()) as { data: { totalRows: number } }).data.totalRows, 12);

    const pool = await request('/api/onchain/pool');
    assert.equal(pool.status, 200);
    const poolBody = (await pool.json()) as {
      data: { storedSnapshots: number; executionAdapterReady: boolean };
    };
    assert.equal(poolBody.data.storedSnapshots, 4);
    assert.equal(poolBody.data.executionAdapterReady, false);

    const onchainHistory = await request('/api/onchain/history?limit=20');
    assert.equal(onchainHistory.status, 200);
    const onchainHistoryBody = (await onchainHistory.json()) as {
      data: { count: number; snapshots: Array<{ limit: number }>; health: { ready: boolean } };
    };
    assert.equal(onchainHistoryBody.data.count, 4);
    assert.equal(onchainHistoryBody.data.snapshots[0].limit, 20);
    assert.equal(onchainHistoryBody.data.health.ready, true);
    assert.equal((await request('/api/onchain/history?limit=invalid')).status, 400);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
  }
});
