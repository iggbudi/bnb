import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  runDirectionalBacktest,
  processDirectionalSnapshot,
  type DirectionalLifecycleResult,
} from './directional-paper-manager.js';
import { DirectionalPaperStore } from '../infrastructure/directional-paper-store.js';
import {
  DEFAULT_DIRECTIONAL_CONFIG,
  type DirectionalStrategyConfig,
} from '../domain/directional-strategy.js';
import type { PoolSnapshot } from '../../market-data/index.js';

const CONFIG: DirectionalStrategyConfig = {
  ...DEFAULT_DIRECTIONAL_CONFIG,
  minimumHistoryPoints: 20,
  fastEmaPoints: 3,
  slowEmaPoints: 10,
  shortMomentumPoints: 5,
  longMomentumPoints: 10,
  volatilityPoints: 10,
  minimumShortMomentum: 0.0002,
  minimumLongMomentum: 0.001,
  minimumTrendGap: 0.0001,
  cooldownMinutes: 2,
};

function snapshot(price: number, minute: number): PoolSnapshot {
  return {
    capturedAt: new Date(Date.parse('2026-07-01T00:00:00.000Z') + minute * 60_000).toISOString(),
    pairAddress: '0xpool',
    price,
    tvl: 1_000_000,
    volume24h: 2_000_000,
    volume6h: 500_000,
    volume1h: 100_000,
    volLiqRatio: 2,
    estimatedFees24h: 200,
    estimatedAPR: 7.3,
    priceChange1h: 0,
    priceChange6h: 0,
    priceChange24h: 0,
    txns24h: { buys: 100, sells: 100 },
    wbnbInPool: 1_000,
    usdtInPool: 500_000,
  };
}

function longHistory(count = 38): PoolSnapshot[] {
  let price = 100;
  return Array.from({ length: count }, (_, index) => {
    const change = index % 5 < 3 ? 0.002 : -0.0015;
    price *= 1 + change;
    return snapshot(price, index);
  });
}

function context() {
  const directory = mkdtempSync(join(tmpdir(), 'bnb-directional-'));
  return {
    directory,
    store: new DirectionalPaperStore(join(directory, 'paper.sqlite'), { initializeSchema: true }),
  };
}

test('directional lifecycle opens a leveraged long and closes it at stop loss', () => {
  const testContext = context();
  try {
    const history = longHistory();
    const run = testContext.store.createRun({
      mode: 'BACKTEST',
      startedAt: history[0]!.capturedAt,
      config: CONFIG,
      sourceLabel: 'test',
    });
    const opened = processDirectionalSnapshot({
      runId: run.id,
      snapshot: history.at(-1)!,
      history,
      store: testContext.store,
      config: CONFIG,
    });
    assert.equal(opened.action, 'OPEN_LONG');
    assert.equal(opened.position?.leverage, 5);
    assert.equal(testContext.store.getFills(opened.position!.id).length, 1);

    const stopSnapshot = snapshot(opened.position!.stopLossPrice * 0.99, history.length);
    const closed = processDirectionalSnapshot({
      runId: run.id,
      snapshot: stopSnapshot,
      history: [...history, stopSnapshot],
      store: testContext.store,
      config: CONFIG,
    });
    assert.equal(closed.action, 'CLOSE');
    assert.equal(closed.reasonCode, 'STOP_LOSS');
    assert.equal(closed.position?.status, 'CLOSED');
    assert.ok((closed.position?.realizedPnlUsd ?? 0) < 0);
    assert.equal(testContext.store.getFills(closed.position!.id).length, 2);
    assert.equal(testContext.store.getPerformance(run.id).completedPositions, 1);
  } finally {
    testContext.store.close();
    rmSync(testContext.directory, { recursive: true, force: true });
  }
});

test('directional lifecycle is idempotent for one run and captured minute', () => {
  const testContext = context();
  try {
    const history = longHistory();
    const run = testContext.store.createRun({
      mode: 'FORWARD',
      startedAt: history[0]!.capturedAt,
      config: CONFIG,
      sourceLabel: 'test',
    });
    processDirectionalSnapshot({
      runId: run.id,
      snapshot: history.at(-1)!,
      history,
      store: testContext.store,
      config: CONFIG,
    });
    const repeated = processDirectionalSnapshot({
      runId: run.id,
      snapshot: history.at(-1)!,
      history,
      store: testContext.store,
      config: CONFIG,
    });
    assert.equal(repeated.action, 'ALREADY_PROCESSED');
    assert.equal(testContext.store.getRecentDecisions(run.id).length, 1);
  } finally {
    testContext.store.close();
    rmSync(testContext.directory, { recursive: true, force: true });
  }
});

test('directional lifecycle closes an opposing signal at market price by default', () => {
  const testContext = context();
  try {
    const history = longHistory();
    const run = testContext.store.createRun({
      mode: 'FORWARD',
      startedAt: history[0]!.capturedAt,
      config: CONFIG,
      sourceLabel: 'test',
    });
    const opened = processDirectionalSnapshot({
      runId: run.id,
      snapshot: history.at(-1)!,
      history,
      store: testContext.store,
      config: CONFIG,
    });
    assert.equal(opened.action, 'OPEN_LONG');
    const entryFill = opened.position!.entryFillPrice;

    // turunkan harga (mirror dari uptrend) sampai sinyal SHORT muncul
    let price = history.at(-1)!.price;
    const extended = [...history];
    let result: DirectionalLifecycleResult | null = null;
    for (let index = 0; index < 18; index++) {
      const change = index % 5 < 3 ? -0.003 : 0.002;
      price *= 1 + change;
      const next = snapshot(price, history.length + index);
      extended.push(next);
      result = processDirectionalSnapshot({
        runId: run.id,
        snapshot: next,
        history: extended,
        store: testContext.store,
        config: CONFIG,
      });
      if (result.action === 'CLOSE') break;
    }
    assert.equal(result?.action, 'CLOSE');
    assert.equal(result?.reasonCode, 'OPPOSING_SIGNAL');
    // default: exit di harga pasar -> fill menyimpang jelas dari harga entry
    assert.ok(Math.abs(result!.position!.exitFillPrice! - entryFill) > 0.005);
    assert.ok((result!.position!.realizedPnlUsd ?? 0) < -0.3);
  } finally {
    testContext.store.close();
    rmSync(testContext.directory, { recursive: true, force: true });
  }
});

test('directional lifecycle closes an opposing signal at breakeven when configured', () => {
  const testContext = context();
  try {
    const config: DirectionalStrategyConfig = { ...CONFIG, opposingExitAtBreakeven: true };
    const history = longHistory();
    const run = testContext.store.createRun({
      mode: 'FORWARD',
      startedAt: history[0]!.capturedAt,
      config,
      sourceLabel: 'test',
    });
    const opened = processDirectionalSnapshot({
      runId: run.id,
      snapshot: history.at(-1)!,
      history,
      store: testContext.store,
      config,
    });
    assert.equal(opened.action, 'OPEN_LONG');
    const entryFill = opened.position!.entryFillPrice;

    let price = history.at(-1)!.price;
    const extended = [...history];
    let result: DirectionalLifecycleResult | null = null;
    for (let index = 0; index < 18; index++) {
      const change = index % 5 < 3 ? -0.003 : 0.002;
      price *= 1 + change;
      const next = snapshot(price, history.length + index);
      extended.push(next);
      result = processDirectionalSnapshot({
        runId: run.id,
        snapshot: next,
        history: extended,
        store: testContext.store,
        config,
      });
      if (result.action === 'CLOSE') break;
    }
    assert.equal(result?.action, 'CLOSE');
    assert.equal(result?.reasonCode, 'OPPOSING_SIGNAL');
    assert.ok(result?.position);
    // exit di breakeven: fill = entry * (1 - slippage 2bps), realized hanya fee + slippage
    const expectedFill = entryFill * (1 - 2 / 10_000);
    assert.ok(Math.abs(result.position.exitFillPrice! - expectedFill) < 1e-9);
    const realized = result.position.realizedPnlUsd ?? 0;
    assert.ok(realized < 0);
    // kerugian hanya fee round-trip + slippage kecil (~$0.16), bukan kerugian pasar
    assert.ok(realized > -0.3);
    assert.ok(realized < -0.05);
  } finally {
    testContext.store.close();
    rmSync(testContext.directory, { recursive: true, force: true });
  }
});

test('backtest replays snapshots chronologically and closes any final position', () => {
  const testContext = context();
  try {
    const snapshots = longHistory(80);
    const performance = runDirectionalBacktest({
      snapshots,
      store: testContext.store,
      config: CONFIG,
      sourceLabel: 'unit-test',
    });
    assert.equal(performance.run.status, 'COMPLETED');
    assert.equal(performance.run.lastProcessedAt, snapshots.at(-1)!.capturedAt);
    assert.equal(performance.activePosition, null);
    assert.equal(testContext.store.getRecentDecisions(performance.run.id, 1_000).length, snapshots.length);
  } finally {
    testContext.store.close();
    rmSync(testContext.directory, { recursive: true, force: true });
  }
});
