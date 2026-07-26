import 'dotenv/config';
import type { PancakeV3OnchainState } from '../../market-data/index.js';
import { calculateFullRangeTokenAmounts } from '../../lp-analysis/index.js';

export const PANCAKE_V3_POSITION_MANAGER = '0x46a15b0b27311cedf172ab29e4f4766fbe7f4364';
const USDT_ADDRESS = '0x55d398326f99059ff775485246999027b3197955';
const WBNB_ADDRESS = '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c';
const DEFAULT_RPC_URL = 'https://bsc-dataseed1.bnbchain.org';
const MIN_TICK = -887272;
const MAX_TICK = 887272;
const APPROVE_SELECTOR = '095ea7b3';
const BALANCE_OF_SELECTOR = '70a08231';
const ALLOWANCE_SELECTOR = 'dd62ed3e';
const MINT_SELECTOR = '88316456';

export interface UnsignedTransaction {
  purpose: 'APPROVE_USDT' | 'APPROVE_WBNB' | 'MINT_FULL_RANGE';
  to: string;
  data: string;
  value: '0x0';
}

export interface FullRangeMintPlan {
  chainId: 56;
  positionManager: string;
  recipient: string;
  amountUsd: number;
  priceWbnbUsd: number;
  tickLower: number;
  tickUpper: number;
  fee: number;
  slippageBps: number;
  deadline: number;
  amount0Desired: string;
  amount1Desired: string;
  amount0Min: string;
  amount1Min: string;
  token0Symbol: 'USDT';
  token1Symbol: 'WBNB';
  transactions: UnsignedTransaction[];
  warnings: string[];
}

export interface WalletTokenState {
  wallet: string;
  usdtBalance: string;
  wbnbBalance: string;
  usdtAllowance: string;
  wbnbAllowance: string;
}

function normalizeAddress(value: string): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error('Invalid EVM wallet address');
  return value.toLowerCase();
}

function encodeUint(value: bigint): string {
  if (value < 0n) throw new Error('Unsigned ABI value cannot be negative');
  return value.toString(16).padStart(64, '0');
}

function encodeInt(value: number, bits = 24): string {
  if (!Number.isInteger(value)) throw new Error('Signed ABI value must be an integer');
  return BigInt.asUintN(256, BigInt.asIntN(bits, BigInt(value)))
    .toString(16)
    .padStart(64, '0');
}

function encodeAddress(value: string): string {
  return normalizeAddress(value).slice(2).padStart(64, '0');
}

function approveData(spender: string, amount: bigint): string {
  return `0x${APPROVE_SELECTOR}${encodeAddress(spender)}${encodeUint(amount)}`;
}

export function encodeMintFullRange(params: {
  fee: number;
  amount0Desired: bigint;
  amount1Desired: bigint;
  amount0Min: bigint;
  amount1Min: bigint;
  recipient: string;
  deadline: number;
}): string {
  const encoded = [
    encodeAddress(USDT_ADDRESS),
    encodeAddress(WBNB_ADDRESS),
    encodeUint(BigInt(params.fee)),
    encodeInt(MIN_TICK),
    encodeInt(MAX_TICK),
    encodeUint(params.amount0Desired),
    encodeUint(params.amount1Desired),
    encodeUint(params.amount0Min),
    encodeUint(params.amount1Min),
    encodeAddress(params.recipient),
    encodeUint(BigInt(params.deadline)),
  ].join('');
  return `0x${MINT_SELECTOR}${encoded}`;
}

export function buildFullRangeMintPlan(input: {
  state: PancakeV3OnchainState;
  walletState: WalletTokenState;
  amountUsd: number;
  slippageBps: number;
  deadline: number;
}): FullRangeMintPlan {
  const recipient = normalizeAddress(input.walletState.wallet);
  if (!Number.isInteger(input.slippageBps) || input.slippageBps < 10 || input.slippageBps > 500) {
    throw new Error('Slippage must be between 10 and 500 basis points');
  }
  if (input.state.chainId !== 56 || input.state.fee !== 100 || input.state.tickSpacing !== 1) {
    throw new Error('On-chain pool configuration does not match the execution adapter');
  }

  const amounts = calculateFullRangeTokenAmounts(
    input.amountUsd,
    input.state.priceWbnbUsd,
    input.state.currentTick,
    input.state.token0Decimals,
    input.state.token1Decimals
  );
  const slippageFactor = BigInt(10_000 - input.slippageBps);
  const amount0Min = (amounts.amount0 * slippageFactor) / 10_000n;
  const amount1Min = (amounts.amount1 * slippageFactor) / 10_000n;
  if (BigInt(input.walletState.usdtBalance) < amounts.amount0) {
    throw new Error('Wallet USDT balance is insufficient for the plan');
  }
  if (BigInt(input.walletState.wbnbBalance) < amounts.amount1) {
    throw new Error('Wallet WBNB balance is insufficient for the plan');
  }

  const transactions: UnsignedTransaction[] = [];
  if (BigInt(input.walletState.usdtAllowance) < amounts.amount0) {
    transactions.push({
      purpose: 'APPROVE_USDT',
      to: USDT_ADDRESS,
      data: approveData(PANCAKE_V3_POSITION_MANAGER, amounts.amount0),
      value: '0x0',
    });
  }
  if (BigInt(input.walletState.wbnbAllowance) < amounts.amount1) {
    transactions.push({
      purpose: 'APPROVE_WBNB',
      to: WBNB_ADDRESS,
      data: approveData(PANCAKE_V3_POSITION_MANAGER, amounts.amount1),
      value: '0x0',
    });
  }
  transactions.push({
    purpose: 'MINT_FULL_RANGE',
    to: PANCAKE_V3_POSITION_MANAGER,
    data: encodeMintFullRange({
      fee: input.state.fee,
      amount0Desired: amounts.amount0,
      amount1Desired: amounts.amount1,
      amount0Min,
      amount1Min,
      recipient,
      deadline: input.deadline,
    }),
    value: '0x0',
  });

  return {
    chainId: 56,
    positionManager: PANCAKE_V3_POSITION_MANAGER,
    recipient,
    amountUsd: input.amountUsd,
    priceWbnbUsd: input.state.priceWbnbUsd,
    tickLower: MIN_TICK,
    tickUpper: MAX_TICK,
    fee: input.state.fee,
    slippageBps: input.slippageBps,
    deadline: input.deadline,
    amount0Desired: amounts.amount0.toString(),
    amount1Desired: amounts.amount1.toString(),
    amount0Min: amount0Min.toString(),
    amount1Min: amount1Min.toString(),
    token0Symbol: 'USDT',
    token1Symbol: 'WBNB',
    transactions,
    warnings: [
      'Unsigned plan only. Every transaction requires explicit confirmation in an external wallet.',
      'Wallet must retain separate native BNB for gas; the plan spends WBNB and USDT only.',
      'Amounts use the latest cached on-chain tick and can become stale before signing.',
      'Full-range is used because the paper agent and outcome model are not trained for concentrated ranges.',
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

async function ethCall(to: string, data: string): Promise<bigint> {
  const result = await rpcSingle('eth_call', [{ to, data }, 'latest']);
  return BigInt(String(result));
}

export async function verifyPositionManagerAdapter(): Promise<boolean> {
  const code = String(await rpcSingle('eth_getCode', [PANCAKE_V3_POSITION_MANAGER, 'latest']));
  return /^0x[0-9a-fA-F]+$/.test(code) && code.length > 1_000;
}

export async function fetchWalletTokenState(wallet: string): Promise<WalletTokenState> {
  const normalized = normalizeAddress(wallet);
  const owner = encodeAddress(normalized);
  const spender = encodeAddress(PANCAKE_V3_POSITION_MANAGER);
  const [usdtBalance, wbnbBalance, usdtAllowance, wbnbAllowance] = await Promise.all([
    ethCall(USDT_ADDRESS, `0x${BALANCE_OF_SELECTOR}${owner}`),
    ethCall(WBNB_ADDRESS, `0x${BALANCE_OF_SELECTOR}${owner}`),
    ethCall(USDT_ADDRESS, `0x${ALLOWANCE_SELECTOR}${owner}${spender}`),
    ethCall(WBNB_ADDRESS, `0x${ALLOWANCE_SELECTOR}${owner}${spender}`),
  ]);
  return {
    wallet: normalized,
    usdtBalance: usdtBalance.toString(),
    wbnbBalance: wbnbBalance.toString(),
    usdtAllowance: usdtAllowance.toString(),
    wbnbAllowance: wbnbAllowance.toString(),
  };
}
