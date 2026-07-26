import type { OnchainStore } from '../infrastructure/onchain-store.js';
import type { SnapshotStore } from '../infrastructure/snapshot-store.js';
import type { Pair } from '../domain/market-types.js';
import {
  feeGrowthDelta,
  feeGrowthX128ToTokenPerLiquidity,
  fetchPancakeV3OnchainState,
} from '../infrastructure/pancakeswap-v3-onchain.js';
import { getPoolByAddress } from '../infrastructure/dexscreener.js';

export const WBNB_USDT_CHAIN_ID = 'bsc';
export const WBNB_USDT_POOL_ADDRESS = '0x172fcD41E0913e95784454622d1c3724f546f849';
export const WBNB_USDT_FEE_RATE = 0.0001;

export interface WbnbUsdtAnalysis {
  price: number;
  tvl: number;
  volume24h: number;
  volume6h: number;
  volume1h: number;
  volLiqRatio: number;
  estimatedFees24h: number;
  estimatedAPR: number;
  priceChange1h: number;
  priceChange6h: number;
  priceChange24h: number;
  txns24h: { buys: number; sells: number };
  wbnbInPool: number;
  usdtInPool: number;
  pairAddress: string;
}

export interface OnchainHealth {
  ready: boolean;
  lastSuccessAt: string | null;
  lastError: string | null;
}

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

export class MarketDataService {
  private readonly cache = new Map<string, CacheEntry<unknown>>();
  private onchainHealth: OnchainHealth = { ready: false, lastSuccessAt: null, lastError: null };

  constructor(
    private readonly snapshotStore: SnapshotStore,
    private readonly onchainStore: OnchainStore,
    private readonly cacheTtlMs = 60_000
  ) {}

  private getCached<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > this.cacheTtlMs) {
      this.cache.delete(key);
      return null;
    }
    return entry.data as T;
  }

  private setCache<T>(key: string, data: T): void {
    this.cache.set(key, { data, timestamp: Date.now() });
  }

  async getPair(): Promise<Pair> {
    const cached = this.getCached<Pair>('wbnbusdt');
    if (cached) return cached;

    const pair = await getPoolByAddress(WBNB_USDT_CHAIN_ID, WBNB_USDT_POOL_ADDRESS);
    if (
      !pair ||
      pair.chainId !== WBNB_USDT_CHAIN_ID ||
      pair.dexId !== 'pancakeswap' ||
      pair.baseToken?.symbol !== 'WBNB' ||
      pair.quoteToken?.symbol !== 'USDT' ||
      !pair.labels?.includes('v3')
    ) {
      throw new Error('Configured PancakeSwap V3 WBNB/USDT 0.01% pool is unavailable');
    }

    this.setCache('wbnbusdt', pair);
    return pair;
  }

  analyzePair(pair: Pair): WbnbUsdtAnalysis {
    const price = Number.parseFloat(pair.priceUsd);
    const tvl = pair.liquidity?.usd || 0;
    const volume24h = pair.volume?.h24 || 0;
    const volume6h = pair.volume?.h6 || 0;
    const volume1h = pair.volume?.h1 || 0;
    const estimatedFees24h = volume24h * WBNB_USDT_FEE_RATE;

    return {
      price,
      tvl,
      volume24h,
      volume6h,
      volume1h,
      volLiqRatio: tvl > 0 ? volume24h / tvl : 0,
      estimatedFees24h,
      estimatedAPR: tvl > 0 ? ((estimatedFees24h * 365) / tvl) * 100 : 0,
      priceChange1h: pair.priceChange?.h1 || 0,
      priceChange6h: pair.priceChange?.h6 || 0,
      priceChange24h: pair.priceChange?.h24 || 0,
      txns24h: pair.txns?.h24 || { buys: 0, sells: 0 },
      wbnbInPool: pair.liquidity?.base || 0,
      usdtInPool: pair.liquidity?.quote || 0,
      pairAddress: pair.pairAddress,
    };
  }

  async capturePoolSnapshot(): Promise<WbnbUsdtAnalysis> {
    const analysis = this.analyzePair(await this.getPair());
    this.snapshotStore.save(analysis);
    return analysis;
  }

  async captureOnchainPoolState() {
    const cached = this.getCached<
      Awaited<ReturnType<typeof fetchPancakeV3OnchainState>> & {
        historyDelta: Record<string, unknown> | null;
      }
    >('pancake-v3-onchain');
    if (cached) return cached;

    try {
      const state = await fetchPancakeV3OnchainState();
      this.onchainStore.saveIfAbsent(state);
      const snapshots = this.onchainStore.getRecent(2);
      const previous = snapshots.find(snapshot => snapshot.blockNumber !== state.blockNumber);
      const historyDelta = previous
        ? (() => {
            const delta0 = feeGrowthDelta(state.feeGrowthGlobal0X128, previous.feeGrowthGlobal0X128);
            const delta1 = feeGrowthDelta(state.feeGrowthGlobal1X128, previous.feeGrowthGlobal1X128);
            return {
              previousBlockNumber: previous.blockNumber,
              previousCapturedAt: previous.capturedAt,
              elapsedSeconds: Math.max(
                0,
                (new Date(state.blockTimestamp).getTime() - new Date(previous.blockTimestamp).getTime()) /
                  1_000
              ),
              feeGrowthGlobal0DeltaX128: delta0,
              feeGrowthGlobal1DeltaX128: delta1,
              token0PerLiquidity: feeGrowthX128ToTokenPerLiquidity(delta0),
              token1PerLiquidity: feeGrowthX128ToTokenPerLiquidity(delta1),
            };
          })()
        : null;
      const result = { ...state, historyDelta };
      this.setCache('pancake-v3-onchain', result);
      this.onchainHealth = { ready: true, lastSuccessAt: state.capturedAt, lastError: null };
      return result;
    } catch (error) {
      this.onchainHealth = {
        ...this.onchainHealth,
        ready: false,
        lastError: error instanceof Error ? error.message : 'Unknown on-chain error',
      };
      throw error;
    }
  }

  getOnchainHealth(): Readonly<OnchainHealth> {
    return this.onchainHealth;
  }
}
