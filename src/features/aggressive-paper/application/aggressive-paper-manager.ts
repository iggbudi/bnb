import {
  AggressivePaperStore,
  type AggressiveAction,
  type AggressivePaperEvaluationRecord,
  type AggressivePaperPosition,
} from '../../../aggressive-paper-store.js';
import {
  concentratedAmountsAtPrice,
  concentratedPositionForCapital,
  feeGrowthIncrementUsd,
} from '../../lp-analysis/index.js';
import type { HighRiskStrategyPlan } from '../domain/high-risk-strategy.js';
import type { PancakeV3OnchainState } from '../../lp-execution/index.js';
import { estimateLifecycleGas } from '../../lp-execution/index.js';
import { SnapshotStore } from '../../../snapshot-store.js';

export const AGGRESSIVE_PAPER_STRATEGY_VERSION = 'concentrated-aggressive-v1.0';
export const AGGRESSIVE_INITIAL_CAPITAL_USD = 50;
export const AGGRESSIVE_TARGET_RETURN_PERCENT = 10;
export const AGGRESSIVE_STOP_LOSS_PERCENT = 5;
export const AGGRESSIVE_OUT_OF_RANGE_CONFIRMATION_MINUTES = 60;
export const AGGRESSIVE_MAX_RECENTERS = 4;
export const AGGRESSIVE_MAX_HOLD_HOURS = 30 * 24;
export const AGGRESSIVE_RECENTER_SLIPPAGE_BPS = 10;
export const AGGRESSIVE_NORMAL_COOLDOWN_HOURS = 6;
export const AGGRESSIVE_RISK_COOLDOWN_HOURS = 24;

export interface AggressivePaperLifecycleResult {
  action: AggressiveAction;
  reasonCode: string;
  position: AggressivePaperPosition | null;
  evaluation: AggressivePaperEvaluationRecord | null;
}

function sameUtcHour(value: string, now: Date): boolean {
  const date = new Date(value);
  return (
    date.getUTCFullYear() === now.getUTCFullYear() &&
    date.getUTCMonth() === now.getUTCMonth() &&
    date.getUTCDate() === now.getUTCDate() &&
    date.getUTCHours() === now.getUTCHours()
  );
}

function elapsedHours(from: string, to: Date): number {
  return Math.max(0, (to.getTime() - new Date(from).getTime()) / 3_600_000);
}

function wait(input: {
  store: AggressivePaperStore;
  reasonCode: string;
  rationale: string;
  metrics?: Record<string, unknown>;
  now: Date;
}): AggressivePaperLifecycleResult {
  input.store.recordAction({
    action: 'WAIT',
    reasonCode: input.reasonCode,
    rationale: input.rationale,
    metrics: input.metrics,
    now: input.now,
  });
  return { action: 'WAIT', reasonCode: input.reasonCode, position: null, evaluation: null };
}

function openPosition(input: {
  plan: HighRiskStrategyPlan;
  onchain: PancakeV3OnchainState;
  store: AggressivePaperStore;
  investmentUsd: number;
  now: Date;
}): AggressivePaperLifecycleResult {
  const selected = input.plan.selectedRange;
  if (!selected) throw new Error('Aggressive paper entry requires a selected range');
  const gas = estimateLifecycleGas(input.onchain);
  const definition = concentratedPositionForCapital({
    capitalUsd: input.investmentUsd,
    priceUsd: input.onchain.priceWbnbUsd,
    tickLower: selected.tickLower,
    tickUpper: selected.tickUpper,
    tokenDecimals: input.onchain.token0Decimals,
  });
  const totalCostUsd = gas.entryGasUsd;
  const netLiquidationValueUsd = input.investmentUsd - totalCostUsd - gas.estimatedExitGasUsd;
  const timestamp = input.now.toISOString();
  const position = input.store.createPosition({
    strategyVersion: AGGRESSIVE_PAPER_STRATEGY_VERSION,
    openedAt: timestamp,
    investmentUsd: input.investmentUsd,
    initialPrice: input.onchain.priceWbnbUsd,
    initialAmount0: definition.amount0Tokens,
    initialAmount1: definition.amount1Tokens,
    targetValueUsd: input.investmentUsd * (1 + AGGRESSIVE_TARGET_RETURN_PERCENT / 100),
    stopValueUsd: input.investmentUsd * (1 - AGGRESSIVE_STOP_LOSS_PERCENT / 100),
    rangePercent: selected.rangePercent,
    tickLower: selected.tickLower,
    tickUpper: selected.tickUpper,
    priceLowerUsd: definition.priceLowerUsd,
    priceUpperUsd: definition.priceUpperUsd,
    liquidity: definition.liquidity,
    segmentEntryPrice: input.onchain.priceWbnbUsd,
    segmentPrincipalUsd: input.investmentUsd,
    segmentStartFeeUsd: 0,
    segmentStartCostUsd: 0,
    accumulatedFeeUsd: 0,
    totalCostUsd,
    estimatedExitCostUsd: gas.estimatedExitGasUsd,
    currentPrincipalUsd: definition.valueUsd,
    netLiquidationValueUsd,
    recenterCount: 0,
    losingRecenterCount: 0,
    outOfRangeSince: null,
    lastFeeGrowth0X128: input.onchain.feeGrowthGlobal0X128,
    lastFeeGrowth1X128: input.onchain.feeGrowthGlobal1X128,
    lastOnchainCapturedAt: input.onchain.capturedAt,
  });
  const evaluation = input.store.recordEvaluation({
    positionId: position.id,
    evaluatedAt: timestamp,
    ageHours: 0,
    priceUsd: input.onchain.priceWbnbUsd,
    principalValueUsd: definition.valueUsd,
    holdValueUsd: input.investmentUsd,
    accumulatedFeeUsd: 0,
    feeIncrementUsd: 0,
    realizedCostUsd: totalCostUsd,
    estimatedExitCostUsd: gas.estimatedExitGasUsd,
    netLiquidationValueUsd,
    netPnlUsd: netLiquidationValueUsd - input.investmentUsd,
    netReturnPercent: (netLiquidationValueUsd / input.investmentUsd - 1) * 100,
    differenceVsHoldUsd: netLiquidationValueUsd - input.investmentUsd,
    inRange: true,
    occupancyPercent: 100,
    outOfRangeMinutes: 0,
    dataQuality: 'insufficient',
    metrics: {
      projectionVersion: input.plan.projectionVersion,
      historyWindowHours: input.plan.historyWindowHours,
      historyCoveragePercent: input.plan.historyCoveragePercent,
      observedVolume24h: input.plan.observedVolume24h,
      conservativeVolume24h: input.plan.conservativeVolume24h,
      volumeHaircutFactor: input.plan.volumeHaircutFactor,
      rangePercent: selected.rangePercent,
      tickLower: selected.tickLower,
      tickUpper: selected.tickUpper,
      priceLowerUsd: definition.priceLowerUsd,
      priceUpperUsd: definition.priceUpperUsd,
      entryGasUsd: gas.entryGasUsd,
      estimatedExitGasUsd: gas.estimatedExitGasUsd,
      projectedNetReturn30dPercent: selected.projectedNetReturn30dPercent,
      feeSource: 'ONCHAIN_FEE_GROWTH_GLOBAL_AFTER_ENTRY',
    },
  });
  input.store.recordAction({
    positionId: position.id,
    action: 'ENTER',
    reasonCode: 'AGGRESSIVE_TARGET_CANDIDATE_FOUND',
    rationale: `Membuka paper concentrated ±${selected.rangePercent}% karena proyeksi net 30 hari mencapai target agresif.`,
    metrics: {
      investmentUsd: input.investmentUsd,
      targetValueUsd: position.targetValueUsd,
      stopValueUsd: position.stopValueUsd,
      tickLower: selected.tickLower,
      tickUpper: selected.tickUpper,
      priceLowerUsd: definition.priceLowerUsd,
      priceUpperUsd: definition.priceUpperUsd,
    },
    now: input.now,
  });
  return { action: 'ENTER', reasonCode: 'AGGRESSIVE_TARGET_CANDIDATE_FOUND', position, evaluation };
}

function evaluatePosition(input: {
  position: AggressivePaperPosition;
  onchain: PancakeV3OnchainState;
  store: AggressivePaperStore;
  snapshotStore: SnapshotStore;
  now: Date;
}): { position: AggressivePaperPosition; evaluation: AggressivePaperEvaluationRecord } {
  const from = new Date(input.position.lastOnchainCapturedAt);
  const elapsedMinutes = Math.max(0, (input.now.getTime() - from.getTime()) / 60_000);
  const snapshots = elapsedMinutes > 0 ? input.snapshotStore.getSnapshotsBetween(from, input.now) : [];
  const expectedSnapshots = Math.max(1, Math.round(elapsedMinutes));
  const validSnapshots = snapshots.filter(snapshot => Number.isFinite(snapshot.price) && snapshot.price > 0);
  const insideCount = validSnapshots.filter(
    snapshot =>
      snapshot.price >= input.position.priceLowerUsd && snapshot.price <= input.position.priceUpperUsd
  ).length;
  const coveragePercent =
    elapsedMinutes < 1 ? 100 : Math.min(100, (snapshots.length / expectedSnapshots) * 100);
  const occupancyFactor = validSnapshots.length > 0 ? insideCount / validSnapshots.length : 0;
  let exits = 0;
  let previousInside: boolean | null = null;
  for (const snapshot of validSnapshots) {
    const inside =
      snapshot.price >= input.position.priceLowerUsd && snapshot.price <= input.position.priceUpperUsd;
    if (previousInside === true && !inside) exits++;
    previousInside = inside;
  }
  const checkpointAdvanced = input.onchain.capturedAt > input.position.lastOnchainCapturedAt;
  const dataValid =
    elapsedMinutes >= 1 && coveragePercent >= 80 && validSnapshots.length > 0 && checkpointAdvanced;
  const fee = checkpointAdvanced
    ? feeGrowthIncrementUsd({
        liquidity: input.position.liquidity,
        previousFeeGrowth0X128: input.position.lastFeeGrowth0X128,
        previousFeeGrowth1X128: input.position.lastFeeGrowth1X128,
        currentFeeGrowth0X128: input.onchain.feeGrowthGlobal0X128,
        currentFeeGrowth1X128: input.onchain.feeGrowthGlobal1X128,
        token0Decimals: input.onchain.token0Decimals,
        token1Decimals: input.onchain.token1Decimals,
        priceToken1Usd: input.onchain.priceWbnbUsd,
        occupancyFactor,
      })
    : { token0Fee: 0, token1Fee: 0, feeUsd: 0 };
  const amounts = concentratedAmountsAtPrice({
    liquidity: input.position.liquidity,
    tickLower: input.position.tickLower,
    tickUpper: input.position.tickUpper,
    priceUsd: input.onchain.priceWbnbUsd,
    token0Decimals: input.onchain.token0Decimals,
    token1Decimals: input.onchain.token1Decimals,
  });
  const accumulatedFeeUsd = input.position.accumulatedFeeUsd + (dataValid ? fee.feeUsd : 0);
  const gas = estimateLifecycleGas(input.onchain);
  const holdValueUsd =
    input.position.initialAmount0 + input.position.initialAmount1 * input.onchain.priceWbnbUsd;
  const inRange =
    input.onchain.priceWbnbUsd >= input.position.priceLowerUsd &&
    input.onchain.priceWbnbUsd <= input.position.priceUpperUsd;
  const outOfRangeSince = inRange ? null : (input.position.outOfRangeSince ?? input.now.toISOString());
  const outOfRangeMinutes = outOfRangeSince
    ? Math.max(0, (input.now.getTime() - new Date(outOfRangeSince).getTime()) / 60_000)
    : 0;
  const netLiquidationValueUsd =
    amounts.valueUsd + accumulatedFeeUsd - input.position.totalCostUsd - gas.estimatedExitGasUsd;

  const refreshed = input.store.updatePosition({
    id: input.position.id,
    accumulatedFeeUsd,
    estimatedExitCostUsd: gas.estimatedExitGasUsd,
    currentPrincipalUsd: amounts.valueUsd,
    netLiquidationValueUsd,
    outOfRangeSince,
    lastFeeGrowth0X128: input.onchain.feeGrowthGlobal0X128,
    lastFeeGrowth1X128: input.onchain.feeGrowthGlobal1X128,
    lastOnchainCapturedAt: input.onchain.capturedAt,
    now: input.now,
  });
  const evaluation = input.store.recordEvaluation({
    positionId: refreshed.id,
    evaluatedAt: input.now.toISOString(),
    ageHours: elapsedHours(refreshed.openedAt, input.now),
    priceUsd: input.onchain.priceWbnbUsd,
    principalValueUsd: amounts.valueUsd,
    holdValueUsd,
    accumulatedFeeUsd,
    feeIncrementUsd: dataValid ? fee.feeUsd : 0,
    realizedCostUsd: refreshed.totalCostUsd,
    estimatedExitCostUsd: gas.estimatedExitGasUsd,
    netLiquidationValueUsd,
    netPnlUsd: netLiquidationValueUsd - refreshed.investmentUsd,
    netReturnPercent: (netLiquidationValueUsd / refreshed.investmentUsd - 1) * 100,
    differenceVsHoldUsd: netLiquidationValueUsd - holdValueUsd,
    inRange,
    occupancyPercent: occupancyFactor * 100,
    outOfRangeMinutes,
    dataQuality: dataValid ? 'valid' : 'insufficient',
    metrics: {
      rangePercent: refreshed.rangePercent,
      tickLower: refreshed.tickLower,
      tickUpper: refreshed.tickUpper,
      priceLowerUsd: refreshed.priceLowerUsd,
      priceUpperUsd: refreshed.priceUpperUsd,
      token0Amount: amounts.amount0Tokens,
      token1Amount: amounts.amount1Tokens,
      token0Fee: dataValid ? fee.token0Fee : 0,
      token1Fee: dataValid ? fee.token1Fee : 0,
      snapshotCount: snapshots.length,
      coveragePercent,
      rangeExits: exits,
      feeOccupancyFactor: occupancyFactor,
      feeSource: 'ONCHAIN_FEE_GROWTH_GLOBAL_X128',
    },
  });
  return { position: refreshed, evaluation };
}

function exitPosition(input: {
  position: AggressivePaperPosition;
  evaluation: AggressivePaperEvaluationRecord;
  store: AggressivePaperStore;
  reasonCode: string;
  rationale: string;
  now: Date;
}): AggressivePaperLifecycleResult {
  const totalCostUsd = input.position.totalCostUsd + input.evaluation.estimatedExitCostUsd;
  const netLiquidationValueUsd =
    input.evaluation.principalValueUsd + input.evaluation.accumulatedFeeUsd - totalCostUsd;
  const closed = input.store.closePosition({
    id: input.position.id,
    totalCostUsd,
    netLiquidationValueUsd,
    closeReason: input.reasonCode,
    now: input.now,
  });
  input.store.recordAction({
    positionId: closed.id,
    action: 'EXIT',
    reasonCode: input.reasonCode,
    rationale: input.rationale,
    metrics: {
      netLiquidationValueUsd,
      netPnlUsd: netLiquidationValueUsd - closed.investmentUsd,
      netReturnPercent: (netLiquidationValueUsd / closed.investmentUsd - 1) * 100,
      accumulatedFeeUsd: closed.accumulatedFeeUsd,
      totalCostUsd,
      recenterCount: closed.recenterCount,
      losingRecenterCount: closed.losingRecenterCount,
    },
    now: input.now,
  });
  return { action: 'EXIT', reasonCode: input.reasonCode, position: closed, evaluation: input.evaluation };
}

function recenterPosition(input: {
  position: AggressivePaperPosition;
  evaluation: AggressivePaperEvaluationRecord;
  plan: HighRiskStrategyPlan;
  onchain: PancakeV3OnchainState;
  store: AggressivePaperStore;
  losingCycle: boolean;
  cycleNetPnlUsd: number;
  now: Date;
}): AggressivePaperLifecycleResult {
  const selected = input.plan.selectedRange;
  if (!selected) throw new Error('Recenter requires a selected aggressive range');
  const gas = estimateLifecycleGas(input.onchain);
  const slippageUsd = (input.evaluation.principalValueUsd * AGGRESSIVE_RECENTER_SLIPPAGE_BPS) / 10_000;
  const recenterCostUsd = gas.entryGasUsd + gas.estimatedExitGasUsd + slippageUsd;
  const definition = concentratedPositionForCapital({
    capitalUsd: input.evaluation.principalValueUsd,
    priceUsd: input.onchain.priceWbnbUsd,
    tickLower: selected.tickLower,
    tickUpper: selected.tickUpper,
    tokenDecimals: input.onchain.token0Decimals,
  });
  const totalCostUsd = input.position.totalCostUsd + recenterCostUsd;
  const netLiquidationValueUsd =
    definition.valueUsd + input.position.accumulatedFeeUsd - totalCostUsd - gas.estimatedExitGasUsd;
  const refreshed = input.store.updatePosition({
    id: input.position.id,
    rangePercent: selected.rangePercent,
    tickLower: selected.tickLower,
    tickUpper: selected.tickUpper,
    priceLowerUsd: definition.priceLowerUsd,
    priceUpperUsd: definition.priceUpperUsd,
    liquidity: definition.liquidity,
    segmentEntryPrice: input.onchain.priceWbnbUsd,
    segmentPrincipalUsd: definition.valueUsd,
    segmentStartFeeUsd: input.position.accumulatedFeeUsd,
    segmentStartCostUsd: input.position.totalCostUsd,
    totalCostUsd,
    estimatedExitCostUsd: gas.estimatedExitGasUsd,
    currentPrincipalUsd: definition.valueUsd,
    netLiquidationValueUsd,
    recenterCount: input.position.recenterCount + 1,
    losingRecenterCount: input.position.losingRecenterCount + Number(input.losingCycle),
    outOfRangeSince: null,
    lastFeeGrowth0X128: input.onchain.feeGrowthGlobal0X128,
    lastFeeGrowth1X128: input.onchain.feeGrowthGlobal1X128,
    lastOnchainCapturedAt: input.onchain.capturedAt,
    now: input.now,
  });
  input.store.recordAction({
    positionId: refreshed.id,
    action: 'RECENTER',
    reasonCode: 'OUT_OF_RANGE_CONFIRMED',
    rationale: `Harga berada di luar range selama minimal ${AGGRESSIVE_OUT_OF_RANGE_CONFIRMATION_MINUTES} menit; range digeser ke ±${selected.rangePercent}%.`,
    metrics: {
      previousRangePercent: input.position.rangePercent,
      newRangePercent: selected.rangePercent,
      previousPriceLowerUsd: input.position.priceLowerUsd,
      previousPriceUpperUsd: input.position.priceUpperUsd,
      newPriceLowerUsd: definition.priceLowerUsd,
      newPriceUpperUsd: definition.priceUpperUsd,
      cycleNetPnlUsd: input.cycleNetPnlUsd,
      losingCycle: input.losingCycle,
      recenterCostUsd,
      slippageUsd,
      recenterCount: refreshed.recenterCount,
      losingRecenterCount: refreshed.losingRecenterCount,
    },
    now: input.now,
  });
  return {
    action: 'RECENTER',
    reasonCode: 'OUT_OF_RANGE_CONFIRMED',
    position: refreshed,
    evaluation: input.evaluation,
  };
}

export function processAggressivePaperLifecycle(input: {
  plan: HighRiskStrategyPlan | null;
  onchain: PancakeV3OnchainState | null;
  store: AggressivePaperStore;
  snapshotStore: SnapshotStore;
  initialCapitalUsd?: number;
  now?: Date;
}): AggressivePaperLifecycleResult {
  const now = input.now ?? new Date();
  const initialCapitalUsd = input.initialCapitalUsd ?? AGGRESSIVE_INITIAL_CAPITAL_USD;
  let position = input.store.getActivePosition();
  const latestAction = input.store.getLatestAction();

  if (!position) {
    if (latestAction && sameUtcHour(latestAction.createdAt, now)) {
      return {
        action: latestAction.action,
        reasonCode: 'HOURLY_AGGRESSIVE_LIFECYCLE_ALREADY_PROCESSED',
        position: null,
        evaluation: null,
      };
    }
    const latestPosition = input.store.getRecentPositions(1)[0];
    if (latestPosition?.closedAt) {
      const riskExit = [
        'STOP_LOSS_5_PERCENT',
        'TWO_LOSING_RECENTER_CYCLES',
        'MAX_RECENTERS_REACHED',
      ].includes(latestPosition.closeReason ?? '');
      const cooldownHours = riskExit ? AGGRESSIVE_RISK_COOLDOWN_HOURS : AGGRESSIVE_NORMAL_COOLDOWN_HOURS;
      const sinceClose = elapsedHours(latestPosition.closedAt, now);
      if (sinceClose < cooldownHours) {
        return wait({
          store: input.store,
          reasonCode: 'AGGRESSIVE_REENTRY_COOLDOWN',
          rationale: `Menunggu cooldown ${cooldownHours} jam setelah posisi agresif ditutup.`,
          metrics: {
            sinceCloseHours: sinceClose,
            cooldownHours,
            previousCloseReason: latestPosition.closeReason,
          },
          now,
        });
      }
    }
    if (!input.onchain || !input.plan) {
      return wait({
        store: input.store,
        reasonCode: 'AGGRESSIVE_ONCHAIN_DATA_UNAVAILABLE',
        rationale: 'Entry agresif menunggu checkpoint fee dan tick on-chain.',
        now,
      });
    }
    if (!input.plan.selectedRange) {
      return wait({
        store: input.store,
        reasonCode: input.plan.status,
        rationale: input.plan.reason,
        metrics: {
          historyWindowHours: input.plan.historyWindowHours,
          historyCoveragePercent: input.plan.historyCoveragePercent,
          projectionVersion: input.plan.projectionVersion,
        },
        now,
      });
    }
    const investmentUsd = input.store.getAvailableCapital(initialCapitalUsd);
    if (!(investmentUsd > 0)) {
      return wait({
        store: input.store,
        reasonCode: 'AGGRESSIVE_CAPITAL_DEPLETED',
        rationale: 'Portfolio paper agresif tidak memiliki modal positif untuk entry berikutnya.',
        now,
      });
    }
    return openPosition({
      plan: input.plan,
      onchain: input.onchain,
      store: input.store,
      investmentUsd,
      now,
    });
  }

  const latestEvaluation = input.store.getLatestEvaluation(position.id);
  if (latestEvaluation && sameUtcHour(latestEvaluation.evaluatedAt, now)) {
    return {
      action: latestAction?.action ?? 'HOLD',
      reasonCode: 'HOURLY_AGGRESSIVE_LIFECYCLE_ALREADY_PROCESSED',
      position,
      evaluation: latestEvaluation,
    };
  }
  if (!input.onchain) {
    input.store.recordAction({
      positionId: position.id,
      action: 'HOLD',
      reasonCode: 'AGGRESSIVE_ONCHAIN_DATA_UNAVAILABLE',
      rationale: 'Posisi dipertahankan; evaluasi fee menunggu checkpoint on-chain.',
      now,
    });
    return { action: 'HOLD', reasonCode: 'AGGRESSIVE_ONCHAIN_DATA_UNAVAILABLE', position, evaluation: null };
  }

  const evaluated = evaluatePosition({
    position,
    onchain: input.onchain,
    store: input.store,
    snapshotStore: input.snapshotStore,
    now,
  });
  position = evaluated.position;
  const evaluation = evaluated.evaluation;

  if (evaluation.netLiquidationValueUsd <= position.stopValueUsd) {
    return exitPosition({
      position,
      evaluation,
      store: input.store,
      reasonCode: 'STOP_LOSS_5_PERCENT',
      rationale: 'Hard stop dijalankan karena nilai likuidasi net turun 5% dari modal siklus.',
      now,
    });
  }
  if (evaluation.dataQuality === 'valid' && evaluation.netLiquidationValueUsd >= position.targetValueUsd) {
    return exitPosition({
      position,
      evaluation,
      store: input.store,
      reasonCode: 'TAKE_PROFIT_10_PERCENT',
      rationale: 'Target agresif 10% tercapai setelah fee dan seluruh biaya exit.',
      now,
    });
  }
  if (evaluation.ageHours >= AGGRESSIVE_MAX_HOLD_HOURS) {
    return exitPosition({
      position,
      evaluation,
      store: input.store,
      reasonCode: 'MONTHLY_REVIEW_30D',
      rationale: 'Siklus paper agresif ditutup pada review maksimal 30 hari.',
      now,
    });
  }

  if (evaluation.inRange) {
    input.store.recordAction({
      positionId: position.id,
      action: 'HOLD',
      reasonCode: 'AGGRESSIVE_IN_RANGE',
      rationale: 'Harga masih di dalam range; posisi aktif menghasilkan fee dan tidak direcenter.',
      metrics: { evaluationId: evaluation.id, netPnlUsd: evaluation.netPnlUsd },
      now,
    });
    return { action: 'HOLD', reasonCode: 'AGGRESSIVE_IN_RANGE', position, evaluation };
  }

  if (evaluation.outOfRangeMinutes < AGGRESSIVE_OUT_OF_RANGE_CONFIRMATION_MINUTES) {
    input.store.recordAction({
      positionId: position.id,
      action: 'HOLD',
      reasonCode: 'OUT_OF_RANGE_CONFIRMATION',
      rationale: `Menunggu konfirmasi out-of-range ${AGGRESSIVE_OUT_OF_RANGE_CONFIRMATION_MINUTES} menit agar tidak overtrade.`,
      metrics: { outOfRangeMinutes: evaluation.outOfRangeMinutes },
      now,
    });
    return { action: 'HOLD', reasonCode: 'OUT_OF_RANGE_CONFIRMATION', position, evaluation };
  }

  if (position.recenterCount >= AGGRESSIVE_MAX_RECENTERS) {
    return exitPosition({
      position,
      evaluation,
      store: input.store,
      reasonCode: 'MAX_RECENTERS_REACHED',
      rationale: 'Posisi ditutup karena budget empat recenter per siklus telah habis.',
      now,
    });
  }
  if (!input.plan?.selectedRange) {
    return exitPosition({
      position,
      evaluation,
      store: input.store,
      reasonCode: 'NO_FEASIBLE_RECENTER',
      rationale:
        'Posisi out-of-range ditutup karena tidak ada range baru yang memenuhi target setelah biaya.',
      now,
    });
  }

  const cycleNetPnlUsd =
    evaluation.principalValueUsd -
    position.segmentPrincipalUsd +
    (position.accumulatedFeeUsd - position.segmentStartFeeUsd) -
    (position.totalCostUsd - position.segmentStartCostUsd);
  const losingCycle = cycleNetPnlUsd < 0;
  if (position.losingRecenterCount + Number(losingCycle) >= 2) {
    return exitPosition({
      position,
      evaluation,
      store: input.store,
      reasonCode: 'TWO_LOSING_RECENTER_CYCLES',
      rationale: 'Posisi ditutup setelah dua siklus range berturut/terakumulasi merugi.',
      now,
    });
  }

  return recenterPosition({
    position,
    evaluation,
    plan: input.plan,
    onchain: input.onchain,
    store: input.store,
    losingCycle,
    cycleNetPnlUsd,
    now,
  });
}
