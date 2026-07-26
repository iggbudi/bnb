import assert from 'node:assert/strict';
import test from 'node:test';

import { OnchainStore } from './onchain-store.js';
import type { PancakeV3OnchainState } from '../../lp-execution/index.js';

const state = {
  blockNumber: 123,
  blockTimestamp: '2026-07-18T10:00:00.000Z',
  capturedAt: '2026-07-18T10:00:01.000Z',
  currentTick: -63446,
  activeLiquidity: '1000000',
  feeGrowthGlobal0X128: '2000000',
  feeGrowthGlobal1X128: '3000000',
  priceWbnbUsd: 570,
  gas: { gasPriceWei: '1000000000' },
} as PancakeV3OnchainState;

test('stores at most one on-chain snapshot per block', () => {
  const store = new OnchainStore(':memory:');
  try {
    assert.equal(store.saveIfAbsent(state), true);
    assert.equal(store.saveIfAbsent(state), false);
    assert.equal(store.count(), 1);
    assert.equal(store.getRecent(1)[0]?.currentTick, -63446);
    assert.equal(store.getRecent(1)[0]?.feeGrowthGlobal1X128, '3000000');
    assert.equal(store.getAtOrBefore('2026-07-18T10:05:00.000Z')?.blockNumber, 123);
    assert.equal(store.getAtOrBefore('2026-07-18T09:59:00.000Z'), null);
  } finally {
    store.close();
  }
});
