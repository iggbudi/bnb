import { calculateFullRangeTokenAmounts, fullRangeLiquidityForAmounts } from './full-range-liquidity.js';
import { feeGrowthDelta } from '../../market-data/index.js';

const Q96 = 1n << 96n;
const Q128 = 1n << 128n;

export const FULL_RANGE_FEE_ACCOUNTING_VERSION = 'v3-fee-growth-v1';

export interface FullRangeFeeCheckpoint {
  blockNumber: number;
  capturedAt: string;
  currentTick: number;
  feeGrowthGlobal0X128: string;
  feeGrowthGlobal1X128: string;
  priceWbnbUsd: number;
}

function requireUint(value: string, label: string): bigint {
  if (!/^\d+$/.test(value)) throw new Error(`${label} must be an unsigned integer string`);
  return BigInt(value);
}

export function sqrtPriceX96AtTick(tick: number): bigint {
  if (!Number.isInteger(tick) || tick < -887272 || tick > 887272) {
    throw new Error('Tick is outside the supported V3 range');
  }
  const ratio = 1.0001 ** (tick / 2);
  if (!Number.isFinite(ratio) || ratio <= 0) throw new Error('Tick produced an invalid sqrt price');
  const scaled = ratio * Number(Q96);
  if (!Number.isFinite(scaled) || scaled <= 0) throw new Error('Tick produced an invalid Q96 price');
  return BigInt(Math.floor(scaled));
}

export function fullRangeLiquidityForCapital(input: {
  investmentUsd: number;
  priceWbnbUsd: number;
  currentTick: number;
  token0Decimals?: number;
  token1Decimals?: number;
}): bigint {
  const token0Decimals = input.token0Decimals ?? 18;
  const token1Decimals = input.token1Decimals ?? 18;
  const amounts = calculateFullRangeTokenAmounts(
    input.investmentUsd,
    input.priceWbnbUsd,
    input.currentTick,
    token0Decimals,
    token1Decimals
  );
  return fullRangeLiquidityForAmounts(
    amounts.amount0,
    amounts.amount1,
    sqrtPriceX96AtTick(input.currentTick)
  );
}

function bigintRatio(numerator: bigint, denominator: bigint): number {
  if (denominator <= 0n) throw new Error('Liquidity denominator must be positive');
  const scale = 10n ** 24n;
  return Number((numerator * scale) / denominator) / 1e24;
}

export function projectFullRangeFee24h(input: {
  investmentUsd: number;
  priceWbnbUsd: number;
  currentTick: number;
  activeLiquidity: string;
  volume24h: number;
  poolFeeRate: number;
  protocolFeeShareToken0Bps: number;
  protocolFeeShareToken1Bps: number;
  token0Decimals?: number;
  token1Decimals?: number;
}): number {
  if (!Number.isFinite(input.volume24h) || input.volume24h < 0 || !(input.poolFeeRate > 0)) {
    throw new Error('Fee projection market inputs are invalid');
  }
  const activeLiquidity = requireUint(input.activeLiquidity, 'Active liquidity');
  if (activeLiquidity <= 0n) throw new Error('Active liquidity must be positive');
  for (const share of [input.protocolFeeShareToken0Bps, input.protocolFeeShareToken1Bps]) {
    if (!Number.isInteger(share) || share < 0 || share > 10_000) {
      throw new Error('Protocol fee share must be between 0 and 10000 bps');
    }
  }
  const liquidity = fullRangeLiquidityForCapital(input);
  const share = bigintRatio(liquidity, activeLiquidity + liquidity);
  const protocolFeeShareBps = (input.protocolFeeShareToken0Bps + input.protocolFeeShareToken1Bps) / 2;
  return share * input.volume24h * input.poolFeeRate * (1 - protocolFeeShareBps / 10_000);
}

export function fullRangeFeeGrowthIncrement(input: {
  liquidity: string;
  previousFeeGrowthGlobal0X128: string;
  previousFeeGrowthGlobal1X128: string;
  currentFeeGrowthGlobal0X128: string;
  currentFeeGrowthGlobal1X128: string;
  token0Decimals?: number;
  token1Decimals?: number;
  priceWbnbUsd: number;
}): { token0Fee: number; token1Fee: number; feeUsd: number } {
  const liquidity = requireUint(input.liquidity, 'Liquidity');
  if (liquidity <= 0n) throw new Error('Liquidity must be positive');
  if (!Number.isFinite(input.priceWbnbUsd) || input.priceWbnbUsd <= 0) {
    throw new Error('WBNB price must be positive');
  }
  const delta0 = BigInt(
    feeGrowthDelta(input.currentFeeGrowthGlobal0X128, input.previousFeeGrowthGlobal0X128)
  );
  const delta1 = BigInt(
    feeGrowthDelta(input.currentFeeGrowthGlobal1X128, input.previousFeeGrowthGlobal1X128)
  );
  const amount0Raw = (liquidity * delta0) / Q128;
  const amount1Raw = (liquidity * delta1) / Q128;
  const token0Fee = Number(amount0Raw) / 10 ** (input.token0Decimals ?? 18);
  const token1Fee = Number(amount1Raw) / 10 ** (input.token1Decimals ?? 18);
  const feeUsd = token0Fee + token1Fee * input.priceWbnbUsd;
  if (![token0Fee, token1Fee, feeUsd].every(Number.isFinite) || feeUsd < 0) {
    throw new Error('Fee growth produced an invalid amount');
  }
  return { token0Fee, token1Fee, feeUsd };
}

export function estimateFullRangeFeeBetweenCheckpoints(input: {
  investmentUsd: number;
  entry: FullRangeFeeCheckpoint;
  exit: FullRangeFeeCheckpoint;
  token0Decimals?: number;
  token1Decimals?: number;
}): { liquidity: string; token0Fee: number; token1Fee: number; feeUsd: number } {
  if (input.exit.blockNumber < input.entry.blockNumber) {
    throw new Error('Exit fee checkpoint is older than entry checkpoint');
  }
  const liquidity = fullRangeLiquidityForCapital({
    investmentUsd: input.investmentUsd,
    priceWbnbUsd: input.entry.priceWbnbUsd,
    currentTick: input.entry.currentTick,
    token0Decimals: input.token0Decimals,
    token1Decimals: input.token1Decimals,
  });
  return {
    liquidity: liquidity.toString(),
    ...fullRangeFeeGrowthIncrement({
      liquidity: liquidity.toString(),
      previousFeeGrowthGlobal0X128: input.entry.feeGrowthGlobal0X128,
      previousFeeGrowthGlobal1X128: input.entry.feeGrowthGlobal1X128,
      currentFeeGrowthGlobal0X128: input.exit.feeGrowthGlobal0X128,
      currentFeeGrowthGlobal1X128: input.exit.feeGrowthGlobal1X128,
      token0Decimals: input.token0Decimals,
      token1Decimals: input.token1Decimals,
      priceWbnbUsd: input.exit.priceWbnbUsd,
    }),
  };
}
