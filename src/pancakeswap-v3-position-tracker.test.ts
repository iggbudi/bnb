import assert from 'node:assert/strict';
import test from 'node:test';

import { encodeMintFullRange, PANCAKE_V3_POSITION_MANAGER } from './pancakeswap-v3-execution.js';
import {
  verifyMintAgainstImmutablePlan,
  verifyPancakeV3MintEvidence,
  type RpcTransaction,
  type RpcTransactionReceipt,
} from './pancakeswap-v3-position-tracker.js';

const wallet = '0x1111111111111111111111111111111111111111';
const usdt = '0x55d398326f99059ff775485246999027b3197955';
const wbnb = '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c';
const hash = `0x${'ab'.repeat(32)}`;
const blockHash = `0x${'cd'.repeat(32)}`;
const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const increaseTopic = '0x3067048beee31b25b2f1681f88dac838c8bba36af25bfb2b7cf7473a5847e35f';

function uint(value: bigint): string {
  return value.toString(16).padStart(64, '0');
}

function int(value: number, bits = 24): string {
  return BigInt.asUintN(256, BigInt.asIntN(bits, BigInt(value)))
    .toString(16)
    .padStart(64, '0');
}

function address(value: string): string {
  return value.slice(2).padStart(64, '0');
}

function evidence() {
  const tokenId = 42n;
  const transaction: RpcTransaction = {
    hash,
    from: wallet,
    to: PANCAKE_V3_POSITION_MANAGER,
    value: '0x0',
    gasPrice: '0x3b9aca00',
    input: encodeMintFullRange({
      fee: 100,
      amount0Desired: 50n * 10n ** 18n,
      amount1Desired: 1n * 10n ** 17n,
      amount0Min: 49n * 10n ** 18n,
      amount1Min: 9n * 10n ** 16n,
      recipient: wallet,
      deadline: 2_000_000_000,
    }),
  };
  const receipt: RpcTransactionReceipt = {
    transactionHash: hash,
    blockNumber: '0x64',
    blockHash,
    from: wallet,
    to: PANCAKE_V3_POSITION_MANAGER,
    status: '0x1',
    gasUsed: '0x7a120',
    effectiveGasPrice: '0x3b9aca00',
    logs: [
      {
        address: PANCAKE_V3_POSITION_MANAGER,
        topics: [transferTopic, `0x${uint(0n)}`, `0x${address(wallet)}`, `0x${uint(tokenId)}`],
        data: '0x',
      },
      {
        address: PANCAKE_V3_POSITION_MANAGER,
        topics: [increaseTopic, `0x${uint(tokenId)}`],
        data: `0x${uint(123456n)}${uint(50n * 10n ** 18n)}${uint(1n * 10n ** 17n)}`,
      },
    ],
  };
  const positionResult = `0x${[
    uint(0n),
    address('0x0000000000000000000000000000000000000000'),
    address(usdt),
    address(wbnb),
    uint(100n),
    int(-887272),
    int(887272),
    uint(123456n),
    uint(987n),
    uint(654n),
    uint(0n),
    uint(0n),
  ].join('')}`;
  const ownerResult = `0x${address(wallet)}`;
  return { transaction, receipt, positionResult, ownerResult };
}

test('verifies a confirmed full-range mint receipt and decodes its NFT position', () => {
  const fixture = evidence();
  const verified = verifyPancakeV3MintEvidence({
    txHash: hash,
    wallet,
    ...fixture,
    currentBlockNumber: 102,
    blockTimestamp: '2026-07-18T15:00:00.000Z',
    minimumConfirmations: 3,
  });

  assert.equal(verified.tokenId, '42');
  assert.equal(verified.owner, wallet);
  assert.equal(verified.tickLower, -887272);
  assert.equal(verified.tickUpper, 887272);
  assert.equal(verified.liquidity, '123456');
  assert.equal(verified.amount0, (50n * 10n ** 18n).toString());
  assert.equal(verified.confirmations, 3);
  assert.equal(verified.gasCostWei, (500000n * 1_000_000_000n).toString());
});

test('binds mint evidence to immutable plan time, block, calldata, and amounts', () => {
  const fixture = evidence();
  const verified = verifyPancakeV3MintEvidence({
    txHash: hash,
    wallet,
    ...fixture,
    currentBlockNumber: 102,
    blockTimestamp: '2026-07-18T15:00:00.000Z',
    minimumConfirmations: 3,
  });
  const plan = {
    createdAt: '2026-07-18T14:59:00.000Z',
    referenceBlockNumber: 99,
    amountUsd: 100,
    amount0Desired: verified.amount0Desired,
    amount1Desired: verified.amount1Desired,
    amount0Min: verified.amount0Min,
    amount1Min: verified.amount1Min,
    deadline: verified.deadline,
    mintCalldata: verified.mintCalldata,
  };
  assert.doesNotThrow(() =>
    verifyMintAgainstImmutablePlan({
      verified,
      proposalCreatedAt: '2026-07-18T14:58:00.000Z',
      proposalExpiresAt: '2026-07-18T15:10:00.000Z',
      plan,
      proposalAmountUsd: 100,
    })
  );
  assert.throws(
    () =>
      verifyMintAgainstImmutablePlan({
        verified,
        proposalCreatedAt: '2026-07-18T15:01:00.000Z',
        proposalExpiresAt: '2026-07-18T15:10:00.000Z',
        plan: { ...plan, createdAt: '2026-07-18T15:01:00.000Z' },
        proposalAmountUsd: 100,
      }),
    /before the approved immutable plan/
  );
  assert.throws(
    () =>
      verifyMintAgainstImmutablePlan({
        verified,
        proposalCreatedAt: '2026-07-18T14:58:00.000Z',
        proposalExpiresAt: '2026-07-18T15:10:00.000Z',
        plan: { ...plan, amount0Desired: '1' },
        proposalAmountUsd: 100,
      }),
    /does not match/
  );
});

test('rejects receipts sent to a different contract or without enough confirmations', () => {
  const fixture = evidence();
  assert.throws(
    () =>
      verifyPancakeV3MintEvidence({
        txHash: hash,
        wallet,
        ...fixture,
        transaction: { ...fixture.transaction, to: wallet },
        currentBlockNumber: 102,
        blockTimestamp: '2026-07-18T15:00:00.000Z',
      }),
    /official PancakeSwap/
  );

  assert.throws(
    () =>
      verifyPancakeV3MintEvidence({
        txHash: hash,
        wallet,
        ...fixture,
        currentBlockNumber: 100,
        blockTimestamp: '2026-07-18T15:00:00.000Z',
        minimumConfirmations: 3,
      }),
    /1 confirmation/
  );
});

test('rejects an NFT no longer owned by the proposal wallet', () => {
  const fixture = evidence();
  assert.throws(
    () =>
      verifyPancakeV3MintEvidence({
        txHash: hash,
        wallet,
        ...fixture,
        ownerResult: `0x${address('0x2222222222222222222222222222222222222222')}`,
        currentBlockNumber: 102,
        blockTimestamp: '2026-07-18T15:00:00.000Z',
      }),
    /no longer owns/
  );
});
