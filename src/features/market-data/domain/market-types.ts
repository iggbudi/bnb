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
