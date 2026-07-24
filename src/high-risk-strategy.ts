const PROTOCOL_FEE_DENOMINATOR_BPS = 10_000;
const DAYS_PER_MONTH = 30;

export const HIGH_RISK_TARGET_MONTHLY_RETURN_PERCENT = 10;
export const HIGH_RISK_FEE_RETENTION_FACTOR = 0.7;
export const HIGH_RISK_MAX_RECENTERS_PER_MONTH = 4;
export const HIGH_RISK_RECENTER_SLIPPAGE_BPS = 10;
export const HIGH_RISK_STOP_LOSS_PERCENT = 5;
export const HIGH_RISK_MIN_HISTORY_COVERAGE_PERCENT = 80;
export const HIGH_RISK_RANGE_CANDIDATES_PERCENT = [
  0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.7, 0.8, 0.9, 1, 1.25, 1.5, 2,
] as const;

export interface HighRiskStrategyInput {
  investment: number;
  currentPrice: number;
  volume24h: number;
  poolFeeRate: number;
  activeLiquidity: string;
  sqrtPriceX96: string;
  currentTick: number;
  tickSpacing: number;
  token0Decimals: number;
  token1Decimals: number;
  protocolFeeShareToken0Bps: number;
  protocolFeeShareToken1Bps: number;
  entryGasUsd: number;
  exitGasUsd: number;
  history24hCoveragePercent: number;
  history24hPrices: number[];
  targetMonthlyReturnPercent?: number;
  feeRetentionFactor?: number;
  maxRecentersPerMonth?: number;
  recenterSlippageBps?: number;
  rangeCandidatesPercent?: number[];
}

export interface HighRiskRangeCandidate {
  rangePercent: number;
  tickLower: number;
  tickUpper: number;
  priceLowerUsd: number;
  priceUpperUsd: number;
  positionLiquidity: string;
  shareOfActiveLiquidity: number;
  historicalOccupancyPercent: number;
  historicalRangeExits: number;
  appliedFeeRetentionFactor: number;
  idealFee30dUsd: number;
  retainedFee30dUsd: number;
  plannedLifecycleCostUsd: number;
  projectedNetProfit30dUsd: number;
  projectedNetReturn30dPercent: number;
  idealFeeAprPercent: number;
  stressDown5ValueUsd: number;
  stressDown5ReturnPercent: number;
  stressUp5ValueUsd: number;
  stressUp5ReturnPercent: number;
  meetsTarget: boolean;
}

export interface HighRiskStrategyPlan {
  strategy: 'CONCENTRATED_HIGH_RISK_MONTHLY_TARGET';
  riskLevel: 'VERY_HIGH';
  advisoryAction: 'PAPER_TEST_CONCENTRATED' | 'WAIT';
  status: 'CANDIDATE_FOUND' | 'TARGET_NOT_FEASIBLE' | 'DATA_INSUFFICIENT';
  executionEnabled: false;
  investment: number;
  targetMonthlyReturnPercent: number;
  targetProfitUsd: number;
  stopLossPercent: number;
  stopValueUsd: number;
  feeRetentionFactor: number;
  maxRecentersPerMonth: number;
  recenterSlippageBps: number;
  history24hCoveragePercent: number;
  selectedRange: HighRiskRangeCandidate | null;
  candidates: HighRiskRangeCandidate[];
  reason: string;
  warnings: string[];
}

function finitePositive(value: number, label: string, allowZero = false): void {
  if (!Number.isFinite(value) || (allowZero ? value < 0 : value <= 0)) {
    throw new Error(`${label} must be ${allowZero ? 'non-negative' : 'positive'}`);
  }
}

function alignFloor(value: number, spacing: number): number {
  return Math.floor(value / spacing) * spacing;
}

function alignCeil(value: number, spacing: number): number {
  return Math.ceil(value / spacing) * spacing;
}

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

function rangeOccupancy(
  prices: number[],
  lower: number,
  upper: number
): { occupancyPercent: number; exits: number } {
  if (prices.length === 0) return { occupancyPercent: 0, exits: 0 };
  let insideCount = 0;
  let exits = 0;
  let previousInside: boolean | null = null;
  for (const price of prices) {
    const inside = Number.isFinite(price) && price >= lower && price <= upper;
    if (inside) insideCount += 1;
    if (previousInside === true && !inside) exits += 1;
    previousInside = inside;
  }
  return {
    occupancyPercent: (insideCount / prices.length) * 100,
    exits,
  };
}

function positionValueAtPrice(
  liquidityTokens: number,
  sqrtLower: number,
  sqrtUpper: number,
  priceUsd: number
): number {
  const sqrtPrice = 1 / Math.sqrt(priceUsd);
  if (sqrtPrice <= sqrtLower) {
    return (liquidityTokens * (sqrtUpper - sqrtLower)) / (sqrtLower * sqrtUpper);
  }
  if (sqrtPrice >= sqrtUpper) {
    return liquidityTokens * (sqrtUpper - sqrtLower) * priceUsd;
  }
  const amount0 = (liquidityTokens * (sqrtUpper - sqrtPrice)) / (sqrtPrice * sqrtUpper);
  const amount1 = liquidityTokens * (sqrtPrice - sqrtLower);
  return amount0 + amount1 * priceUsd;
}

export function buildHighRiskStrategyPlan(input: HighRiskStrategyInput): HighRiskStrategyPlan {
  finitePositive(input.investment, 'Investment');
  finitePositive(input.currentPrice, 'Current price');
  finitePositive(input.volume24h, '24h volume', true);
  finitePositive(input.poolFeeRate, 'Pool fee rate');
  finitePositive(input.entryGasUsd, 'Entry gas', true);
  finitePositive(input.exitGasUsd, 'Exit gas', true);
  if (!Number.isInteger(input.tickSpacing) || input.tickSpacing <= 0) {
    throw new Error('Tick spacing must be a positive integer');
  }
  if (input.token0Decimals !== input.token1Decimals) {
    throw new Error('High-risk planner currently requires equal token decimals');
  }

  const activeLiquidity = BigInt(input.activeLiquidity);
  const sqrtPriceX96 = BigInt(input.sqrtPriceX96);
  if (activeLiquidity <= 0n || sqrtPriceX96 <= 0n) {
    throw new Error('On-chain liquidity and sqrt price must be positive');
  }

  const targetMonthlyReturnPercent =
    input.targetMonthlyReturnPercent ?? HIGH_RISK_TARGET_MONTHLY_RETURN_PERCENT;
  const feeRetentionFactor = input.feeRetentionFactor ?? HIGH_RISK_FEE_RETENTION_FACTOR;
  const maxRecentersPerMonth = input.maxRecentersPerMonth ?? HIGH_RISK_MAX_RECENTERS_PER_MONTH;
  const recenterSlippageBps = input.recenterSlippageBps ?? HIGH_RISK_RECENTER_SLIPPAGE_BPS;
  const rangeCandidates = input.rangeCandidatesPercent ?? [...HIGH_RISK_RANGE_CANDIDATES_PERCENT];
  finitePositive(targetMonthlyReturnPercent, 'Monthly return target');
  if (!(feeRetentionFactor > 0 && feeRetentionFactor <= 1)) {
    throw new Error('Fee retention factor must be between 0 and 1');
  }
  if (!Number.isInteger(maxRecentersPerMonth) || maxRecentersPerMonth < 0) {
    throw new Error('Maximum monthly recenters must be a non-negative integer');
  }
  if (!Number.isInteger(recenterSlippageBps) || recenterSlippageBps < 0 || recenterSlippageBps > 1_000) {
    throw new Error('Recenter slippage must be between 0 and 1000 bps');
  }

  const sqrtPrice = Number(sqrtPriceX96) / 2 ** 96;
  const activeLiquidityNumber = Number(activeLiquidity);
  const protocolFeeShareBps = (input.protocolFeeShareToken0Bps + input.protocolFeeShareToken1Bps) / 2;
  const netLpPoolFees24h =
    input.volume24h * input.poolFeeRate * (1 - protocolFeeShareBps / PROTOCOL_FEE_DENOMINATOR_BPS);
  const baseLifecycleCostUsd = input.entryGasUsd + input.exitGasUsd;
  const recenterCostUsd =
    baseLifecycleCostUsd + (input.investment * recenterSlippageBps) / PROTOCOL_FEE_DENOMINATOR_BPS;
  const plannedLifecycleCostUsd = baseLifecycleCostUsd + maxRecentersPerMonth * recenterCostUsd;
  const logTick = Math.log(1.0001);
  const unitScale = 10 ** input.token0Decimals;
  const hasSufficientHistory =
    input.history24hCoveragePercent >= HIGH_RISK_MIN_HISTORY_COVERAGE_PERCENT &&
    input.history24hPrices.length > 0;

  const candidates = rangeCandidates.map((rangePercent): HighRiskRangeCandidate => {
    finitePositive(rangePercent, 'Range percent');
    if (rangePercent >= 100) throw new Error('Range percent must be below 100');
    const lowerOffset = Math.log(1 - rangePercent / 100) / logTick;
    const upperOffset = Math.log(1 + rangePercent / 100) / logTick;
    const tickLower = alignFloor(input.currentTick + lowerOffset, input.tickSpacing);
    const tickUpper = alignCeil(input.currentTick + upperOffset, input.tickSpacing);
    const sqrtLower = 1.0001 ** (tickLower / 2);
    const sqrtUpper = 1.0001 ** (tickUpper / 2);
    const amount0PerLiquidity = (sqrtUpper - sqrtPrice) / (sqrtPrice * sqrtUpper);
    const amount1PerLiquidity = sqrtPrice - sqrtLower;
    const capitalPerLiquidity = amount0PerLiquidity + amount1PerLiquidity * input.currentPrice;
    if (!(capitalPerLiquidity > 0)) throw new Error('Candidate range produced invalid liquidity');

    const liquidityTokens = input.investment / capitalPerLiquidity;
    const positionLiquidityNumber = liquidityTokens * unitScale;
    const shareOfActiveLiquidity = ratio(
      positionLiquidityNumber,
      activeLiquidityNumber + positionLiquidityNumber
    );
    const boundaryPrices = [1 / sqrtLower ** 2, 1 / sqrtUpper ** 2];
    const priceLowerUsd = Math.min(...boundaryPrices);
    const priceUpperUsd = Math.max(...boundaryPrices);
    const historical = rangeOccupancy(input.history24hPrices, priceLowerUsd, priceUpperUsd);
    const occupancyFactor = historical.occupancyPercent / 100;
    const appliedFeeRetentionFactor = hasSufficientHistory
      ? Math.min(feeRetentionFactor, occupancyFactor)
      : feeRetentionFactor;
    const idealFee30dUsd = shareOfActiveLiquidity * netLpPoolFees24h * DAYS_PER_MONTH;
    const retainedFee30dUsd = idealFee30dUsd * appliedFeeRetentionFactor;
    const projectedNetProfit30dUsd = retainedFee30dUsd - plannedLifecycleCostUsd;
    const projectedNetReturn30dPercent = (projectedNetProfit30dUsd / input.investment) * 100;
    const stressDown5ValueUsd = positionValueAtPrice(
      liquidityTokens,
      sqrtLower,
      sqrtUpper,
      input.currentPrice * 0.95
    );
    const stressUp5ValueUsd = positionValueAtPrice(
      liquidityTokens,
      sqrtLower,
      sqrtUpper,
      input.currentPrice * 1.05
    );

    return {
      rangePercent,
      tickLower,
      tickUpper,
      priceLowerUsd,
      priceUpperUsd,
      positionLiquidity: BigInt(Math.floor(positionLiquidityNumber)).toString(),
      shareOfActiveLiquidity,
      historicalOccupancyPercent: historical.occupancyPercent,
      historicalRangeExits: historical.exits,
      appliedFeeRetentionFactor,
      idealFee30dUsd,
      retainedFee30dUsd,
      plannedLifecycleCostUsd,
      projectedNetProfit30dUsd,
      projectedNetReturn30dPercent,
      idealFeeAprPercent: ((idealFee30dUsd * 365) / DAYS_PER_MONTH / input.investment) * 100,
      stressDown5ValueUsd,
      stressDown5ReturnPercent: (stressDown5ValueUsd / input.investment - 1) * 100,
      stressUp5ValueUsd,
      stressUp5ReturnPercent: (stressUp5ValueUsd / input.investment - 1) * 100,
      meetsTarget: hasSufficientHistory && projectedNetReturn30dPercent >= targetMonthlyReturnPercent,
    };
  });

  const selectedRange =
    candidates
      .filter(candidate => candidate.meetsTarget)
      .sort((a, b) => b.rangePercent - a.rangePercent)[0] ?? null;
  const targetProfitUsd = (input.investment * targetMonthlyReturnPercent) / 100;
  let status: HighRiskStrategyPlan['status'];
  let reason: string;
  if (!hasSufficientHistory) {
    status = 'DATA_INSUFFICIENT';
    reason = `Coverage histori 24 jam ${input.history24hCoveragePercent.toFixed(1)}% belum mencapai ${HIGH_RISK_MIN_HISTORY_COVERAGE_PERCENT}%.`;
  } else if (!selectedRange) {
    status = 'TARGET_NOT_FEASIBLE';
    reason = `Tidak ada kandidat range yang mencapai target net ${targetMonthlyReturnPercent.toFixed(1)}% per 30 hari setelah haircut fee dan budget recenter.`;
  } else {
    status = 'CANDIDATE_FOUND';
    reason = `Range terlebar yang masih mencapai target adalah ±${selectedRange.rangePercent}% dengan proyeksi net ${selectedRange.projectedNetReturn30dPercent.toFixed(2)}%.`;
  }

  return {
    strategy: 'CONCENTRATED_HIGH_RISK_MONTHLY_TARGET',
    riskLevel: 'VERY_HIGH',
    advisoryAction: selectedRange ? 'PAPER_TEST_CONCENTRATED' : 'WAIT',
    status,
    executionEnabled: false,
    investment: input.investment,
    targetMonthlyReturnPercent,
    targetProfitUsd,
    stopLossPercent: HIGH_RISK_STOP_LOSS_PERCENT,
    stopValueUsd: input.investment * (1 - HIGH_RISK_STOP_LOSS_PERCENT / 100),
    feeRetentionFactor,
    maxRecentersPerMonth,
    recenterSlippageBps,
    history24hCoveragePercent: input.history24hCoveragePercent,
    selectedRange,
    candidates,
    reason,
    warnings: [
      'Target adalah proyeksi, bukan jaminan hasil.',
      'Range sempit dapat sering out-of-range dan berubah menjadi satu token.',
      'Proyeksi memakai volume 24 jam dan active liquidity saat ini; keduanya dapat berubah.',
      'Lifecycle portfolio paper concentrated aktif; live execution adapter tetap dinonaktifkan.',
    ],
  };
}
