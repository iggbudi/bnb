import assert from 'node:assert/strict';
import test from 'node:test';

import { parsePositiveNumber, parsePositiveNumberOrDefault } from './validation.js';

test('parsePositiveNumber accepts positive finite numbers', () => {
  assert.equal(parsePositiveNumber('12.5', 'amount'), 12.5);
  assert.equal(parsePositiveNumber(12.5, 'amount'), 12.5);
});

test('parsePositiveNumber rejects missing, malformed, and non-positive values', () => {
  for (const value of [undefined, '', 'abc', '12abc', '0', '-1', 'Infinity', 'NaN']) {
    assert.throws(() => parsePositiveNumber(value, 'amount'), /Parameter "amount"/);
  }
});

test('parsePositiveNumberOrDefault defaults only when omitted', () => {
  assert.equal(parsePositiveNumberOrDefault(undefined, 'amount', 10_000), 10_000);
  assert.throws(() => parsePositiveNumberOrDefault('0', 'amount', 10_000));
});
