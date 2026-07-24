import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { AgentStore, type PaperAgentDecisionInput } from './agent-store.js';
import { PositionStore } from './position-store.js';

const signal: PaperAgentDecisionInput = {
  decisionHour: '2026-07-01T00:00:00.000Z',
  createdAt: '2026-07-01T00:00:00.000Z',
  strategyVersion: 'baseline-v1.0',
  action: 'ENTER_FULL_RANGE',
  reasonCode: 'BASELINE_CONDITIONS_MET',
  confidence: 'medium',
  rationale: 'Signal test.',
  investment: 100,
  referencePrice: 570,
  predictedFee24h: 0.04,
  predictedIL24h: 0.01,
  predictedExcessVsHold24h: 0.03,
  features: {},
};

function createStores() {
  const directory = mkdtempSync(join(tmpdir(), 'bnb-position-'));
  const path = join(directory, 'test.sqlite');
  const agentStore = new AgentStore(path);
  const positionStore = new PositionStore(path);
  return { directory, agentStore, positionStore };
}

test('enforces one active position and an audited transition lifecycle', () => {
  const { directory, agentStore, positionStore } = createStores();
  try {
    const decision = agentStore.saveIfAbsent(signal).decision;
    const position = positionStore.createPosition({
      mode: 'PAPER',
      investmentUsd: 100,
      entryDecisionId: decision.id,
      entryPrice: 570,
      now: new Date('2026-07-01T00:01:00.000Z'),
    });
    assert.equal(position.status, 'PENDING_ENTRY');
    assert.throws(
      () => positionStore.createPosition({ mode: 'PAPER', investmentUsd: 100 }),
      /active position already exists/
    );

    const opened = positionStore.transitionPosition({
      id: position.id,
      toStatus: 'OPEN',
      reason: 'Paper entry confirmed.',
      now: new Date('2026-07-01T00:02:00.000Z'),
    });
    assert.equal(opened.status, 'OPEN');
    assert.equal(opened.openedAt, '2026-07-01T00:02:00.000Z');
    assert.throws(
      () =>
        positionStore.transitionPosition({
          id: position.id,
          toStatus: 'CLOSED',
          reason: 'Invalid shortcut.',
        }),
      /Invalid position transition/
    );

    const pendingExit = positionStore.transitionPosition({
      id: position.id,
      toStatus: 'PENDING_EXIT',
      reason: '14 day review.',
    });
    assert.equal(pendingExit.status, 'PENDING_EXIT');
    const closed = positionStore.transitionPosition({
      id: position.id,
      toStatus: 'CLOSED',
      reason: 'Paper exit completed.',
    });
    assert.equal(closed.status, 'CLOSED');
    assert.equal(closed.exitReason, 'Paper exit completed.');
    assert.equal(positionStore.getEvents(position.id).length, 4);

    const next = positionStore.createPosition({ mode: 'PAPER', investmentUsd: 100 });
    assert.equal(next.status, 'PENDING_ENTRY');
  } finally {
    positionStore.close();
    agentStore.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('returns the latest lifecycle action even when no position is open', () => {
  const { directory, agentStore, positionStore } = createStores();
  try {
    const first = positionStore.recordAction({
      action: 'WAIT',
      reasonCode: 'DATA_INSUFFICIENT',
      confidence: 'low',
      rationale: 'Menunggu coverage.',
      now: new Date('2026-07-01T00:05:00.000Z'),
    });
    const duplicate = positionStore.recordAction({
      action: 'WAIT',
      reasonCode: 'DATA_INSUFFICIENT',
      confidence: 'low',
      rationale: 'Tidak boleh membuat row kedua pada jam yang sama.',
      now: new Date('2026-07-01T00:45:00.000Z'),
    });
    assert.equal(duplicate.id, first.id);
    const nextHour = positionStore.recordAction({
      action: 'WAIT',
      reasonCode: 'DATA_INSUFFICIENT',
      confidence: 'low',
      rationale: 'Jam lifecycle berikutnya.',
      now: new Date('2026-07-01T01:05:00.000Z'),
    });
    assert.equal(nextHour.id, first.id + 1);
    assert.equal(positionStore.getRecentActions(10).length, 2);
    assert.equal(positionStore.getRecentActions(1)[0]?.positionId, null);
  } finally {
    positionStore.close();
    agentStore.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('atomically opens a live position only from verified NFT mint evidence', () => {
  const { directory, agentStore, positionStore } = createStores();
  try {
    const decision = agentStore.saveIfAbsent(signal).decision;
    const input = {
      proposalId: 7,
      decisionId: decision.id,
      investmentUsd: 100,
      entryPrice: 570,
      entryGasUsd: 0.02,
      txHash: `0x${'ab'.repeat(32)}`,
      wallet: '0x1111111111111111111111111111111111111111',
      tokenId: '42',
      blockNumber: 123,
      blockHash: `0x${'cd'.repeat(32)}`,
      blockTimestamp: '2026-07-01T00:03:00.000Z',
      confirmations: 3,
      token0: '0x55d398326f99059ff775485246999027b3197955',
      token1: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',
      fee: 100,
      tickLower: -887272,
      tickUpper: 887272,
      liquidity: '123456',
      feeGrowthInside0LastX128: '1000',
      feeGrowthInside1LastX128: '2000',
      tokensOwed0: '0',
      tokensOwed1: '0',
      amount0: '50000000000000000000',
      amount1: '100000000000000000',
      gasUsed: '500000',
      effectiveGasPriceWei: '1000000000',
      gasCostWei: '500000000000000',
      owner: '0x1111111111111111111111111111111111111111',
      verifiedAt: new Date('2026-07-01T00:05:00.000Z'),
    };
    const tracked = positionStore.confirmVerifiedLiveMint(input);
    assert.equal(tracked.position.mode, 'LIVE');
    assert.equal(tracked.position.status, 'OPEN');
    assert.equal(tracked.position.liveTokenId, '42');
    assert.equal(tracked.nft.ownershipVerified, true);
    assert.equal(tracked.nft.feeGrowthInside0LastX128, '1000');
    assert.equal(positionStore.confirmVerifiedLiveMint(input).position.id, tracked.position.id);
    assert.equal(positionStore.getRecentLiveNfts().length, 1);
    assert.equal(positionStore.getActions(tracked.position.id)[0]?.reasonCode, 'LIVE_MINT_RECEIPT_VERIFIED');

    positionStore.transitionPosition({
      id: tracked.position.id,
      toStatus: 'PENDING_EXIT',
      reason: 'Test cleanup.',
    });
    positionStore.transitionPosition({
      id: tracked.position.id,
      toStatus: 'CLOSED',
      reason: 'Test cleanup.',
    });
    const paperShadow = positionStore.createPosition({
      mode: 'PAPER',
      investmentUsd: 100,
      entryDecisionId: decision.id,
      entryPrice: 570,
    });
    positionStore.transitionPosition({ id: paperShadow.id, toStatus: 'OPEN', reason: 'Paper shadow.' });
    const promoted = positionStore.confirmVerifiedLiveMint({
      ...input,
      proposalId: 8,
      txHash: `0x${'ef'.repeat(32)}`,
      tokenId: '43',
    });
    assert.equal(promoted.position.id, paperShadow.id);
    assert.equal(promoted.position.mode, 'LIVE');
    assert.equal(positionStore.count(), 2);
    assert.equal(positionStore.getRecentLiveNfts().length, 2);
  } finally {
    positionStore.close();
    agentStore.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('stores lifecycle actions and mark-to-market evaluations separately from signals', () => {
  const { directory, agentStore, positionStore } = createStores();
  try {
    const position = positionStore.createPosition({ mode: 'PAPER', investmentUsd: 100 });
    positionStore.transitionPosition({ id: position.id, toStatus: 'OPEN', reason: 'Open test.' });

    const action = positionStore.recordAction({
      positionId: position.id,
      action: 'HOLD',
      reasonCode: 'MINIMUM_HOLD_PERIOD',
      confidence: 'high',
      rationale: 'Posisi belum berumur tujuh hari.',
      metrics: { ageHours: 24 },
    });
    assert.equal(action.action, 'HOLD');

    const evaluation = positionStore.recordEvaluation({
      positionId: position.id,
      evaluatedAt: '2026-07-02T00:00:00.000Z',
      ageHours: 24,
      lpValueUsd: 101,
      holdValueUsd: 100.8,
      accumulatedFeeUsd: 0.1,
      grossPnlUsd: 1,
      netPnlUsd: 0.95,
      differenceVsHoldUsd: 0.2,
      estimatedExitCostUsd: 0.05,
      dataQuality: 'valid',
      metrics: { source: 'test' },
    });
    assert.equal(evaluation.netPnlUsd, 0.95);
    assert.equal(positionStore.getActions(position.id)[0]?.reasonCode, 'MINIMUM_HOLD_PERIOD');
    assert.equal(positionStore.getEvaluations(position.id)[0]?.metrics.source, 'test');
  } finally {
    positionStore.close();
    agentStore.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
