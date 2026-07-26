import assert from 'node:assert/strict';
import test from 'node:test';

import type { AgentModelRecord, PaperAgentDecision, PaperAgentPerformance } from '../../../agent-store.js';
import { evaluateExecutionReadiness } from './execution-control.js';

const now = new Date('2026-07-18T10:30:00.000Z');
const model = {
  version: 'logistic-v1',
  accuracyPercent: 65,
} as AgentModelRecord;
const decision = {
  createdAt: '2026-07-18T10:00:00.000Z',
  action: 'ENTER_FULL_RANGE',
  strategyVersion: 'logistic-v1',
} as PaperAgentDecision;
const performance = {
  evaluated: 400,
  scored: 400,
  diagnostic: 0,
  accuracyPercent: 65,
} as PaperAgentPerformance;

function readiness(overrides = {}) {
  return evaluateExecutionReadiness({
    liveExecutionEnabled: true,
    adminTokenConfigured: true,
    onchainAdapterReady: true,
    shadowValidationQualified: true,
    paperLifecycleActive: true,
    killSwitchEngaged: false,
    activeModel: model,
    performance168h: performance,
    latestDecision: decision,
    realizedLossTodayUsd: 0,
    now,
    limits: {
      maxCapitalUsd: 100,
      maxDailyLossUsd: 5,
      proposalExpiryMinutes: 15,
    },
    ...overrides,
  });
}

test('execution readiness passes only with every safety gate', () => {
  const result = readiness();
  assert.equal(result.ready, true);
  assert.equal(result.mode, 'MANUAL_APPROVAL');
  assert.deepEqual(result.blockers, []);
});

test('execution readiness remains locked without an on-chain adapter and active model', () => {
  const result = readiness({ onchainAdapterReady: false, activeModel: null });
  assert.equal(result.ready, false);
  assert.ok(result.blockers.includes('ONCHAIN_EXECUTION_ADAPTER_NOT_READY'));
  assert.ok(result.blockers.includes('NO_ACTIVE_VALIDATED_MODEL'));
});

test('shadow validation and Stage G paper activation are mandatory live-entry gates', () => {
  const result = readiness({ shadowValidationQualified: false, paperLifecycleActive: false });
  assert.equal(result.ready, false);
  assert.ok(result.blockers.includes('SHADOW_VALIDATION_NOT_QUALIFIED'));
  assert.ok(result.blockers.includes('PAPER_LIFECYCLE_NOT_ACTIVE'));
});

test('emergency stop and daily loss limit block execution', () => {
  const result = readiness({ killSwitchEngaged: true, realizedLossTodayUsd: 5 });
  assert.ok(result.blockers.includes('EMERGENCY_STOP_ENGAGED'));
  assert.ok(result.blockers.includes('DAILY_LOSS_LIMIT_REACHED'));
});
