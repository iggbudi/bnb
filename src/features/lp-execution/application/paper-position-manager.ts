import { calculateIL } from '../../lp-analysis/index.js';
import type { PaperAgentDecision } from '../../../agent-store.js';
import {
  FULL_RANGE_FEE_ACCOUNTING_VERSION,
  fullRangeFeeGrowthIncrement,
  fullRangeLiquidityForCapital,
} from '../../lp-analysis/index.js';
import { calculateFullRangeTokenAmounts } from '../infrastructure/pancakeswap-v3-execution.js';
import type { PancakeV3OnchainState } from '../infrastructure/pancakeswap-v3-onchain.js';
import { positionAgeHours, scheduledPositionReview } from '../domain/position-lifecycle.js';
import {
  PositionStore,
  type PositionEvaluationRecord,
  type PositionRecord,
} from '../../../position-store.js';
import { SnapshotStore } from '../../../snapshot-store.js';

const MINIMUM_HOLD_HOURS = 7 * 24;
const FINAL_REVIEW_HOURS = 14 * 24;
const REENTRY_COOLDOWN_HOURS = 24;

function isSameUtcHour(value: string, now: Date): boolean {
  const date = new Date(value);
  return (
    date.getUTCFullYear() === now.getUTCFullYear() &&
    date.getUTCMonth() === now.getUTCMonth() &&
    date.getUTCDate() === now.getUTCDate() &&
    date.getUTCHours() === now.getUTCHours()
  );
}

export interface PaperPositionMarketInput {
  price: number;
  tvl: number;
  volume1h: number;
}

export interface PaperPositionLifecycleResult {
  action: 'WAIT' | 'ENTER' | 'HOLD' | 'REVIEW_7D' | 'REVIEW_14D' | 'EXIT';
  position: PositionRecord | null;
  evaluation: PositionEvaluationRecord | null;
  reasonCode: string;
}

export function estimateLifecycleGas(onchain: PancakeV3OnchainState): {
  entryGasUsd: number;
  estimatedExitGasUsd: number;
} {
  const approvalGasUnits = 2 * 50_000;
  const approvalCostBnb = Number(BigInt(onchain.gas.gasPriceWei) * BigInt(approvalGasUnits)) / 1e18;
  return {
    entryGasUsd: onchain.gas.estimatedMintCostUsd + approvalCostBnb * onchain.priceWbnbUsd,
    estimatedExitGasUsd: onchain.gas.estimatedRebalanceCostUsd,
  };
}

function feeIncrementSince(
  position: PositionRecord,
  onchain: PancakeV3OnchainState | null
): { feeUsd: number; token0Fee: number; token1Fee: number; valid: boolean; reason: string } {
  if (
    !onchain ||
    position.accountingVersion !== FULL_RANGE_FEE_ACCOUNTING_VERSION ||
    !position.positionLiquidity ||
    !position.feeGrowthGlobal0LastX128 ||
    !position.feeGrowthGlobal1LastX128 ||
    position.feeCheckpointBlock === null
  ) {
    return {
      feeUsd: 0,
      token0Fee: 0,
      token1Fee: 0,
      valid: false,
      reason: 'FEE_GROWTH_CHECKPOINT_UNAVAILABLE',
    };
  }
  if (onchain.blockNumber < position.feeCheckpointBlock) {
    return { feeUsd: 0, token0Fee: 0, token1Fee: 0, valid: false, reason: 'ONCHAIN_BLOCK_REGRESSION' };
  }
  const increment = fullRangeFeeGrowthIncrement({
    liquidity: position.positionLiquidity,
    previousFeeGrowthGlobal0X128: position.feeGrowthGlobal0LastX128,
    previousFeeGrowthGlobal1X128: position.feeGrowthGlobal1LastX128,
    currentFeeGrowthGlobal0X128: onchain.feeGrowthGlobal0X128,
    currentFeeGrowthGlobal1X128: onchain.feeGrowthGlobal1X128,
    token0Decimals: onchain.token0Decimals,
    token1Decimals: onchain.token1Decimals,
    priceWbnbUsd: onchain.priceWbnbUsd,
  });
  return { ...increment, valid: true, reason: 'ONCHAIN_FEE_GROWTH_GLOBAL_X128' };
}

function evaluateOpenPaperPosition(input: {
  position: PositionRecord;
  market: PaperPositionMarketInput;
  onchain: PancakeV3OnchainState | null;
  positionStore: PositionStore;
  snapshotStore: SnapshotStore;
  now: Date;
}): PositionEvaluationRecord {
  if (!input.position.openedAt || input.position.entryPrice === null) {
    throw new Error('Open paper position is missing entry data');
  }
  const previous = input.positionStore.getEvaluations(input.position.id, 1)[0];
  const fee = feeIncrementSince(input.position, input.onchain);
  const accumulatedFeeUsd = input.position.accumulatedFeeUsd + fee.feeUsd;
  const il = calculateIL(input.position.entryPrice, input.market.price, input.position.investmentUsd);
  const lpValueUsd = il.lpValue + accumulatedFeeUsd;
  const grossPnlUsd = lpValueUsd - input.position.investmentUsd;
  const estimatedExitCostUsd = input.onchain
    ? estimateLifecycleGas(input.onchain).estimatedExitGasUsd
    : Number(previous?.metrics.estimatedExitCostUsd ?? 0);
  const netPnlUsd = grossPnlUsd - input.position.entryGasUsd - estimatedExitCostUsd;
  const differenceVsHoldUsd = lpValueUsd - il.holdValue - input.position.entryGasUsd - estimatedExitCostUsd;
  const ageHours = positionAgeHours(input.position.openedAt, input.now) ?? 0;

  input.positionStore.updateAccounting({
    id: input.position.id,
    accumulatedFeeUsd,
    currentValueUsd: lpValueUsd,
    feeGrowthGlobal0LastX128: fee.valid ? input.onchain!.feeGrowthGlobal0X128 : undefined,
    feeGrowthGlobal1LastX128: fee.valid ? input.onchain!.feeGrowthGlobal1X128 : undefined,
    feeCheckpointBlock: fee.valid ? input.onchain!.blockNumber : undefined,
    feeCheckpointAt: fee.valid ? input.onchain!.capturedAt : undefined,
    now: input.now,
  });
  return input.positionStore.recordEvaluation({
    positionId: input.position.id,
    evaluatedAt: input.now.toISOString(),
    ageHours,
    lpValueUsd,
    holdValueUsd: il.holdValue,
    accumulatedFeeUsd,
    grossPnlUsd,
    netPnlUsd,
    differenceVsHoldUsd,
    estimatedExitCostUsd,
    dataQuality: fee.valid ? 'valid' : 'insufficient',
    metrics: {
      feeIncrementUsd: fee.feeUsd,
      token0FeeIncrement: fee.token0Fee,
      token1FeeIncrement: fee.token1Fee,
      feeSource: fee.reason,
      accountingVersion: input.position.accountingVersion,
      feeCheckpointBlock: input.position.feeCheckpointBlock,
      ilLossUsd: il.ilLoss,
      ilPercent: il.ilPercent,
      entryGasUsd: input.position.entryGasUsd,
      estimatedExitCostUsd,
      hourlyGasChargedUsd: 0,
      applicableSwapSlippageUsd: 0,
      transactionPath: 'BALANCED_TOKENS_MINT_WITHDRAW',
    },
  });
}

function openPaperPosition(input: {
  signal: PaperAgentDecision;
  market: PaperPositionMarketInput;
  onchain: PancakeV3OnchainState;
  positionStore: PositionStore;
  snapshotStore: SnapshotStore;
  now: Date;
}): PaperPositionLifecycleResult {
  const gas = estimateLifecycleGas(input.onchain);
  const liquidity = fullRangeLiquidityForCapital({
    investmentUsd: input.signal.investment,
    priceWbnbUsd: input.onchain.priceWbnbUsd,
    currentTick: input.onchain.currentTick,
    token0Decimals: input.onchain.token0Decimals,
    token1Decimals: input.onchain.token1Decimals,
  });
  const amounts = calculateFullRangeTokenAmounts(
    input.signal.investment,
    input.market.price,
    input.onchain.currentTick,
    input.onchain.token0Decimals,
    input.onchain.token1Decimals
  );
  let position = input.positionStore.createPosition({
    mode: 'PAPER',
    investmentUsd: input.signal.investment,
    entryDecisionId: input.signal.id,
    entryPrice: input.market.price,
    accountingVersion: FULL_RANGE_FEE_ACCOUNTING_VERSION,
    now: input.now,
  });
  position = input.positionStore.updateAccounting({
    id: position.id,
    token0Amount: amounts.amount0.toString(),
    token1Amount: amounts.amount1.toString(),
    entryGasUsd: gas.entryGasUsd,
    currentValueUsd: input.signal.investment,
    positionLiquidity: liquidity.toString(),
    feeGrowthGlobal0LastX128: input.onchain.feeGrowthGlobal0X128,
    feeGrowthGlobal1LastX128: input.onchain.feeGrowthGlobal1X128,
    feeCheckpointBlock: input.onchain.blockNumber,
    feeCheckpointAt: input.onchain.capturedAt,
    now: input.now,
  });
  input.positionStore.recordAction({
    positionId: position.id,
    action: 'ENTER',
    reasonCode: 'QUALIFYING_HOURLY_SIGNAL',
    confidence: input.signal.confidence,
    rationale: 'Membuka satu paper position full-range dari sinyal entry yang lolos gate.',
    metrics: {
      signalDecisionId: input.signal.id,
      entryGasUsd: gas.entryGasUsd,
      estimatedExitGasUsd: gas.estimatedExitGasUsd,
      applicableSwapSlippageUsd: 0,
      transactionPath: 'BALANCED_TOKENS_MINT_WITHDRAW',
      accountingVersion: FULL_RANGE_FEE_ACCOUNTING_VERSION,
      positionLiquidity: liquidity.toString(),
      feeCheckpointBlock: input.onchain.blockNumber,
    },
    now: input.now,
  });
  position = input.positionStore.transitionPosition({
    id: position.id,
    toStatus: 'OPEN',
    reason: 'Paper entry confirmed without an on-chain transaction.',
    now: input.now,
  });
  const evaluation = evaluateOpenPaperPosition({
    position,
    market: input.market,
    onchain: input.onchain,
    positionStore: input.positionStore,
    snapshotStore: input.snapshotStore,
    now: input.now,
  });
  return {
    action: 'ENTER',
    position: input.positionStore.getPosition(position.id),
    evaluation,
    reasonCode: 'POSITION_OPENED',
  };
}

export function processPaperPositionLifecycle(input: {
  signal: PaperAgentDecision;
  market: PaperPositionMarketInput;
  onchain: PancakeV3OnchainState | null;
  positionStore: PositionStore;
  snapshotStore: SnapshotStore;
  now?: Date;
}): PaperPositionLifecycleResult {
  const now = input.now ?? new Date();
  let active = input.positionStore.getActivePosition();

  if (!active) {
    const latest = input.positionStore.getRecentPositions(1)[0];
    const accountingUpgradeCancellation =
      latest?.status === 'CANCELLED' && latest.exitReason === 'ACCOUNTING_VERSION_UPGRADE_REQUIRED';
    const hoursSinceClose =
      latest?.closedAt && !accountingUpgradeCancellation
        ? (now.getTime() - new Date(latest.closedAt).getTime()) / (60 * 60 * 1_000)
        : Infinity;
    if (hoursSinceClose < REENTRY_COOLDOWN_HOURS) {
      input.positionStore.recordAction({
        action: 'WAIT',
        reasonCode: 'REENTRY_COOLDOWN',
        confidence: 'high',
        rationale: 'Menunggu cooldown 24 jam setelah posisi sebelumnya ditutup.',
        metrics: { hoursSinceClose },
        now,
      });
      return { action: 'WAIT', position: null, evaluation: null, reasonCode: 'REENTRY_COOLDOWN' };
    }
    const compatibleSignal =
      input.signal.strategyVersion === 'lifecycle-v2.1' ||
      input.signal.strategyVersion.startsWith('logistic-');
    if (!compatibleSignal) {
      input.positionStore.recordAction({
        action: 'WAIT',
        reasonCode: 'INCOMPATIBLE_SIGNAL_VERSION',
        confidence: 'low',
        rationale: 'Menunggu sinyal lifecycle dengan accounting fee-growth V3 yang kompatibel.',
        metrics: { signalDecisionId: input.signal.id, strategyVersion: input.signal.strategyVersion },
        now,
      });
      return { action: 'WAIT', position: null, evaluation: null, reasonCode: 'INCOMPATIBLE_SIGNAL_VERSION' };
    }
    if (input.signal.action !== 'ENTER_FULL_RANGE') {
      input.positionStore.recordAction({
        action: 'WAIT',
        reasonCode: input.signal.reasonCode,
        confidence: input.signal.confidence,
        rationale: input.signal.rationale,
        metrics: { signalDecisionId: input.signal.id },
        now,
      });
      return { action: 'WAIT', position: null, evaluation: null, reasonCode: input.signal.reasonCode };
    }
    if (!input.onchain) {
      input.positionStore.recordAction({
        action: 'WAIT',
        reasonCode: 'ONCHAIN_DATA_UNAVAILABLE',
        confidence: 'low',
        rationale: 'Paper entry ditunda karena gas dan tick on-chain tidak tersedia.',
        metrics: { signalDecisionId: input.signal.id },
        now,
      });
      return { action: 'WAIT', position: null, evaluation: null, reasonCode: 'ONCHAIN_DATA_UNAVAILABLE' };
    }
    return openPaperPosition({ ...input, onchain: input.onchain, now });
  }

  if (active.mode !== 'PAPER') {
    return {
      action: 'HOLD',
      position: active,
      evaluation: null,
      reasonCode: 'LIVE_POSITION_NOT_MANAGED_BY_PAPER_STAGE',
    };
  }
  if (active.accountingVersion !== FULL_RANGE_FEE_ACCOUNTING_VERSION) {
    input.positionStore.recordAction({
      positionId: active.id,
      action: 'WAIT',
      reasonCode: 'ACCOUNTING_VERSION_UPGRADE_REQUIRED',
      confidence: 'high',
      rationale:
        'Posisi paper legacy dibatalkan karena tidak memiliki checkpoint fee-growth V3 yang dapat diaudit.',
      metrics: { previousAccountingVersion: active.accountingVersion },
      now,
    });
    const cancelled = input.positionStore.transitionPosition({
      id: active.id,
      toStatus: 'CANCELLED',
      reason: 'ACCOUNTING_VERSION_UPGRADE_REQUIRED',
      now,
    });
    return {
      action: 'WAIT',
      position: cancelled,
      evaluation: null,
      reasonCode: 'ACCOUNTING_VERSION_UPGRADE_REQUIRED',
    };
  }
  if (active.status === 'PENDING_ENTRY') {
    if (active.entryPrice === null || active.token0Amount === null || active.token1Amount === null) {
      if (!input.onchain) {
        return {
          action: 'HOLD',
          position: active,
          evaluation: null,
          reasonCode: 'PENDING_ENTRY_AWAITS_ONCHAIN_DATA',
        };
      }
      const gas = estimateLifecycleGas(input.onchain);
      const liquidity = fullRangeLiquidityForCapital({
        investmentUsd: active.investmentUsd,
        priceWbnbUsd: input.onchain.priceWbnbUsd,
        currentTick: input.onchain.currentTick,
        token0Decimals: input.onchain.token0Decimals,
        token1Decimals: input.onchain.token1Decimals,
      });
      const amounts = calculateFullRangeTokenAmounts(
        active.investmentUsd,
        input.market.price,
        input.onchain.currentTick,
        input.onchain.token0Decimals,
        input.onchain.token1Decimals
      );
      active = input.positionStore.updateAccounting({
        id: active.id,
        entryPrice: input.market.price,
        token0Amount: amounts.amount0.toString(),
        token1Amount: amounts.amount1.toString(),
        entryGasUsd: gas.entryGasUsd,
        currentValueUsd: active.investmentUsd,
        positionLiquidity: liquidity.toString(),
        feeGrowthGlobal0LastX128: input.onchain.feeGrowthGlobal0X128,
        feeGrowthGlobal1LastX128: input.onchain.feeGrowthGlobal1X128,
        feeCheckpointBlock: input.onchain.blockNumber,
        feeCheckpointAt: input.onchain.capturedAt,
        now,
      });
    }
    active = input.positionStore.transitionPosition({
      id: active.id,
      toStatus: 'OPEN',
      reason: 'Recovered pending paper entry after restart.',
      now,
    });
  }
  if (active.status === 'PENDING_EXIT') {
    const closed = input.positionStore.transitionPosition({
      id: active.id,
      toStatus: 'CLOSED',
      reason: 'Recovered pending paper exit after restart.',
      now,
    });
    return { action: 'EXIT', position: closed, evaluation: null, reasonCode: 'PENDING_EXIT_RECOVERED' };
  }

  const latestEvaluation = input.positionStore.getEvaluations(active.id, 1)[0];
  const latestAction = input.positionStore.getActions(active.id, 1)[0];
  if (
    latestEvaluation &&
    latestAction &&
    isSameUtcHour(latestEvaluation.evaluatedAt, now) &&
    isSameUtcHour(latestAction.createdAt, now)
  ) {
    const action =
      latestAction.action === 'REVIEW_7D'
        ? 'REVIEW_7D'
        : latestAction.action === 'REVIEW_14D'
          ? 'REVIEW_14D'
          : latestAction.action === 'EXIT'
            ? 'EXIT'
            : latestAction.action === 'ENTER'
              ? 'ENTER'
              : 'HOLD';
    return {
      action,
      position: active,
      evaluation: latestEvaluation,
      reasonCode: 'HOURLY_LIFECYCLE_ALREADY_PROCESSED',
    };
  }

  const evaluation = evaluateOpenPaperPosition({
    position: active,
    market: input.market,
    onchain: input.onchain,
    positionStore: input.positionStore,
    snapshotStore: input.snapshotStore,
    now,
  });
  active = input.positionStore.getPosition(active.id)!;
  const actions = input.positionStore.getActions(active.id, 1_000);
  const hasReview7d = actions.some(action => action.action === 'REVIEW_7D');
  const hasReview14d = actions.some(action => action.action === 'REVIEW_14D');
  const review = scheduledPositionReview(active.openedAt, hasReview7d, hasReview14d, now);

  if (review === 'REVIEW_14D') {
    input.positionStore.recordAction({
      positionId: active.id,
      action: 'REVIEW_14D',
      reasonCode: 'FINAL_PAPER_REVIEW_DUE',
      confidence: evaluation.dataQuality === 'valid' ? 'high' : 'low',
      rationale: 'Review final 14 hari selesai; paper position ditutup untuk menghasilkan lifecycle label.',
      metrics: { evaluationId: evaluation.id, netPnlUsd: evaluation.netPnlUsd },
      now,
    });
    input.positionStore.recordAction({
      positionId: active.id,
      action: 'EXIT',
      reasonCode: 'PAPER_MAX_HOLD_REACHED',
      confidence: 'high',
      rationale: 'Paper position ditutup otomatis pada hari ke-14; live exit tetap harus manual.',
      metrics: { evaluationId: evaluation.id },
      now,
    });
    active = input.positionStore.transitionPosition({
      id: active.id,
      toStatus: 'PENDING_EXIT',
      reason: '14 day paper review completed.',
      now,
    });
    input.positionStore.updateAccounting({
      id: active.id,
      exitGasUsd: evaluation.estimatedExitCostUsd,
      now,
    });
    const closed = input.positionStore.transitionPosition({
      id: active.id,
      toStatus: 'CLOSED',
      reason: 'PAPER_MAX_HOLD_REACHED',
      now,
    });
    return { action: 'EXIT', position: closed, evaluation, reasonCode: 'PAPER_MAX_HOLD_REACHED' };
  }

  if (review === 'REVIEW_7D') {
    input.positionStore.recordAction({
      positionId: active.id,
      action: 'REVIEW_7D',
      reasonCode: 'SEVEN_DAY_REVIEW_DUE',
      confidence: evaluation.dataQuality === 'valid' ? 'high' : 'low',
      rationale: 'Review hari ke-7 dicatat; paper position tetap di-hold sampai review final.',
      metrics: { evaluationId: evaluation.id, netPnlUsd: evaluation.netPnlUsd },
      now,
    });
    return { action: 'REVIEW_7D', position: active, evaluation, reasonCode: 'SEVEN_DAY_REVIEW_DUE' };
  }

  const ageHours = positionAgeHours(active.openedAt, now) ?? 0;
  input.positionStore.recordAction({
    positionId: active.id,
    action: 'HOLD',
    reasonCode: ageHours < MINIMUM_HOLD_HOURS ? 'MINIMUM_HOLD_PERIOD' : 'AWAITING_FINAL_REVIEW',
    confidence: evaluation.dataQuality === 'valid' ? 'high' : 'low',
    rationale:
      ageHours < MINIMUM_HOLD_HOURS
        ? 'Full-range paper position masih dalam minimum holding period tujuh hari.'
        : 'Review tujuh hari selesai; posisi tetap di-hold sampai review final 14 hari.',
    metrics: { evaluationId: evaluation.id, ageHours, finalReviewHours: FINAL_REVIEW_HOURS },
    now,
  });
  return {
    action: 'HOLD',
    position: active,
    evaluation,
    reasonCode: ageHours < MINIMUM_HOLD_HOURS ? 'MINIMUM_HOLD_PERIOD' : 'AWAITING_FINAL_REVIEW',
  };
}
