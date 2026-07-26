import assert from 'node:assert/strict';
import test from 'node:test';

import { LifecycleActivationStore } from './lifecycle-activation-store.js';

test('Stage G activation defaults to shadow and rejects an unqualified run', () => {
  const store = new LifecycleActivationStore(':memory:', new Date('2026-08-01T00:00:00.000Z'), {
    initializeSchema: true,
  });
  try {
    assert.equal(store.getState().mode, 'SHADOW');
    assert.throws(
      () =>
        store.activatePaper({
          shadowQualified: false,
          shadowRunId: 1,
          shadowBlockers: ['SHADOW_MINIMUM_14_DAYS_NOT_REACHED'],
          confirmPaperOnly: true,
          reason: 'Attempt before qualification.',
        }),
      /SHADOW_VALIDATION_NOT_QUALIFIED/
    );
    assert.equal(store.getState().mode, 'SHADOW');
    assert.equal(store.getEvents().length, 0);
  } finally {
    store.close();
  }
});

test('activates paper-only mode after qualification and supports explicit rollback', () => {
  const store = new LifecycleActivationStore(':memory:', new Date('2026-08-01T00:00:00.000Z'), {
    initializeSchema: true,
  });
  try {
    assert.throws(
      () =>
        store.activatePaper({
          shadowQualified: true,
          shadowRunId: 7,
          shadowBlockers: [],
          confirmPaperOnly: false,
          reason: 'Missing explicit confirmation.',
        }),
      /confirmPaperOnly/
    );

    const active = store.activatePaper({
      shadowQualified: true,
      shadowRunId: 7,
      shadowBlockers: [],
      confirmPaperOnly: true,
      reason: 'Qualified run reviewed and approved for paper activation.',
      now: new Date('2026-08-02T00:00:00.000Z'),
    });
    assert.equal(active.mode, 'PAPER_ACTIVE');
    assert.equal(active.qualifiedShadowRunId, 7);
    assert.equal(active.paperOnly, true);
    assert.equal(active.liveExecutionChanged, false);

    const shadow = store.returnToShadow(
      'Manual rollback after monitoring warning.',
      new Date('2026-08-02T01:00:00.000Z')
    );
    assert.equal(shadow.mode, 'SHADOW');
    assert.deepEqual(
      store.getEvents().map(event => event.eventType),
      ['RETURNED_TO_SHADOW', 'PAPER_ACTIVATED']
    );
  } finally {
    store.close();
  }
});
