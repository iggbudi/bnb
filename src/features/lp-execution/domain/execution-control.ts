import type { AgentModelRecord, PaperAgentDecision, PaperAgentPerformance } from '../../paper-agent/index.js';

export interface ExecutionLimits {
  maxCapitalUsd: number;
  maxDailyLossUsd: number;
  proposalExpiryMinutes: number;
}

export interface ExecutionReadinessInput {
  liveExecutionEnabled: boolean;
  adminTokenConfigured: boolean;
  onchainAdapterReady: boolean;
  shadowValidationQualified: boolean;
  paperLifecycleActive: boolean;
  killSwitchEngaged: boolean;
  activeModel: AgentModelRecord | null;
  performance168h: PaperAgentPerformance;
  latestDecision: PaperAgentDecision | null;
  realizedLossTodayUsd: number;
  now: Date;
  limits: ExecutionLimits;
}

export interface ExecutionReadiness {
  ready: boolean;
  mode: 'LOCKED' | 'MANUAL_APPROVAL';
  blockers: string[];
  warnings: string[];
}

export function evaluateExecutionReadiness(input: ExecutionReadinessInput): ExecutionReadiness {
  const blockers: string[] = [];
  const warnings: string[] = [
    'Approval hanya mengubah status proposal; server tidak menyimpan private key dan tidak menandatangani transaksi.',
  ];

  if (!input.liveExecutionEnabled) blockers.push('LIVE_EXECUTION_DISABLED');
  if (!input.adminTokenConfigured) blockers.push('ADMIN_TOKEN_NOT_CONFIGURED');
  if (!input.onchainAdapterReady) blockers.push('ONCHAIN_EXECUTION_ADAPTER_NOT_READY');
  if (!input.shadowValidationQualified) blockers.push('SHADOW_VALIDATION_NOT_QUALIFIED');
  if (!input.paperLifecycleActive) blockers.push('PAPER_LIFECYCLE_NOT_ACTIVE');
  if (input.killSwitchEngaged) blockers.push('EMERGENCY_STOP_ENGAGED');
  if (!input.activeModel) blockers.push('NO_ACTIVE_VALIDATED_MODEL');
  if (input.performance168h.scored < 336) blockers.push('INSUFFICIENT_SCORED_168H_OUTCOMES');
  if (input.performance168h.accuracyPercent === null || input.performance168h.accuracyPercent < 60)
    blockers.push('PAPER_168H_ACCURACY_BELOW_60_PERCENT');
  if (input.realizedLossTodayUsd >= input.limits.maxDailyLossUsd) {
    blockers.push('DAILY_LOSS_LIMIT_REACHED');
  }

  if (!input.latestDecision) {
    blockers.push('NO_AGENT_DECISION');
  } else {
    const ageMs = input.now.getTime() - new Date(input.latestDecision.createdAt).getTime();
    if (ageMs < 0 || ageMs > 90 * 60 * 1_000) blockers.push('LATEST_DECISION_STALE');
    if (input.latestDecision.action !== 'ENTER_FULL_RANGE') blockers.push('LATEST_DECISION_IS_NOT_ENTRY');
    if (!input.activeModel || input.latestDecision.strategyVersion !== input.activeModel.version) {
      blockers.push('LATEST_DECISION_NOT_FROM_ACTIVE_MODEL');
    }
  }

  return {
    ready: blockers.length === 0,
    mode: blockers.length === 0 ? 'MANUAL_APPROVAL' : 'LOCKED',
    blockers,
    warnings,
  };
}
