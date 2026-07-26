import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildTickRanges,
  decodeSlot0,
  encodeTickCall,
  feeGrowthDelta,
  feeGrowthInside,
  fetchPancakeV3OnchainState,
  initializeHypotheticalTick,
  type V3TickState,
} from './pancakeswap-v3-onchain.js';

function word(value: bigint): string {
  return BigInt.asUintN(256, value).toString(16).padStart(64, '0');
}

test('decodes PancakeSwap V3 slot0 including signed tick', () => {
  const encoded = `0x${[
    word(123456789n),
    word(-63446n),
    word(1n),
    word(2n),
    word(3n),
    word(216272100n),
    word(1n),
  ].join('')}`;
  const slot0 = decodeSlot0(encoded);
  assert.equal(slot0.sqrtPriceX96, 123456789n);
  assert.equal(slot0.tick, -63446);
  assert.equal(slot0.protocolFeeShareToken0Bps, 3300);
  assert.equal(slot0.protocolFeeShareToken1Bps, 3300);
  assert.equal(slot0.unlocked, true);
});

test('encodes negative ticks as a sign-extended ABI argument', () => {
  const call = encodeTickCall(-63446);
  assert.ok(call.startsWith('0xf30dba93'));
  assert.ok(call.endsWith('ffff082a'));
  assert.equal(call.length, 74);
});

test('builds aligned ranges around the current tick', () => {
  const ranges = buildTickRanges(-63446, 10, [5]);
  assert.equal(ranges.length, 1);
  assert.equal(Math.abs(ranges[0]!.tickLower % 10), 0);
  assert.equal(Math.abs(ranges[0]!.tickUpper % 10), 0);
  assert.ok(ranges[0]!.tickLower < -63446);
  assert.ok(ranges[0]!.tickUpper > -63446);
});

test('initializes hypothetical boundary checkpoints without attributing old fees', () => {
  const boundary: V3TickState = {
    tick: -100,
    initialized: false,
    liquidityGross: '0',
    liquidityNet: '0',
    feeGrowthOutside0X128: '0',
    feeGrowthOutside1X128: '0',
  };
  const initialized = initializeHypotheticalTick(boundary, 0, 100n, 200n);
  assert.equal(initialized.feeGrowthOutside0X128, '100');
  assert.equal(initialized.feeGrowthOutside1X128, '200');
});

test('reads and validates a complete deterministic BSC RPC snapshot', async () => {
  const originalFetch = globalThis.fetch;
  const addressWord = (value: string) => value.slice(2).padStart(64, '0');
  const rpcBatch = (results: unknown[]) =>
    new Response(
      JSON.stringify(results.map((result, index) => ({ jsonrpc: '2.0', id: index + 1, result }))),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  const slot0 = `0x${[word(3317521175930763235976231709n), word(-63459n), word(0n), word(0n), word(0n), word(216272100n), word(1n)].join('')}`;
  const tick = `0x${[word(1n), word(0n), word(10n), word(20n), word(0n), word(0n), word(0n), word(1n)].join('')}`;
  const responses = [
    rpcBatch(['0x38', '0x3e8']),
    rpcBatch([
      slot0,
      `0x${word(1_000_000n)}`,
      `0x${word(1_000n)}`,
      `0x${word(2_000n)}`,
      `0x${word(1n)}`,
      `0x${word(100n)}`,
      `0x${addressWord('0x55d398326f99059ff775485246999027b3197955')}`,
      `0x${addressWord('0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c')}`,
      '0x3b9aca00',
      { timestamp: '0x64' },
    ]),
    rpcBatch([`0x${word(18n)}`, `0x${word(18n)}`]),
    rpcBatch([tick, tick, tick, tick, tick, tick]),
  ];
  globalThis.fetch = (async () => responses.shift() ?? rpcBatch([])) as typeof fetch;
  try {
    const state = await fetchPancakeV3OnchainState('https://deterministic-rpc.example');
    assert.equal(state.chainId, 56);
    assert.equal(state.blockNumber, 1000);
    assert.equal(state.fee, 100);
    assert.equal(state.ranges.length, 3);
    assert.equal(state.readOnly, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fails closed for chain mismatch, malformed RPC entries, and timeout', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify([
          { jsonrpc: '2.0', id: 1, result: '0x1' },
          { jsonrpc: '2.0', id: 2, result: '0x2' },
        ]),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )) as typeof fetch;
    await assert.rejects(
      fetchPancakeV3OnchainState('https://wrong-chain.example'),
      /malformed chain or ABI data/
    );

    globalThis.fetch = (async () =>
      new Response(JSON.stringify([{ jsonrpc: '2.0', id: 1, result: '0x1' }]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;
    await assert.rejects(fetchPancakeV3OnchainState('https://missing-result.example'), /missing a result/);

    globalThis.fetch = (async () => {
      throw new DOMException('request timed out', 'TimeoutError');
    }) as typeof fetch;
    await assert.rejects(fetchPancakeV3OnchainState('https://timeout.example'), /timed out/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('calculates fee growth inside a currently active range', () => {
  const lower: V3TickState = {
    tick: -100,
    initialized: true,
    liquidityGross: '1',
    liquidityNet: '1',
    feeGrowthOutside0X128: '10',
    feeGrowthOutside1X128: '20',
  };
  const upper: V3TickState = {
    ...lower,
    tick: 100,
    feeGrowthOutside0X128: '30',
    feeGrowthOutside1X128: '40',
  };
  const inside = feeGrowthInside(0, lower, upper, 100n, 200n);
  assert.equal(inside.feeGrowthInside0X128, 60n);
  assert.equal(inside.feeGrowthInside1X128, 140n);
  assert.equal(feeGrowthDelta('5', (2n ** 256n - 2n).toString()), '7');
});
