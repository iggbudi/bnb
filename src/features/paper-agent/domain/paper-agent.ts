import { calculateIL } from '../../lp-analysis/index.js';
import { FULL_RANGE_FEE_ACCOUNTING_VERSION } from '../../lp-analysis/index.js';
import type { PaperAgentDecisionInput } from '../infrastructure/agent-store.js';
import type { HistoricalPeriodStats } from '../../market-data/index.js';

export const PAPER_AGENT_STRATEGY_VERSION = 'lifecycle-v2.1';
export const PAPER_AGENT_INVESTMENT = 100;
export const ENTRY_FORECAST_DAYS = 7;
export const ENTRY_FEE_RETENTION_FACTOR = 0.7;
export const ENTRY_HISTORY_COVERAGE_PERCENT = 80;
export const ENTRY_MINIMUM_NET_EDGE_USD = 0.01;

export interface PaperAgentMarketInput {
  price: number;
  tvl: number;
  volume1h: number;
  volume6h: number;
  volume24h: number;
  volLiqRatio: number;
  estimatedFees24h: number;
  estimatedAPR: number;
  priceChange1h: number;
  priceChange6h: number;
  priceChange24h: number;
  buys24h: number;
  sells24h: number;
}

export interface PaperAgentEconomicInput {
  entryGasUsd: number;
  exitGasUsd: number;
  applicableSwapSlippageUsd: number;
  projectedFee24hOnchain: number;
  transactionPath: 'BALANCED_TOKENS_MINT_WITHDRAW';
}

export interface PaperAgentFeatures {
  price: number;
  tvl: number;
  volume1h: number;
  volume6h: number;
  volume24h: number;
  volumeLiquidityRatio: number;
  estimatedFees24h: number;
  estimatedAPR: number;
  priceChange1h: number;
  priceChange6h: number;
  priceChange24h: number;
  buys24h: number;
  sells24h: number;
  buyRatio24h: number;
  history1hCount: number;
  history1hCoveragePercent: number;
  history1hPriceChangePercent: number | null;
  history1hTvlChangePercent: number | null;
  history24hCount: number;
  history24hCoveragePercent: number;
  history24hPriceChangePercent: number | null;
  history24hTvlChangePercent: number | null;
  history7dCoveragePercent: number;
  history7dPriceChangePercent: number | null;
  history7dPriceRangePercent: number | null;
  predictedFee7d: number;
  predictedIL7d: number;
  predictedLifecycleCostUsd: number;
  predictedNetEdge7d: number;
  entryFeeRetentionFactor: number;
  transactionPath: 'BALANCED_TOKENS_MINT_WITHDRAW';
  feeAccountingVersion: string;
}

function getPeriod(
  periods: HistoricalPeriodStats[],
  label: HistoricalPeriodStats['label']
): HistoricalPeriodStats | undefined {
  return periods.find(period => period.label === label);
}

export function buildPaperAgentFeatures(
  market: PaperAgentMarketInput,
  periods: HistoricalPeriodStats[]
): PaperAgentFeatures {
  const stats1h = getPeriod(periods, '1h');
  const stats24h = getPeriod(periods, '24h');
  const stats7d = getPeriod(periods, '7d');
  const totalTransactions = market.buys24h + market.sells24h;

  return {
    price: market.price,
    tvl: market.tvl,
    volume1h: market.volume1h,
    volume6h: market.volume6h,
    volume24h: market.volume24h,
    volumeLiquidityRatio: market.volLiqRatio,
    estimatedFees24h: market.estimatedFees24h,
    estimatedAPR: market.estimatedAPR,
    priceChange1h: market.priceChange1h,
    priceChange6h: market.priceChange6h,
    priceChange24h: market.priceChange24h,
    buys24h: market.buys24h,
    sells24h: market.sells24h,
    buyRatio24h: totalTransactions > 0 ? market.buys24h / totalTransactions : 0,
    history1hCount: stats1h?.count ?? 0,
    history1hCoveragePercent: stats1h?.coveragePercent ?? 0,
    history1hPriceChangePercent: stats1h?.price.changePercent ?? null,
    history1hTvlChangePercent: stats1h?.tvl.changePercent ?? null,
    history24hCount: stats24h?.count ?? 0,
    history24hCoveragePercent: stats24h?.coveragePercent ?? 0,
    history24hPriceChangePercent: stats24h?.price.changePercent ?? null,
    history24hTvlChangePercent: stats24h?.tvl.changePercent ?? null,
    history7dCoveragePercent: stats7d?.coveragePercent ?? 0,
    history7dPriceChangePercent: stats7d?.price.changePercent ?? null,
    history7dPriceRangePercent:
      stats7d?.price.average && stats7d.price.min !== null && stats7d.price.max !== null
        ? ((stats7d.price.max - stats7d.price.min) / stats7d.price.average) * 100
        : null,
    predictedFee7d: 0,
    predictedIL7d: 0,
    predictedLifecycleCostUsd: 0,
    predictedNetEdge7d: 0,
    entryFeeRetentionFactor: ENTRY_FEE_RETENTION_FACTOR,
    transactionPath: 'BALANCED_TOKENS_MINT_WITHDRAW',
    feeAccountingVersion: FULL_RANGE_FEE_ACCOUNTING_VERSION,
  };
}

function sevenDayStressMovePercent(
  currentPrice: number,
  period: HistoricalPeriodStats | undefined
): number | null {
  if (!(currentPrice > 0) || !period || period.price.min === null || period.price.max === null) return null;
  const moves = [period.price.min, period.price.max]
    .filter(price => price > 0)
    .map(price => (price / currentPrice - 1) * 100)
    .filter(move => move > -100 && Number.isFinite(move));
  if (moves.length === 0) return null;
  return moves.reduce((worst, move) => (Math.abs(move) > Math.abs(worst) ? move : worst), moves[0]!);
}

function startOfHour(date: Date): string {
  const value = new Date(date);
  value.setUTCMinutes(0, 0, 0);
  return value.toISOString();
}

export function makeBaselinePaperDecision(
  market: PaperAgentMarketInput,
  periods: HistoricalPeriodStats[],
  economics: PaperAgentEconomicInput | null,
  now = new Date()
): PaperAgentDecisionInput {
  const features = buildPaperAgentFeatures(market, periods);
  const stats7d = getPeriod(periods, '7d');
  const estimatedFee24h = economics?.projectedFee24hOnchain ?? 0;
  const validPriceScenario24h = 1 + market.priceChange24h / 100 > 0;
  const estimatedIL24h = validPriceScenario24h
    ? calculateIL(100, 100 * (1 + market.priceChange24h / 100), PAPER_AGENT_INVESTMENT).ilLoss
    : PAPER_AGENT_INVESTMENT;
  const predictedExcessVsHold24h = estimatedFee24h - estimatedIL24h;
  const stressMove7d = sevenDayStressMovePercent(market.price, stats7d);
  const predictedFee7d = estimatedFee24h * ENTRY_FORECAST_DAYS * ENTRY_FEE_RETENTION_FACTOR;
  const predictedIL7d =
    stressMove7d === null
      ? PAPER_AGENT_INVESTMENT
      : calculateIL(100, 100 * (1 + stressMove7d / 100), PAPER_AGENT_INVESTMENT).ilLoss;
  const predictedLifecycleCostUsd = economics
    ? economics.entryGasUsd + economics.exitGasUsd + economics.applicableSwapSlippageUsd
    : 0;
  const predictedNetEdge7d = predictedFee7d - predictedIL7d - predictedLifecycleCostUsd;
  Object.assign(features, {
    predictedFee7d,
    predictedIL7d,
    predictedLifecycleCostUsd,
    predictedNetEdge7d,
    transactionPath: economics?.transactionPath ?? 'BALANCED_TOKENS_MINT_WITHDRAW',
  });

  let action: PaperAgentDecisionInput['action'] = 'WAIT';
  let reasonCode = 'DATA_INSUFFICIENT';
  let confidence: PaperAgentDecisionInput['confidence'] = 'low';
  let rationale = `Menunggu karena coverage histori tujuh hari belum mencapai ${ENTRY_HISTORY_COVERAGE_PERCENT}%.`;

  if (
    features.history24hCoveragePercent >= ENTRY_HISTORY_COVERAGE_PERCENT &&
    features.history7dCoveragePercent >= ENTRY_HISTORY_COVERAGE_PERCENT
  ) {
    confidence =
      Math.min(features.history24hCoveragePercent, features.history7dCoveragePercent) >= 95
        ? 'high'
        : 'medium';

    if (!economics) {
      reasonCode = 'ONCHAIN_COST_UNAVAILABLE';
      confidence = 'low';
      rationale = 'Menunggu karena estimasi on-chain untuk biaya entry dan exit tidak tersedia.';
    } else if (
      !validPriceScenario24h ||
      stressMove7d === null ||
      market.tvl <= 0 ||
      market.price <= 0 ||
      !(economics.projectedFee24hOnchain >= 0) ||
      !Number.isFinite(predictedNetEdge7d)
    ) {
      reasonCode = 'INVALID_MARKET_DATA';
      confidence = 'low';
      rationale = 'Menunggu karena input harga, histori tujuh hari, atau likuiditas tidak valid.';
    } else if (Math.abs(market.priceChange1h) > 3 || Math.abs(market.priceChange24h) > 8) {
      reasonCode = 'VOLATILITY_TOO_HIGH';
      rationale =
        'Menunggu karena perubahan harga melewati batas risiko baseline (3% per jam atau 8% per 24 jam).';
    } else if ((features.history24hTvlChangePercent ?? 0) < -10) {
      reasonCode = 'TVL_DECLINING';
      rationale = 'Menunggu karena TVL lokal turun lebih dari 10% dalam 24 jam.';
    } else if (market.volLiqRatio < 0.25) {
      reasonCode = 'ACTIVITY_TOO_LOW';
      rationale = 'Menunggu karena rasio volume terhadap likuiditas berada di bawah 0,25.';
    } else if (market.estimatedAPR < 1) {
      reasonCode = 'FEE_YIELD_TOO_LOW';
      rationale = 'Menunggu karena estimasi APR gross berada di bawah 1%.';
    } else if (predictedNetEdge7d < ENTRY_MINIMUM_NET_EDGE_USD) {
      reasonCode = 'LIFECYCLE_EDGE_TOO_LOW';
      rationale = `Menunggu karena proyeksi net edge tujuh hari ${predictedNetEdge7d.toFixed(4)} belum mencapai US$${ENTRY_MINIMUM_NET_EDGE_USD.toFixed(2)} setelah IL dan lifecycle gas.`;
    } else {
      action = 'ENTER_FULL_RANGE';
      reasonCode = 'LIFECYCLE_CONDITIONS_MET';
      rationale = `Sinyal entry full-range karena proyeksi net edge tujuh hari ${predictedNetEdge7d.toFixed(4)} telah melewati biaya lifecycle dan ambang US$${ENTRY_MINIMUM_NET_EDGE_USD.toFixed(2)}.`;
    }
  }

  return {
    decisionHour: startOfHour(now),
    createdAt: now.toISOString(),
    strategyVersion: PAPER_AGENT_STRATEGY_VERSION,
    action,
    reasonCode,
    confidence,
    rationale,
    investment: PAPER_AGENT_INVESTMENT,
    referencePrice: market.price,
    predictedFee24h: estimatedFee24h,
    predictedIL24h: estimatedIL24h,
    predictedExcessVsHold24h,
    features: features as unknown as Record<string, unknown>,
  };
}
