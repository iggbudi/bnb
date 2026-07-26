import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { AgentStore, type PaperAgentDecision } from '../../paper-agent/index.js';
import { FULL_RANGE_FEE_ACCOUNTING_VERSION } from '../../lp-analysis/index.js';
import type { PaperPositionLifecycleResult } from '../application/paper-position-manager.js';
import { PositionStore } from './position-store.js';
import { ShadowModeStore } from './shadow-mode-store.js';

const start = new Date('2026-07-01T00:00:00.000Z');
const decision = {
  id: 1,
  action: 'WAIT',
} as PaperAgentDecision;
const waitResult: PaperPositionLifecycleResult = {
  action: 'WAIT',
  position: null,
  evaluation: null,
  reasonCode: 'DATA_INSUFFICIENT',
};

function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'bnb-shadow-'));
  const path = join(directory, 'test.sqlite');
  const agentStore = new AgentStore(path, { initializeSchema: true });
  agentStore.saveIfAbsent({
    decisionHour: start.toISOString(),
    createdAt: start.toISOString(),
    strategyVersion: 'lifecycle-v2.1',
    action: 'WAIT',
    reasonCode: 'TEST',
    confidence: 'high',
    rationale: 'Shadow qualification test.',
    investment: 100,
    referencePrice: 570,
    predictedFee24h: 0,
    predictedIL24h: 0,
    predictedExcessVsHold24h: 0,
    features: { feeAccountingVersion: FULL_RANGE_FEE_ACCOUNTING_VERSION },
  });
  const positionStore = new PositionStore(path, { initializeSchema: true });
  const shadowStore = new ShadowModeStore(path, start, { initializeSchema: true });
  return { directory, agentStore, positionStore, shadowStore };
}

test('shadow validation starts a persistent fourteen-day run with explicit blockers', () => {
  const context = setup();
  try {
    context.shadowStore.recordSuccess(decision, waitResult, start);
    const status = context.shadowStore.getStatus(start);
    assert.equal(status.run.status, 'RUNNING');
    assert.equal(status.targetDays, 14);
    assert.equal(status.observedHours, 1);
    assert.equal(status.coveragePercent, 100);
    assert.equal(status.qualified, false);
    assert.ok(status.blockers.includes('SHADOW_MINIMUM_14_DAYS_NOT_REACHED'));
    assert.ok(status.blockers.includes('NO_COMPLETED_14D_PAPER_POSITION'));
  } finally {
    context.shadowStore.close();
    context.positionStore.close();
    context.agentStore.close();
    rmSync(context.directory, { recursive: true, force: true });
  }
});

test('qualifies only after sufficient hourly coverage and a valid completed 14-day paper position', () => {
  const context = setup();
  try {
    const position = context.positionStore.createPosition({
      mode: 'PAPER',
      investmentUsd: 100,
      entryDecisionId: 1,
      entryPrice: 570,
      accountingVersion: FULL_RANGE_FEE_ACCOUNTING_VERSION,
      now: start,
    });
    context.positionStore.transitionPosition({
      id: position.id,
      toStatus: 'OPEN',
      reason: 'Shadow entry.',
      now: start,
    });

    for (let hour = 0; hour <= 320; hour++) {
      context.shadowStore.recordSuccess(
        decision,
        waitResult,
        new Date(start.getTime() + hour * 60 * 60 * 1_000)
      );
    }
    const finalAt = new Date(start.getTime() + 336 * 60 * 60 * 1_000);
    context.positionStore.recordEvaluation({
      positionId: position.id,
      evaluatedAt: finalAt.toISOString(),
      ageHours: 336,
      lpValueUsd: 101,
      holdValueUsd: 100.5,
      accumulatedFeeUsd: 1,
      grossPnlUsd: 1,
      netPnlUsd: 0.95,
      differenceVsHoldUsd: 0.5,
      estimatedExitCostUsd: 0.05,
      dataQuality: 'valid',
      metrics: { accountingVersion: FULL_RANGE_FEE_ACCOUNTING_VERSION },
    });
    context.positionStore.transitionPosition({
      id: position.id,
      toStatus: 'PENDING_EXIT',
      reason: 'Final shadow review.',
      now: finalAt,
    });
    context.positionStore.transitionPosition({
      id: position.id,
      toStatus: 'CLOSED',
      reason: 'PAPER_MAX_HOLD_REACHED',
      now: finalAt,
    });
    context.shadowStore.recordSuccess(decision, waitResult, finalAt);

    const status = context.shadowStore.refreshQualification(finalAt);
    assert.ok(status.coveragePercent >= 95);
    assert.equal(status.completed14dPaperPositions, 1);
    assert.equal(status.valid14dFinalEvaluations, 1);
    assert.equal(status.qualified, true);
    assert.equal(status.run.status, 'QUALIFIED');
    assert.deepEqual(status.blockers, []);
  } finally {
    context.shadowStore.close();
    context.positionStore.close();
    context.agentStore.close();
    rmSync(context.directory, { recursive: true, force: true });
  }
});

test('a processing error is sticky until an audited shadow run reset', () => {
  const context = setup();
  try {
    context.shadowStore.recordFailure(decision, new Error('Invariant failed'), start);
    context.shadowStore.recordSuccess(decision, waitResult, start);
    const status = context.shadowStore.getStatus(start);
    assert.equal(status.successfulHours, 1);
    assert.equal(status.errorHours, 1);
    assert.ok(status.blockers.includes('SHADOW_PROCESSING_ERRORS_PRESENT'));

    const reset = context.shadowStore.reset(
      'Restart after fixing invariant.',
      new Date(start.getTime() + 60 * 60 * 1_000)
    );
    assert.equal(reset.run.id, status.run.id + 1);
    assert.equal(reset.errorHours, 0);
    assert.equal(reset.run.status, 'RUNNING');
  } finally {
    context.shadowStore.close();
    context.positionStore.close();
    context.agentStore.close();
    rmSync(context.directory, { recursive: true, force: true });
  }
});
