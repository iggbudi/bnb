import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  AGGRESSIVE_INITIAL_CAPITAL_USD,
  processAggressivePaperLifecycle,
} from './aggressive-paper-manager.js';
import { AggressivePaperStore } from './aggressive-paper-store.js';
import { buildHighRiskStrategyPlan, type HighRiskStrategyPlan } from './high-risk-strategy.js';
import type { PancakeV3OnchainState } from './pancakeswap-v3-onchain.js';
import { SnapshotStore, type PoolSnapshotInput } from './snapshot-store.js';

const Q128 = 1n << 128n;

function stateAtPrice(price: number, capturedAt: string, growth0 = 1_000n): PancakeV3OnchainState {
  const currentTick = Math.round(Math.log(1 / price) / Math.log(1.0001));
  const actualPrice = 1 / 1.0001 ** currentTick;
  const sqrtPriceX96 = BigInt(Math.floor(1.0001 ** (currentTick / 2) * 2 ** 96));
  return {
    chainId: 56,
    poolAddress: '0xpool',
    blockNumber: Math.floor(new Date(capturedAt).getTime() / 1_000),
    blockTimestamp: capturedAt,
    capturedAt,
    token0: '0x0',
    token1: '0x1',
    token0Symbol: 'USDT',
    token1Symbol: 'WBNB',
    token0Decimals: 18,
    token1Decimals: 18,
    sqrtPriceX96: sqrtPriceX96.toString(),
    currentTick,
    tickSpacing: 1,
    fee: 100,
    feePercent: 0.01,
    protocolFeeShareToken0Bps: 3300,
    protocolFeeShareToken1Bps: 3300,
    unlocked: true,
    activeLiquidity: '5000000000000000000000000',
    feeGrowthGlobal0X128: growth0.toString(),
    feeGrowthGlobal1X128: '2000',
    priceWbnbUsd: actualPrice,
    ranges: [],
    gas: {
      gasPriceWei: '50000000',
      gasPriceGwei: 0.05,
      assumedMintGasUnits: 500000,
      assumedRebalanceGasUnits: 800000,
      estimatedMintCostBnb: 0.000025,
      estimatedMintCostUsd: 0.000025 * actualPrice,
      estimatedRebalanceCostBnb: 0.00004,
      estimatedRebalanceCostUsd: 0.00004 * actualPrice,
      note: 'test',
    },
    readOnly: true,
  };
}

function planFor(state: PancakeV3OnchainState): HighRiskStrategyPlan {
  return buildHighRiskStrategyPlan({
    investment: AGGRESSIVE_INITIAL_CAPITAL_USD,
    currentPrice: state.priceWbnbUsd,
    volume24h: 200_000_000,
    poolFeeRate: 0.0001,
    activeLiquidity: state.activeLiquidity,
    sqrtPriceX96: state.sqrtPriceX96,
    currentTick: state.currentTick,
    tickSpacing: state.tickSpacing,
    token0Decimals: state.token0Decimals,
    token1Decimals: state.token1Decimals,
    protocolFeeShareToken0Bps: state.protocolFeeShareToken0Bps,
    protocolFeeShareToken1Bps: state.protocolFeeShareToken1Bps,
    entryGasUsd: 0.017,
    exitGasUsd: 0.023,
    history24hCoveragePercent: 100,
    history24hPrices: Array.from({ length: 1_440 }, () => state.priceWbnbUsd),
  });
}

function snapshot(price: number): PoolSnapshotInput {
  return {
    price,
    tvl: 10_000_000,
    volume24h: 200_000_000,
    volume6h: 50_000_000,
    volume1h: 8_000_000,
    volLiqRatio: 20,
    estimatedFees24h: 20_000,
    estimatedAPR: 73,
    priceChange1h: 0,
    priceChange6h: 0,
    priceChange24h: 0,
    txns24h: { buys: 1_000, sells: 1_000 },
    wbnbInPool: 1,
    usdtInPool: 1,
    pairAddress: '0xpool',
  };
}

function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'bnb-aggressive-paper-'));
  const path = join(directory, 'test.sqlite');
  return {
    directory,
    store: new AggressivePaperStore(path),
    snapshots: new SnapshotStore(path),
  };
}

function saveMinuteSnapshots(store: SnapshotStore, from: string, minutes: number, price: number): void {
  const start = Date.parse(from);
  for (let minute = 1; minute <= minutes; minute++) {
    store.save(snapshot(price), new Date(start + minute * 60_000));
  }
}

test('opens one actual aggressive portfolio position with target and hard stop', () => {
  const context = setup();
  try {
    const state = stateAtPrice(570, '2026-07-01T00:00:00.000Z');
    const result = processAggressivePaperLifecycle({
      plan: planFor(state),
      onchain: state,
      store: context.store,
      snapshotStore: context.snapshots,
      now: new Date(state.capturedAt),
    });

    assert.equal(result.action, 'ENTER');
    assert.equal(result.position?.status, 'OPEN');
    assert.equal(result.position?.investmentUsd, 50);
    assert.ok(Math.abs((result.position?.targetValueUsd ?? 0) - 55) < 1e-10);
    assert.ok(Math.abs((result.position?.stopValueUsd ?? 0) - 47.5) < 1e-10);
    assert.ok((result.position?.priceLowerUsd ?? 0) < state.priceWbnbUsd);
    assert.ok((result.position?.priceUpperUsd ?? 0) > state.priceWbnbUsd);
    assert.equal(context.store.count(), 1);
  } finally {
    context.snapshots.close();
    context.store.close();
    rmSync(context.directory, { recursive: true, force: true });
  }
});

test('credits observed on-chain fee once and takes profit at ten percent', () => {
  const context = setup();
  try {
    const enteredState = stateAtPrice(570, '2026-07-01T00:00:00.000Z');
    processAggressivePaperLifecycle({
      plan: planFor(enteredState),
      onchain: enteredState,
      store: context.store,
      snapshotStore: context.snapshots,
      now: new Date(enteredState.capturedAt),
    });
    const position = context.store.getActivePosition()!;
    saveMinuteSnapshots(context.snapshots, enteredState.capturedAt, 60, enteredState.priceWbnbUsd);
    const sixUsdDelta = (Q128 * 6_000_000_000_000_000_000n) / BigInt(position.liquidity);
    const exitState = {
      ...enteredState,
      blockNumber: enteredState.blockNumber + 1,
      capturedAt: '2026-07-01T01:00:00.000Z',
      blockTimestamp: '2026-07-01T01:00:00.000Z',
      feeGrowthGlobal0X128: (BigInt(enteredState.feeGrowthGlobal0X128) + sixUsdDelta).toString(),
    };
    const result = processAggressivePaperLifecycle({
      plan: planFor(exitState),
      onchain: exitState,
      store: context.store,
      snapshotStore: context.snapshots,
      now: new Date(exitState.capturedAt),
    });

    assert.equal(result.action, 'EXIT');
    assert.equal(result.reasonCode, 'TAKE_PROFIT_10_PERCENT');
    assert.equal(result.position?.status, 'CLOSED');
    assert.ok((result.position?.accumulatedFeeUsd ?? 0) > 5.9);
    const performance = context.store.getPerformance(50);
    assert.equal(performance.completedPositions, 1);
    assert.equal(performance.targetHits, 1);
    assert.ok(performance.portfolioValueUsd > 55);

    const reentryState = {
      ...exitState,
      blockNumber: exitState.blockNumber + 1,
      capturedAt: '2026-07-01T07:00:00.000Z',
      blockTimestamp: '2026-07-01T07:00:00.000Z',
    };
    const reentry = processAggressivePaperLifecycle({
      plan: planFor(reentryState),
      onchain: reentryState,
      store: context.store,
      snapshotStore: context.snapshots,
      now: new Date(reentryState.capturedAt),
    });
    assert.equal(reentry.action, 'ENTER');
    assert.ok((reentry.position?.investmentUsd ?? 0) > 55);
    assert.ok(Math.abs((reentry.position?.investmentUsd ?? 0) - performance.portfolioValueUsd) < 1e-9);
  } finally {
    context.snapshots.close();
    context.store.close();
    rmSync(context.directory, { recursive: true, force: true });
  }
});

test('waits sixty minutes out of range then recenters with explicit cost and no out-of-range fee', () => {
  const context = setup();
  try {
    const enteredState = stateAtPrice(570, '2026-07-01T00:00:00.000Z');
    processAggressivePaperLifecycle({
      plan: planFor(enteredState),
      onchain: enteredState,
      store: context.store,
      snapshotStore: context.snapshots,
      now: new Date(enteredState.capturedAt),
    });
    const position = context.store.getActivePosition()!;
    const movedState1 = stateAtPrice(590, '2026-07-01T01:00:00.000Z');
    const oneUsdDelta = (Q128 * 1_000_000_000_000_000_000n) / BigInt(position.liquidity);
    movedState1.feeGrowthGlobal0X128 = (BigInt(enteredState.feeGrowthGlobal0X128) + oneUsdDelta).toString();
    saveMinuteSnapshots(context.snapshots, enteredState.capturedAt, 60, movedState1.priceWbnbUsd);
    const confirming = processAggressivePaperLifecycle({
      plan: planFor(movedState1),
      onchain: movedState1,
      store: context.store,
      snapshotStore: context.snapshots,
      now: new Date(movedState1.capturedAt),
    });
    assert.equal(confirming.action, 'HOLD');
    assert.equal(confirming.reasonCode, 'OUT_OF_RANGE_CONFIRMATION');
    assert.equal(confirming.evaluation?.feeIncrementUsd, 0);

    const movedState2 = {
      ...movedState1,
      blockNumber: movedState1.blockNumber + 1,
      capturedAt: '2026-07-01T02:00:00.000Z',
      blockTimestamp: '2026-07-01T02:00:00.000Z',
    };
    saveMinuteSnapshots(context.snapshots, movedState1.capturedAt, 60, movedState2.priceWbnbUsd);
    const recentered = processAggressivePaperLifecycle({
      plan: planFor(movedState2),
      onchain: movedState2,
      store: context.store,
      snapshotStore: context.snapshots,
      now: new Date(movedState2.capturedAt),
    });

    assert.equal(recentered.action, 'RECENTER');
    assert.equal(recentered.position?.recenterCount, 1);
    assert.ok((recentered.position?.totalCostUsd ?? 0) > position.totalCostUsd);
    assert.ok((recentered.position?.priceLowerUsd ?? Infinity) < movedState2.priceWbnbUsd);
    assert.ok((recentered.position?.priceUpperUsd ?? 0) > movedState2.priceWbnbUsd);
  } finally {
    context.snapshots.close();
    context.store.close();
    rmSync(context.directory, { recursive: true, force: true });
  }
});

test('exits instead of starting a second losing recenter cycle', () => {
  const context = setup();
  try {
    const enteredState = stateAtPrice(570, '2026-07-01T00:00:00.000Z');
    processAggressivePaperLifecycle({
      plan: planFor(enteredState),
      onchain: enteredState,
      store: context.store,
      snapshotStore: context.snapshots,
      now: new Date(enteredState.capturedAt),
    });
    const movedState1 = stateAtPrice(590, '2026-07-01T01:00:00.000Z');
    saveMinuteSnapshots(context.snapshots, enteredState.capturedAt, 60, movedState1.priceWbnbUsd);
    processAggressivePaperLifecycle({
      plan: planFor(movedState1),
      onchain: movedState1,
      store: context.store,
      snapshotStore: context.snapshots,
      now: new Date(movedState1.capturedAt),
    });
    const active = context.store.getActivePosition()!;
    context.store.updatePosition({
      id: active.id,
      losingRecenterCount: 1,
      segmentPrincipalUsd: 100,
      now: new Date('2026-07-01T01:30:00.000Z'),
    });
    const movedState2 = {
      ...movedState1,
      blockNumber: movedState1.blockNumber + 1,
      capturedAt: '2026-07-01T02:00:00.000Z',
      blockTimestamp: '2026-07-01T02:00:00.000Z',
    };
    saveMinuteSnapshots(context.snapshots, movedState1.capturedAt, 60, movedState2.priceWbnbUsd);
    const stopped = processAggressivePaperLifecycle({
      plan: planFor(movedState2),
      onchain: movedState2,
      store: context.store,
      snapshotStore: context.snapshots,
      now: new Date(movedState2.capturedAt),
    });

    assert.equal(stopped.action, 'EXIT');
    assert.equal(stopped.reasonCode, 'TWO_LOSING_RECENTER_CYCLES');
    assert.equal(stopped.position?.recenterCount, 0);
  } finally {
    context.snapshots.close();
    context.store.close();
    rmSync(context.directory, { recursive: true, force: true });
  }
});

test('hard stop closes a concentrated position before attempting a recenter', () => {
  const context = setup();
  try {
    const enteredState = stateAtPrice(570, '2026-07-01T00:00:00.000Z');
    processAggressivePaperLifecycle({
      plan: planFor(enteredState),
      onchain: enteredState,
      store: context.store,
      snapshotStore: context.snapshots,
      now: new Date(enteredState.capturedAt),
    });
    const crashedState = stateAtPrice(500, '2026-07-01T01:00:00.000Z');
    saveMinuteSnapshots(context.snapshots, enteredState.capturedAt, 60, crashedState.priceWbnbUsd);
    const stopped = processAggressivePaperLifecycle({
      plan: planFor(crashedState),
      onchain: crashedState,
      store: context.store,
      snapshotStore: context.snapshots,
      now: new Date(crashedState.capturedAt),
    });

    assert.equal(stopped.action, 'EXIT');
    assert.equal(stopped.reasonCode, 'STOP_LOSS_5_PERCENT');
    assert.equal(stopped.position?.recenterCount, 0);
    assert.equal(context.store.getPerformance(50).stopLosses, 1);
  } finally {
    context.snapshots.close();
    context.store.close();
    rmSync(context.directory, { recursive: true, force: true });
  }
});
