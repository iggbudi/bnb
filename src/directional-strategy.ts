export type DirectionalSide = 'LONG' | 'SHORT';
export type DirectionalSignalAction = 'ENTER_LONG' | 'ENTER_SHORT' | 'WAIT';

export const DIRECTIONAL_STRATEGY_VERSION = 'directional-momentum-v1.0';

export interface DirectionalStrategyConfig {
  strategyVersion: string;
  initialCapitalUsd: number;
  leverage: number;
  marginFraction: number;
  takerFeeBps: number;
  slippageBps: number;
  maintenanceMarginRate: number;
  minimumHistoryPoints: number;
  fastEmaPoints: number;
  slowEmaPoints: number;
  shortMomentumPoints: number;
  longMomentumPoints: number;
  volatilityPoints: number;
  minimumShortMomentum: number;
  minimumLongMomentum: number;
  minimumTrendGap: number;
  minimumStopDistance: number;
  maximumStopDistance: number;
  volatilityStopMultiplier: number;
  rewardRiskRatio: number;
  trailingActivationR: number;
  trailingDistanceR: number;
  maximumHoldMinutes: number;
  cooldownMinutes: number;
  fundingRate8h: number;
}

export const DEFAULT_DIRECTIONAL_CONFIG: Readonly<DirectionalStrategyConfig> = {
  strategyVersion: DIRECTIONAL_STRATEGY_VERSION,
  initialCapitalUsd: 50,
  leverage: 5,
  marginFraction: 0.5,
  takerFeeBps: 5.5,
  slippageBps: 2,
  maintenanceMarginRate: 0.005,
  minimumHistoryPoints: 240,
  fastEmaPoints: 20,
  slowEmaPoints: 60,
  shortMomentumPoints: 15,
  longMomentumPoints: 60,
  volatilityPoints: 60,
  minimumShortMomentum: 0.0008,
  minimumLongMomentum: 0.002,
  minimumTrendGap: 0.0003,
  minimumStopDistance: 0.006,
  maximumStopDistance: 0.02,
  volatilityStopMultiplier: 2.5,
  rewardRiskRatio: 2,
  trailingActivationR: 1,
  trailingDistanceR: 0.75,
  maximumHoldMinutes: 24 * 60,
  cooldownMinutes: 15,
  fundingRate8h: 0,
};

export interface DirectionalSignalFeatures {
  price: number;
  historyPoints: number;
  historyCoveragePercent: number;
  returnShort: number | null;
  returnLong: number | null;
  emaFast: number | null;
  emaSlow: number | null;
  trendGap: number | null;
  realizedVolatility: number | null;
  rsi14: number | null;
  stopDistance: number | null;
}

export interface DirectionalSignal {
  action: DirectionalSignalAction;
  confidence: number;
  reasonCode: string;
  rationale: string;
  features: DirectionalSignalFeatures;
}

function finitePositivePrices(prices: readonly number[]): number[] {
  return prices.filter(price => Number.isFinite(price) && price > 0);
}

function ema(values: readonly number[], points: number): number {
  const alpha = 2 / (points + 1);
  let result = values[0]!;
  for (let index = 1; index < values.length; index++) {
    result = values[index]! * alpha + result * (1 - alpha);
  }
  return result;
}

function returnOver(values: readonly number[], points: number): number {
  const latest = values.at(-1)!;
  const previous = values[values.length - 1 - points]!;
  return latest / previous - 1;
}

function realizedVolatility(values: readonly number[], points: number): number {
  const window = values.slice(-(points + 1));
  const returns: number[] = [];
  for (let index = 1; index < window.length; index++) {
    returns.push(Math.log(window[index]! / window[index - 1]!));
  }
  if (returns.length === 0) return 0;
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance =
    returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, returns.length - 1);
  return Math.sqrt(variance);
}

function rsi(values: readonly number[], points = 14): number {
  const window = values.slice(-(points + 1));
  let gains = 0;
  let losses = 0;
  for (let index = 1; index < window.length; index++) {
    const change = window[index]! - window[index - 1]!;
    if (change >= 0) gains += change;
    else losses -= change;
  }
  if (losses === 0) return gains === 0 ? 50 : 100;
  const relativeStrength = gains / losses;
  return 100 - 100 / (1 + relativeStrength);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function validateDirectionalConfig(config: DirectionalStrategyConfig): void {
  const positive = [
    config.initialCapitalUsd,
    config.leverage,
    config.marginFraction,
    config.fastEmaPoints,
    config.slowEmaPoints,
    config.shortMomentumPoints,
    config.longMomentumPoints,
    config.volatilityPoints,
    config.minimumHistoryPoints,
    config.minimumStopDistance,
    config.maximumStopDistance,
    config.volatilityStopMultiplier,
    config.rewardRiskRatio,
    config.trailingActivationR,
    config.trailingDistanceR,
    config.maximumHoldMinutes,
  ];
  if (positive.some(value => !Number.isFinite(value) || value <= 0)) {
    throw new Error('Directional strategy positive parameters must be finite and positive');
  }
  if (!config.strategyVersion.trim()) throw new Error('Directional strategy version is required');
  if (config.leverage < 1 || config.leverage > 20) throw new Error('Directional leverage must be 1-20');
  if (config.marginFraction <= 0 || config.marginFraction > 1) {
    throw new Error('Directional margin fraction must be in (0, 1]');
  }
  if (config.maintenanceMarginRate < 0 || config.maintenanceMarginRate >= 1 / config.leverage) {
    throw new Error('Directional maintenance margin rate is invalid for the leverage');
  }
  if (config.takerFeeBps < 0 || config.slippageBps < 0 || config.fundingRate8h < 0) {
    throw new Error('Directional costs must be non-negative');
  }
  if (config.minimumStopDistance > config.maximumStopDistance) {
    throw new Error('Directional minimum stop distance cannot exceed maximum');
  }
  if (config.fastEmaPoints >= config.slowEmaPoints) {
    throw new Error('Directional fast EMA must be shorter than slow EMA');
  }
}

export function directionalRequiredHistoryPoints(config: DirectionalStrategyConfig): number {
  return Math.max(
    config.minimumHistoryPoints,
    config.slowEmaPoints + 1,
    config.longMomentumPoints + 1,
    config.volatilityPoints + 1,
    15
  );
}

export function makeDirectionalSignal(
  rawPrices: readonly number[],
  config: DirectionalStrategyConfig = DEFAULT_DIRECTIONAL_CONFIG,
  historyCoveragePercent = 100
): DirectionalSignal {
  validateDirectionalConfig(config);
  const prices = finitePositivePrices(rawPrices);
  const latest = prices.at(-1) ?? 0;
  const emptyFeatures: DirectionalSignalFeatures = {
    price: latest,
    historyPoints: prices.length,
    historyCoveragePercent,
    returnShort: null,
    returnLong: null,
    emaFast: null,
    emaSlow: null,
    trendGap: null,
    realizedVolatility: null,
    rsi14: null,
    stopDistance: null,
  };
  const required = directionalRequiredHistoryPoints(config);
  if (prices.length < required || historyCoveragePercent < 80) {
    const historyGap = historyCoveragePercent < 80;
    return {
      action: 'WAIT',
      confidence: 0,
      reasonCode: historyGap ? 'HISTORY_COVERAGE_INSUFFICIENT' : 'HISTORY_INSUFFICIENT',
      rationale: historyGap
        ? `Coverage snapshot terbaru ${historyCoveragePercent.toFixed(1)}% belum mencapai 80%.`
        : `Menunggu minimal ${required} snapshot harga valid.`,
      features: emptyFeatures,
    };
  }

  const emaWindow = prices.slice(-Math.max(config.minimumHistoryPoints, config.slowEmaPoints * 3));
  const emaFast = ema(emaWindow, config.fastEmaPoints);
  const emaSlow = ema(emaWindow, config.slowEmaPoints);
  const returnShort = returnOver(prices, config.shortMomentumPoints);
  const returnLong = returnOver(prices, config.longMomentumPoints);
  const trendGap = emaFast / emaSlow - 1;
  const volatility = realizedVolatility(prices, config.volatilityPoints);
  const rsi14 = rsi(prices);
  const stopDistance = clamp(
    volatility * config.volatilityStopMultiplier * Math.sqrt(config.volatilityPoints),
    config.minimumStopDistance,
    config.maximumStopDistance
  );
  const features: DirectionalSignalFeatures = {
    price: latest,
    historyPoints: prices.length,
    historyCoveragePercent,
    returnShort,
    returnLong,
    emaFast,
    emaSlow,
    trendGap,
    realizedVolatility: volatility,
    rsi14,
    stopDistance,
  };

  const longSignal =
    returnShort >= config.minimumShortMomentum &&
    returnLong >= config.minimumLongMomentum &&
    trendGap >= config.minimumTrendGap &&
    latest >= emaFast &&
    rsi14 >= 52 &&
    rsi14 <= 82;
  const shortSignal =
    returnShort <= -config.minimumShortMomentum &&
    returnLong <= -config.minimumLongMomentum &&
    trendGap <= -config.minimumTrendGap &&
    latest <= emaFast &&
    rsi14 >= 18 &&
    rsi14 <= 48;

  if (!longSignal && !shortSignal) {
    return {
      action: 'WAIT',
      confidence: 0.25,
      reasonCode: 'NO_DIRECTIONAL_EDGE',
      rationale: 'Momentum pendek, momentum panjang, tren EMA, dan RSI belum searah.',
      features,
    };
  }

  const side: DirectionalSide = longSignal ? 'LONG' : 'SHORT';
  const momentumScore = Math.min(1, Math.abs(returnLong) / (config.minimumLongMomentum * 3));
  const trendScore = Math.min(1, Math.abs(trendGap) / (config.minimumTrendGap * 4));
  const shortScore = Math.min(1, Math.abs(returnShort) / (config.minimumShortMomentum * 3));
  const confidence = clamp(0.45 + 0.2 * momentumScore + 0.2 * trendScore + 0.15 * shortScore, 0, 1);
  return {
    action: side === 'LONG' ? 'ENTER_LONG' : 'ENTER_SHORT',
    confidence,
    reasonCode: side === 'LONG' ? 'BULLISH_MOMENTUM_CONFIRMED' : 'BEARISH_MOMENTUM_CONFIRMED',
    rationale: `${side} karena momentum 15m/60m dan tren EMA searah; RSI ${rsi14.toFixed(1)} belum melewati filter ekstrem.`,
    features,
  };
}

export function entryFillPrice(side: DirectionalSide, signalPrice: number, slippageBps: number): number {
  const adjustment = slippageBps / 10_000;
  return signalPrice * (side === 'LONG' ? 1 + adjustment : 1 - adjustment);
}

export function exitFillPrice(side: DirectionalSide, markPrice: number, slippageBps: number): number {
  const adjustment = slippageBps / 10_000;
  return markPrice * (side === 'LONG' ? 1 - adjustment : 1 + adjustment);
}

export function positionLevels(input: {
  side: DirectionalSide;
  entryPrice: number;
  stopDistance: number;
  leverage: number;
  maintenanceMarginRate: number;
  rewardRiskRatio: number;
}): { takeProfitPrice: number; stopLossPrice: number; liquidationPrice: number } {
  const { side, entryPrice, stopDistance, leverage, maintenanceMarginRate, rewardRiskRatio } = input;
  if (side === 'LONG') {
    return {
      takeProfitPrice: entryPrice * (1 + stopDistance * rewardRiskRatio),
      stopLossPrice: entryPrice * (1 - stopDistance),
      liquidationPrice: entryPrice * (1 - 1 / leverage + maintenanceMarginRate),
    };
  }
  return {
    takeProfitPrice: entryPrice * (1 - stopDistance * rewardRiskRatio),
    stopLossPrice: entryPrice * (1 + stopDistance),
    liquidationPrice: entryPrice * (1 + 1 / leverage - maintenanceMarginRate),
  };
}

export function rawPositionPnl(
  side: DirectionalSide,
  entryPrice: number,
  markOrExitPrice: number,
  quantity: number
): number {
  return (markOrExitPrice - entryPrice) * quantity * (side === 'LONG' ? 1 : -1);
}
