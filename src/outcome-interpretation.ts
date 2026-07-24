import type { PaperAgentOutcomeDetail, PaperAgentOutcomeInterpretationInput } from './agent-store.js';
import type { OutcomeGasContext } from './outcome-assessment.js';
import { MINIMUM_ACTIONABLE_EDGE_USD } from './outcome-assessment.js';

export const OUTCOME_INTERPRETATION_VERSION = 'lifecycle-v2.1';
export const ENTRY_VERDICT_HORIZON_HOURS = 168;
export const OUTCOME_TRANSACTION_PATH = 'BALANCED_TOKENS_MINT_WITHDRAW' as const;

const SAFETY_ABSTENTION_REASON_CODES = new Set([
  'DATA_INSUFFICIENT',
  'INVALID_MARKET_DATA',
  'ONCHAIN_COST_UNAVAILABLE',
]);

/**
 * Interprets immutable counterfactual outcomes for the actual 7-14 day policy.
 * The default transaction path starts and ends with balanced USDT/WBNB, so
 * mint/decrease/collect do not incur swap slippage. Optional swaps are costed
 * only by an exit proposal that actually requests one.
 */
export function interpretPaperOutcomeLifecycle(
  outcome: PaperAgentOutcomeDetail,
  gas: OutcomeGasContext,
  now = new Date()
): PaperAgentOutcomeInterpretationInput {
  const base = {
    outcomeId: outcome.id,
    interpretedAt: now.toISOString(),
    version: OUTCOME_INTERPRETATION_VERSION,
    minimumActionableEdgeUsd: MINIMUM_ACTIONABLE_EDGE_USD,
    gasSource: gas.gasSource,
    transactionPath: OUTCOME_TRANSACTION_PATH,
  } as const;

  if (outcome.status === 'SKIPPED_DATA_GAP') {
    return {
      ...base,
      role: 'DATA_GAP',
      classification: 'SKIPPED_DATA_GAP',
      accuracyEligible: false,
      trainable: false,
      economicActionCorrect: null,
      grossDifferenceVsHold: null,
      estimatedEntryGasUsd: null,
      estimatedExitGasUsd: null,
      applicableSwapSlippageUsd: null,
      totalLifecycleCostUsd: null,
      economicDifferenceVsHold: null,
      economicReward: null,
      economicRegret: null,
      rationale: 'Outcome tidak diinterpretasikan karena gap data snapshot.',
    };
  }

  if (
    outcome.differenceVsHold === null ||
    !Number.isFinite(gas.entryGasUsd) ||
    !Number.isFinite(gas.exitGasUsd) ||
    gas.entryGasUsd < 0 ||
    gas.exitGasUsd < 0
  )
    throw new Error('Evaluated outcome is missing lifecycle interpretation inputs');

  const applicableSwapSlippageUsd = 0;
  const totalLifecycleCostUsd = gas.entryGasUsd + gas.exitGasUsd + applicableSwapSlippageUsd;
  const economicDifferenceVsHold = outcome.differenceVsHold - totalLifecycleCostUsd;
  const entered = outcome.decision.action === 'ENTER_FULL_RANGE';
  const safetyAbstention = !entered && SAFETY_ABSTENTION_REASON_CODES.has(outcome.decision.reasonCode);

  if (safetyAbstention) {
    return {
      ...base,
      role: 'SAFETY_ABSTENTION',
      classification: 'ABSTAINED_SAFETY',
      accuracyEligible: false,
      trainable: false,
      economicActionCorrect: null,
      grossDifferenceVsHold: outcome.differenceVsHold,
      estimatedEntryGasUsd: gas.entryGasUsd,
      estimatedExitGasUsd: gas.exitGasUsd,
      applicableSwapSlippageUsd,
      totalLifecycleCostUsd,
      economicDifferenceVsHold,
      economicReward: null,
      economicRegret: null,
      rationale: `WAIT ${outcome.decision.reasonCode} adalah safety abstention dan dikeluarkan dari akurasi/training.`,
    };
  }

  const compatibleAccountingSignal =
    outcome.decision.strategyVersion === 'lifecycle-v2.1' ||
    outcome.decision.strategyVersion.startsWith('logistic-');
  if (outcome.horizonHours !== ENTRY_VERDICT_HORIZON_HOURS || !compatibleAccountingSignal) {
    return {
      ...base,
      role: 'EARLY_DIAGNOSTIC',
      classification: 'DIAGNOSTIC_EARLY',
      accuracyEligible: false,
      trainable: false,
      economicActionCorrect: null,
      grossDifferenceVsHold: outcome.differenceVsHold,
      estimatedEntryGasUsd: gas.entryGasUsd,
      estimatedExitGasUsd: gas.exitGasUsd,
      applicableSwapSlippageUsd,
      totalLifecycleCostUsd,
      economicDifferenceVsHold,
      economicReward: null,
      economicRegret: null,
      rationale: !compatibleAccountingSignal
        ? `Sinyal immutable ${outcome.decision.strategyVersion} tidak memakai accounting fee-growth V3 yang kompatibel dan hanya dipakai sebagai diagnostik.`
        : `Horizon ${outcome.horizonHours}h hanya diagnostik; verdict entry ditetapkan pada 168h sesuai minimum hold tujuh hari.`,
    };
  }

  const economicallyShouldEnter = economicDifferenceVsHold >= MINIMUM_ACTIONABLE_EDGE_USD;
  const economicActionCorrect = entered === economicallyShouldEnter;
  const economicReward = entered ? economicDifferenceVsHold : -economicDifferenceVsHold;
  const economicRegret = economicActionCorrect ? 0 : Math.abs(economicDifferenceVsHold);

  return {
    ...base,
    role: 'ENTRY_VERDICT',
    classification: economicActionCorrect ? 'CORRECT' : 'INCORRECT',
    accuracyEligible: true,
    trainable: true,
    economicActionCorrect,
    grossDifferenceVsHold: outcome.differenceVsHold,
    estimatedEntryGasUsd: gas.entryGasUsd,
    estimatedExitGasUsd: gas.exitGasUsd,
    applicableSwapSlippageUsd,
    totalLifecycleCostUsd,
    economicDifferenceVsHold,
    economicReward,
    economicRegret,
    rationale: economicallyShouldEnter
      ? `Net LP 168h mengungguli HOLD setidaknya US$${MINIMUM_ACTIONABLE_EDGE_USD.toFixed(2)} setelah lifecycle gas.`
      : `Net LP 168h belum melewati lifecycle gas dan ambang US$${MINIMUM_ACTIONABLE_EDGE_USD.toFixed(2)}.`,
  };
}
