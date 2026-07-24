import 'dotenv/config';

const DEFAULT_RPC_URL = 'https://bsc-dataseed1.bnbchain.org';
const USDT_ADDRESS = '0x55d398326f99059ff775485246999027b3197955';
const WBNB_ADDRESS = '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c';
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

export interface ExpectedExitTransaction {
  purpose: string;
  to: string;
  data: string;
  value: string;
}

export interface ExitRpcTransaction {
  hash: string;
  from: string;
  to: string | null;
  input: string;
  value: string;
}

export interface ExitRpcLog {
  address: string;
  topics: string[];
  data: string;
  removed?: boolean;
}

export interface ExitRpcReceipt {
  transactionHash: string;
  blockNumber: string;
  transactionIndex: string;
  from: string;
  to: string | null;
  status: string;
  gasUsed: string;
  effectiveGasPrice?: string;
  logs: ExitRpcLog[];
  blockTimestamp: string;
}

export interface VerifiedExitSettlementEvidence {
  txHashes: string[];
  collectedUsdt: string;
  collectedWbnb: string;
  swappedWbnb: string;
  swapUsdtReceived: string;
  residualWbnb: string;
  exitValueUsd: number;
  exitGasCostWei: string;
  exitGasUsd: number;
  realizedPnlUsd: number;
  finalBlockNumber: number;
  confirmations: number;
}

function normalizeAddress(value: string): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error('Invalid EVM address');
  return value.toLowerCase();
}

function normalizeHash(value: string): string {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error('Invalid transaction hash');
  return value.toLowerCase();
}

function topicAddress(topic: string): string {
  if (!/^0x[0-9a-fA-F]{64}$/.test(topic)) throw new Error('Invalid address topic');
  return `0x${topic.slice(-40).toLowerCase()}`;
}

function transferToWallet(receipt: ExitRpcReceipt, token: string, wallet: string): bigint {
  return receipt.logs.reduce((sum, log) => {
    if (
      log.removed ||
      log.address.toLowerCase() !== token ||
      log.topics[0]?.toLowerCase() !== TRANSFER_TOPIC ||
      log.topics.length < 3 ||
      topicAddress(log.topics[2]!) !== wallet ||
      !/^0x[0-9a-fA-F]{64}$/.test(log.data)
    )
      return sum;
    return sum + BigInt(log.data);
  }, 0n);
}

export function verifyExitReceiptEvidence(input: {
  wallet: string;
  expectedTransactions: ExpectedExitTransaction[];
  transactions: ExitRpcTransaction[];
  receipts: ExitRpcReceipt[];
  referenceBlockNumber: number;
  planCreatedAt: string;
  proposalExpiresAt: string;
  currentBlockNumber: number;
  minimumConfirmations: number;
  swapAmountIn: string | null;
  priceWbnbUsd: number;
  investmentUsd: number;
  entryGasUsd: number;
}): VerifiedExitSettlementEvidence {
  const wallet = normalizeAddress(input.wallet);
  if (
    input.expectedTransactions.length === 0 ||
    input.transactions.length !== input.expectedTransactions.length ||
    input.receipts.length !== input.expectedTransactions.length
  )
    throw new Error('Exit receipt count does not match the immutable plan');
  if (
    !Number.isInteger(input.minimumConfirmations) ||
    input.minimumConfirmations < 1 ||
    input.minimumConfirmations > 100
  ) {
    throw new Error('Minimum confirmations must be between 1 and 100');
  }
  if (!(input.priceWbnbUsd > 0) || !(input.investmentUsd > 0) || input.entryGasUsd < 0) {
    throw new Error('Exit financial inputs are invalid');
  }
  const planCreatedAt = new Date(input.planCreatedAt).getTime();
  const expiresAt = new Date(input.proposalExpiresAt).getTime();
  if (!Number.isFinite(planCreatedAt) || !Number.isFinite(expiresAt))
    throw new Error('Exit plan timestamps are invalid');

  let previousOrder = -1n;
  let exitGasCostWei = 0n;
  let minimumObservedConfirmations = Number.MAX_SAFE_INTEGER;
  const txHashes: string[] = [];

  for (let index = 0; index < input.expectedTransactions.length; index++) {
    const expected = input.expectedTransactions[index]!;
    const transaction = input.transactions[index]!;
    const receipt = input.receipts[index]!;
    const hash = normalizeHash(transaction.hash);
    if (normalizeHash(receipt.transactionHash) !== hash)
      throw new Error('Exit transaction and receipt hash mismatch');
    if (normalizeAddress(transaction.from) !== wallet || normalizeAddress(receipt.from) !== wallet) {
      throw new Error('Exit transaction sender is not the verified NFT owner');
    }
    if (
      !transaction.to ||
      !receipt.to ||
      normalizeAddress(transaction.to) !== normalizeAddress(expected.to) ||
      normalizeAddress(receipt.to) !== normalizeAddress(expected.to) ||
      transaction.input.toLowerCase() !== expected.data.toLowerCase() ||
      BigInt(transaction.value) !== BigInt(expected.value) ||
      BigInt(receipt.status) !== 1n
    )
      throw new Error(`Exit transaction ${expected.purpose} does not match the immutable plan`);

    const blockNumber = Number(BigInt(receipt.blockNumber));
    const transactionIndex = BigInt(receipt.transactionIndex);
    if (!Number.isSafeInteger(blockNumber) || blockNumber < input.referenceBlockNumber) {
      throw new Error('Exit receipt predates the immutable plan reference block');
    }
    const order = BigInt(blockNumber) * 1_000_000n + transactionIndex;
    if (order <= previousOrder) throw new Error('Exit transactions were not mined in immutable plan order');
    previousOrder = order;
    const minedAt = new Date(receipt.blockTimestamp).getTime();
    if (!Number.isFinite(minedAt) || minedAt + 2_000 < planCreatedAt || minedAt > expiresAt) {
      throw new Error('Exit transaction was mined outside the approved plan window');
    }
    const confirmations = input.currentBlockNumber - blockNumber + 1;
    if (confirmations < input.minimumConfirmations) {
      throw new Error(
        `Exit receipt has ${Math.max(0, confirmations)} confirmation(s); ${input.minimumConfirmations} required`
      );
    }
    minimumObservedConfirmations = Math.min(minimumObservedConfirmations, confirmations);
    const gasPrice = BigInt(receipt.effectiveGasPrice ?? '0x0');
    const gasUsed = BigInt(receipt.gasUsed);
    if (gasPrice <= 0n || gasUsed <= 0n) throw new Error('Exit receipt gas accounting is unavailable');
    exitGasCostWei += gasUsed * gasPrice;
    txHashes.push(hash);
  }

  const collectIndex = input.expectedTransactions.findIndex(item => item.purpose === 'COLLECT');
  if (collectIndex < 0) throw new Error('Immutable exit plan has no collect transaction');
  const collectReceipt = input.receipts[collectIndex]!;
  const collectedUsdt = transferToWallet(collectReceipt, USDT_ADDRESS, wallet);
  const collectedWbnb = transferToWallet(collectReceipt, WBNB_ADDRESS, wallet);
  if (collectedUsdt <= 0n && collectedWbnb <= 0n)
    throw new Error('Collect receipt transferred no pool tokens to the owner');

  const swapIndex = input.expectedTransactions.findIndex(item => item.purpose === 'SWAP_WBNB_TO_USDT');
  const swappedWbnb = swapIndex >= 0 ? BigInt(input.swapAmountIn ?? '0') : 0n;
  if (swappedWbnb < 0n || swappedWbnb > collectedWbnb)
    throw new Error('Collected WBNB does not cover the approved swap input');
  const swapUsdtReceived =
    swapIndex >= 0 ? transferToWallet(input.receipts[swapIndex]!, USDT_ADDRESS, wallet) : 0n;
  if (swapIndex >= 0 && swapUsdtReceived <= 0n)
    throw new Error('Swap receipt transferred no USDT to the owner');
  const residualWbnb = collectedWbnb - swappedWbnb;
  const exitValueUsd =
    Number(collectedUsdt + swapUsdtReceived) / 1e18 + (Number(residualWbnb) / 1e18) * input.priceWbnbUsd;
  const exitGasUsd = (Number(exitGasCostWei) / 1e18) * input.priceWbnbUsd;
  const realizedPnlUsd = exitValueUsd - input.investmentUsd - input.entryGasUsd - exitGasUsd;
  if (![exitValueUsd, exitGasUsd, realizedPnlUsd].every(Number.isFinite)) {
    throw new Error('Exit settlement produced invalid accounting');
  }
  const finalBlockNumber = Math.max(...input.receipts.map(receipt => Number(BigInt(receipt.blockNumber))));
  return {
    txHashes,
    collectedUsdt: collectedUsdt.toString(),
    collectedWbnb: collectedWbnb.toString(),
    swappedWbnb: swappedWbnb.toString(),
    swapUsdtReceived: swapUsdtReceived.toString(),
    residualWbnb: residualWbnb.toString(),
    exitValueUsd,
    exitGasCostWei: exitGasCostWei.toString(),
    exitGasUsd,
    realizedPnlUsd,
    finalBlockNumber,
    confirmations: minimumObservedConfirmations,
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

export async function fetchAndVerifyExitReceipts(input: {
  txHashes: string[];
  wallet: string;
  expectedTransactions: ExpectedExitTransaction[];
  referenceBlockNumber: number;
  planCreatedAt: string;
  proposalExpiresAt: string;
  minimumConfirmations: number;
  swapAmountIn: string | null;
  priceWbnbUsd: number;
  investmentUsd: number;
  entryGasUsd: number;
  rpcUrl?: string;
}): Promise<VerifiedExitSettlementEvidence> {
  const rpcUrl = input.rpcUrl ?? process.env.BSC_RPC_URL ?? DEFAULT_RPC_URL;
  if (input.txHashes.length !== input.expectedTransactions.length) {
    throw new Error('txHashes must match the immutable exit transaction count');
  }
  const chainId = Number(BigInt(String(await rpcSingle(rpcUrl, 'eth_chainId', []))));
  if (chainId !== 56) throw new Error(`BSC RPC returned unexpected chain ID ${chainId}`);
  const [currentBlockValue, transactionValues, receiptValues] = await Promise.all([
    rpcSingle(rpcUrl, 'eth_blockNumber', []),
    Promise.all(
      input.txHashes.map(hash => rpcSingle(rpcUrl, 'eth_getTransactionByHash', [normalizeHash(hash)]))
    ),
    Promise.all(
      input.txHashes.map(hash => rpcSingle(rpcUrl, 'eth_getTransactionReceipt', [normalizeHash(hash)]))
    ),
  ]);
  if (transactionValues.some(value => value === null) || receiptValues.some(value => value === null)) {
    throw new Error('One or more exit transactions are not mined');
  }
  const receipts = receiptValues as Omit<ExitRpcReceipt, 'blockTimestamp'>[];
  const blockTimestamps = new Map<string, string>();
  for (const blockNumber of new Set(receipts.map(receipt => receipt.blockNumber))) {
    const block = (await rpcSingle(rpcUrl, 'eth_getBlockByNumber', [blockNumber, false])) as {
      timestamp?: string;
    } | null;
    if (!block?.timestamp) throw new Error('Exit receipt block could not be read');
    blockTimestamps.set(blockNumber, new Date(Number(BigInt(block.timestamp)) * 1_000).toISOString());
  }
  return verifyExitReceiptEvidence({
    ...input,
    transactions: transactionValues as ExitRpcTransaction[],
    receipts: receipts.map(receipt => ({
      ...receipt,
      blockTimestamp: blockTimestamps.get(receipt.blockNumber)!,
    })),
    currentBlockNumber: Number(BigInt(String(currentBlockValue))),
  });
}
