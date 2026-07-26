import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { AgentStore, type PaperAgentDecisionInput } from '../../paper-agent/index.js';
import { ExecutionStore } from './execution-store.js';
import { PositionStore } from './position-store.js';

const paperDecision: PaperAgentDecisionInput = {
  decisionHour: '2026-07-18T10:00:00.000Z',
  createdAt: '2026-07-18T10:00:00.000Z',
  strategyVersion: 'logistic-v1',
  action: 'ENTER_FULL_RANGE',
  reasonCode: 'LEARNING_MODEL_ENTER',
  confidence: 'high',
  rationale: 'Model tervalidasi.',
  investment: 100,
  referencePrice: 600,
  predictedFee24h: 0.1,
  predictedIL24h: 0.02,
  predictedExcessVsHold24h: 0.08,
  features: {},
};

test('execution store defaults to emergency stop engaged', () => {
  const store = new ExecutionStore(':memory:');
  try {
    const control = store.getControl();
    assert.equal(control.killSwitchEngaged, true);
  } finally {
    store.close();
  }
});

test('execution proposals require manual review and produce audit events', () => {
  const directory = mkdtempSync(join(tmpdir(), 'bnb-execution-'));
  const path = join(directory, 'test.sqlite');
  const agentStore = new AgentStore(path);
  const decision = agentStore.saveIfAbsent(paperDecision).decision;
  const store = new ExecutionStore(path);
  try {
    store.setKillSwitch(false, 'Test unlock.', new Date('2026-07-18T10:00:00.000Z'));
    const proposal = store.createProposal({
      decisionId: decision.id,
      amountUsd: 50,
      readiness: { ready: true },
      expiresAt: '2026-07-18T10:30:00.000Z',
      now: new Date('2026-07-18T10:01:00.000Z'),
    });
    assert.equal(proposal.status, 'PENDING_APPROVAL');

    const approved = store.reviewProposal(
      proposal.id,
      true,
      'Manual test approval.',
      new Date('2026-07-18T10:05:00.000Z')
    );
    assert.equal(approved.status, 'APPROVED');
    assert.deepEqual(
      store.getRecentAudit().map(event => event.eventType),
      ['PROPOSAL_APPROVED', 'PROPOSAL_CREATED', 'KILL_SWITCH_CHANGED']
    );

    const wallet = store.bindProposalWallet(
      proposal.id,
      '0x1111111111111111111111111111111111111111',
      new Date('2026-07-18T10:06:00.000Z')
    );
    assert.equal(store.bindProposalWallet(proposal.id, wallet.wallet).wallet, wallet.wallet);
    assert.throws(
      () => store.bindProposalWallet(proposal.id, '0x2222222222222222222222222222222222222222'),
      /already bound/
    );
    const mintPlan = store.saveMintTransactionPlan({
      proposalId: proposal.id,
      wallet: wallet.wallet,
      referenceBlockNumber: 100,
      amountUsd: proposal.amountUsd,
      amount0Desired: '10',
      amount1Desired: '20',
      amount0Min: '9',
      amount1Min: '18',
      deadline: 1_800_000_000,
      mintCalldata: '0x1234',
      now: new Date('2026-07-18T10:06:30.000Z'),
    });
    assert.equal(store.getMintTransactionPlan(proposal.id)?.planHash, mintPlan.planHash);
    assert.throws(
      () =>
        store.saveMintTransactionPlan({
          proposalId: proposal.id,
          wallet: wallet.wallet,
          referenceBlockNumber: 101,
          amountUsd: proposal.amountUsd,
          amount0Desired: '10',
          amount1Desired: '20',
          amount0Min: '9',
          amount1Min: '18',
          deadline: 1_800_000_000,
          mintCalldata: '0x1234',
        }),
      /different immutable mint plan/
    );
    const transaction = store.recordVerifiedTransaction(
      proposal.id,
      `0x${'ab'.repeat(32)}`,
      new Date('2026-07-18T10:10:00.000Z')
    );
    assert.equal(store.recordVerifiedTransaction(proposal.id, transaction.txHash).id, transaction.id);
    assert.equal(store.getTransactionByProposal(proposal.id)?.txHash, transaction.txHash);
  } finally {
    store.close();
    agentStore.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('exit proposals require separate manual approval and only one active proposal per position', () => {
  const directory = mkdtempSync(join(tmpdir(), 'bnb-exit-execution-'));
  const path = join(directory, 'test.sqlite');
  const agentStore = new AgentStore(path);
  const decision = agentStore.saveIfAbsent(paperDecision).decision;
  const positionStore = new PositionStore(path);
  const position = positionStore.createPosition({
    mode: 'LIVE',
    investmentUsd: 100,
    entryDecisionId: decision.id,
    entryPrice: 600,
  });
  positionStore.transitionPosition({ id: position.id, toStatus: 'OPEN', reason: 'Live test.' });
  const store = new ExecutionStore(path);
  try {
    const proposal = store.createExitProposal({
      positionId: position.id,
      reason: 'Manual strategic exit test.',
      slippageBps: 100,
      burnAfterCollect: true,
      swapWbnbToUsdt: false,
      expiresAt: '2026-07-18T11:30:00.000Z',
      now: new Date('2026-07-18T11:00:00.000Z'),
    });
    assert.equal(proposal.status, 'PENDING_APPROVAL');
    assert.throws(
      () =>
        store.createExitProposal({
          positionId: position.id,
          reason: 'Duplicate proposal.',
          slippageBps: 100,
          burnAfterCollect: false,
          swapWbnbToUsdt: false,
          expiresAt: '2026-07-18T11:30:00.000Z',
          now: new Date('2026-07-18T11:01:00.000Z'),
        }),
      /active exit proposal/
    );
    const approved = store.reviewExitProposal(
      proposal.id,
      true,
      'Approved for unsigned planning.',
      new Date('2026-07-18T11:05:00.000Z')
    );
    assert.equal(approved.status, 'APPROVED');
    assert.equal(store.getRecentExitProposals(1)[0]?.positionId, position.id);
  } finally {
    store.close();
    positionStore.close();
    agentStore.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('verified exit settlement closes LIVE position and feeds the daily-loss gate', () => {
  const directory = mkdtempSync(join(tmpdir(), 'bnb-exit-settlement-'));
  const path = join(directory, 'test.sqlite');
  const agentStore = new AgentStore(path);
  const decision = agentStore.saveIfAbsent(paperDecision).decision;
  const positionStore = new PositionStore(path);
  const store = new ExecutionStore(path);
  const wallet = '0x1111111111111111111111111111111111111111';
  try {
    const entryProposal = store.createProposal({
      decisionId: decision.id,
      amountUsd: 100,
      readiness: { ready: true },
      expiresAt: '2026-07-18T10:30:00.000Z',
      now: new Date('2026-07-18T10:00:00.000Z'),
    });
    store.reviewProposal(entryProposal.id, true, 'Approved entry.', new Date('2026-07-18T10:01:00.000Z'));
    store.recordVerifiedTransaction(
      entryProposal.id,
      `0x${'ab'.repeat(32)}`,
      new Date('2026-07-18T10:10:00.000Z')
    );
    const tracked = positionStore.confirmVerifiedLiveMint({
      proposalId: entryProposal.id,
      decisionId: decision.id,
      investmentUsd: 100,
      entryPrice: 600,
      entryGasUsd: 0.02,
      txHash: `0x${'ab'.repeat(32)}`,
      wallet,
      tokenId: '123',
      blockNumber: 100,
      blockHash: `0x${'cd'.repeat(32)}`,
      blockTimestamp: '2026-07-18T10:10:00.000Z',
      confirmations: 3,
      token0: '0x55d398326f99059ff775485246999027b3197955',
      token1: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',
      fee: 100,
      tickLower: -887272,
      tickUpper: 887272,
      liquidity: '1000',
      feeGrowthInside0LastX128: '0',
      feeGrowthInside1LastX128: '0',
      tokensOwed0: '0',
      tokensOwed1: '0',
      amount0: '50000000000000000000',
      amount1: '83333333333333333',
      gasUsed: '500000',
      effectiveGasPriceWei: '50000000',
      gasCostWei: '25000000000000',
      owner: wallet,
      verifiedAt: new Date('2026-07-18T10:12:00.000Z'),
    });
    const exitProposal = store.createExitProposal({
      positionId: tracked.position.id,
      reason: 'Verified loss-limiting exit.',
      slippageBps: 100,
      burnAfterCollect: true,
      swapWbnbToUsdt: false,
      expiresAt: '2026-07-18T12:00:00.000Z',
      now: new Date('2026-07-18T11:00:00.000Z'),
    });
    store.reviewExitProposal(exitProposal.id, true, 'Approved exit.', new Date('2026-07-18T11:01:00.000Z'));
    store.saveExitTransactionPlan({
      exitProposalId: exitProposal.id,
      positionId: tracked.position.id,
      wallet,
      referenceBlockNumber: 110,
      plan: {
        swapAmountIn: null,
        transactions: [{ purpose: 'COLLECT', to: wallet, data: '0x1234', value: '0x0' }],
      },
      now: new Date('2026-07-18T11:02:00.000Z'),
    });
    const settlement = store.settleVerifiedExit({
      exitProposalId: exitProposal.id,
      txHashes: [`0x${'ef'.repeat(32)}`],
      collectedUsdt: '94000000000000000000',
      collectedWbnb: '0',
      swapUsdtReceived: '0',
      residualWbnb: '0',
      exitValueUsd: 94,
      exitGasUsd: 0.03,
      realizedPnlUsd: -6.05,
      finalBlockNumber: 120,
      confirmations: 3,
      burnAfterCollect: true,
      now: new Date('2026-07-18T11:10:00.000Z'),
    });
    assert.equal(settlement.realizedPnlUsd, -6.05);
    assert.equal(positionStore.getPosition(tracked.position.id)?.status, 'CLOSED');
    assert.equal(store.getExitProposal(exitProposal.id)?.settledAt, '2026-07-18T11:10:00.000Z');
    assert.equal(store.getRealizedLossToday(new Date('2026-07-18T20:00:00.000Z')), 6.05);
    assert.equal(store.getTransactionByProposal(entryProposal.id)?.realizedPnlUsd, -6.05);
  } finally {
    store.close();
    positionStore.close();
    agentStore.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('expired execution proposal cannot be approved', () => {
  const directory = mkdtempSync(join(tmpdir(), 'bnb-execution-'));
  const path = join(directory, 'test.sqlite');
  const agentStore = new AgentStore(path);
  const decision = agentStore.saveIfAbsent(paperDecision).decision;
  const store = new ExecutionStore(path);
  try {
    const proposal = store.createProposal({
      decisionId: decision.id,
      amountUsd: 50,
      readiness: { ready: true },
      expiresAt: '2026-07-18T10:10:00.000Z',
      now: new Date('2026-07-18T10:00:00.000Z'),
    });
    assert.throws(
      () => store.reviewProposal(proposal.id, true, 'Too late.', new Date('2026-07-18T10:11:00.000Z')),
      /expired/
    );
    assert.equal(store.getProposal(proposal.id)?.status, 'EXPIRED');
  } finally {
    store.close();
    agentStore.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
