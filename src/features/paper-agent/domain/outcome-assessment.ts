import type { PaperAgentOutcomeAssessmentInput, PaperAgentOutcomeDetail } from '../../../agent-store.js';

export const OUTCOME_ASSESSMENT_VERSION = 'economic-v1.0';
export const ECONOMIC_SLIPPAGE_BPS_PER_LEG = 5;
export const MINIMUM_ACTIONABLE_EDGE_USD = 0.01;
export const ASSUMED_ENTRY_GAS_UNITS = 600_000;
export const ASSUMED_EXIT_GAS_UNITS = 800_000;

const SAFETY_ABSTENTION_REASON_CODES = new Set(['DATA_INSUFFICIENT', 'INVALID_MARKET_DATA']);

export interface OutcomeGasContext {
  entryGasUsd: number;
  exitGasUsd: number;
  gasSource: 'HISTORICAL_ONCHAIN' | 'CURRENT_FALLBACK';
}

export function gasCostUsd(gasPriceWei: string, gasUnits: number, priceWbnbUsd: number): number {
  if (!/^\d+$/.test(gasPriceWei) || !Number.isInteger(gasUnits) || gasUnits <= 0 || !(priceWbnbUsd > 0)) {
    throw new Error('Invalid gas assessment inputs');
  }
  return (Number(BigInt(gasPriceWei) * BigInt(gasUnits)) / 1e18) * priceWbnbUsd;
}

export function assessPaperOutcomeEconomics(
  outcome: PaperAgentOutcomeDetail,
  gas: OutcomeGasContext,
  now = new Date()
): PaperAgentOutcomeAssessmentInput {
  if (outcome.status === 'SKIPPED_DATA_GAP') {
    return {
      outcomeId: outcome.id,
      assessedAt: now.toISOString(),
      version: OUTCOME_ASSESSMENT_VERSION,
      classification: 'SKIPPED_DATA_GAP',
      trainable: false,
      safetyAbstention: false,
      strictActionCorrect: null,
      economicActionCorrect: null,
      grossDifferenceVsHold: null,
      estimatedEntryGasUsd: null,
      estimatedExitGasUsd: null,
      estimatedSlippageUsd: null,
      totalLifecycleCostUsd: null,
      economicDifferenceVsHold: null,
      minimumActionableEdgeUsd: MINIMUM_ACTIONABLE_EDGE_USD,
      economicReward: null,
      economicRegret: null,
      gasSource: gas.gasSource,
      rationale: 'Outcome tidak dinilai karena gap data snapshot.',
    };
  }
  if (
    outcome.differenceVsHold === null ||
    outcome.lpValueAfterFee === null ||
    !Number.isFinite(gas.entryGasUsd) ||
    !Number.isFinite(gas.exitGasUsd) ||
    gas.entryGasUsd < 0 ||
    gas.exitGasUsd < 0
  )
    throw new Error('Evaluated outcome is missing economic inputs');

  const slippageRate = ECONOMIC_SLIPPAGE_BPS_PER_LEG / 10_000;
  const estimatedSlippageUsd =
    outcome.decision.investment * slippageRate + outcome.lpValueAfterFee * slippageRate;
  const totalLifecycleCostUsd = gas.entryGasUsd + gas.exitGasUsd + estimatedSlippageUsd;
  const economicDifferenceVsHold = outcome.differenceVsHold - totalLifecycleCostUsd;
  const economicallyShouldEnter = economicDifferenceVsHold > MINIMUM_ACTIONABLE_EDGE_USD;
  const entered = outcome.decision.action === 'ENTER_FULL_RANGE';
  const safetyAbstention = !entered && SAFETY_ABSTENTION_REASON_CODES.has(outcome.decision.reasonCode);
  const economicActionCorrect = safetyAbstention ? null : entered === economicallyShouldEnter;
  const economicReward = safetyAbstention
    ? null
    : entered
      ? economicDifferenceVsHold
      : -economicDifferenceVsHold;
  const economicRegret =
    safetyAbstention || economicActionCorrect
      ? safetyAbstention
        ? null
        : 0
      : Math.abs(economicDifferenceVsHold);
  const classification = safetyAbstention
    ? 'ABSTAINED_SAFETY'
    : economicActionCorrect
      ? 'CORRECT'
      : 'INCORRECT';

  return {
    outcomeId: outcome.id,
    assessedAt: now.toISOString(),
    version: OUTCOME_ASSESSMENT_VERSION,
    classification,
    trainable: !safetyAbstention,
    safetyAbstention,
    strictActionCorrect: outcome.actionCorrect,
    economicActionCorrect,
    grossDifferenceVsHold: outcome.differenceVsHold,
    estimatedEntryGasUsd: gas.entryGasUsd,
    estimatedExitGasUsd: gas.exitGasUsd,
    estimatedSlippageUsd,
    totalLifecycleCostUsd,
    economicDifferenceVsHold,
    minimumActionableEdgeUsd: MINIMUM_ACTIONABLE_EDGE_USD,
    economicReward,
    economicRegret,
    gasSource: gas.gasSource,
    rationale: safetyAbstention
      ? `WAIT ${outcome.decision.reasonCode} adalah safety abstention dan dikeluarkan dari akurasi/training.`
      : economicallyShouldEnter
        ? `Net LP mengungguli HOLD lebih dari ambang US$${MINIMUM_ACTIONABLE_EDGE_USD.toFixed(2)} setelah gas dan estimasi slippage.`
        : `Keunggulan LP tidak menutup lifecycle cost dan ambang ekonomi US$${MINIMUM_ACTIONABLE_EDGE_USD.toFixed(2)}.`,
  };
}
