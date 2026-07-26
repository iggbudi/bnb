import { calculateIL } from '../../lp-analysis/index.js';
import type { PaperAgentDecision, PaperAgentOutcomeInput } from '../../../agent-store.js';
import type { PoolSnapshot } from '../../../snapshot-store.js';

export const PAPER_AGENT_HORIZONS = [1, 6, 24, 168] as const;
export type PaperAgentHorizon = (typeof PAPER_AGENT_HORIZONS)[number];
export const OUTCOME_SNAPSHOT_MIN_COVERAGE_PERCENT = 80;
export const OUTCOME_TARGET_SNAPSHOT_MAX_AGE_MS = 15 * 60 * 1_000;
export const OUTCOME_DATA_GRACE_MS = 15 * 60 * 1_000;

export interface ObservedFullRangeFee {
  amountUsd: number;
  token0Fee: number;
  token1Fee: number;
  liquidity: string;
  entryBlockNumber: number;
  exitBlockNumber: number;
  accountingVersion: string;
}

function getTargetAt(decision: PaperAgentDecision, horizonHours: PaperAgentHorizon): Date {
  return new Date(new Date(decision.createdAt).getTime() + horizonHours * 60 * 60 * 1_000);
}

export function makeSkippedPaperOutcome(
  decision: PaperAgentDecision,
  horizonHours: PaperAgentHorizon,
  now: Date,
  snapshotCount: number,
  reason: string
): PaperAgentOutcomeInput {
  return {
    decisionId: decision.id,
    horizonHours,
    targetAt: getTargetAt(decision, horizonHours).toISOString(),
    evaluatedAt: now.toISOString(),
    status: 'SKIPPED_DATA_GAP',
    exitCapturedAt: null,
    exitPrice: null,
    snapshotCount,
    estimatedFee: null,
    holdValue: null,
    lpValueBeforeFee: null,
    lpValueAfterFee: null,
    ilLoss: null,
    ilPercent: null,
    lpProfitLossVsInvestment: null,
    lpReturnPercent: null,
    decisionProfitLoss: null,
    differenceVsHold: null,
    decisionReward: null,
    regret: null,
    actionCorrect: null,
    note: reason,
  };
}

export function evaluatePaperDecision(
  decision: PaperAgentDecision,
  horizonHours: PaperAgentHorizon,
  exitSnapshot: PoolSnapshot,
  intervalSnapshots: PoolSnapshot[],
  observedFee: ObservedFullRangeFee,
  now = new Date()
): PaperAgentOutcomeInput {
  if (intervalSnapshots.length === 0) {
    throw new Error('Paper outcome requires interval snapshots');
  }

  const expectedSnapshots = horizonHours * 60;
  const coveragePercent = Math.min(100, (intervalSnapshots.length / expectedSnapshots) * 100);
  if (coveragePercent < OUTCOME_SNAPSHOT_MIN_COVERAGE_PERCENT) {
    throw new Error('Paper outcome snapshot coverage is below 80%');
  }

  if (
    !Number.isFinite(observedFee.amountUsd) ||
    observedFee.amountUsd < 0 ||
    !/^\d+$/.test(observedFee.liquidity) ||
    observedFee.entryBlockNumber <= 0 ||
    observedFee.exitBlockNumber < observedFee.entryBlockNumber
  )
    throw new Error('Paper outcome has invalid on-chain fee-growth evidence');
  const estimatedFee = observedFee.amountUsd;
  const il = calculateIL(decision.referencePrice, exitSnapshot.price, decision.investment);
  const lpValueAfterFee = il.lpValue + estimatedFee;
  const lpProfitLossVsInvestment = lpValueAfterFee - decision.investment;
  const differenceVsHold = lpValueAfterFee - il.holdValue;
  const shouldEnter = differenceVsHold > 0;
  const entered = decision.action === 'ENTER_FULL_RANGE';
  const actionCorrect = entered === shouldEnter;
  const decisionProfitLoss = entered ? lpProfitLossVsInvestment : 0;
  const decisionReward = entered ? differenceVsHold : -differenceVsHold;
  const regret = actionCorrect ? 0 : Math.abs(differenceVsHold);

  return {
    decisionId: decision.id,
    horizonHours,
    targetAt: getTargetAt(decision, horizonHours).toISOString(),
    evaluatedAt: now.toISOString(),
    status: 'EVALUATED',
    exitCapturedAt: exitSnapshot.capturedAt,
    exitPrice: exitSnapshot.price,
    snapshotCount: intervalSnapshots.length,
    estimatedFee,
    holdValue: il.holdValue,
    lpValueBeforeFee: il.lpValue,
    lpValueAfterFee,
    ilLoss: il.ilLoss,
    ilPercent: il.ilPercent,
    lpProfitLossVsInvestment,
    lpReturnPercent: (lpProfitLossVsInvestment / decision.investment) * 100,
    decisionProfitLoss,
    differenceVsHold,
    decisionReward,
    regret,
    actionCorrect,
    note: `Raw counterfactual full-range ${horizonHours}h; coverage ${coveragePercent.toFixed(1)}%; fee dari delta feeGrowthGlobal V3 block ${observedFee.entryBlockNumber}-${observedFee.exitBlockNumber} untuk liquidity ${observedFee.liquidity} (${observedFee.accountingVersion}). Strict LP-vs-HOLD ini belum memasukkan lifecycle gas; gunakan lifecycle interpretation. Slippage hanya berlaku bila transaction path meminta swap. Full-range tidak memakai rebalance berkala.`,
  };
}
