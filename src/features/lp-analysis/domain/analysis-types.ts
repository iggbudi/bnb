import type { Pair } from '../../market-data/index.js';

export interface PoolAnalysis {
  pair: Pair;
  metrics: {
    tvl: number;
    volume24h: number;
    volLiqRatio: number;
    estimatedFees24h: number;
    estimatedAPR: number;
    priceChange24h: number;
  };
  interpretation: {
    activity: 'high' | 'medium' | 'low';
    aprLevel: 'high' | 'medium' | 'low';
    ilRisk: 'low' | 'medium' | 'high';
  };
  score: number; // 0-100
}

// ============================================
// 📌 IL Calculator Types
// ============================================

export interface ILCalculation {
  initialPrice: number;
  currentPrice: number;
  priceRatio: number;
  initialInvestment: number;
  holdValue: number;
  lpValue: number;
  ilLoss: number;
  ilPercent: number;
  isProfit: boolean;
}

export interface LPInvestmentProjection {
  investment: number;
  periodHours: 24;
  priceChangePercent: number;
  initialPrice: number;
  currentPrice: number;
  estimatedFee: number;
  holdValue: number;
  lpValueBeforeFee: number;
  lpValueAfterFee: number;
  ilLoss: number;
  ilPercent: number;
  profitLossVsInvestment: number;
  differenceVsHold: number;
}

// ============================================
// 📌 Screening Types
// ============================================

export interface ScreeningFilters {
  minLiquidity?: number;
  minVolume24h?: number;
  maxPriceChange?: number;
  chainFilter?: string;
  dexFilter?: string;
}

export interface ScreeningResult {
  query: string;
  filters: ScreeningFilters;
  totalFound: number;
  pools: PoolAnalysis[];
  bestPool: PoolAnalysis | null;
  averageAPR: number;
}
