import 'dotenv/config';
import { PANCAKE_V3_POSITION_MANAGER } from './pancakeswap-v3-execution.js';

const DEFAULT_RPC_URL = 'https://bsc-dataseed1.bnbchain.org';
const USDT_ADDRESS = '0x55d398326f99059ff775485246999027b3197955';
const WBNB_ADDRESS = '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c';
const MINT_SELECTOR = '88316456';
const POSITIONS_SELECTOR = '99fbab88';
const OWNER_OF_SELECTOR = '6352211e';
const MIN_TICK = -887272;
const MAX_TICK = 887272;
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const INCREASE_LIQUIDITY_TOPIC = '0x3067048beee31b25b2f1681f88dac838c8bba36af25bfb2b7cf7473a5847e35f';
const ZERO_TOPIC = `0x${'0'.repeat(64)}`;

export interface RpcTransaction {
  hash: string;
  from: string;
  to: string | null;
  input: string;
  value: string;
  gasPrice?: string;
}

export interface RpcLog {
  address: string;
  topics: string[];
  data: string;
  removed?: boolean;
}

export interface RpcTransactionReceipt {
  transactionHash: string;
  blockNumber: string;
  blockHash: string;
  from: string;
  to: string | null;
  status: string;
  gasUsed: string;
  effectiveGasPrice?: string;
  logs: RpcLog[];
}

export interface PancakeV3PositionState {
  tokenId: string;
  owner: string;
  blockNumber: number;
  token0: string;
  token1: string;
  fee: number;
  tickLower: number;
  tickUpper: number;
  liquidity: string;
  feeGrowthInside0LastX128: string;
  feeGrowthInside1LastX128: string;
  tokensOwed0: string;
  tokensOwed1: string;
}

export interface VerifiedPancakeV3Mint {
  transactionHash: string;
  wallet: string;
  tokenId: string;
  owner: string;
  blockNumber: number;
  blockHash: string;
  blockTimestamp: string;
  confirmations: number;
  token0: string;
  token1: string;
  fee: number;
  tickLower: number;
  tickUpper: number;
  liquidity: string;
  feeGrowthInside0LastX128: string;
  feeGrowthInside1LastX128: string;
  tokensOwed0: string;
  tokensOwed1: string;
  amount0: string;
  amount1: string;
  amount0Desired: string;
  amount1Desired: string;
  amount0Min: string;
  amount1Min: string;
  deadline: number;
  mintCalldata: string;
  gasUsed: string;
  effectiveGasPriceWei: string;
  gasCostWei: string;
}

function normalizeAddress(value: string): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error('Invalid EVM wallet address');
  return value.toLowerCase();
}

function requireHash(value: string): string {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error('Invalid transaction hash');
  return value.toLowerCase();
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

function encodeUint(value: bigint): string {
  if (value < 0n) throw new Error('ABI uint cannot be negative');
  return value.toString(16).padStart(64, '0');
}

export function decodePancakeV3Position(
  tokenId: string,
  positionResult: string,
  ownerResult: string,
  blockNumber: number
): PancakeV3PositionState {
  if (!/^\d+$/.test(tokenId)) throw new Error('Invalid NFT tokenId');
  const position = words(positionResult);
  if (position.length < 12) throw new Error('positions(tokenId) response is incomplete');
  const ownerWords = words(ownerResult);
  if (ownerWords.length !== 1) throw new Error('ownerOf(tokenId) response is malformed');
  return {
    tokenId,
    owner: address(ownerWords[0]!),
    blockNumber,
    token0: address(position[2]!),
    token1: address(position[3]!),
    fee: Number(uint(position[4]!)),
    tickLower: Number(signed(position[5]!, 24)),
    tickUpper: Number(signed(position[6]!, 24)),
    liquidity: uint(position[7]!).toString(),
    feeGrowthInside0LastX128: uint(position[8]!).toString(),
    feeGrowthInside1LastX128: uint(position[9]!).toString(),
    tokensOwed0: uint(position[10]!).toString(),
    tokensOwed1: uint(position[11]!).toString(),
  };
}

function parseMintInput(input: string): {
  token0: string;
  token1: string;
  fee: number;
  tickLower: number;
  tickUpper: number;
  recipient: string;
  amount0Desired: bigint;
  amount1Desired: bigint;
  amount0Min: bigint;
  amount1Min: bigint;
  deadline: number;
} {
  const hex = stripHex(input);
  if (!hex.startsWith(MINT_SELECTOR)) throw new Error('Transaction is not a direct full-range mint call');
  const encoded = `0x${hex.slice(8)}`;
  const decoded = words(encoded);
  if (decoded.length !== 11) throw new Error('Mint calldata has an unexpected argument count');
  return {
    token0: address(decoded[0]!),
    token1: address(decoded[1]!),
    fee: Number(uint(decoded[2]!)),
    tickLower: Number(signed(decoded[3]!, 24)),
    tickUpper: Number(signed(decoded[4]!, 24)),
    amount0Desired: uint(decoded[5]!),
    amount1Desired: uint(decoded[6]!),
    amount0Min: uint(decoded[7]!),
    amount1Min: uint(decoded[8]!),
    recipient: address(decoded[9]!),
    deadline: Number(uint(decoded[10]!)),
  };
}

function findMintTransfer(receipt: RpcTransactionReceipt, wallet: string): { tokenId: bigint } {
  const transfers = receipt.logs.filter(
    log =>
      !log.removed &&
      log.address.toLowerCase() === PANCAKE_V3_POSITION_MANAGER &&
      log.topics[0]?.toLowerCase() === TRANSFER_TOPIC &&
      log.topics[1]?.toLowerCase() === ZERO_TOPIC &&
      log.topics.length >= 4 &&
      address(stripHex(log.topics[2]!)) === wallet
  );
  if (transfers.length !== 1) {
    throw new Error('Receipt must contain exactly one Position Manager NFT mint to the bound wallet');
  }
  return { tokenId: BigInt(transfers[0]!.topics[3]!) };
}

function findIncreaseLiquidity(
  receipt: RpcTransactionReceipt,
  tokenId: bigint
): {
  liquidity: bigint;
  amount0: bigint;
  amount1: bigint;
} {
  const events = receipt.logs.filter(
    log =>
      !log.removed &&
      log.address.toLowerCase() === PANCAKE_V3_POSITION_MANAGER &&
      log.topics[0]?.toLowerCase() === INCREASE_LIQUIDITY_TOPIC &&
      log.topics.length >= 2 &&
      BigInt(log.topics[1]!) === tokenId
  );
  if (events.length !== 1) throw new Error('Receipt must contain one matching IncreaseLiquidity event');
  const decoded = words(events[0]!.data);
  if (decoded.length !== 3) throw new Error('IncreaseLiquidity event data is malformed');
  return {
    liquidity: uint(decoded[0]!),
    amount0: uint(decoded[1]!),
    amount1: uint(decoded[2]!),
  };
}

export function verifyPancakeV3MintEvidence(input: {
  txHash: string;
  wallet: string;
  transaction: RpcTransaction;
  receipt: RpcTransactionReceipt;
  currentBlockNumber: number;
  blockTimestamp: string;
  positionResult: string;
  ownerResult: string;
  minimumConfirmations?: number;
}): VerifiedPancakeV3Mint {
  const txHash = requireHash(input.txHash);
  const wallet = normalizeAddress(input.wallet);
  const transactionTo = input.transaction.to ? normalizeAddress(input.transaction.to) : null;
  const receiptTo = input.receipt.to ? normalizeAddress(input.receipt.to) : null;
  if (
    input.transaction.hash.toLowerCase() !== txHash ||
    input.receipt.transactionHash.toLowerCase() !== txHash
  ) {
    throw new Error('RPC transaction hash does not match the submitted hash');
  }
  if (
    normalizeAddress(input.transaction.from) !== wallet ||
    normalizeAddress(input.receipt.from) !== wallet
  ) {
    throw new Error('Mint transaction sender does not match the proposal wallet');
  }
  if (transactionTo !== PANCAKE_V3_POSITION_MANAGER || receiptTo !== PANCAKE_V3_POSITION_MANAGER) {
    throw new Error('Mint transaction destination is not the official PancakeSwap V3 Position Manager');
  }
  if (BigInt(input.receipt.status) !== 1n) throw new Error('Mint transaction reverted');
  if (BigInt(input.transaction.value) !== 0n)
    throw new Error('Mint transaction unexpectedly transfers native BNB');

  const mint = parseMintInput(input.transaction.input);
  if (
    !Number.isSafeInteger(mint.deadline) ||
    mint.deadline <= 0 ||
    mint.amount0Desired <= 0n ||
    mint.amount1Desired <= 0n ||
    mint.amount0Min <= 0n ||
    mint.amount1Min <= 0n ||
    mint.amount0Min > mint.amount0Desired ||
    mint.amount1Min > mint.amount1Desired
  )
    throw new Error('Mint calldata contains invalid amounts or deadline');
  if (
    mint.token0 !== USDT_ADDRESS ||
    mint.token1 !== WBNB_ADDRESS ||
    mint.fee !== 100 ||
    mint.tickLower !== MIN_TICK ||
    mint.tickUpper !== MAX_TICK ||
    mint.recipient !== wallet
  ) {
    throw new Error('Mint calldata does not match the approved WBNB/USDT full-range strategy');
  }

  const blockNumber = Number(BigInt(input.receipt.blockNumber));
  if (!Number.isSafeInteger(blockNumber) || blockNumber <= 0)
    throw new Error('Receipt block number is invalid');
  const confirmations = input.currentBlockNumber - blockNumber + 1;
  const minimumConfirmations = input.minimumConfirmations ?? 3;
  if (!Number.isInteger(minimumConfirmations) || minimumConfirmations < 1 || minimumConfirmations > 100) {
    throw new Error('Minimum confirmations must be between 1 and 100');
  }
  if (confirmations < minimumConfirmations) {
    throw new Error(
      `Mint receipt has ${Math.max(0, confirmations)} confirmation(s); ${minimumConfirmations} required`
    );
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(input.receipt.blockHash)) throw new Error('Receipt block hash is invalid');
  const blockTime = new Date(input.blockTimestamp);
  if (!Number.isFinite(blockTime.getTime())) throw new Error('Receipt block timestamp is invalid');

  const transfer = findMintTransfer(input.receipt, wallet);
  const increased = findIncreaseLiquidity(input.receipt, transfer.tokenId);
  if (increased.liquidity <= 0n || increased.amount0 <= 0n || increased.amount1 <= 0n) {
    throw new Error('Mint event has zero liquidity or token amounts');
  }
  if (
    increased.amount0 < mint.amount0Min ||
    increased.amount1 < mint.amount1Min ||
    increased.amount0 > mint.amount0Desired ||
    increased.amount1 > mint.amount1Desired
  )
    throw new Error('Mint event token amounts do not satisfy calldata bounds');

  const position = decodePancakeV3Position(
    transfer.tokenId.toString(),
    input.positionResult,
    input.ownerResult,
    blockNumber
  );
  if (
    position.token0 !== USDT_ADDRESS ||
    position.token1 !== WBNB_ADDRESS ||
    position.fee !== 100 ||
    position.tickLower !== MIN_TICK ||
    position.tickUpper !== MAX_TICK ||
    BigInt(position.liquidity) <= 0n
  ) {
    throw new Error('On-chain NFT position does not match the approved full-range pool');
  }
  if (position.owner !== wallet) throw new Error('Bound wallet no longer owns the minted NFT');

  const gasUsed = BigInt(input.receipt.gasUsed);
  const effectiveGasPrice = BigInt(input.receipt.effectiveGasPrice ?? input.transaction.gasPrice ?? '0x0');
  if (gasUsed <= 0n || effectiveGasPrice <= 0n) throw new Error('Receipt gas accounting is unavailable');

  return {
    transactionHash: txHash,
    wallet,
    tokenId: transfer.tokenId.toString(),
    owner: position.owner,
    blockNumber,
    blockHash: input.receipt.blockHash.toLowerCase(),
    blockTimestamp: blockTime.toISOString(),
    confirmations,
    token0: position.token0,
    token1: position.token1,
    fee: position.fee,
    tickLower: position.tickLower,
    tickUpper: position.tickUpper,
    liquidity: position.liquidity,
    feeGrowthInside0LastX128: position.feeGrowthInside0LastX128,
    feeGrowthInside1LastX128: position.feeGrowthInside1LastX128,
    tokensOwed0: position.tokensOwed0,
    tokensOwed1: position.tokensOwed1,
    amount0: increased.amount0.toString(),
    amount1: increased.amount1.toString(),
    amount0Desired: mint.amount0Desired.toString(),
    amount1Desired: mint.amount1Desired.toString(),
    amount0Min: mint.amount0Min.toString(),
    amount1Min: mint.amount1Min.toString(),
    deadline: mint.deadline,
    mintCalldata: input.transaction.input.toLowerCase(),
    gasUsed: gasUsed.toString(),
    effectiveGasPriceWei: effectiveGasPrice.toString(),
    gasCostWei: (gasUsed * effectiveGasPrice).toString(),
  };
}

async function rpcSingle(rpcUrl: string, method: string, params: unknown[]): Promise<unknown> {
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

export function verifyMintAgainstImmutablePlan(input: {
  verified: VerifiedPancakeV3Mint;
  proposalCreatedAt: string;
  proposalExpiresAt: string;
  plan: {
    createdAt: string;
    referenceBlockNumber: number;
    amountUsd: number;
    amount0Desired: string;
    amount1Desired: string;
    amount0Min: string;
    amount1Min: string;
    deadline: number;
    mintCalldata: string;
  };
  proposalAmountUsd: number;
}): void {
  const minedAt = new Date(input.verified.blockTimestamp).getTime();
  const proposalCreatedAt = new Date(input.proposalCreatedAt).getTime();
  const planCreatedAt = new Date(input.plan.createdAt).getTime();
  const proposalExpiresAt = new Date(input.proposalExpiresAt).getTime();
  if (![minedAt, proposalCreatedAt, planCreatedAt, proposalExpiresAt].every(Number.isFinite)) {
    throw new Error('Mint proposal or plan timestamp is invalid');
  }
  if (minedAt > proposalExpiresAt) throw new Error('Mint was mined after the execution proposal expired');
  if (minedAt + 2_000 < proposalCreatedAt || minedAt + 2_000 < planCreatedAt) {
    throw new Error('Mint was mined before the approved immutable plan existed');
  }
  if (input.verified.blockNumber < input.plan.referenceBlockNumber) {
    throw new Error('Mint block predates the immutable plan reference block');
  }
  if (
    input.verified.mintCalldata !== input.plan.mintCalldata ||
    input.verified.amount0Desired !== input.plan.amount0Desired ||
    input.verified.amount1Desired !== input.plan.amount1Desired ||
    input.verified.amount0Min !== input.plan.amount0Min ||
    input.verified.amount1Min !== input.plan.amount1Min ||
    input.verified.deadline !== input.plan.deadline ||
    input.plan.amountUsd !== input.proposalAmountUsd
  )
    throw new Error('Mint receipt does not match the approved immutable transaction plan');
}

export async function fetchPancakeV3PositionState(input: {
  tokenId: string;
  expectedWallet: string;
  rpcUrl?: string;
}): Promise<PancakeV3PositionState> {
  if (!/^\d+$/.test(input.tokenId)) throw new Error('Invalid NFT tokenId');
  const wallet = normalizeAddress(input.expectedWallet);
  const rpcUrl = input.rpcUrl ?? process.env.BSC_RPC_URL ?? DEFAULT_RPC_URL;
  const [chainValue, blockValue] = await Promise.all([
    rpcSingle(rpcUrl, 'eth_chainId', []),
    rpcSingle(rpcUrl, 'eth_blockNumber', []),
  ]);
  const chainId = Number(BigInt(String(chainValue)));
  if (chainId !== 56) throw new Error(`BSC RPC returned unexpected chain ID ${chainId}`);
  const blockHex = String(blockValue);
  const blockNumber = Number(BigInt(blockHex));
  const tokenIdWord = encodeUint(BigInt(input.tokenId));
  const [positionResult, ownerResult] = await Promise.all([
    rpcSingle(rpcUrl, 'eth_call', [
      { to: PANCAKE_V3_POSITION_MANAGER, data: `0x${POSITIONS_SELECTOR}${tokenIdWord}` },
      blockHex,
    ]),
    rpcSingle(rpcUrl, 'eth_call', [
      { to: PANCAKE_V3_POSITION_MANAGER, data: `0x${OWNER_OF_SELECTOR}${tokenIdWord}` },
      blockHex,
    ]),
  ]);
  const position = decodePancakeV3Position(
    input.tokenId,
    String(positionResult),
    String(ownerResult),
    blockNumber
  );
  if (position.owner !== wallet) throw new Error('External wallet does not own the tracked NFT');
  if (
    position.token0 !== USDT_ADDRESS ||
    position.token1 !== WBNB_ADDRESS ||
    position.fee !== 100 ||
    position.tickLower !== MIN_TICK ||
    position.tickUpper !== MAX_TICK
  )
    throw new Error('Tracked NFT no longer matches the WBNB/USDT full-range strategy');
  return position;
}

export async function fetchAndVerifyPancakeV3MintReceipt(input: {
  txHash: string;
  wallet: string;
  minimumConfirmations?: number;
  rpcUrl?: string;
}): Promise<VerifiedPancakeV3Mint> {
  const txHash = requireHash(input.txHash);
  const wallet = normalizeAddress(input.wallet);
  const rpcUrl = input.rpcUrl ?? process.env.BSC_RPC_URL ?? DEFAULT_RPC_URL;
  const chainId = Number(BigInt(String(await rpcSingle(rpcUrl, 'eth_chainId', []))));
  if (chainId !== 56) throw new Error(`BSC RPC returned unexpected chain ID ${chainId}`);

  const [receiptValue, transactionValue, currentBlockValue] = await Promise.all([
    rpcSingle(rpcUrl, 'eth_getTransactionReceipt', [txHash]),
    rpcSingle(rpcUrl, 'eth_getTransactionByHash', [txHash]),
    rpcSingle(rpcUrl, 'eth_blockNumber', []),
  ]);
  if (receiptValue === null) throw new Error('Mint transaction is not mined yet');
  if (transactionValue === null) throw new Error('Mint transaction was not found');
  const receipt = receiptValue as RpcTransactionReceipt;
  const transaction = transactionValue as RpcTransaction;
  const transfer = findMintTransfer(receipt, wallet);
  const tokenIdWord = encodeUint(transfer.tokenId);
  const [positionResult, ownerResult, blockValue] = await Promise.all([
    rpcSingle(rpcUrl, 'eth_call', [
      { to: PANCAKE_V3_POSITION_MANAGER, data: `0x${POSITIONS_SELECTOR}${tokenIdWord}` },
      'latest',
    ]),
    rpcSingle(rpcUrl, 'eth_call', [
      { to: PANCAKE_V3_POSITION_MANAGER, data: `0x${OWNER_OF_SELECTOR}${tokenIdWord}` },
      'latest',
    ]),
    rpcSingle(rpcUrl, 'eth_getBlockByNumber', [receipt.blockNumber, false]),
  ]);
  if (!blockValue || typeof blockValue !== 'object' || !('timestamp' in blockValue)) {
    throw new Error('Receipt block could not be read');
  }
  const timestamp = String((blockValue as { timestamp: string }).timestamp);
  return verifyPancakeV3MintEvidence({
    txHash,
    wallet,
    transaction,
    receipt,
    currentBlockNumber: Number(BigInt(String(currentBlockValue))),
    blockTimestamp: new Date(Number(BigInt(timestamp)) * 1_000).toISOString(),
    positionResult: String(positionResult),
    ownerResult: String(ownerResult),
    minimumConfirmations: input.minimumConfirmations,
  });
}
