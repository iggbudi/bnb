/**
 * ============================================
 * 📚 BNB LP Analyzer - DexScreener API Service
 * ============================================
 *
 * Service untuk mengambil data dari DexScreener API
 * Dokumentasi: https://docs.dexscreener.com/api/reference
 *
 * API ini gratis dan tidak perlu API key!
 */

import type { DexScreenerResponse, Pair } from '../domain/market-types.js';
import { fetchJsonWithRetry, SingleFlight } from '../../../shared/runtime/upstream-resilience.js';

const DEXSCREENER_API = 'https://api.dexscreener.com';
const requestSingleFlight = new SingleFlight();
const REQUEST_TIMEOUT_MS = 10_000;

// ============================================
// 📌 Helper: Fetch dengan error handling
// ============================================

async function fetchApi<T>(url: string): Promise<T> {
  return requestSingleFlight.run(url, () =>
    fetchJsonWithRetry<T>(
      url,
      {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'AMM-Viewer/1.0',
        },
      },
      {
        timeoutMs: REQUEST_TIMEOUT_MS,
        attempts: 3,
        baseDelayMs: 250,
        maxDelayMs: 1_500,
      }
    )
  );
}

// ============================================
// 📌 SEARCH TOKEN
// ============================================
//
// Cari token berdasarkan nama/symbol
// Contoh: "BNB", "CAKE", "USDT"

export async function searchToken(query: string): Promise<Pair[]> {
  const url = `${DEXSCREENER_API}/latest/dex/search?q=${encodeURIComponent(query)}`;
  const data = await fetchApi<DexScreenerResponse>(url);
  return data.pairs || [];
}

// ============================================
// 📌 GET TOKEN DETAILS
// ============================================
//
// Ambil detail token berdasarkan contract address

export async function getTokenDetails(tokenAddress: string): Promise<Pair[]> {
  const url = `${DEXSCREENER_API}/latest/dex/tokens/${tokenAddress}`;
  const data = await fetchApi<DexScreenerResponse>(url);
  return data.pairs || [];
}

// ============================================
// 📌 GET POOL BY ADDRESS
// ============================================
//
// Ambil detail pool berdasarkan pair address

export async function getPoolByAddress(chainId: string, pairAddress: string): Promise<Pair | null> {
  const url = `${DEXSCREENER_API}/latest/dex/pairs/${chainId}/${pairAddress}`;
  const data = await fetchApi<DexScreenerResponse>(url);
  return data.pairs?.[0] || null;
}

// ============================================
// 📌 GET TRENDING POOLS
// ============================================
//
// Ambil pool yang sedang trending
// Catatan: DexScreener tidak punya endpoint trending langsung
// Kita pakai search dengan query populer

export async function getTrendingPools(): Promise<Pair[]> {
  // Search beberapa token populer
  const popularTokens = ['BNB', 'CAKE', 'USDT', 'USDC', 'BTCB'];
  const allPairs: Pair[] = [];

  for (const token of popularTokens) {
    try {
      const pairs = await searchToken(token);
      allPairs.push(...pairs.slice(0, 5)); // Ambil 5 teratas
    } catch (error) {
      console.error(`Error fetching ${token}:`, error);
    }
  }

  // Remove duplicates berdasarkan pairAddress
  const uniquePairs = allPairs.filter(
    (pair, index, self) => index === self.findIndex(p => p.pairAddress === pair.pairAddress)
  );

  return uniquePairs;
}

// ============================================
// 📌 FILTER: PancakeSwap Only
// ============================================

export function filterPancakeSwap(pairs: Pair[]): Pair[] {
  return pairs.filter(pair => pair.dexId === 'pancakeswap');
}

// ============================================
// 📌 FILTER: By Chain
// ============================================

export function filterByChain(pairs: Pair[], chainId: string): Pair[] {
  return pairs.filter(pair => pair.chainId === chainId);
}

// ============================================
// 📌 SORT: By Volume
// ============================================

export function sortByVolume(pairs: Pair[], ascending = false): Pair[] {
  return [...pairs].sort((a, b) => {
    const volA = a.volume?.h24 || 0;
    const volB = b.volume?.h24 || 0;
    return ascending ? volA - volB : volB - volA;
  });
}

// ============================================
// 📌 SORT: By Liquidity
// ============================================

export function sortByLiquidity(pairs: Pair[], ascending = false): Pair[] {
  return [...pairs].sort((a, b) => {
    const liqA = a.liquidity?.usd || 0;
    const liqB = b.liquidity?.usd || 0;
    return ascending ? liqA - liqB : liqB - liqA;
  });
}
