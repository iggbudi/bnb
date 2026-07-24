import 'dotenv/config';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type AggressivePositionStatus = 'OPEN' | 'CLOSED';
export type AggressiveAction = 'WAIT' | 'ENTER' | 'HOLD' | 'RECENTER' | 'EXIT';

export interface AggressivePaperPosition {
  id: number;
  status: AggressivePositionStatus;
  strategyVersion: string;
  openedAt: string;
  updatedAt: string;
  closedAt: string | null;
  investmentUsd: number;
  initialPrice: number;
  initialAmount0: number;
  initialAmount1: number;
  targetValueUsd: number;
  stopValueUsd: number;
  rangePercent: number;
  tickLower: number;
  tickUpper: number;
  priceLowerUsd: number;
  priceUpperUsd: number;
  liquidity: string;
  segmentEntryPrice: number;
  segmentPrincipalUsd: number;
  segmentStartFeeUsd: number;
  segmentStartCostUsd: number;
  accumulatedFeeUsd: number;
  totalCostUsd: number;
  estimatedExitCostUsd: number;
  currentPrincipalUsd: number;
  netLiquidationValueUsd: number;
  recenterCount: number;
  losingRecenterCount: number;
  outOfRangeSince: string | null;
  lastFeeGrowth0X128: string;
  lastFeeGrowth1X128: string;
  lastOnchainCapturedAt: string;
  closeReason: string | null;
}

export interface AggressivePaperActionRecord {
  id: number;
  positionId: number | null;
  createdAt: string;
  action: AggressiveAction;
  reasonCode: string;
  rationale: string;
  metrics: Record<string, unknown>;
}

export interface AggressivePaperEvaluationRecord {
  id: number;
  positionId: number;
  evaluatedAt: string;
  ageHours: number;
  priceUsd: number;
  principalValueUsd: number;
  holdValueUsd: number;
  accumulatedFeeUsd: number;
  feeIncrementUsd: number;
  realizedCostUsd: number;
  estimatedExitCostUsd: number;
  netLiquidationValueUsd: number;
  netPnlUsd: number;
  netReturnPercent: number;
  differenceVsHoldUsd: number;
  inRange: boolean;
  occupancyPercent: number;
  outOfRangeMinutes: number;
  dataQuality: 'valid' | 'insufficient';
  metrics: Record<string, unknown>;
}

export interface AggressivePaperPerformance {
  initialCapitalUsd: number;
  portfolioValueUsd: number;
  portfolioPnlUsd: number;
  portfolioReturnPercent: number;
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  totalFeesUsd: number;
  totalCostsIfExitUsd: number;
  completedPositions: number;
  winningPositions: number;
  losingPositions: number;
  winRatePercent: number | null;
  targetHits: number;
  stopLosses: number;
  totalRecenters: number;
  maxDrawdownPercent: number;
  activePosition: AggressivePaperPosition | null;
  latestEvaluation: AggressivePaperEvaluationRecord | null;
  latestAction: AggressivePaperActionRecord | null;
}

const DEFAULT_DATABASE_PATH = resolve(process.env.SQLITE_PATH || 'data/bnb-viewer.sqlite');

function startOfUtcHour(value: Date): string {
  const hour = new Date(value);
  hour.setUTCMinutes(0, 0, 0);
  return hour.toISOString();
}

export class AggressivePaperStore {
  private readonly database: DatabaseSync;

  constructor(databasePath = DEFAULT_DATABASE_PATH) {
    if (databasePath !== ':memory:') mkdirSync(dirname(databasePath), { recursive: true });
    this.database = new DatabaseSync(databasePath);
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS aggressive_paper_positions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        status TEXT NOT NULL CHECK (status IN ('OPEN', 'CLOSED')),
        strategy_version TEXT NOT NULL,
        opened_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        closed_at TEXT,
        investment_usd REAL NOT NULL,
        initial_price REAL NOT NULL,
        initial_amount0 REAL NOT NULL,
        initial_amount1 REAL NOT NULL,
        target_value_usd REAL NOT NULL,
        stop_value_usd REAL NOT NULL,
        range_percent REAL NOT NULL,
        tick_lower INTEGER NOT NULL,
        tick_upper INTEGER NOT NULL,
        price_lower_usd REAL NOT NULL,
        price_upper_usd REAL NOT NULL,
        liquidity TEXT NOT NULL,
        segment_entry_price REAL NOT NULL,
        segment_principal_usd REAL NOT NULL,
        segment_start_fee_usd REAL NOT NULL DEFAULT 0,
        segment_start_cost_usd REAL NOT NULL DEFAULT 0,
        accumulated_fee_usd REAL NOT NULL DEFAULT 0,
        total_cost_usd REAL NOT NULL DEFAULT 0,
        estimated_exit_cost_usd REAL NOT NULL DEFAULT 0,
        current_principal_usd REAL NOT NULL,
        net_liquidation_value_usd REAL NOT NULL,
        recenter_count INTEGER NOT NULL DEFAULT 0,
        losing_recenter_count INTEGER NOT NULL DEFAULT 0,
        out_of_range_since TEXT,
        last_fee_growth_0_x128 TEXT NOT NULL,
        last_fee_growth_1_x128 TEXT NOT NULL,
        last_onchain_captured_at TEXT NOT NULL,
        close_reason TEXT
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_aggressive_one_open_position
        ON aggressive_paper_positions((1)) WHERE status = 'OPEN';
      CREATE INDEX IF NOT EXISTS idx_aggressive_positions_opened
        ON aggressive_paper_positions(opened_at DESC, id DESC);

      CREATE TABLE IF NOT EXISTS aggressive_paper_actions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        position_id INTEGER,
        created_at TEXT NOT NULL,
        action_hour TEXT NOT NULL,
        action TEXT NOT NULL CHECK (action IN ('WAIT', 'ENTER', 'HOLD', 'RECENTER', 'EXIT')),
        reason_code TEXT NOT NULL,
        rationale TEXT NOT NULL,
        metrics_json TEXT NOT NULL,
        FOREIGN KEY(position_id) REFERENCES aggressive_paper_positions(id)
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_aggressive_actions_hourly
        ON aggressive_paper_actions(COALESCE(position_id, -1), action_hour, action);
      CREATE INDEX IF NOT EXISTS idx_aggressive_actions_created
        ON aggressive_paper_actions(created_at DESC, id DESC);

      CREATE TABLE IF NOT EXISTS aggressive_paper_evaluations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        position_id INTEGER NOT NULL,
        evaluated_at TEXT NOT NULL,
        evaluation_hour TEXT NOT NULL,
        age_hours REAL NOT NULL,
        price_usd REAL NOT NULL,
        principal_value_usd REAL NOT NULL,
        hold_value_usd REAL NOT NULL,
        accumulated_fee_usd REAL NOT NULL,
        fee_increment_usd REAL NOT NULL,
        realized_cost_usd REAL NOT NULL,
        estimated_exit_cost_usd REAL NOT NULL,
        net_liquidation_value_usd REAL NOT NULL,
        net_pnl_usd REAL NOT NULL,
        net_return_percent REAL NOT NULL,
        difference_vs_hold_usd REAL NOT NULL,
        in_range INTEGER NOT NULL,
        occupancy_percent REAL NOT NULL,
        out_of_range_minutes REAL NOT NULL,
        data_quality TEXT NOT NULL CHECK (data_quality IN ('valid', 'insufficient')),
        metrics_json TEXT NOT NULL,
        UNIQUE(position_id, evaluation_hour),
        FOREIGN KEY(position_id) REFERENCES aggressive_paper_positions(id)
      );

      CREATE INDEX IF NOT EXISTS idx_aggressive_evaluations_time
        ON aggressive_paper_evaluations(evaluated_at DESC, id DESC);
    `);
  }

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

  getRecentPositions(limit = 20): AggressivePaperPosition[] {
    const safeLimit = Math.min(100, Math.max(1, Math.floor(limit)));
    const rows = this.database
      .prepare(
        `
      SELECT * FROM aggressive_paper_positions ORDER BY opened_at DESC, id DESC LIMIT ?
    `
      )
      .all(safeLimit) as Array<Record<string, string | number | null>>;
    return rows.map(row => this.mapPosition(row));
  }

  getActions(positionId: number, limit = 100): AggressivePaperActionRecord[] {
    const safeLimit = Math.min(1_000, Math.max(1, Math.floor(limit)));
    const rows = this.database
      .prepare(
        `
      SELECT * FROM aggressive_paper_actions
      WHERE position_id = ? ORDER BY created_at DESC, id DESC LIMIT ?
    `
      )
      .all(positionId, safeLimit) as Array<Record<string, string | number | null>>;
    return rows.map(row => this.mapAction(row));
  }

  getEvaluations(positionId: number, limit = 1_000): AggressivePaperEvaluationRecord[] {
    const safeLimit = Math.min(10_000, Math.max(1, Math.floor(limit)));
    const rows = this.database
      .prepare(
        `
      SELECT * FROM aggressive_paper_evaluations
      WHERE position_id = ? ORDER BY evaluated_at DESC, id DESC LIMIT ?
    `
      )
      .all(positionId, safeLimit) as Array<Record<string, string | number>>;
    return rows.map(row => this.mapEvaluation(row));
  }

  getLatestAction(): AggressivePaperActionRecord | null {
    const row = this.database
      .prepare(
        `
      SELECT * FROM aggressive_paper_actions ORDER BY created_at DESC, id DESC LIMIT 1
    `
      )
      .get() as Record<string, string | number | null> | undefined;
    return row ? this.mapAction(row) : null;
  }

  getLatestEvaluation(positionId?: number): AggressivePaperEvaluationRecord | null {
    const row =
      positionId === undefined
        ? this.database
            .prepare(
              `
          SELECT * FROM aggressive_paper_evaluations ORDER BY evaluated_at DESC, id DESC LIMIT 1
        `
            )
            .get()
        : this.database
            .prepare(
              `
          SELECT * FROM aggressive_paper_evaluations
          WHERE position_id = ? ORDER BY evaluated_at DESC, id DESC LIMIT 1
        `
            )
            .get(positionId);
    return row ? this.mapEvaluation(row as Record<string, string | number>) : null;
  }

  getAvailableCapital(initialCapitalUsd: number): number {
    const active = this.getActivePosition();
    if (active) return active.investmentUsd;
    const latest = this.getRecentPositions(1)[0];
    return latest?.status === 'CLOSED' ? latest.netLiquidationValueUsd : initialCapitalUsd;
  }

  getPerformance(initialCapitalUsd: number): AggressivePaperPerformance {
    const positions = this.getRecentPositions(100).reverse();
    const activePosition = positions.find(position => position.status === 'OPEN') ?? null;
    const closed = positions.filter(position => position.status === 'CLOSED');
    const latestPosition = positions.at(-1) ?? null;
    const portfolioValueUsd =
      activePosition?.netLiquidationValueUsd ?? latestPosition?.netLiquidationValueUsd ?? initialCapitalUsd;
    const realizedPnlUsd = closed.reduce(
      (sum, position) => sum + position.netLiquidationValueUsd - position.investmentUsd,
      0
    );
    const unrealizedPnlUsd = activePosition
      ? activePosition.netLiquidationValueUsd - activePosition.investmentUsd
      : 0;
    const winningPositions = closed.filter(
      position => position.netLiquidationValueUsd > position.investmentUsd
    ).length;
    const losingPositions = closed.filter(
      position => position.netLiquidationValueUsd < position.investmentUsd
    ).length;
    const allEvaluations = this.database
      .prepare(
        `
      SELECT * FROM aggressive_paper_evaluations ORDER BY evaluated_at ASC, id ASC
    `
      )
      .all() as Array<Record<string, string | number>>;
    let peak = initialCapitalUsd;
    let maxDrawdownPercent = 0;
    for (const row of allEvaluations) {
      const value = Number(row.net_liquidation_value_usd);
      peak = Math.max(peak, value);
      if (peak > 0) maxDrawdownPercent = Math.max(maxDrawdownPercent, ((peak - value) / peak) * 100);
    }

    return {
      initialCapitalUsd,
      portfolioValueUsd,
      portfolioPnlUsd: portfolioValueUsd - initialCapitalUsd,
      portfolioReturnPercent: (portfolioValueUsd / initialCapitalUsd - 1) * 100,
      realizedPnlUsd,
      unrealizedPnlUsd,
      totalFeesUsd: positions.reduce((sum, position) => sum + position.accumulatedFeeUsd, 0),
      totalCostsIfExitUsd: positions.reduce(
        (sum, position) => sum + position.totalCostUsd + position.estimatedExitCostUsd,
        0
      ),
      completedPositions: closed.length,
      winningPositions,
      losingPositions,
      winRatePercent: closed.length > 0 ? (winningPositions / closed.length) * 100 : null,
      targetHits: closed.filter(position => position.closeReason === 'TAKE_PROFIT_10_PERCENT').length,
      stopLosses: closed.filter(position => position.closeReason === 'STOP_LOSS_5_PERCENT').length,
      totalRecenters: positions.reduce((sum, position) => sum + position.recenterCount, 0),
      maxDrawdownPercent,
      activePosition,
      latestEvaluation: activePosition
        ? this.getLatestEvaluation(activePosition.id)
        : this.getLatestEvaluation(),
      latestAction: this.getLatestAction(),
    };
  }

  count(): number {
    const row = this.database.prepare(`SELECT COUNT(*) AS count FROM aggressive_paper_positions`).get() as {
      count: number;
    };
    return Number(row.count);
  }

  close(): void {
    this.database.close();
  }

  private mapPosition(row: Record<string, string | number | null>): AggressivePaperPosition {
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

  private mapAction(row: Record<string, string | number | null>): AggressivePaperActionRecord {
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

  private mapEvaluation(row: Record<string, string | number>): AggressivePaperEvaluationRecord {
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
