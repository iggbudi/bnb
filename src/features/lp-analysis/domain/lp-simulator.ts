import { calculateIL } from './amm.js';
import { calculateFullRangeTokenAmounts, fullRangeLiquidityForAmounts } from './full-range-liquidity.js';

const DEFAULT_PRICE_CHANGES = [-50, -20, -10, 0, 10, 20, 50, 100, 200];
const PROTOCOL_FEE_DENOMINATOR_BPS = 10_000;
const FEE_PERIOD_DAYS = 30;

export interface FullRangeSimulationInput {
  investment: number;
  currentPrice: number;
  volume24h: number;
  poolFeeRate: number;
  activeLiquidity: string;
  sqrtPriceX96: string;
  currentTick: number;
  token0Decimals: number;
  token1Decimals: number;
  protocolFeeShareToken0Bps: number;
  protocolFeeShareToken1Bps: number;
  entryGasUsd: number;
  exitGasUsd: number;
  assetSymbol?: string;
  priceChanges?: number[];
}

export interface FullRangeSimulationScenario {
  scenario: string;
  priceChange: number;
  newPrice: number;
  holdValue: number;
  lpValueBeforeFee: number;
  lpValueAfterFee: number;
  netValueAfterFeeAndGas: number;
  ilLoss: number;
  ilPercent: number;
  profitLossVsInvestment: number;
  returnVsInvestmentPercent: number;
  differenceVsHold: number;
}

export interface FullRangeLPSimulation {
  investment: number;
  feePeriodDays: 30;
  positionLiquidity: string;
  activeLiquidityBefore: string;
  shareOfActiveLiquidity: number;
  protocolFeeShareBps: number;
  grossPoolFees24h: number;
  netLpPoolFees24h: number;
  dailyFee: number;
  weeklyFee: number;
  monthlyFee: number;
  yearlyFee: number;
  apr: number;
  entryGasUsd: number;
  exitGasUsd: number;
  totalLifecycleGasUsd: number;
  ilScenarios: FullRangeSimulationScenario[];
  assumptions: string[];
}

function requireFinite(value: number, label: string, allowZero = false): void {
  if (!Number.isFinite(value) || (allowZero ? value < 0 : value <= 0)) {
    throw new Error(`${label} must be ${allowZero ? 'non-negative' : 'positive'}`);
  }
}

function requireProtocolFeeBps(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0 || value > PROTOCOL_FEE_DENOMINATOR_BPS) {
    throw new Error(`${label} must be an integer between 0 and 10000`);
  }
}

function bigintRatio(numerator: bigint, denominator: bigint): number {
  const scale = 10n ** 24n;
  return Number((numerator * scale) / denominator) / 1e24;
}

export function simulateFullRangeLP(input: FullRangeSimulationInput): FullRangeLPSimulation {
  requireFinite(input.investment, 'Investment');
  requireFinite(input.currentPrice, 'Current price');
  requireFinite(input.volume24h, '24h volume', true);
  requireFinite(input.poolFeeRate, 'Pool fee rate');
  requireFinite(input.entryGasUsd, 'Entry gas', true);
  requireFinite(input.exitGasUsd, 'Exit gas', true);
  requireProtocolFeeBps(input.protocolFeeShareToken0Bps, 'Token0 protocol fee share');
  requireProtocolFeeBps(input.protocolFeeShareToken1Bps, 'Token1 protocol fee share');

  const activeLiquidity = BigInt(input.activeLiquidity);
  const sqrtPriceX96 = BigInt(input.sqrtPriceX96);
  if (activeLiquidity <= 0n || sqrtPriceX96 <= 0n) {
    throw new Error('On-chain liquidity and sqrt price must be positive');
  }

  const tokenAmounts = calculateFullRangeTokenAmounts(
    input.investment,
    input.currentPrice,
    input.currentTick,
    input.token0Decimals,
    input.token1Decimals
  );
  const positionLiquidity = fullRangeLiquidityForAmounts(
    tokenAmounts.amount0,
    tokenAmounts.amount1,
    sqrtPriceX96
  );
  const shareOfActiveLiquidity = bigintRatio(positionLiquidity, activeLiquidity + positionLiquidity);

  // DexScreener does not split volume by swap direction. The configured pool currently
  // uses the same protocol share for both tokens; averaging remains explicit if that changes.
  const protocolFeeShareBps = (input.protocolFeeShareToken0Bps + input.protocolFeeShareToken1Bps) / 2;
  const grossPoolFees24h = input.volume24h * input.poolFeeRate;
  const netLpPoolFees24h = grossPoolFees24h * (1 - protocolFeeShareBps / PROTOCOL_FEE_DENOMINATOR_BPS);
  const dailyFee = shareOfActiveLiquidity * netLpPoolFees24h;
  const weeklyFee = dailyFee * 7;
  const monthlyFee = dailyFee * FEE_PERIOD_DAYS;
  const yearlyFee = dailyFee * 365;
  const apr = (yearlyFee / input.investment) * 100;
  const totalLifecycleGasUsd = input.entryGasUsd + input.exitGasUsd;
  const assetSymbol = input.assetSymbol ?? 'BNB';
  const priceChanges = input.priceChanges ?? DEFAULT_PRICE_CHANGES;

  const ilScenarios = priceChanges.map((change): FullRangeSimulationScenario => {
    if (!Number.isFinite(change) || change <= -100) {
      throw new Error('Every price scenario must be finite and greater than -100%');
    }
    const newPrice = input.currentPrice * (1 + change / 100);
    const il = calculateIL(input.currentPrice, newPrice, input.investment);
    const lpValueAfterFee = il.lpValue + monthlyFee;
    const netValueAfterFeeAndGas = lpValueAfterFee - totalLifecycleGasUsd;
    const profitLossVsInvestment = netValueAfterFeeAndGas - input.investment;
    const scenario =
      change === 0
        ? 'Harga tetap'
        : change > 0
          ? `${assetSymbol} naik ${change}%`
          : `${assetSymbol} turun ${Math.abs(change)}%`;

    return {
      scenario,
      priceChange: change,
      newPrice,
      holdValue: il.holdValue,
      lpValueBeforeFee: il.lpValue,
      lpValueAfterFee,
      netValueAfterFeeAndGas,
      ilLoss: il.ilLoss,
      ilPercent: il.ilPercent,
      profitLossVsInvestment,
      returnVsInvestmentPercent: (profitLossVsInvestment / input.investment) * 100,
      differenceVsHold: netValueAfterFeeAndGas - il.holdValue,
    };
  });

  return {
    investment: input.investment,
    feePeriodDays: FEE_PERIOD_DAYS,
    positionLiquidity: positionLiquidity.toString(),
    activeLiquidityBefore: activeLiquidity.toString(),
    shareOfActiveLiquidity,
    protocolFeeShareBps,
    grossPoolFees24h,
    netLpPoolFees24h,
    dailyFee,
    weeklyFee,
    monthlyFee,
    yearlyFee,
    apr,
    entryGasUsd: input.entryGasUsd,
    exitGasUsd: input.exitGasUsd,
    totalLifecycleGasUsd,
    ilScenarios,
    assumptions: [
      'Fee memakai volume 24 jam terakhir sebagai proyeksi dan tidak dikompaun.',
      'Porsi fee memakai liquidity aktif on-chain pada snapshot saat ini; liquidity aktif dapat berubah ketika harga melintasi tick.',
      'Protocol fee sudah dikurangkan dari swap fee sebelum menghitung bagian LP.',
      'IL memakai model full-range 50/50; hasil concentrated liquidity berbeda.',
    ],
  };
}
