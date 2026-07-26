import type { PancakeV3OnchainState } from '../../market-data/index.js';

export function estimateLifecycleGas(onchain: PancakeV3OnchainState): {
  entryGasUsd: number;
  estimatedExitGasUsd: number;
} {
  const approvalGasUnits = 2 * 50_000;
  const approvalCostBnb = Number(BigInt(onchain.gas.gasPriceWei) * BigInt(approvalGasUnits)) / 1e18;
  return {
    entryGasUsd: onchain.gas.estimatedMintCostUsd + approvalCostBnb * onchain.priceWbnbUsd,
    estimatedExitGasUsd: onchain.gas.estimatedRebalanceCostUsd,
  };
}
