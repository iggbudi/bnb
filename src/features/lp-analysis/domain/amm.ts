/**
 * ============================================
 * 📚 BNB LP Analyzer - Core Analysis Functions
 * ============================================
 *
 * File ini berisi logika inti untuk:
 * 1. Menghitung Impermanent Loss
 * 2. Menganalisis pool
 * 3. Screening pools
 *
 * Dipisah dari server supaya bisa dipakai di mana saja
 */

import type {
  Pair,
  PoolAnalysis,
  ILCalculation,
  LPInvestmentProjection,
  ScreeningFilters,
  ScreeningResult,
} from '../../../types.js';

// ============================================
// 📌 IMPERMANENT LOSS CALCULATOR
// ============================================
//
// IL terjadi ketika harga token berubah saat LP
// Rumus: IL = 2 × √(priceRatio) / (1 + priceRatio) - 1
//
// Contoh:
// - Harga naik 2x → IL = 5.7%
// - Harga naik 3x → IL = 13.4%
// - Harga naik 5x → IL = 25.5%

export function calculateIL(
  initialPrice: number,
  currentPrice: number,
  initialInvestment: number
): ILCalculation {
  const priceRatio = currentPrice / initialPrice;
  const sqrtRatio = Math.sqrt(priceRatio);

  // Rumus IL
  const ilPercent = Math.abs((2 * sqrtRatio) / (1 + priceRatio) - 1) * 100;

  // Nilai portfolio 50/50 jika aset hanya di-hold.
  // Separuh modal tetap dalam quote token, separuh mengikuti perubahan harga.
  const holdValue = (initialInvestment * (1 + priceRatio)) / 2;

  // Nilai LP constant-product full-range, sebelum fee.
  const lpValue = initialInvestment * sqrtRatio;

  // Underperformance LP terhadap strategi hold (selalu >= 0 untuk input valid).
  const ilLoss = holdValue - lpValue;

  return {
    initialPrice,
    currentPrice,
    priceRatio,
    initialInvestment,
    holdValue,
    lpValue,
    ilLoss,
    ilPercent,
    isProfit: lpValue > initialInvestment,
  };
}

export function calculateLPInvestmentProjection(
  investment: number,
  currentPrice: number,
  priceChangePercent: number,
  estimatedFee24h: number
): LPInvestmentProjection {
  const priceRatio = 1 + priceChangePercent / 100;
  if (investment <= 0 || currentPrice <= 0 || priceRatio <= 0 || estimatedFee24h < 0) {
    throw new Error('Investment projection inputs must be valid positive values');
  }

  const initialPrice = currentPrice / priceRatio;
  const il = calculateIL(initialPrice, currentPrice, investment);
  const lpValueAfterFee = il.lpValue + estimatedFee24h;

  return {
    investment,
    periodHours: 24,
    priceChangePercent,
    initialPrice,
    currentPrice,
    estimatedFee: estimatedFee24h,
    holdValue: il.holdValue,
    lpValueBeforeFee: il.lpValue,
    lpValueAfterFee,
    ilLoss: il.ilLoss,
    ilPercent: il.ilPercent,
    profitLossVsInvestment: lpValueAfterFee - investment,
    differenceVsHold: lpValueAfterFee - il.holdValue,
  };
}

// ============================================
// 📌 POOL ANALYSIS
// ============================================
//
// Analisis pool berdasarkan metric penting:
// - TVL (Total Value Locked)
// - Volume/TVL Ratio
// - Estimasi Fee & APR
// - Price Change (IL risk)

export function analyzePool(pair: Pair): PoolAnalysis {
  const tvl = pair.liquidity?.usd || 0;
  const volume24h = pair.volume?.h24 || 0;
  const priceChange24h = pair.priceChange?.h24 || 0;

  // Volume/Liquidity ratio
  // Semakin tinggi = semakin aktif = fee lebih besar
  const volLiqRatio = tvl > 0 ? volume24h / tvl : 0;

  // Fee estimation (asumsi 0.3% fee tier)
  const estimatedFees24h = volume24h * 0.003;

  // APR estimation
  // (Fee harian × 365) / TVL × 100
  const estimatedAPR = tvl > 0 ? ((estimatedFees24h * 365) / tvl) * 100 : 0;

  // Interpretasi
  const activity: PoolAnalysis['interpretation']['activity'] =
    volLiqRatio > 1 ? 'high' : volLiqRatio > 0.5 ? 'medium' : 'low';

  const aprLevel: PoolAnalysis['interpretation']['aprLevel'] =
    estimatedAPR > 50 ? 'high' : estimatedAPR > 20 ? 'medium' : 'low';

  const ilRisk: PoolAnalysis['interpretation']['ilRisk'] =
    Math.abs(priceChange24h) < 5 ? 'low' : Math.abs(priceChange24h) < 20 ? 'medium' : 'high';

  // Score (0-100)
  // Kombinasi dari APR, activity, dan IL risk
  let score = 0;

  // APR contribution (max 40)
  score += Math.min(40, estimatedAPR * 0.4);

  // Activity contribution (max 30)
  score += Math.min(30, volLiqRatio * 10);

  // IL risk penalty (max -30)
  score -= Math.abs(priceChange24h) * 0.5;

  // Clamp 0-100
  score = Math.max(0, Math.min(100, score));

  return {
    pair,
    metrics: {
      tvl,
      volume24h,
      volLiqRatio,
      estimatedFees24h,
      estimatedAPR,
      priceChange24h,
    },
    interpretation: {
      activity,
      aprLevel,
      ilRisk,
    },
    score,
  };
}

// ============================================
// 📌 POOL SCREENING
// ============================================
//
// Filter pools berdasarkan kriteria
// Implementasi dari strategi screening di postingan

export function screenPools(pairs: Pair[], filters: ScreeningFilters = {}): ScreeningResult {
  const {
    minLiquidity = 100000, // $100k default
    minVolume24h = 50000, // $50k default
    maxPriceChange = 100, // Max 100% change
    chainFilter,
    dexFilter,
  } = filters;

  // Filter pairs
  const filteredPairs = pairs.filter(pair => {
    const liquidity = pair.liquidity?.usd || 0;
    const volume24h = pair.volume?.h24 || 0;
    const priceChange = Math.abs(pair.priceChange?.h24 || 0);

    // Filter liquidity
    if (liquidity < minLiquidity) return false;

    // Filter volume
    if (volume24h < minVolume24h) return false;

    // Filter price change (terlalu volatile = IL besar)
    if (priceChange > maxPriceChange) return false;

    // Filter chain
    if (chainFilter && pair.chainId !== chainFilter) return false;

    // Filter DEX
    if (dexFilter && pair.dexId !== dexFilter) return false;

    return true;
  });

  // Analyze each pool
  const analyses = filteredPairs.map(pair => analyzePool(pair));

  // Sort by score
  analyses.sort((a, b) => b.score - a.score);

  // Find best pool
  const bestPool = analyses.length > 0 ? analyses[0] : null;

  // Calculate average APR
  const averageAPR =
    analyses.length > 0 ? analyses.reduce((sum, a) => sum + a.metrics.estimatedAPR, 0) / analyses.length : 0;

  return {
    query: '', // Will be set by caller
    filters,
    totalFound: analyses.length,
    pools: analyses,
    bestPool,
    averageAPR,
  };
}
