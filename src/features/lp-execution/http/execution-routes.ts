import type { AgentStore } from '../../paper-agent/index.js';
import type { PancakeV3OnchainState } from '../../market-data/index.js';
import type { ExecutionStore } from '../infrastructure/execution-store.js';
import {
  fetchWalletTokenState,
  verifyPositionManagerAdapter,
} from '../infrastructure/pancakeswap-v3-execution.js';
import {
  fetchWbnbSwapRouterAllowance,
  verifyPancakeV3SwapRouter,
} from '../infrastructure/pancakeswap-v3-exit.js';
import { fetchAndVerifyExitReceipts } from '../infrastructure/pancakeswap-v3-exit-tracker.js';
import {
  fetchAndVerifyPancakeV3MintReceipt,
  fetchPancakeV3PositionState,
  verifyMintAgainstImmutablePlan,
} from '../infrastructure/pancakeswap-v3-position-tracker.js';
import type { PositionStore } from '../infrastructure/position-store.js';
export interface ExecutionStatusView {
  ready: boolean;
  blockers: readonly string[];
  [key: string]: unknown;
}

export interface ExecutionChainAdapter {
  fetchWalletTokenState: typeof fetchWalletTokenState;
  verifyPositionManagerAdapter: typeof verifyPositionManagerAdapter;
  fetchAndVerifyMintReceipt: typeof fetchAndVerifyPancakeV3MintReceipt;
  verifyMintAgainstImmutablePlan: typeof verifyMintAgainstImmutablePlan;
  fetchPositionState: typeof fetchPancakeV3PositionState;
  fetchWbnbSwapRouterAllowance: typeof fetchWbnbSwapRouterAllowance;
  verifySwapRouter: typeof verifyPancakeV3SwapRouter;
  fetchAndVerifyExitReceipts: typeof fetchAndVerifyExitReceipts;
}

const DEFAULT_EXECUTION_CHAIN_ADAPTER: ExecutionChainAdapter = {
  fetchWalletTokenState,
  verifyPositionManagerAdapter,
  fetchAndVerifyMintReceipt: fetchAndVerifyPancakeV3MintReceipt,
  verifyMintAgainstImmutablePlan,
  fetchPositionState: fetchPancakeV3PositionState,
  fetchWbnbSwapRouterAllowance,
  verifySwapRouter: verifyPancakeV3SwapRouter,
  fetchAndVerifyExitReceipts,
};

export interface ExecutionRouteDependencies {
  agentStore: AgentStore;
  executionStore: ExecutionStore;
  positionStore: PositionStore;
  limits: {
    maxCapitalUsd: number;
    maxDailyLossUsd: number;
    proposalExpiryMinutes: number;
  };
  mintReceiptMinimumConfirmations: number;
  getExecutionStatus(): ExecutionStatusView;
  isAdminAuthorized(authorization: string | undefined): boolean;
  captureOnchainState(): Promise<PancakeV3OnchainState>;
  isExecutionAdapterReady(): boolean;
  setExecutionAdapterReady(value: boolean): void;
  isExitSwapRouterReady(): boolean;
  setExitSwapRouterReady(value: boolean): void;
  chainAdapter?: ExecutionChainAdapter;
}

export function resolveExecutionChainAdapter(
  dependencies: ExecutionRouteDependencies
): ExecutionChainAdapter {
  return dependencies.chainAdapter ?? DEFAULT_EXECUTION_CHAIN_ADAPTER;
}
