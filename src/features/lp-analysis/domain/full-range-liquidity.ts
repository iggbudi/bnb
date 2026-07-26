const MIN_TICK = -887272;
const MAX_TICK = 887272;
const Q96 = 1n << 96n;
const MIN_SQRT_RATIO = 4_295_128_739n;
const MAX_SQRT_RATIO = 1_461_446_703_485_210_103_287_273_052_203_988_822_378_723_970_342n;

function decimalToUnits(value: number, decimals: number): bigint {
  if (!Number.isFinite(value) || value <= 0) throw new Error('Token amount must be positive');
  const precision = Math.min(decimals, 12);
  const [whole, fraction = ''] = value.toFixed(precision).split('.');
  return BigInt(whole!) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0'));
}

export function fullRangeLiquidityForAmounts(amount0: bigint, amount1: bigint, sqrtPriceX96: bigint): bigint {
  if (amount0 <= 0n || amount1 <= 0n) throw new Error('Full-range token amounts must be positive');
  if (sqrtPriceX96 <= MIN_SQRT_RATIO || sqrtPriceX96 >= MAX_SQRT_RATIO) {
    throw new Error('Current sqrt price is outside the full-range boundaries');
  }

  const liquidity0 = (amount0 * sqrtPriceX96 * MAX_SQRT_RATIO) / (MAX_SQRT_RATIO - sqrtPriceX96) / Q96;
  const liquidity1 = (amount1 * Q96) / (sqrtPriceX96 - MIN_SQRT_RATIO);
  const liquidity = liquidity0 < liquidity1 ? liquidity0 : liquidity1;
  if (liquidity <= 0n) throw new Error('Full-range position liquidity is zero');
  return liquidity;
}

export function calculateFullRangeTokenAmounts(
  amountUsd: number,
  priceWbnbUsd: number,
  currentTick: number,
  token0Decimals = 18,
  token1Decimals = 18
): { amount0: bigint; amount1: bigint; amount0Tokens: number; amount1Tokens: number } {
  if (!(amountUsd > 0) || !(priceWbnbUsd > 0)) throw new Error('Capital and price must be positive');
  const sqrtA = 1.0001 ** (MIN_TICK / 2);
  const sqrtP = 1.0001 ** (currentTick / 2);
  const sqrtB = 1.0001 ** (MAX_TICK / 2);
  if (!(sqrtA < sqrtP && sqrtP < sqrtB)) throw new Error('Current tick is outside full range');

  const amount0PerLiquidity = (sqrtB - sqrtP) / (sqrtP * sqrtB);
  const amount1PerLiquidity = sqrtP - sqrtA;
  const liquidity = amountUsd / (amount0PerLiquidity + amount1PerLiquidity * priceWbnbUsd);
  const amount0Tokens = liquidity * amount0PerLiquidity;
  const amount1Tokens = liquidity * amount1PerLiquidity;
  return {
    amount0: decimalToUnits(amount0Tokens, token0Decimals),
    amount1: decimalToUnits(amount1Tokens, token1Decimals),
    amount0Tokens,
    amount1Tokens,
  };
}
