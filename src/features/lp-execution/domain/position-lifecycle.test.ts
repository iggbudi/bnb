import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertPositionTransition,
  canTransitionPosition,
  positionAgeHours,
  scheduledPositionReview,
} from './position-lifecycle.js';

test('position lifecycle allows only explicit transitions', () => {
  assert.equal(canTransitionPosition('PENDING_ENTRY', 'OPEN'), true);
  assert.equal(canTransitionPosition('OPEN', 'PENDING_EXIT'), true);
  assert.equal(canTransitionPosition('PENDING_EXIT', 'CLOSED'), true);
  assert.equal(canTransitionPosition('CLOSED', 'OPEN'), false);
  assert.throws(() => assertPositionTransition('OPEN', 'CLOSED'), /Invalid position transition/);
});

test('calculates position age without returning negative time', () => {
  assert.equal(positionAgeHours('2026-07-01T00:00:00.000Z', new Date('2026-07-08T00:00:00.000Z')), 168);
  assert.equal(positionAgeHours('2026-07-02T00:00:00.000Z', new Date('2026-07-01T00:00:00.000Z')), 0);
});

test('schedules one seven-day and one fourteen-day review', () => {
  const openedAt = '2026-07-01T00:00:00.000Z';
  assert.equal(scheduledPositionReview(openedAt, false, false, new Date('2026-07-07T23:59:00.000Z')), null);
  assert.equal(
    scheduledPositionReview(openedAt, false, false, new Date('2026-07-08T00:00:00.000Z')),
    'REVIEW_7D'
  );
  assert.equal(
    scheduledPositionReview(openedAt, true, false, new Date('2026-07-15T00:00:00.000Z')),
    'REVIEW_14D'
  );
  assert.equal(scheduledPositionReview(openedAt, true, true, new Date('2026-07-16T00:00:00.000Z')), null);
});
