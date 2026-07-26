import 'dotenv/config';
import { PANCAKE_V3_POSITION_MANAGER } from './pancakeswap-v3-execution.js';
import type { PancakeV3OnchainState } from '../../market-data/index.js';
import type { PancakeV3PositionState } from './pancakeswap-v3-position-tracker.js';

const DEFAULT_RPC_URL = 'https://bsc-dataseed1.bnbchain.org';
const WBNB_ADDRESS = '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c';
const USDT_ADDRESS = '0x55d398326f99059ff775485246999027b3197955';
export const PANCAKE_V3_SWAP_ROUTER = '0x1b81d678ffb9c0263b24a97847620c99d213eb14';
const DECREASE_LIQUIDITY_SELECTOR = '0c49ccbe';
const COLLECT_SELECTOR = 'fc6f7865';
const BURN_SELECTOR = '42966c68';
const APPROVE_SELECTOR = '095ea7b3';
const ALLOWANCE_SELECTOR = 'dd62ed3e';
const EXACT_INPUT_SINGLE_SELECTOR = '414bf389';
const Q96 = 1n << 96n;
const Q192 = 1n << 192n;
const MIN_SQRT_RATIO = 4_295_128_739n;
const MAX_SQRT_RATIO = 1_461_446_703_485_210_103_287_273_052_203_988_822_378_723_970_342n;
const MAX_UINT128 = (1n << 128n) - 1n;

export type UnsignedExitPurpose =
  'APPROVE_WBNB_SWAP' | 'DECREASE_LIQUIDITY' | 'COLLECT' | 'BURN' | 'SWAP_WBNB_TO_USDT';

export interface UnsignedExitTransaction {
  purpose: UnsignedExitPurpose;
  to: string;
  data: string;
  value: '0x0';
}

export interface FullRangeExitPlan {
  chainId: 56;
  positionManager: string;
  swapRouter: string | null;
  wallet: string;
  tokenId: string;
  liquidity: string;
  slippageBps: number;
  deadline: number;
  burnAfterCollect: boolean;
  swapWbnbToUsdt: boolean;
  expectedAmount0: string;
  expectedAmount1: string;
  amount0Min: string;
  amount1Min: string;
  swapAmountIn: string | null;
  swapAmountOutMin: string | null;
  transactions: UnsignedExitTransaction[];
  warnings: string[];
}

function normalizeAddress(value: string): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error('Invalid EVM wallet address');
  return value.toLowerCase();
}

function encodeUint(value: bigint): string {
  if (value < 0n) throw new Error('Unsigned ABI value cannot be negative');
  return value.toString(16).padStart(64, '0');
}

function encodeAddress(value: string): string {
  return normalizeAddress(value).slice(2).padStart(64, '0');
}

export function fullRangeAmountsForLiquidity(
  liquidity: bigint,
  sqrtPriceX96: bigint
): { amount0: bigint; amount1: bigint } {
  if (liquidity <= 0n) throw new Error('Position liquidity must be positive');
  if (sqrtPriceX96 <= MIN_SQRT_RATIO || sqrtPriceX96 >= MAX_SQRT_RATIO) {
    throw new Error('Current sqrt price is outside the full-range boundaries');
  }
  const amount0 = (liquidity * (MAX_SQRT_RATIO - sqrtPriceX96) * Q96) / sqrtPriceX96 / MAX_SQRT_RATIO;
  const amount1 = (liquidity * (sqrtPriceX96 - MIN_SQRT_RATIO)) / Q96;
  if (amount0 <= 0n || amount1 <= 0n) throw new Error('Expected exit token amounts are zero');
  return { amount0, amount1 };
}

export function encodeDecreaseLiquidity(input: {
  tokenId: bigint;
  liquidity: bigint;
  amount0Min: bigint;
  amount1Min: bigint;
  deadline: number;
}): string {
  return `0x${DECREASE_LIQUIDITY_SELECTOR}${[
    encodeUint(input.tokenId),
    encodeUint(input.liquidity),
    encodeUint(input.amount0Min),
    encodeUint(input.amount1Min),
    encodeUint(BigInt(input.deadline)),
  ].join('')}`;
}

export function encodeCollect(input: { tokenId: bigint; recipient: string }): string {
  return `0x${COLLECT_SELECTOR}${[
    encodeUint(input.tokenId),
    encodeAddress(input.recipient),
    encodeUint(MAX_UINT128),
    encodeUint(MAX_UINT128),
  ].join('')}`;
}

export function encodeBurn(tokenId: bigint): string {
  return `0x${BURN_SELECTOR}${encodeUint(tokenId)}`;
}

function encodeApprove(spender: string, amount: bigint): string {
  return `0x${APPROVE_SELECTOR}${encodeAddress(spender)}${encodeUint(amount)}`;
}

export function encodeExactInputSingle(input: {
  recipient: string;
  deadline: number;
  amountIn: bigint;
  amountOutMinimum: bigint;
}): string {
  return `0x${EXACT_INPUT_SINGLE_SELECTOR}${[
    encodeAddress(WBNB_ADDRESS),
    encodeAddress(USDT_ADDRESS),
    encodeUint(100n),
    encodeAddress(input.recipient),
    encodeUint(BigInt(input.deadline)),
    encodeUint(input.amountIn),
    encodeUint(input.amountOutMinimum),
    encodeUint(0n),
  ].join('')}`;
}

export function buildFullRangeExitPlan(input: {
  state: PancakeV3OnchainState;
  position: PancakeV3PositionState;
  wallet: string;
  wbnbSwapRouterAllowance: string;
  slippageBps: number;
  deadline: number;
  burnAfterCollect: boolean;
  swapWbnbToUsdt: boolean;
  nowUnix?: number;
}): FullRangeExitPlan {
  const wallet = normalizeAddress(input.wallet);
  if (input.position.owner !== wallet) throw new Error('Wallet does not own the NFT position');
  if (
    input.state.chainId !== 56 ||
    input.position.token0 !== USDT_ADDRESS ||
    input.position.token1 !== WBNB_ADDRESS ||
    input.position.fee !== 100 ||
    input.position.tickLower !== -887272 ||
    input.position.tickUpper !== 887272
  )
    throw new Error('NFT or pool configuration does not match the full-range exit adapter');
  if (!Number.isInteger(input.slippageBps) || input.slippageBps < 10 || input.slippageBps > 500) {
    throw new Error('Slippage must be between 10 and 500 basis points');
  }
  const nowUnix = input.nowUnix ?? Math.floor(Date.now() / 1_000);
  if (!Number.isInteger(input.deadline) || input.deadline <= nowUnix || input.deadline > nowUnix + 30 * 60) {
    throw new Error('Exit deadline must be within the next 30 minutes');
  }

  const tokenId = BigInt(input.position.tokenId);
  const liquidity = BigInt(input.position.liquidity);
  if (liquidity <= 0n || liquidity > MAX_UINT128) throw new Error('NFT has no removable liquidity');
  const expected = fullRangeAmountsForLiquidity(liquidity, BigInt(input.state.sqrtPriceX96));
  const slippageFactor = BigInt(10_000 - input.slippageBps);
  const amount0Min = (expected.amount0 * slippageFactor) / 10_000n;
  const amount1Min = (expected.amount1 * slippageFactor) / 10_000n;
  const transactions: UnsignedExitTransaction[] = [];
  let swapAmountOutMin: bigint | null = null;

  if (input.swapWbnbToUsdt) {
    const spotAmountOut =
      (amount1Min * Q192) / (BigInt(input.state.sqrtPriceX96) * BigInt(input.state.sqrtPriceX96));
    swapAmountOutMin = (spotAmountOut * slippageFactor) / 10_000n;
    if (swapAmountOutMin <= 0n) throw new Error('Swap output minimum is zero');
    if (BigInt(input.wbnbSwapRouterAllowance) < amount1Min) {
      transactions.push({
        purpose: 'APPROVE_WBNB_SWAP',
        to: WBNB_ADDRESS,
        data: encodeApprove(PANCAKE_V3_SWAP_ROUTER, amount1Min),
        value: '0x0',
      });
    }
  }

  transactions.push({
    purpose: 'DECREASE_LIQUIDITY',
    to: PANCAKE_V3_POSITION_MANAGER,
    data: encodeDecreaseLiquidity({ tokenId, liquidity, amount0Min, amount1Min, deadline: input.deadline }),
    value: '0x0',
  });
  transactions.push({
    purpose: 'COLLECT',
    to: PANCAKE_V3_POSITION_MANAGER,
    data: encodeCollect({ tokenId, recipient: wallet }),
    value: '0x0',
  });
  if (input.burnAfterCollect) {
    transactions.push({
      purpose: 'BURN',
      to: PANCAKE_V3_POSITION_MANAGER,
      data: encodeBurn(tokenId),
      value: '0x0',
    });
  }
  if (input.swapWbnbToUsdt) {
    transactions.push({
      purpose: 'SWAP_WBNB_TO_USDT',
      to: PANCAKE_V3_SWAP_ROUTER,
      data: encodeExactInputSingle({
        recipient: wallet,
        deadline: input.deadline,
        amountIn: amount1Min,
        amountOutMinimum: swapAmountOutMin!,
      }),
      value: '0x0',
    });
  }

  return {
    chainId: 56,
    positionManager: PANCAKE_V3_POSITION_MANAGER,
    swapRouter: input.swapWbnbToUsdt ? PANCAKE_V3_SWAP_ROUTER : null,
    wallet,
    tokenId: tokenId.toString(),
    liquidity: liquidity.toString(),
    slippageBps: input.slippageBps,
    deadline: input.deadline,
    burnAfterCollect: input.burnAfterCollect,
    swapWbnbToUsdt: input.swapWbnbToUsdt,
    expectedAmount0: expected.amount0.toString(),
    expectedAmount1: expected.amount1.toString(),
    amount0Min: amount0Min.toString(),
    amount1Min: amount1Min.toString(),
    swapAmountIn: input.swapWbnbToUsdt ? amount1Min.toString() : null,
    swapAmountOutMin: swapAmountOutMin?.toString() ?? null,
    transactions,
    warnings: [
      'Unsigned plan only. The server does not sign or broadcast any exit transaction.',
      'Sign transactions in the listed order and stop if any preceding transaction fails.',
      'Token minimums use the latest pool sqrt price and can become stale before signing.',
      input.burnAfterCollect
        ? 'Burn is irreversible and must only be signed after decreaseLiquidity and collect succeed.'
        : 'The empty NFT is retained after liquidity removal and collection.',
      input.swapWbnbToUsdt
        ? 'The optional swap spends only the conservative principal minimum; WBNB fees or residuals can remain in the wallet.'
        : 'Collected WBNB remains WBNB; no automatic swap is included.',
    ],
  };
}

async function rpcSingle(method: string, params: unknown[]): Promise<unknown> {
  const rpcUrl = process.env.BSC_RPC_URL || DEFAULT_RPC_URL;
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`BSC RPC failed with status ${response.status}`);
  const body = (await response.json()) as { result?: unknown; error?: { message: string } };
  if (body.error || body.result === undefined) {
    throw new Error(`BSC RPC call failed: ${body.error?.message || 'missing result'}`);
  }
  return body.result;
}

export async function verifyPancakeV3SwapRouter(): Promise<boolean> {
  const [chainValue, codeValue] = await Promise.all([
    rpcSingle('eth_chainId', []),
    rpcSingle('eth_getCode', [PANCAKE_V3_SWAP_ROUTER, 'latest']),
  ]);
  if (Number(BigInt(String(chainValue))) !== 56) return false;
  const code = String(codeValue);
  return /^0x[0-9a-fA-F]+$/.test(code) && code.length > 1_000;
}

export async function fetchWbnbSwapRouterAllowance(wallet: string): Promise<string> {
  const owner = encodeAddress(wallet);
  const spender = encodeAddress(PANCAKE_V3_SWAP_ROUTER);
  const value = await rpcSingle('eth_call', [
    {
      to: WBNB_ADDRESS,
      data: `0x${ALLOWANCE_SELECTOR}${owner}${spender}`,
    },
    'latest',
  ]);
  return BigInt(String(value)).toString();
}
