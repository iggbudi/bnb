import {
  DirectionalPaperStore,
  type DirectionalDecisionAction,
  type DirectionalPaperPosition,
  type DirectionalPaperRun,
  type DirectionalRunPerformance,
} from '../infrastructure/directional-paper-store.js';
import {
  DEFAULT_DIRECTIONAL_CONFIG,
  directionalRequiredHistoryPoints,
  entryFillPrice,
  exitFillPrice,
  makeDirectionalSignal,
  positionLevels,
  rawPositionPnl,
  type DirectionalSide,
  type DirectionalSignal,
  type DirectionalStrategyConfig,
} from '../domain/directional-strategy.js';
import type { PoolSnapshot, SnapshotStore } from '../../market-data/index.js';

export interface DirectionalLifecycleResult {
  processed: boolean;
  action: DirectionalDecisionAction | 'ALREADY_PROCESSED';
  reasonCode: string;
  run: DirectionalPaperRun;
  position: DirectionalPaperPosition | null;
}

function drawdown(peak: number, equity: number): number {
  return peak > 0 ? Math.max(0, ((peak - equity) / peak) * 100) : 0;
}

function fee(notionalUsd: number, feeBps: number): number {
  return (notionalUsd * feeBps) / 10_000;
}

function fundingCost(
  position: DirectionalPaperPosition,
  at: string,
  config: DirectionalStrategyConfig
): number {
  const elapsedMinutes = Math.max(0, (Date.parse(at) - Date.parse(position.openedAt)) / 60_000);
  return position.notionalUsd * config.fundingRate8h * (elapsedMinutes / (8 * 60));
}

function updateTrailingStop(
  position: DirectionalPaperPosition,
  markPrice: number,
  config: DirectionalStrategyConfig
): { bestPrice: number; trailingStopPrice: number | null } {
  const riskDistance = Math.abs(position.entryFillPrice - position.stopLossPrice);
  if (position.side === 'LONG') {
    const bestPrice = Math.max(position.bestPrice, markPrice);
    const activated = bestPrice - position.entryFillPrice >= riskDistance * config.trailingActivationR;
    const candidate = activated ? bestPrice - riskDistance * config.trailingDistanceR : null;
    return {
      bestPrice,
      trailingStopPrice:
        candidate === null
          ? position.trailingStopPrice
          : Math.max(position.trailingStopPrice ?? -Infinity, candidate),
    };
  }
  const bestPrice = Math.min(position.bestPrice, markPrice);
  const activated = position.entryFillPrice - bestPrice >= riskDistance * config.trailingActivationR;
  const candidate = activated ? bestPrice + riskDistance * config.trailingDistanceR : null;
  return {
    bestPrice,
    trailingStopPrice:
      candidate === null
        ? position.trailingStopPrice
        : Math.min(position.trailingStopPrice ?? Infinity, candidate),
  };
}

function opposingSignal(position: DirectionalPaperPosition, signal: DirectionalSignal): boolean {
  return (
    (position.side === 'LONG' && signal.action === 'ENTER_SHORT') ||
    (position.side === 'SHORT' && signal.action === 'ENTER_LONG')
  );
}

function exitReason(input: {
  position: DirectionalPaperPosition;
  markPrice: number;
  signal: DirectionalSignal;
  trailingStopPrice: number | null;
  capturedAt: string;
  config: DirectionalStrategyConfig;
  forceClose: boolean;
}): string | null {
  const { position, markPrice, signal, trailingStopPrice, capturedAt, config } = input;
  if (position.side === 'LONG' && markPrice <= position.liquidationPrice) return 'LIQUIDATION';
  if (position.side === 'SHORT' && markPrice >= position.liquidationPrice) return 'LIQUIDATION';
  if (position.side === 'LONG' && markPrice <= position.stopLossPrice) return 'STOP_LOSS';
  if (position.side === 'SHORT' && markPrice >= position.stopLossPrice) return 'STOP_LOSS';
  if (trailingStopPrice !== null) {
    if (position.side === 'LONG' && markPrice <= trailingStopPrice) return 'TRAILING_STOP';
    if (position.side === 'SHORT' && markPrice >= trailingStopPrice) return 'TRAILING_STOP';
  }
  if (position.side === 'LONG' && markPrice >= position.takeProfitPrice) return 'TAKE_PROFIT';
  if (position.side === 'SHORT' && markPrice <= position.takeProfitPrice) return 'TAKE_PROFIT';
  if (opposingSignal(position, signal) && signal.confidence >= 0.65) return 'OPPOSING_SIGNAL';
  const ageMinutes = (Date.parse(capturedAt) - Date.parse(position.openedAt)) / 60_000;
  if (ageMinutes >= config.maximumHoldMinutes) return 'MAX_HOLD';
  return input.forceClose ? 'BACKTEST_END' : null;
}

function closeMarkForReason(
  position: DirectionalPaperPosition,
  observedMark: number,
  reasonCode: string,
  config: DirectionalStrategyConfig
): number {
  if (reasonCode === 'LIQUIDATION') return position.liquidationPrice;
  if (reasonCode === 'OPPOSING_SIGNAL' && config.opposingExitAtBreakeven) {
    return position.entryFillPrice;
  }
  return observedMark;
}

export function processDirectionalSnapshot(input: {
  runId: number;
  snapshot: PoolSnapshot;
  history: readonly PoolSnapshot[];
  store: DirectionalPaperStore;
  config?: DirectionalStrategyConfig;
  forceClose?: boolean;
}): DirectionalLifecycleResult {
  const config = input.config ?? DEFAULT_DIRECTIONAL_CONFIG;
  const capturedAt = input.snapshot.capturedAt;
  const markPrice = input.snapshot.price;
  if (!Number.isFinite(markPrice) || markPrice <= 0) {
    throw new Error('Directional lifecycle requires a finite positive snapshot price');
  }
  const currentRun = input.store.getRun(input.runId);
  if (!currentRun) throw new Error('Directional paper run not found');
  if (currentRun.status !== 'ACTIVE') throw new Error('Directional paper run is not active');
  if (input.store.hasDecision(input.runId, capturedAt)) {
    return {
      processed: false,
      action: 'ALREADY_PROCESSED',
      reasonCode: 'SNAPSHOT_ALREADY_PROCESSED',
      run: currentRun,
      position: input.store.getOpenPosition(input.runId),
    };
  }

  return input.store.transaction(() => {
    let run = input.store.getRun(input.runId)!;
    let position = input.store.getOpenPosition(input.runId);
    const availableSnapshots = input.history.filter(snapshot => snapshot.capturedAt <= capturedAt);
    const prices = availableSnapshots.map(snapshot => snapshot.price);
    const requiredHistoryPoints = directionalRequiredHistoryPoints(config);
    const coverageWindowStart = Date.parse(capturedAt) - (requiredHistoryPoints - 1) * 60_000;
    const recentSnapshotCount = availableSnapshots.filter(
      snapshot => Date.parse(snapshot.capturedAt) >= coverageWindowStart
    ).length;
    const historyCoveragePercent = Math.min(100, (recentSnapshotCount / requiredHistoryPoints) * 100);
    const signal = makeDirectionalSignal(prices, config, historyCoveragePercent);

    if (position) {
      const trailing = updateTrailingStop(position, markPrice, config);
      const currentFunding = fundingCost(position, capturedAt, config);
      const rawUnrealizedPnlUsd = rawPositionPnl(
        position.side,
        position.entryFillPrice,
        markPrice,
        position.quantity
      );
      const estimatedExitFeeUsd = fee(markPrice * position.quantity, config.takerFeeBps);
      const netUnrealizedPnlUsd = rawUnrealizedPnlUsd - estimatedExitFeeUsd - currentFunding;
      const accountEquityUsd = run.realizedBalanceUsd + netUnrealizedPnlUsd;
      const peakEquityUsd = Math.max(run.peakEquityUsd, accountEquityUsd);
      const maxDrawdownPercent = Math.max(run.maxDrawdownPercent, drawdown(peakEquityUsd, accountEquityUsd));
      position = input.store.updateOpenPosition({
        id: position.id,
        updatedAt: capturedAt,
        bestPrice: trailing.bestPrice,
        trailingStopPrice: trailing.trailingStopPrice,
        unrealizedPnlUsd: rawUnrealizedPnlUsd,
        fundingPaymentUsd: currentFunding,
      });
      input.store.saveEvaluation({
        positionId: position.id,
        evaluatedAt: capturedAt,
        markPriceUsd: markPrice,
        rawUnrealizedPnlUsd,
        estimatedExitFeeUsd,
        fundingPaymentUsd: currentFunding,
        netUnrealizedPnlUsd,
        accountEquityUsd,
        drawdownPercent: drawdown(peakEquityUsd, accountEquityUsd),
        takeProfitPrice: position.takeProfitPrice,
        stopLossPrice: position.stopLossPrice,
        liquidationPrice: position.liquidationPrice,
        trailingStopPrice: trailing.trailingStopPrice,
      });

      const halted = config.maxDrawdownHaltPercent > 0 && maxDrawdownPercent >= config.maxDrawdownHaltPercent;
      const reasonCode = halted
        ? 'MAX_DRAWDOWN_HALT'
        : exitReason({
            position,
            markPrice,
            signal,
            trailingStopPrice: trailing.trailingStopPrice,
            capturedAt,
            config,
            forceClose: input.forceClose ?? false,
          });
      if (reasonCode) {
        const exitMark = closeMarkForReason(position, markPrice, reasonCode, config);
        const fillPrice = exitFillPrice(position.side, exitMark, config.slippageBps);
        const exitNotionalUsd = fillPrice * position.quantity;
        const exitFeeUsd = fee(exitNotionalUsd, config.takerFeeBps);
        const rawRealizedPnlUsd = rawPositionPnl(
          position.side,
          position.entryFillPrice,
          fillPrice,
          position.quantity
        );
        const realizedPnlUsd = rawRealizedPnlUsd - position.entryFeeUsd - exitFeeUsd - currentFunding;
        const realizedBalanceUsd = Math.max(
          0,
          run.realizedBalanceUsd + rawRealizedPnlUsd - exitFeeUsd - currentFunding
        );
        position = input.store.closePosition({
          id: position.id,
          closedAt: capturedAt,
          exitFillPrice: fillPrice,
          exitFeeUsd,
          fundingPaymentUsd: currentFunding,
          realizedPnlUsd,
          closeReason: reasonCode,
        });
        input.store.saveFill({
          positionId: position.id,
          filledAt: capturedAt,
          fillType: 'EXIT',
          orderSide: position.side === 'LONG' ? 'SELL' : 'BUY',
          priceUsd: fillPrice,
          quantity: position.quantity,
          notionalUsd: exitNotionalUsd,
          feeUsd: exitFeeUsd,
          slippageBps: config.slippageBps,
        });
        const closePeak = Math.max(peakEquityUsd, realizedBalanceUsd);
        run = input.store.updateRunMark({
          id: run.id,
          realizedBalanceUsd,
          markEquityUsd: realizedBalanceUsd,
          peakEquityUsd: closePeak,
          maxDrawdownPercent: Math.max(maxDrawdownPercent, drawdown(closePeak, realizedBalanceUsd)),
          lastProcessedAt: capturedAt,
        });
        input.store.saveDecision({
          runId: run.id,
          positionId: position.id,
          capturedAt,
          action: 'CLOSE',
          reasonCode,
          rationale: `Menutup ${position.side} pada simulasi karena ${reasonCode}.`,
          priceUsd: markPrice,
          confidence: signal.confidence,
          features: {
            ...signal.features,
            exitFillPrice: fillPrice,
            realizedPnlUsd,
            fundingRate8h: config.fundingRate8h,
          },
        });
        if (reasonCode === 'MAX_DRAWDOWN_HALT') {
          run = input.store.pauseRun(run.id, capturedAt);
        }
        return { processed: true, action: 'CLOSE', reasonCode, run, position };
      }

      run = input.store.updateRunMark({
        id: run.id,
        realizedBalanceUsd: run.realizedBalanceUsd,
        markEquityUsd: accountEquityUsd,
        peakEquityUsd,
        maxDrawdownPercent,
        lastProcessedAt: capturedAt,
      });
      input.store.saveDecision({
        runId: run.id,
        positionId: position.id,
        capturedAt,
        action: 'HOLD',
        reasonCode: 'POSITION_OPEN',
        rationale: `${position.side} tetap terbuka; TP, SL, trailing stop, dan liquidation belum tersentuh pada snapshot menit ini.`,
        priceUsd: markPrice,
        confidence: signal.confidence,
        features: {
          ...signal.features,
          netUnrealizedPnlUsd,
          trailingStopPrice: trailing.trailingStopPrice,
        },
      });
      return { processed: true, action: 'HOLD', reasonCode: 'POSITION_OPEN', run, position };
    }

    if (input.forceClose) {
      run = input.store.updateRunMark({
        id: run.id,
        realizedBalanceUsd: run.realizedBalanceUsd,
        markEquityUsd: run.realizedBalanceUsd,
        peakEquityUsd: Math.max(run.peakEquityUsd, run.realizedBalanceUsd),
        maxDrawdownPercent: run.maxDrawdownPercent,
        lastProcessedAt: capturedAt,
      });
      input.store.saveDecision({
        runId: run.id,
        positionId: null,
        capturedAt,
        action: 'WAIT',
        reasonCode: 'BACKTEST_END_NO_ENTRY',
        rationale: 'Tidak membuka posisi baru pada snapshot terakhir backtest.',
        priceUsd: markPrice,
        confidence: signal.confidence,
        features: { ...signal.features },
      });
      return {
        processed: true,
        action: 'WAIT',
        reasonCode: 'BACKTEST_END_NO_ENTRY',
        run,
        position: null,
      };
    }

    const halted =
      config.maxDrawdownHaltPercent > 0 && run.maxDrawdownPercent >= config.maxDrawdownHaltPercent;
    if (halted) {
      run = input.store.updateRunMark({
        id: run.id,
        realizedBalanceUsd: run.realizedBalanceUsd,
        markEquityUsd: run.realizedBalanceUsd,
        peakEquityUsd: Math.max(run.peakEquityUsd, run.realizedBalanceUsd),
        maxDrawdownPercent: run.maxDrawdownPercent,
        lastProcessedAt: capturedAt,
      });
      run = input.store.pauseRun(run.id, capturedAt);
      input.store.saveDecision({
        runId: run.id,
        positionId: null,
        capturedAt,
        action: 'WAIT',
        reasonCode: 'MAX_DRAWDOWN_HALT',
        rationale: `Run dihentikan: max drawdown ${run.maxDrawdownPercent.toFixed(2)}% mencapai ambang ${config.maxDrawdownHaltPercent}%.`,
        priceUsd: markPrice,
        confidence: signal.confidence,
        features: { ...signal.features },
      });
      return { processed: true, action: 'WAIT', reasonCode: 'MAX_DRAWDOWN_HALT', run, position: null };
    }

    const latestClosed = input.store.getLatestClosedPosition(run.id);
    const cooldownRemainingMinutes = latestClosed?.closedAt
      ? config.cooldownMinutes - (Date.parse(capturedAt) - Date.parse(latestClosed.closedAt)) / 60_000
      : 0;
    const canEnter =
      (signal.action === 'ENTER_LONG' || (signal.action === 'ENTER_SHORT' && config.shortEnabled)) &&
      cooldownRemainingMinutes <= 0 &&
      run.realizedBalanceUsd > 1;

    if (!canEnter) {
      const reasonCode =
        cooldownRemainingMinutes > 0
          ? 'ENTRY_COOLDOWN'
          : run.realizedBalanceUsd <= 1
            ? 'CAPITAL_EXHAUSTED'
            : signal.action === 'ENTER_SHORT' && !config.shortEnabled
              ? 'SHORT_DISABLED_BY_CONFIG'
              : signal.reasonCode;
      run = input.store.updateRunMark({
        id: run.id,
        realizedBalanceUsd: run.realizedBalanceUsd,
        markEquityUsd: run.realizedBalanceUsd,
        peakEquityUsd: Math.max(run.peakEquityUsd, run.realizedBalanceUsd),
        maxDrawdownPercent: Math.max(
          run.maxDrawdownPercent,
          drawdown(run.peakEquityUsd, run.realizedBalanceUsd)
        ),
        lastProcessedAt: capturedAt,
      });
      input.store.saveDecision({
        runId: run.id,
        positionId: null,
        capturedAt,
        action: 'WAIT',
        reasonCode,
        rationale:
          cooldownRemainingMinutes > 0
            ? `Menunggu cooldown ${Math.ceil(cooldownRemainingMinutes)} menit setelah posisi terakhir.`
            : signal.rationale,
        priceUsd: markPrice,
        confidence: signal.confidence,
        features: { ...signal.features },
      });
      return { processed: true, action: 'WAIT', reasonCode, run, position: null };
    }

    const side: DirectionalSide = signal.action === 'ENTER_LONG' ? 'LONG' : 'SHORT';
    const marginUsd = run.realizedBalanceUsd * config.marginFraction;
    const notionalUsd = marginUsd * config.leverage;
    const fillPrice = entryFillPrice(side, markPrice, config.slippageBps);
    const quantity = notionalUsd / fillPrice;
    const entryFeeUsd = fee(notionalUsd, config.takerFeeBps);
    const levels = positionLevels({
      side,
      entryPrice: fillPrice,
      stopDistance: signal.features.stopDistance ?? config.minimumStopDistance,
      leverage: config.leverage,
      maintenanceMarginRate: config.maintenanceMarginRate,
      rewardRiskRatio: config.rewardRiskRatio,
    });
    position = input.store.createPosition({
      runId: run.id,
      side,
      openedAt: capturedAt,
      signalPrice: markPrice,
      entryFillPrice: fillPrice,
      quantity,
      leverage: config.leverage,
      marginUsd,
      notionalUsd,
      takeProfitPrice: levels.takeProfitPrice,
      stopLossPrice: levels.stopLossPrice,
      liquidationPrice: levels.liquidationPrice,
      trailingStopPrice: null,
      bestPrice: fillPrice,
      entryFeeUsd,
    });
    input.store.saveFill({
      positionId: position.id,
      filledAt: capturedAt,
      fillType: 'ENTRY',
      orderSide: side === 'LONG' ? 'BUY' : 'SELL',
      priceUsd: fillPrice,
      quantity,
      notionalUsd,
      feeUsd: entryFeeUsd,
      slippageBps: config.slippageBps,
    });
    const realizedBalanceUsd = Math.max(0, run.realizedBalanceUsd - entryFeeUsd);
    const initialRawPnlUsd = rawPositionPnl(side, fillPrice, markPrice, quantity);
    const estimatedExitFeeUsd = fee(markPrice * quantity, config.takerFeeBps);
    const markEquityUsd = realizedBalanceUsd + initialRawPnlUsd - estimatedExitFeeUsd;
    const peakEquityUsd = Math.max(run.peakEquityUsd, markEquityUsd);
    run = input.store.updateRunMark({
      id: run.id,
      realizedBalanceUsd,
      markEquityUsd,
      peakEquityUsd,
      maxDrawdownPercent: Math.max(run.maxDrawdownPercent, drawdown(peakEquityUsd, markEquityUsd)),
      lastProcessedAt: capturedAt,
    });
    const action: DirectionalDecisionAction = side === 'LONG' ? 'OPEN_LONG' : 'OPEN_SHORT';
    input.store.saveDecision({
      runId: run.id,
      positionId: position.id,
      capturedAt,
      action,
      reasonCode: signal.reasonCode,
      rationale: signal.rationale,
      priceUsd: markPrice,
      confidence: signal.confidence,
      features: {
        ...signal.features,
        marginUsd,
        notionalUsd,
        leverage: config.leverage,
        entryFillPrice: fillPrice,
        takeProfitPrice: levels.takeProfitPrice,
        stopLossPrice: levels.stopLossPrice,
        liquidationPrice: levels.liquidationPrice,
      },
    });
    return { processed: true, action, reasonCode: signal.reasonCode, run, position };
  });
}

export function runDirectionalBacktest(input: {
  snapshots: readonly PoolSnapshot[];
  store: DirectionalPaperStore;
  config?: DirectionalStrategyConfig;
  sourceLabel?: string;
}): DirectionalRunPerformance {
  const config = input.config ?? DEFAULT_DIRECTIONAL_CONFIG;
  const snapshots = [...input.snapshots]
    .filter(snapshot => Number.isFinite(snapshot.price) && snapshot.price > 0)
    .sort((left, right) => left.capturedAt.localeCompare(right.capturedAt));
  if (snapshots.length === 0) throw new Error('Directional backtest requires price snapshots');
  const run = input.store.createRun({
    mode: 'BACKTEST',
    startedAt: snapshots[0]!.capturedAt,
    config,
    sourceLabel: input.sourceLabel ?? 'pool_snapshots',
  });
  const historyWindowPoints = directionalRequiredHistoryPoints(config);
  for (let index = 0; index < snapshots.length; index++) {
    processDirectionalSnapshot({
      runId: run.id,
      snapshot: snapshots[index]!,
      history: snapshots.slice(Math.max(0, index - historyWindowPoints + 1), index + 1),
      store: input.store,
      config,
      forceClose: index === snapshots.length - 1,
    });
  }
  input.store.completeRun(run.id, snapshots.at(-1)!.capturedAt);
  return input.store.getPerformance(run.id);
}

export function runDirectionalForwardCycle(input: {
  store: DirectionalPaperStore;
  snapshotStore: SnapshotStore;
  config?: DirectionalStrategyConfig;
  now?: Date;
}): DirectionalRunPerformance | null {
  const config = input.config ?? DEFAULT_DIRECTIONAL_CONFIG;
  const now = input.now ?? new Date();
  const requiredHistoryPoints = directionalRequiredHistoryPoints(config);
  const historyHours = Math.max(48, Math.ceil(requiredHistoryPoints / 60) + 2);
  const history = input.snapshotStore
    .getHistory(historyHours, historyHours * 60)
    .filter(snapshot => Date.parse(snapshot.capturedAt) <= now.getTime());
  const latest = history.at(-1);
  if (!latest) return null;
  let run = input.store.getActiveForwardRun();
  if (!run) {
    run = input.store.createRun({
      mode: 'FORWARD',
      startedAt: latest.capturedAt,
      config,
      sourceLabel: 'pool_snapshots_forward_minute',
    });
  } else if (JSON.stringify(run.config) !== JSON.stringify(config)) {
    // Config layanan bersifat otoritatif untuk run forward aktif: selaraskan
    // config tersimpan agar perubahan (mis. opposingExitAtBreakeven) berlaku
    // tanpa perlu membuat run baru.
    run = input.store.updateRunConfig(run.id, config);
  }
  const candidates = run.lastProcessedAt
    ? history.filter(snapshot => snapshot.capturedAt > run!.lastProcessedAt!)
    : [latest];
  for (const snapshot of candidates) {
    const availableHistory = history
      .filter(item => item.capturedAt <= snapshot.capturedAt)
      .slice(-requiredHistoryPoints);
    processDirectionalSnapshot({
      runId: run.id,
      snapshot,
      history: availableHistory,
      store: input.store,
      config: run.config,
    });
  }
  return input.store.getPerformance(run.id);
}
