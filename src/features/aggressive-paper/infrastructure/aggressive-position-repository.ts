import type { DatabaseSync } from 'node:sqlite';
import type {
  AggressiveAction,
  AggressivePaperActionRecord,
  AggressivePaperEvaluationRecord,
  AggressivePaperPosition,
  AggressivePositionStatus,
} from './aggressive-paper-store.js';

function startOfUtcHour(value: Date): string {
  const hour = new Date(value);
  hour.setUTCMinutes(0, 0, 0);
  return hour.toISOString();
}

export class AggressivePositionRepository {
  constructor(protected readonly database: DatabaseSync) {}

  createPosition(
    input: Omit<AggressivePaperPosition, 'id' | 'status' | 'updatedAt' | 'closedAt' | 'closeReason'>
  ): AggressivePaperPosition {
    if (this.getActivePosition()) throw new Error('An aggressive paper position is already open');
    const result = this.database
      .prepare(
        `
      INSERT INTO aggressive_paper_positions (
        status, strategy_version, opened_at, updated_at,
        investment_usd, initial_price, initial_amount0, initial_amount1,
        target_value_usd, stop_value_usd, range_percent,
        tick_lower, tick_upper, price_lower_usd, price_upper_usd, liquidity,
        segment_entry_price, segment_principal_usd,
        segment_start_fee_usd, segment_start_cost_usd,
        accumulated_fee_usd, total_cost_usd, estimated_exit_cost_usd,
        current_principal_usd, net_liquidation_value_usd,
        recenter_count, losing_recenter_count, out_of_range_since,
        last_fee_growth_0_x128, last_fee_growth_1_x128,
        last_onchain_captured_at
      ) VALUES (
        'OPEN', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `
      )
      .run(
        input.strategyVersion,
        input.openedAt,
        input.openedAt,
        input.investmentUsd,
        input.initialPrice,
        input.initialAmount0,
        input.initialAmount1,
        input.targetValueUsd,
        input.stopValueUsd,
        input.rangePercent,
        input.tickLower,
        input.tickUpper,
        input.priceLowerUsd,
        input.priceUpperUsd,
        input.liquidity,
        input.segmentEntryPrice,
        input.segmentPrincipalUsd,
        input.segmentStartFeeUsd,
        input.segmentStartCostUsd,
        input.accumulatedFeeUsd,
        input.totalCostUsd,
        input.estimatedExitCostUsd,
        input.currentPrincipalUsd,
        input.netLiquidationValueUsd,
        input.recenterCount,
        input.losingRecenterCount,
        input.outOfRangeSince,
        input.lastFeeGrowth0X128,
        input.lastFeeGrowth1X128,
        input.lastOnchainCapturedAt
      );
    return this.getPosition(Number(result.lastInsertRowid))!;
  }

  updatePosition(input: {
    id: number;
    rangePercent?: number;
    tickLower?: number;
    tickUpper?: number;
    priceLowerUsd?: number;
    priceUpperUsd?: number;
    liquidity?: string;
    segmentEntryPrice?: number;
    segmentPrincipalUsd?: number;
    segmentStartFeeUsd?: number;
    segmentStartCostUsd?: number;
    accumulatedFeeUsd?: number;
    totalCostUsd?: number;
    estimatedExitCostUsd?: number;
    currentPrincipalUsd?: number;
    netLiquidationValueUsd?: number;
    recenterCount?: number;
    losingRecenterCount?: number;
    outOfRangeSince?: string | null;
    lastFeeGrowth0X128?: string;
    lastFeeGrowth1X128?: string;
    lastOnchainCapturedAt?: string;
    now: Date;
  }): AggressivePaperPosition {
    const current = this.getPosition(input.id);
    if (!current) throw new Error('Aggressive paper position not found');
    if (current.status !== 'OPEN') throw new Error('Closed aggressive position cannot be updated');
    const choose = <T>(value: T | undefined, fallback: T): T => (value === undefined ? fallback : value);
    this.database
      .prepare(
        `
      UPDATE aggressive_paper_positions SET
        updated_at = ?, range_percent = ?, tick_lower = ?, tick_upper = ?,
        price_lower_usd = ?, price_upper_usd = ?, liquidity = ?,
        segment_entry_price = ?, segment_principal_usd = ?,
        segment_start_fee_usd = ?, segment_start_cost_usd = ?,
        accumulated_fee_usd = ?, total_cost_usd = ?, estimated_exit_cost_usd = ?,
        current_principal_usd = ?, net_liquidation_value_usd = ?,
        recenter_count = ?, losing_recenter_count = ?, out_of_range_since = ?,
        last_fee_growth_0_x128 = ?, last_fee_growth_1_x128 = ?,
        last_onchain_captured_at = ?
      WHERE id = ? AND status = 'OPEN'
    `
      )
      .run(
        input.now.toISOString(),
        choose(input.rangePercent, current.rangePercent),
        choose(input.tickLower, current.tickLower),
        choose(input.tickUpper, current.tickUpper),
        choose(input.priceLowerUsd, current.priceLowerUsd),
        choose(input.priceUpperUsd, current.priceUpperUsd),
        choose(input.liquidity, current.liquidity),
        choose(input.segmentEntryPrice, current.segmentEntryPrice),
        choose(input.segmentPrincipalUsd, current.segmentPrincipalUsd),
        choose(input.segmentStartFeeUsd, current.segmentStartFeeUsd),
        choose(input.segmentStartCostUsd, current.segmentStartCostUsd),
        choose(input.accumulatedFeeUsd, current.accumulatedFeeUsd),
        choose(input.totalCostUsd, current.totalCostUsd),
        choose(input.estimatedExitCostUsd, current.estimatedExitCostUsd),
        choose(input.currentPrincipalUsd, current.currentPrincipalUsd),
        choose(input.netLiquidationValueUsd, current.netLiquidationValueUsd),
        choose(input.recenterCount, current.recenterCount),
        choose(input.losingRecenterCount, current.losingRecenterCount),
        choose(input.outOfRangeSince, current.outOfRangeSince),
        choose(input.lastFeeGrowth0X128, current.lastFeeGrowth0X128),
        choose(input.lastFeeGrowth1X128, current.lastFeeGrowth1X128),
        choose(input.lastOnchainCapturedAt, current.lastOnchainCapturedAt),
        input.id
      );
    return this.getPosition(input.id)!;
  }

  closePosition(input: {
    id: number;
    totalCostUsd: number;
    netLiquidationValueUsd: number;
    closeReason: string;
    now: Date;
  }): AggressivePaperPosition {
    const current = this.getPosition(input.id);
    if (!current || current.status !== 'OPEN') throw new Error('Open aggressive position not found');
    this.database
      .prepare(
        `
      UPDATE aggressive_paper_positions SET
        status = 'CLOSED', updated_at = ?, closed_at = ?,
        total_cost_usd = ?, estimated_exit_cost_usd = 0,
        net_liquidation_value_usd = ?, close_reason = ?
      WHERE id = ? AND status = 'OPEN'
    `
      )
      .run(
        input.now.toISOString(),
        input.now.toISOString(),
        input.totalCostUsd,
        input.netLiquidationValueUsd,
        input.closeReason,
        input.id
      );
    return this.getPosition(input.id)!;
  }

  recordAction(input: {
    positionId?: number | null;
    action: AggressiveAction;
    reasonCode: string;
    rationale: string;
    metrics?: Record<string, unknown>;
    now: Date;
  }): AggressivePaperActionRecord {
    const actionHour = startOfUtcHour(input.now);
    this.database
      .prepare(
        `
      INSERT OR IGNORE INTO aggressive_paper_actions (
        position_id, created_at, action_hour, action, reason_code, rationale, metrics_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        input.positionId ?? null,
        input.now.toISOString(),
        actionHour,
        input.action,
        input.reasonCode,
        input.rationale,
        JSON.stringify(input.metrics ?? {})
      );
    const row = this.database
      .prepare(
        `
      SELECT * FROM aggressive_paper_actions
      WHERE COALESCE(position_id, -1) = COALESCE(?, -1)
        AND action_hour = ? AND action = ?
    `
      )
      .get(input.positionId ?? null, actionHour, input.action) as
      Record<string, string | number | null> | undefined;
    if (!row) throw new Error('Aggressive paper action could not be stored');
    return this.mapAction(row);
  }

  recordEvaluation(input: Omit<AggressivePaperEvaluationRecord, 'id'>): AggressivePaperEvaluationRecord {
    const evaluationHour = startOfUtcHour(new Date(input.evaluatedAt));
    this.database
      .prepare(
        `
      INSERT OR IGNORE INTO aggressive_paper_evaluations (
        position_id, evaluated_at, evaluation_hour, age_hours, price_usd,
        principal_value_usd, hold_value_usd, accumulated_fee_usd,
        fee_increment_usd, realized_cost_usd, estimated_exit_cost_usd,
        net_liquidation_value_usd, net_pnl_usd, net_return_percent,
        difference_vs_hold_usd, in_range, occupancy_percent,
        out_of_range_minutes, data_quality, metrics_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        input.positionId,
        input.evaluatedAt,
        evaluationHour,
        input.ageHours,
        input.priceUsd,
        input.principalValueUsd,
        input.holdValueUsd,
        input.accumulatedFeeUsd,
        input.feeIncrementUsd,
        input.realizedCostUsd,
        input.estimatedExitCostUsd,
        input.netLiquidationValueUsd,
        input.netPnlUsd,
        input.netReturnPercent,
        input.differenceVsHoldUsd,
        Number(input.inRange),
        input.occupancyPercent,
        input.outOfRangeMinutes,
        input.dataQuality,
        JSON.stringify(input.metrics)
      );
    const row = this.database
      .prepare(
        `
      SELECT * FROM aggressive_paper_evaluations
      WHERE position_id = ? AND evaluation_hour = ?
    `
      )
      .get(input.positionId, evaluationHour) as Record<string, string | number> | undefined;
    if (!row) throw new Error('Aggressive paper evaluation could not be stored');
    return this.mapEvaluation(row);
  }

  getPosition(id: number): AggressivePaperPosition | null {
    const row = this.database.prepare(`SELECT * FROM aggressive_paper_positions WHERE id = ?`).get(id) as
      Record<string, string | number | null> | undefined;
    return row ? this.mapPosition(row) : null;
  }

  getActivePosition(): AggressivePaperPosition | null {
    const row = this.database
      .prepare(
        `
      SELECT * FROM aggressive_paper_positions WHERE status = 'OPEN' ORDER BY id DESC LIMIT 1
    `
      )
      .get() as Record<string, string | number | null> | undefined;
    return row ? this.mapPosition(row) : null;
  }

  protected mapPosition(row: Record<string, string | number | null>): AggressivePaperPosition {
    return {
      id: Number(row.id),
      status: String(row.status) as AggressivePositionStatus,
      strategyVersion: String(row.strategy_version),
      openedAt: String(row.opened_at),
      updatedAt: String(row.updated_at),
      closedAt: row.closed_at === null ? null : String(row.closed_at),
      investmentUsd: Number(row.investment_usd),
      initialPrice: Number(row.initial_price),
      initialAmount0: Number(row.initial_amount0),
      initialAmount1: Number(row.initial_amount1),
      targetValueUsd: Number(row.target_value_usd),
      stopValueUsd: Number(row.stop_value_usd),
      rangePercent: Number(row.range_percent),
      tickLower: Number(row.tick_lower),
      tickUpper: Number(row.tick_upper),
      priceLowerUsd: Number(row.price_lower_usd),
      priceUpperUsd: Number(row.price_upper_usd),
      liquidity: String(row.liquidity),
      segmentEntryPrice: Number(row.segment_entry_price),
      segmentPrincipalUsd: Number(row.segment_principal_usd),
      segmentStartFeeUsd: Number(row.segment_start_fee_usd),
      segmentStartCostUsd: Number(row.segment_start_cost_usd),
      accumulatedFeeUsd: Number(row.accumulated_fee_usd),
      totalCostUsd: Number(row.total_cost_usd),
      estimatedExitCostUsd: Number(row.estimated_exit_cost_usd),
      currentPrincipalUsd: Number(row.current_principal_usd),
      netLiquidationValueUsd: Number(row.net_liquidation_value_usd),
      recenterCount: Number(row.recenter_count),
      losingRecenterCount: Number(row.losing_recenter_count),
      outOfRangeSince: row.out_of_range_since === null ? null : String(row.out_of_range_since),
      lastFeeGrowth0X128: String(row.last_fee_growth_0_x128),
      lastFeeGrowth1X128: String(row.last_fee_growth_1_x128),
      lastOnchainCapturedAt: String(row.last_onchain_captured_at),
      closeReason: row.close_reason === null ? null : String(row.close_reason),
    };
  }

  protected mapAction(row: Record<string, string | number | null>): AggressivePaperActionRecord {
    return {
      id: Number(row.id),
      positionId: row.position_id === null ? null : Number(row.position_id),
      createdAt: String(row.created_at),
      action: String(row.action) as AggressiveAction,
      reasonCode: String(row.reason_code),
      rationale: String(row.rationale),
      metrics: JSON.parse(String(row.metrics_json)) as Record<string, unknown>,
    };
  }

  protected mapEvaluation(row: Record<string, string | number>): AggressivePaperEvaluationRecord {
    return {
      id: Number(row.id),
      positionId: Number(row.position_id),
      evaluatedAt: String(row.evaluated_at),
      ageHours: Number(row.age_hours),
      priceUsd: Number(row.price_usd),
      principalValueUsd: Number(row.principal_value_usd),
      holdValueUsd: Number(row.hold_value_usd),
      accumulatedFeeUsd: Number(row.accumulated_fee_usd),
      feeIncrementUsd: Number(row.fee_increment_usd),
      realizedCostUsd: Number(row.realized_cost_usd),
      estimatedExitCostUsd: Number(row.estimated_exit_cost_usd),
      netLiquidationValueUsd: Number(row.net_liquidation_value_usd),
      netPnlUsd: Number(row.net_pnl_usd),
      netReturnPercent: Number(row.net_return_percent),
      differenceVsHoldUsd: Number(row.difference_vs_hold_usd),
      inRange: Number(row.in_range) === 1,
      occupancyPercent: Number(row.occupancy_percent),
      outOfRangeMinutes: Number(row.out_of_range_minutes),
      dataQuality: String(row.data_quality) as AggressivePaperEvaluationRecord['dataQuality'],
      metrics: JSON.parse(String(row.metrics_json)) as Record<string, unknown>,
    };
  }
}
