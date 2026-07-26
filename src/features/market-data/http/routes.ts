import type { Express, RequestHandler } from 'express';

import type { OnchainStore } from '../../../onchain-store.js';
import type { PancakeV3OnchainState } from '../../../pancakeswap-v3-onchain.js';
import { safeErrorMessage } from '../../../shared/http/errors.js';
import type { SnapshotStore } from '../../../snapshot-store.js';
import { UpstreamError } from '../../../upstream-resilience.js';
import { parsePositiveNumber } from '../../../validation.js';

export interface MarketDataRouteDependencies {
  snapshotStore: Pick<SnapshotStore, 'getHistory' | 'getChartHistory' | 'getStatistics' | 'count'>;
  onchainStore: Pick<OnchainStore, 'count' | 'getRecent'>;
  onchainMiddleware: RequestHandler;
  captureMarketSnapshot(): Promise<unknown>;
  captureOnchainState(): Promise<PancakeV3OnchainState>;
  getOnchainHealth(): unknown;
  isExecutionAdapterReady(): boolean;
}

function upstreamErrorCode(error: unknown): string {
  return error instanceof UpstreamError ? error.code : 'UPSTREAM_UNAVAILABLE';
}

function upstreamStatus(error: unknown): number {
  return error instanceof UpstreamError && error.code === 'UPSTREAM_TIMEOUT' ? 504 : 502;
}

export function registerMarketDataRoutes(app: Express, dependencies: MarketDataRouteDependencies): void {
  app.get('/api/wbnbusdt', async (_req, res) => {
    try {
      console.log('📊 Fetching WBNB/USDT data...');
      const analysis = await dependencies.captureMarketSnapshot();
      res.json({ success: true, data: analysis, timestamp: new Date().toISOString() });
    } catch (error) {
      console.error('WBNB/USDT error:', error);
      res.status(upstreamStatus(error)).json({
        success: false,
        error: safeErrorMessage(error, 'Market data is unavailable'),
        code: upstreamErrorCode(error),
        timestamp: new Date().toISOString(),
      });
    }
  });

  app.get('/api/history', (req, res) => {
    try {
      const hours = req.query.hours === undefined ? 24 : parsePositiveNumber(req.query.hours, 'hours');
      const requestedLimit =
        req.query.limit === undefined ? 1_440 : parsePositiveNumber(req.query.limit, 'limit');
      const limit = Math.min(10_000, Math.max(1, Math.floor(requestedLimit)));
      if (hours > 24 * 30) throw new Error('Parameter "hours" must not exceed 720');

      const snapshots = dependencies.snapshotStore.getHistory(hours, limit);
      res.json({
        success: true,
        data: { hours, count: snapshots.length, snapshots },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : 'Invalid history parameters',
        timestamp: new Date().toISOString(),
      });
    }
  });

  app.get('/api/history/chart', (req, res) => {
    try {
      const hours = req.query.hours === undefined ? 24 : parsePositiveNumber(req.query.hours, 'hours');
      const requestedPoints =
        req.query.points === undefined ? 240 : parsePositiveNumber(req.query.points, 'points');
      if (hours > 24 * 30) throw new Error('Parameter "hours" must not exceed 720');

      const maxPoints = Math.min(1_000, Math.max(2, Math.floor(requestedPoints)));
      const points = dependencies.snapshotStore.getChartHistory(hours, maxPoints);
      res.json({
        success: true,
        data: { hours, count: points.length, points },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : 'Invalid chart parameters',
        timestamp: new Date().toISOString(),
      });
    }
  });

  app.get('/api/history/stats', (_req, res) => {
    res.json({
      success: true,
      data: {
        totalRows: dependencies.snapshotStore.count(),
        periods: dependencies.snapshotStore.getStatistics(),
      },
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/onchain/pool', dependencies.onchainMiddleware, async (_req, res) => {
    try {
      const state = await dependencies.captureOnchainState();
      res.json({
        success: true,
        data: {
          ...state,
          storedSnapshots: dependencies.onchainStore.count(),
          dataAdapterReady: true,
          executionAdapterReady: dependencies.isExecutionAdapterReady(),
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      res.status(upstreamStatus(error)).json({
        success: false,
        error: safeErrorMessage(error, 'On-chain data is unavailable'),
        code: upstreamErrorCode(error),
        timestamp: new Date().toISOString(),
      });
    }
  });

  app.get('/api/onchain/history', (req, res) => {
    try {
      const requestedLimit =
        req.query.limit === undefined ? 100 : parsePositiveNumber(req.query.limit, 'limit');
      const limit = Math.min(10_000, Math.max(1, Math.floor(requestedLimit)));
      res.json({
        success: true,
        data: {
          count: dependencies.onchainStore.count(),
          snapshots: dependencies.onchainStore.getRecent(limit),
          health: dependencies.getOnchainHealth(),
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : 'Invalid on-chain history parameters',
        timestamp: new Date().toISOString(),
      });
    }
  });
}
