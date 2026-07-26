import 'dotenv/config';
import {
  fetchJsonWithRetry,
  SingleFlight,
  UpstreamError,
} from '../../../shared/runtime/upstream-resilience.js';

const DEFAULT_RPC_URL = 'https://bsc-dataseed1.bnbchain.org';
const POOL_ADDRESS = '0x172fcD41E0913e95784454622d1c3724f546f849';
const WBNB_ADDRESS = '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c';
const USDT_ADDRESS = '0x55d398326f99059ff775485246999027b3197955';
const Q128 = 1n << 128n;
const UINT256_MODULUS = 1n << 256n;
const onchainSingleFlight = new SingleFlight();
const RPC_TIMEOUT_MS = 20_000;

const SELECTORS = {
  slot0: '0x3850c7bd',
  liquidity: '0x1a686502',
  feeGrowthGlobal0: '0xf3058399',
  feeGrowthGlobal1: '0x46141319',
  tickSpacing: '0xd0c93a7c',
  fee: '0xddca3f43',
  token0: '0x0dfe1681',
  token1: '0xd21220a7',
  decimals: '0x313ce567',
  ticks: '0xf30dba93',
} as const;

export interface V3TickState {
  tick: number;
  initialized: boolean;
  liquidityGross: string;
  liquidityNet: string;
  feeGrowthOutside0X128: string;
  feeGrowthOutside1X128: string;
}

export interface V3RangeState {
  percent: number;
  tickLower: number;
  tickUpper: number;
  priceLowerUsd: number;
  priceUpperUsd: number;
  inRange: boolean;
  lowerTickInitialized: boolean;
  upperTickInitialized: boolean;
  boundaryCheckpointMode: 'existing_ticks' | 'hypothetical_initialization';
  feeGrowthInside0X128: string;
  feeGrowthInside1X128: string;
}

export interface PancakeV3OnchainState {
  chainId: number;
  poolAddress: string;
  blockNumber: number;
  blockTimestamp: string;
  capturedAt: string;
  token0: string;
  token1: string;
  token0Symbol: 'USDT';
  token1Symbol: 'WBNB';
  token0Decimals: number;
  token1Decimals: number;
  sqrtPriceX96: string;
  currentTick: number;
  tickSpacing: number;
  fee: number;
  feePercent: number;
  protocolFeeShareToken0Bps: number;
  protocolFeeShareToken1Bps: number;
  unlocked: boolean;
  activeLiquidity: string;
  feeGrowthGlobal0X128: string;
  feeGrowthGlobal1X128: string;
  priceWbnbUsd: number;
  ranges: V3RangeState[];
  gas: {
    gasPriceWei: string;
    gasPriceGwei: number;
    assumedMintGasUnits: number;
    assumedRebalanceGasUnits: number;
    estimatedMintCostBnb: number;
    estimatedMintCostUsd: number;
    estimatedRebalanceCostBnb: number;
    estimatedRebalanceCostUsd: number;
    note: string;
  };
  readOnly: true;
}

interface RpcResponse {
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

function stripHex(value: string): string {
  if (!/^0x[0-9a-fA-F]*$/.test(value)) throw new Error('RPC returned invalid hex data');
  return value.slice(2);
}

function words(value: string): string[] {
  const hex = stripHex(value);
  if (hex.length % 64 !== 0) throw new Error('RPC returned malformed ABI data');
  return Array.from({ length: hex.length / 64 }, (_, index) => hex.slice(index * 64, (index + 1) * 64));
}

function uint(word: string): bigint {
  return BigInt(`0x${word}`);
}

function signed(word: string, bits: number): bigint {
  return BigInt.asIntN(bits, uint(word));
}

function address(word: string): string {
  return `0x${word.slice(-40).toLowerCase()}`;
}

export function decodeSlot0(value: string): {
  sqrtPriceX96: bigint;
  tick: number;
  protocolFeeShareToken0Bps: number;
  protocolFeeShareToken1Bps: number;
  unlocked: boolean;
} {
  const decoded = words(value);
  if (decoded.length < 7) throw new Error('slot0 response is incomplete');
  const packedProtocolFee = uint(decoded[5]!);
  return {
    sqrtPriceX96: uint(decoded[0]!),
    tick: Number(signed(decoded[1]!, 24)),
    protocolFeeShareToken0Bps: Number(packedProtocolFee & 0xffffn),
    protocolFeeShareToken1Bps: Number(packedProtocolFee >> 16n),
    unlocked: uint(decoded[6]!) !== 0n,
  };
}

export function encodeTickCall(tick: number): string {
  if (!Number.isInteger(tick) || tick < -887272 || tick > 887272) {
    throw new Error('Tick is outside the supported V3 range');
  }
  const encoded = BigInt.asUintN(256, BigInt(tick)).toString(16).padStart(64, '0');
  return `${SELECTORS.ticks}${encoded}`;
}

export function decodeTickState(tick: number, value: string): V3TickState {
  const decoded = words(value);
  if (decoded.length < 8) throw new Error('ticks response is incomplete');
  return {
    tick,
    liquidityGross: uint(decoded[0]!).toString(),
    liquidityNet: signed(decoded[1]!, 128).toString(),
    feeGrowthOutside0X128: uint(decoded[2]!).toString(),
    feeGrowthOutside1X128: uint(decoded[3]!).toString(),
    initialized: uint(decoded[7]!) !== 0n,
  };
}

function subtractUint256(...values: bigint[]): bigint {
  let result = values[0] ?? 0n;
  for (const value of values.slice(1)) result -= value;
  return ((result % UINT256_MODULUS) + UINT256_MODULUS) % UINT256_MODULUS;
}

export function initializeHypotheticalTick(
  tickState: V3TickState,
  currentTick: number,
  global0: bigint,
  global1: bigint
): V3TickState {
  if (tickState.initialized) return tickState;
  const startsBelowOrAtCurrent = tickState.tick <= currentTick;
  return {
    ...tickState,
    feeGrowthOutside0X128: startsBelowOrAtCurrent ? global0.toString() : '0',
    feeGrowthOutside1X128: startsBelowOrAtCurrent ? global1.toString() : '0',
  };
}

export function feeGrowthInside(
  currentTick: number,
  tickLower: V3TickState,
  tickUpper: V3TickState,
  global0: bigint,
  global1: bigint
): { feeGrowthInside0X128: bigint; feeGrowthInside1X128: bigint } {
  const lowerOutside0 = BigInt(tickLower.feeGrowthOutside0X128);
  const lowerOutside1 = BigInt(tickLower.feeGrowthOutside1X128);
  const upperOutside0 = BigInt(tickUpper.feeGrowthOutside0X128);
  const upperOutside1 = BigInt(tickUpper.feeGrowthOutside1X128);
  const below0 = currentTick >= tickLower.tick ? lowerOutside0 : subtractUint256(global0, lowerOutside0);
  const below1 = currentTick >= tickLower.tick ? lowerOutside1 : subtractUint256(global1, lowerOutside1);
  const above0 = currentTick < tickUpper.tick ? upperOutside0 : subtractUint256(global0, upperOutside0);
  const above1 = currentTick < tickUpper.tick ? upperOutside1 : subtractUint256(global1, upperOutside1);
  return {
    feeGrowthInside0X128: subtractUint256(global0, below0, above0),
    feeGrowthInside1X128: subtractUint256(global1, below1, above1),
  };
}

export function buildTickRanges(
  currentTick: number,
  tickSpacing: number,
  percents = [2, 5, 10]
): Array<{ percent: number; tickLower: number; tickUpper: number }> {
  if (!Number.isInteger(tickSpacing) || tickSpacing <= 0) throw new Error('Invalid tick spacing');
  return percents.map(percent => {
    const lowerOffset = Math.log(1 - percent / 100) / Math.log(1.0001);
    const upperOffset = Math.log(1 + percent / 100) / Math.log(1.0001);
    const tickLower = Math.floor((currentTick + lowerOffset) / tickSpacing) * tickSpacing;
    const tickUpper = Math.ceil((currentTick + upperOffset) / tickSpacing) * tickSpacing;
    return { percent, tickLower, tickUpper };
  });
}

function priceWbnbUsdAtTick(tick: number, token0Decimals: number, token1Decimals: number): number {
  const token1PerToken0 = 1.0001 ** tick * 10 ** (token0Decimals - token1Decimals);
  if (!(token1PerToken0 > 0)) throw new Error('Tick produced an invalid token price');
  return 1 / token1PerToken0;
}

async function rpcBatch(
  rpcUrl: string,
  calls: Array<{ method: string; params: unknown[] }>
): Promise<unknown[]> {
  const payload = calls.map((call, index) => ({
    jsonrpc: '2.0',
    id: index + 1,
    method: call.method,
    params: call.params,
  }));
  const body = await fetchJsonWithRetry<unknown>(
    rpcUrl,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    {
      timeoutMs: RPC_TIMEOUT_MS,
      attempts: 3,
      baseDelayMs: 300,
      maxDelayMs: 2_000,
    }
  );
  if (!Array.isArray(body)) {
    throw new UpstreamError('UPSTREAM_MALFORMED', 'BSC RPC returned a malformed batch response');
  }
  const responses = body as RpcResponse[];
  if (responses.some(item => !item || typeof item !== 'object' || !Number.isInteger(item.id))) {
    throw new UpstreamError('UPSTREAM_MALFORMED', 'BSC RPC returned malformed response entries');
  }
  const byId = new Map(responses.map(item => [item.id, item]));
  return calls.map((_, index) => {
    const item = byId.get(index + 1);
    if (!item || item.result === undefined) {
      throw new UpstreamError('UPSTREAM_MALFORMED', 'BSC RPC response is missing a result');
    }
    if (item.error) {
      throw new UpstreamError('UPSTREAM_HTTP', `BSC RPC call failed with code ${item.error.code}`);
    }
    return item.result;
  });
}

function call(to: string, data: string, block: string): { method: string; params: unknown[] } {
  return { method: 'eth_call', params: [{ to, data }, block] };
}

async function fetchPancakeV3OnchainStateFromRpc(rpcUrl: string): Promise<PancakeV3OnchainState> {
  const [chainHex, blockHex] = (await rpcBatch(rpcUrl, [
    { method: 'eth_chainId', params: [] },
    { method: 'eth_blockNumber', params: [] },
  ])) as [string, string];
  const chainId = Number(BigInt(chainHex));
  if (chainId !== 56) throw new Error(`BSC RPC returned unexpected chain ID ${chainId}`);

  const blockNumber = Number(BigInt(blockHex));
  const initial = (await rpcBatch(rpcUrl, [
    call(POOL_ADDRESS, SELECTORS.slot0, blockHex),
    call(POOL_ADDRESS, SELECTORS.liquidity, blockHex),
    call(POOL_ADDRESS, SELECTORS.feeGrowthGlobal0, blockHex),
    call(POOL_ADDRESS, SELECTORS.feeGrowthGlobal1, blockHex),
    call(POOL_ADDRESS, SELECTORS.tickSpacing, blockHex),
    call(POOL_ADDRESS, SELECTORS.fee, blockHex),
    call(POOL_ADDRESS, SELECTORS.token0, blockHex),
    call(POOL_ADDRESS, SELECTORS.token1, blockHex),
    { method: 'eth_gasPrice', params: [] },
    { method: 'eth_getBlockByNumber', params: [blockHex, false] },
  ])) as [string, string, string, string, string, string, string, string, string, { timestamp: string }];

  const slot0 = decodeSlot0(initial[0]);
  const activeLiquidity = uint(words(initial[1])[0]!).toString();
  const global0 = uint(words(initial[2])[0]!);
  const global1 = uint(words(initial[3])[0]!);
  const tickSpacing = Number(uint(words(initial[4])[0]!));
  const fee = Number(uint(words(initial[5])[0]!));
  const token0 = address(words(initial[6])[0]!);
  const token1 = address(words(initial[7])[0]!);
  if (token0 !== USDT_ADDRESS || token1 !== WBNB_ADDRESS) {
    throw new Error(`Configured pool tokens are unexpected: ${token0}/${token1}`);
  }

  const decimalsResult = (await rpcBatch(rpcUrl, [
    call(token0, SELECTORS.decimals, blockHex),
    call(token1, SELECTORS.decimals, blockHex),
  ])) as [string, string];
  const token0Decimals = Number(uint(words(decimalsResult[0])[0]!));
  const token1Decimals = Number(uint(words(decimalsResult[1])[0]!));
  const priceWbnbUsd = priceWbnbUsdAtTick(slot0.tick, token0Decimals, token1Decimals);
  const baseRanges = buildTickRanges(slot0.tick, tickSpacing);
  const tickCalls = baseRanges.flatMap(range => [
    call(POOL_ADDRESS, encodeTickCall(range.tickLower), blockHex),
    call(POOL_ADDRESS, encodeTickCall(range.tickUpper), blockHex),
  ]);
  const tickResults = (await rpcBatch(rpcUrl, tickCalls)) as string[];
  const ranges = baseRanges.map((range, index): V3RangeState => {
    const lower = decodeTickState(range.tickLower, tickResults[index * 2]!);
    const upper = decodeTickState(range.tickUpper, tickResults[index * 2 + 1]!);
    const lowerCheckpoint = initializeHypotheticalTick(lower, slot0.tick, global0, global1);
    const upperCheckpoint = initializeHypotheticalTick(upper, slot0.tick, global0, global1);
    const inside = feeGrowthInside(slot0.tick, lowerCheckpoint, upperCheckpoint, global0, global1);
    const boundaryPrices = [
      priceWbnbUsdAtTick(range.tickLower, token0Decimals, token1Decimals),
      priceWbnbUsdAtTick(range.tickUpper, token0Decimals, token1Decimals),
    ];
    return {
      ...range,
      priceLowerUsd: Math.min(...boundaryPrices),
      priceUpperUsd: Math.max(...boundaryPrices),
      inRange: slot0.tick >= range.tickLower && slot0.tick < range.tickUpper,
      lowerTickInitialized: lower.initialized,
      upperTickInitialized: upper.initialized,
      boundaryCheckpointMode:
        lower.initialized && upper.initialized ? 'existing_ticks' : 'hypothetical_initialization',
      feeGrowthInside0X128: inside.feeGrowthInside0X128.toString(),
      feeGrowthInside1X128: inside.feeGrowthInside1X128.toString(),
    };
  });

  const gasPriceWei = BigInt(initial[8]);
  const gasPriceGwei = Number(gasPriceWei) / 1e9;
  const mintGas = 500_000;
  const rebalanceGas = 800_000;
  const mintCostBnb = Number(gasPriceWei * BigInt(mintGas)) / 1e18;
  const rebalanceCostBnb = Number(gasPriceWei * BigInt(rebalanceGas)) / 1e18;
  const blockTimestamp = new Date(Number(BigInt(initial[9].timestamp)) * 1_000).toISOString();

  return {
    chainId,
    poolAddress: POOL_ADDRESS,
    blockNumber,
    blockTimestamp,
    capturedAt: new Date().toISOString(),
    token0,
    token1,
    token0Symbol: 'USDT',
    token1Symbol: 'WBNB',
    token0Decimals,
    token1Decimals,
    sqrtPriceX96: slot0.sqrtPriceX96.toString(),
    currentTick: slot0.tick,
    tickSpacing,
    fee,
    feePercent: (fee / 1_000_000) * 100,
    protocolFeeShareToken0Bps: slot0.protocolFeeShareToken0Bps,
    protocolFeeShareToken1Bps: slot0.protocolFeeShareToken1Bps,
    unlocked: slot0.unlocked,
    activeLiquidity,
    feeGrowthGlobal0X128: global0.toString(),
    feeGrowthGlobal1X128: global1.toString(),
    priceWbnbUsd,
    ranges,
    gas: {
      gasPriceWei: gasPriceWei.toString(),
      gasPriceGwei,
      assumedMintGasUnits: mintGas,
      assumedRebalanceGasUnits: rebalanceGas,
      estimatedMintCostBnb: mintCostBnb,
      estimatedMintCostUsd: mintCostBnb * priceWbnbUsd,
      estimatedRebalanceCostBnb: rebalanceCostBnb,
      estimatedRebalanceCostUsd: rebalanceCostBnb * priceWbnbUsd,
      note: 'Gas units are conservative assumptions, not eth_estimateGas for a prepared transaction.',
    },
    readOnly: true,
  };
}

export function fetchPancakeV3OnchainState(
  rpcUrl = process.env.BSC_RPC_URL || DEFAULT_RPC_URL
): Promise<PancakeV3OnchainState> {
  return onchainSingleFlight.run(rpcUrl, async () => {
    try {
      return await fetchPancakeV3OnchainStateFromRpc(rpcUrl);
    } catch (error) {
      if (error instanceof UpstreamError) throw error;
      throw new UpstreamError(
        'UPSTREAM_MALFORMED',
        'BSC RPC returned malformed chain or ABI data',
        undefined,
        { cause: error }
      );
    }
  });
}

export function feeGrowthDelta(current: string, previous: string): string {
  return subtractUint256(BigInt(current), BigInt(previous)).toString();
}

export function feeGrowthX128ToTokenPerLiquidity(value: string): number {
  return Number(BigInt(value)) / Number(Q128);
}
