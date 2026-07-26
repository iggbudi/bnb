import { feeGrowthDelta } from '../../market-data/index.js';

const Q128 = 1n << 128n;

export interface ConcentratedAmounts {
  amount0Tokens: number;
  amount1Tokens: number;
  valueUsd: number;
}

export interface ConcentratedPositionDefinition extends ConcentratedAmounts {
  liquidity: string;
  tickLower: number;
  tickUpper: number;
  priceLowerUsd: number;
  priceUpperUsd: number;
}

function requireFinitePositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be positive`);
}

function requireTickRange(tickLower: number, tickUpper: number): void {
  if (!Number.isInteger(tickLower) || !Number.isInteger(tickUpper) || tickLower >= tickUpper) {
    throw new Error('Concentrated tick range is invalid');
  }
}

export function sqrtRatioAtTick(tick: number): number {
  if (!Number.isInteger(tick) || tick < -887272 || tick > 887272) {
    throw new Error('Tick is outside the supported V3 range');
  }
  return 1.0001 ** (tick / 2);
}

export function concentratedRangePrices(
  tickLower: number,
  tickUpper: number
): { priceLowerUsd: number; priceUpperUsd: number } {
  requireTickRange(tickLower, tickUpper);
  const prices = [1 / sqrtRatioAtTick(tickLower) ** 2, 1 / sqrtRatioAtTick(tickUpper) ** 2];
  return {
    priceLowerUsd: Math.min(...prices),
    priceUpperUsd: Math.max(...prices),
  };
}

export function concentratedAmountsAtPrice(input: {
  liquidity: string;
  tickLower: number;
  tickUpper: number;
  priceUsd: number;
  token0Decimals?: number;
  token1Decimals?: number;
}): ConcentratedAmounts {
  requireFinitePositive(input.priceUsd, 'Price');
  requireTickRange(input.tickLower, input.tickUpper);
  const token0Decimals = input.token0Decimals ?? 18;
  const token1Decimals = input.token1Decimals ?? 18;
  if (token0Decimals !== token1Decimals) {
    throw new Error('Concentrated paper accounting currently requires equal token decimals');
  }
  const liquidityRaw = BigInt(input.liquidity);
  if (liquidityRaw <= 0n) throw new Error('Position liquidity must be positive');

  const liquidityTokens = Number(liquidityRaw) / 10 ** token0Decimals;
  const sqrtLower = sqrtRatioAtTick(input.tickLower);
  const sqrtUpper = sqrtRatioAtTick(input.tickUpper);
  const sqrtPrice = 1 / Math.sqrt(input.priceUsd);
  let amount0Tokens: number;
  let amount1Tokens: number;

  if (sqrtPrice <= sqrtLower) {
    amount0Tokens = (liquidityTokens * (sqrtUpper - sqrtLower)) / (sqrtLower * sqrtUpper);
    amount1Tokens = 0;
  } else if (sqrtPrice >= sqrtUpper) {
    amount0Tokens = 0;
    amount1Tokens = liquidityTokens * (sqrtUpper - sqrtLower);
  } else {
    amount0Tokens = (liquidityTokens * (sqrtUpper - sqrtPrice)) / (sqrtPrice * sqrtUpper);
    amount1Tokens = liquidityTokens * (sqrtPrice - sqrtLower);
  }

  return {
    amount0Tokens,
    amount1Tokens,
    valueUsd: amount0Tokens + amount1Tokens * input.priceUsd,
  };
}

export function concentratedPositionForCapital(input: {
  capitalUsd: number;
  priceUsd: number;
  tickLower: number;
  tickUpper: number;
  tokenDecimals?: number;
}): ConcentratedPositionDefinition {
  requireFinitePositive(input.capitalUsd, 'Capital');
  requireFinitePositive(input.priceUsd, 'Price');
  requireTickRange(input.tickLower, input.tickUpper);
  const tokenDecimals = input.tokenDecimals ?? 18;
  const sqrtLower = sqrtRatioAtTick(input.tickLower);
  const sqrtUpper = sqrtRatioAtTick(input.tickUpper);
  const sqrtPrice = 1 / Math.sqrt(input.priceUsd);
  if (!(sqrtPrice > sqrtLower && sqrtPrice < sqrtUpper)) {
    throw new Error('Entry price must be inside the concentrated range');
  }

  const amount0PerLiquidity = (sqrtUpper - sqrtPrice) / (sqrtPrice * sqrtUpper);
  const amount1PerLiquidity = sqrtPrice - sqrtLower;
  const capitalPerLiquidity = amount0PerLiquidity + amount1PerLiquidity * input.priceUsd;
  if (!(capitalPerLiquidity > 0)) throw new Error('Concentrated range produced invalid liquidity');
  const liquidityTokens = input.capitalUsd / capitalPerLiquidity;
  const liquidityRaw = BigInt(Math.floor(liquidityTokens * 10 ** tokenDecimals));
  if (liquidityRaw <= 0n) throw new Error('Concentrated position liquidity is zero');
  const amounts = concentratedAmountsAtPrice({
    liquidity: liquidityRaw.toString(),
    tickLower: input.tickLower,
    tickUpper: input.tickUpper,
    priceUsd: input.priceUsd,
    token0Decimals: tokenDecimals,
    token1Decimals: tokenDecimals,
  });

  return {
    ...amounts,
    liquidity: liquidityRaw.toString(),
    tickLower: input.tickLower,
    tickUpper: input.tickUpper,
    ...concentratedRangePrices(input.tickLower, input.tickUpper),
  };
}

export function feeGrowthIncrementUsd(input: {
  liquidity: string;
  previousFeeGrowth0X128: string;
  previousFeeGrowth1X128: string;
  currentFeeGrowth0X128: string;
  currentFeeGrowth1X128: string;
  token0Decimals: number;
  token1Decimals: number;
  priceToken1Usd: number;
  occupancyFactor?: number;
}): { token0Fee: number; token1Fee: number; feeUsd: number } {
  requireFinitePositive(input.priceToken1Usd, 'Token1 price');
  const liquidity = BigInt(input.liquidity);
  if (liquidity <= 0n) throw new Error('Position liquidity must be positive');
  const occupancyFactor = input.occupancyFactor ?? 1;
  if (!Number.isFinite(occupancyFactor) || occupancyFactor < 0 || occupancyFactor > 1) {
    throw new Error('Occupancy factor must be between zero and one');
  }

  const delta0 = BigInt(feeGrowthDelta(input.currentFeeGrowth0X128, input.previousFeeGrowth0X128));
  const delta1 = BigInt(feeGrowthDelta(input.currentFeeGrowth1X128, input.previousFeeGrowth1X128));
  const amount0Raw = (liquidity * delta0) / Q128;
  const amount1Raw = (liquidity * delta1) / Q128;
  const token0Fee = (Number(amount0Raw) / 10 ** input.token0Decimals) * occupancyFactor;
  const token1Fee = (Number(amount1Raw) / 10 ** input.token1Decimals) * occupancyFactor;
  return {
    token0Fee,
    token1Fee,
    feeUsd: token0Fee + token1Fee * input.priceToken1Usd,
  };
}
