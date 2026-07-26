import assert from 'node:assert/strict';
import test from 'node:test';

import { verifyExitReceiptEvidence } from './pancakeswap-v3-exit-tracker.js';

const wallet = '0x1111111111111111111111111111111111111111';
const usdt = '0x55d398326f99059ff775485246999027b3197955';
const wbnb = '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c';
const manager = '0x46a15b0b27311cedf172ab29e4f4766fbe7f4364';
const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const hash = `0x${'ab'.repeat(32)}`;

function topicAddress(address: string): string {
  return `0x${address.slice(2).padStart(64, '0')}`;
}

function transfer(token: string, amount: bigint) {
  return {
    address: token,
    topics: [transferTopic, topicAddress(manager), topicAddress(wallet)],
    data: `0x${amount.toString(16).padStart(64, '0')}`,
  };
}

const expected = [{ purpose: 'COLLECT', to: manager, data: '0x1234', value: '0x0' }];
const transaction = { hash, from: wallet, to: manager, input: '0x1234', value: '0x0' };
const receipt = {
  transactionHash: hash,
  blockNumber: '0x65',
  transactionIndex: '0x1',
  from: wallet,
  to: manager,
  status: '0x1',
  gasUsed: '0x186a0',
  effectiveGasPrice: '0x2faf080',
  logs: [transfer(usdt, 100n * 10n ** 18n), transfer(wbnb, 100_000_000_000_000_000n)],
  blockTimestamp: '2026-07-18T10:10:00.000Z',
};

function verify(overrides: Record<string, unknown> = {}) {
  return verifyExitReceiptEvidence({
    wallet,
    expectedTransactions: expected,
    transactions: [transaction],
    receipts: [receipt],
    referenceBlockNumber: 100,
    planCreatedAt: '2026-07-18T10:05:00.000Z',
    proposalExpiresAt: '2026-07-18T10:30:00.000Z',
    currentBlockNumber: 103,
    minimumConfirmations: 3,
    swapAmountIn: null,
    priceWbnbUsd: 500,
    investmentUsd: 145,
    entryGasUsd: 0.01,
    ...overrides,
  });
}

test('verifies ordered immutable exit receipts and computes realized PnL', () => {
  const evidence = verify();
  assert.equal(evidence.collectedUsdt, (100n * 10n ** 18n).toString());
  assert.equal(evidence.collectedWbnb, '100000000000000000');
  assert.equal(evidence.exitValueUsd, 150);
  assert.ok(evidence.exitGasUsd > 0);
  assert.ok(evidence.realizedPnlUsd > 4.9);
  assert.equal(evidence.confirmations, 3);
});

test('rejects an exit receipt mined before the immutable plan reference', () => {
  assert.throws(
    () =>
      verify({
        receipts: [{ ...receipt, blockNumber: '0x63' }],
      }),
    /predates the immutable plan reference/
  );
});

test('rejects calldata that differs from the immutable exit plan', () => {
  assert.throws(
    () =>
      verify({
        transactions: [{ ...transaction, input: '0x5678' }],
      }),
    /does not match the immutable plan/
  );
});
