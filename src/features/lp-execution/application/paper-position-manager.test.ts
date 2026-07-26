import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { AgentStore, type PaperAgentDecisionInput } from '../../paper-agent/index.js';
import type { PancakeV3OnchainState } from '../../market-data/index.js';
import { processPaperPositionLifecycle } from './paper-position-manager.js';
import { PositionStore } from '../infrastructure/position-store.js';
import { SnapshotStore, type PoolSnapshotInput } from '../../market-data/index.js';

const signalInput: PaperAgentDecisionInput = {
  decisionHour: '2026-07-01T00:00:00.000Z',
  createdAt: '2026-07-01T00:00:00.000Z',
  strategyVersion: 'lifecycle-v2.1',
  action: 'ENTER_FULL_RANGE',
  reasonCode: 'BASELINE_CONDITIONS_MET',
  confidence: 'high',
  rationale: 'Entry signal test.',
  investment: 100,
  referencePrice: 570,
  predictedFee24h: 0.04,
  predictedIL24h: 0.01,
  predictedExcessVsHold24h: 0.03,
  features: {},
};

const Q128 = 1n << 128n;

const onchain = {
  chainId: 56,
  blockNumber: 100,
  capturedAt: '2026-07-01T00:00:00.000Z',
  feeGrowthGlobal0X128: '1000',
  feeGrowthGlobal1X128: '2000',
  fee: 100,
  tickSpacing: 1,
  currentTick: -63459,
  priceWbnbUsd: 570,
  token0Decimals: 18,
  token1Decimals: 18,
  gas: {
    gasPriceWei: '50000000',
    estimatedMintCostUsd: 0.01425,
    estimatedRebalanceCostUsd: 0.0228,
  },
} as PancakeV3OnchainState;

const market = { price: 570, tvl: 10_000_000, volume1h: 1_000_000 };
const poolSnapshot: PoolSnapshotInput = {
  price: 570,
  tvl: market.tvl,
  volume24h: 24_000_000,
  volume6h: 6_000_000,
  volume1h: market.volume1h,
  volLiqRatio: 2.4,
  estimatedFees24h: 2_400,
  estimatedAPR: 8.76,
  priceChange1h: 0,
  priceChange6h: 0,
  priceChange24h: 0,
  txns24h: { buys: 100, sells: 100 },
  wbnbInPool: 1,
  usdtInPool: 1,
  pairAddress: '0xpool',
};

function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'bnb-paper-position-'));
  const path = join(directory, 'test.sqlite');
  const agentStore = new AgentStore(path);
  const positionStore = new PositionStore(path);
  const snapshotStore = new SnapshotStore(path);
  const signal = agentStore.saveIfAbsent(signalInput).decision;
  return { directory, agentStore, positionStore, snapshotStore, signal };
}

test('cancels incompatible paper accounting and allows a clean replacement without economic cooldown', () => {
  const context = setup();
  try {
    const legacy = context.positionStore.createPosition({
      mode: 'PAPER',
      investmentUsd: 100,
      entryDecisionId: context.signal.id,
      entryPrice: 570,
      now: new Date('2026-07-01T00:00:00.000Z'),
    });
    context.positionStore.transitionPosition({
      id: legacy.id,
      toStatus: 'OPEN',
      reason: 'Legacy paper position.',
      now: new Date('2026-07-01T00:00:00.000Z'),
    });
    const cancelled = processPaperPositionLifecycle({
      signal: context.signal,
      market,
      onchain,
      positionStore: context.positionStore,
      snapshotStore: context.snapshotStore,
      now: new Date('2026-07-01T00:01:00.000Z'),
    });
    assert.equal(cancelled.position?.status, 'CANCELLED');
    assert.equal(cancelled.position?.exitReason, 'ACCOUNTING_VERSION_UPGRADE_REQUIRED');
    const replacement = processPaperPositionLifecycle({
      signal: context.signal,
      market,
      onchain,
      positionStore: context.positionStore,
      snapshotStore: context.snapshotStore,
      now: new Date('2026-07-01T00:02:00.000Z'),
    });
    assert.equal(replacement.action, 'ENTER');
    assert.equal(replacement.position?.accountingVersion, 'v3-fee-growth-v1');
  } finally {
    context.snapshotStore.close();
    context.positionStore.close();
    context.agentStore.close();
    rmSync(context.directory, { recursive: true, force: true });
  }
});

test('opens one paper position and records entry gas only once', () => {
  const context = setup();
  try {
    const opened = processPaperPositionLifecycle({
      signal: context.signal,
      market,
      onchain,
      positionStore: context.positionStore,
      snapshotStore: context.snapshotStore,
      now: new Date('2026-07-01T00:01:00.000Z'),
    });
    assert.equal(opened.action, 'ENTER');
    assert.equal(opened.position?.status, 'OPEN');
    assert.ok((opened.position?.entryGasUsd ?? 0) > 0);
    assert.equal(opened.evaluation?.metrics.hourlyGasChargedUsd, 0);
    assert.ok((opened.evaluation?.netPnlUsd ?? 0) < 0);
    assert.equal(context.positionStore.count(), 1);
  } finally {
    context.snapshotStore.close();
    context.positionStore.close();
    context.agentStore.close();
    rmSync(context.directory, { recursive: true, force: true });
  }
});

test('holds an open position hourly and accrues fee without recurring gas', () => {
  const context = setup();
  try {
    processPaperPositionLifecycle({
      signal: context.signal,
      market,
      onchain,
      positionStore: context.positionStore,
      snapshotStore: context.snapshotStore,
      now: new Date('2026-07-01T00:00:00.000Z'),
    });
    for (let minute = 1; minute <= 60; minute++) {
      context.snapshotStore.save(
        poolSnapshot,
        new Date(Date.parse('2026-07-01T00:00:00.000Z') + minute * 60_000)
      );
    }
    const held = processPaperPositionLifecycle({
      signal: context.signal,
      market,
      onchain: {
        ...onchain,
        blockNumber: 200,
        capturedAt: '2026-07-01T01:00:00.000Z',
        feeGrowthGlobal0X128: (Q128 / 10_000n + 1000n).toString(),
        feeGrowthGlobal1X128: (Q128 / 1_000_000n + 2000n).toString(),
      },
      positionStore: context.positionStore,
      snapshotStore: context.snapshotStore,
      now: new Date('2026-07-01T01:00:00.000Z'),
    });

    assert.equal(held.action, 'HOLD');
    assert.equal(held.evaluation?.dataQuality, 'valid');
    assert.ok((held.evaluation?.accumulatedFeeUsd ?? 0) > 0);
    assert.equal(held.evaluation?.metrics.hourlyGasChargedUsd, 0);
    assert.equal(held.position?.entryGasUsd, context.positionStore.getPosition(1)?.entryGasUsd);
  } finally {
    context.snapshotStore.close();
    context.positionStore.close();
    context.agentStore.close();
    rmSync(context.directory, { recursive: true, force: true });
  }
});

test('records seven-day review and paper-closes at fourteen days', () => {
  const context = setup();
  try {
    processPaperPositionLifecycle({
      signal: context.signal,
      market,
      onchain,
      positionStore: context.positionStore,
      snapshotStore: context.snapshotStore,
      now: new Date('2026-07-01T00:00:00.000Z'),
    });
    const review7d = processPaperPositionLifecycle({
      signal: context.signal,
      market,
      onchain,
      positionStore: context.positionStore,
      snapshotStore: context.snapshotStore,
      now: new Date('2026-07-08T00:00:00.000Z'),
    });
    assert.equal(review7d.action, 'REVIEW_7D');
    assert.equal(review7d.position?.status, 'OPEN');

    const review14d = processPaperPositionLifecycle({
      signal: context.signal,
      market,
      onchain,
      positionStore: context.positionStore,
      snapshotStore: context.snapshotStore,
      now: new Date('2026-07-15T00:00:00.000Z'),
    });
    assert.equal(review14d.action, 'EXIT');
    assert.equal(review14d.position?.status, 'CLOSED');
    assert.equal(review14d.position?.exitReason, 'PAPER_MAX_HOLD_REACHED');
    assert.ok((review14d.position?.exitGasUsd ?? 0) > 0);
    assert.deepEqual(
      context.positionStore.getActions(1).map(action => action.action),
      ['EXIT', 'REVIEW_14D', 'REVIEW_7D', 'ENTER']
    );
  } finally {
    context.snapshotStore.close();
    context.positionStore.close();
    context.agentStore.close();
    rmSync(context.directory, { recursive: true, force: true });
  }
});
