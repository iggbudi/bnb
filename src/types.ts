/**
 * ============================================
 * 📚 BNB LP Analyzer - TypeScript Types
 * ============================================
 *
 * File ini berisi semua tipe data yang digunakan
 * TypeScript membantu kita mengetahui bentuk data
 * sebelum runtime → lebih aman, lebih jelas
 */

// ============================================
// 📌 DexScreener API Types
// ============================================
// Tipe data dari DexScreener API
// Dokumentasi: https://docs.dexscreener.com/api/reference

export interface Token {
  address: string;
  name: string;
  symbol: string;
}

export interface PriceChange {
  h1: number;
  h6: number;
  h24: number;
}

export interface Volume {
  h1: number;
  h6: number;
  h24: number;
}

export interface Liquidity {
  usd: number;
  base: number;
  quote: number;
}

export interface TransactionCount {
  buys: number;
  sells: number;
}

export interface PairTransactions {
  h24?: TransactionCount;
}

export interface Pair {
  chainId: string;
  dexId: string;
  pairAddress: string;
  baseToken: Token;
  quoteToken: Token;
  priceNative: string;
  priceUsd: string;
  priceChange: PriceChange;
  volume: Volume;
  liquidity: Liquidity;
  txns?: PairTransactions;
  labels?: string[];
  fdv: number;
  pairCreatedAt: number;
}

export interface DexScreenerResponse {
  pairs: Pair[];
}

// ============================================
// 📌 Analysis Types
// ============================================
// Tipe data hasil analisis pool

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

// ============================================
// 📌 API Response Types
// ============================================

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: string;
}
