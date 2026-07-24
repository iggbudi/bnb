import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildTickRanges,
  decodeSlot0,
  encodeTickCall,
  feeGrowthDelta,
  feeGrowthInside,
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
