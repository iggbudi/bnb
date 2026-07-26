import { DatabaseSync } from 'node:sqlite';
import { applicationDatabasePath, openApplicationDatabase } from '../../../shared/database/connection.js';

import type { DirectionalSide, DirectionalStrategyConfig } from '../domain/directional-strategy.js';

export type DirectionalRunMode = 'BACKTEST' | 'FORWARD';
export type DirectionalRunStatus = 'ACTIVE' | 'COMPLETED' | 'PAUSED';
export type DirectionalPositionStatus = 'OPEN' | 'CLOSED';
export type DirectionalDecisionAction = 'WAIT' | 'OPEN_LONG' | 'OPEN_SHORT' | 'HOLD' | 'CLOSE';

export interface DirectionalPaperRun {
  id: number;
  mode: DirectionalRunMode;
  status: DirectionalRunStatus;
  strategyVersion: string;
  startedAt: string;
  endedAt: string | null;
  initialEquityUsd: number;
  realizedBalanceUsd: number;
  markEquityUsd: number;
  peakEquityUsd: number;
  maxDrawdownPercent: number;
  lastProcessedAt: string | null;
  config: DirectionalStrategyConfig;
  sourceLabel: string;
}

export interface DirectionalPaperPosition {
  id: number;
  runId: number;
  side: DirectionalSide;
  status: DirectionalPositionStatus;
  openedAt: string;
  updatedAt: string;
  closedAt: string | null;
  signalPrice: number;
  entryFillPrice: number;
  exitFillPrice: number | null;
  quantity: number;
  leverage: number;
  marginUsd: number;
  notionalUsd: number;
  takeProfitPrice: number;
  stopLossPrice: number;
  liquidationPrice: number;
  trailingStopPrice: number | null;
  bestPrice: number;
  entryFeeUsd: number;
  exitFeeUsd: number;
  fundingPaymentUsd: number;
  unrealizedPnlUsd: number;
  realizedPnlUsd: number | null;
  closeReason: string | null;
}

export interface DirectionalPaperDecision {
  id: number;
  runId: number;
  positionId: number | null;
  capturedAt: string;
  action: DirectionalDecisionAction;
  reasonCode: string;
  rationale: string;
  priceUsd: number;
  confidence: number;
  features: Record<string, unknown>;
}

export interface DirectionalPaperFill {
  id: number;
  positionId: number;
  filledAt: string;
  fillType: 'ENTRY' | 'EXIT';
  orderSide: 'BUY' | 'SELL';
  priceUsd: number;
  quantity: number;
  notionalUsd: number;
  feeUsd: number;
  slippageBps: number;
}

export interface DirectionalPaperEvaluation {
  id: number;
  positionId: number;
  evaluatedAt: string;
  markPriceUsd: number;
  rawUnrealizedPnlUsd: number;
  estimatedExitFeeUsd: number;
  fundingPaymentUsd: number;
  netUnrealizedPnlUsd: number;
  accountEquityUsd: number;
  drawdownPercent: number;
  takeProfitPrice: number;
  stopLossPrice: number;
  liquidationPrice: number;
  trailingStopPrice: number | null;
}

export interface DirectionalRunPerformance {
  run: DirectionalPaperRun;
  activePosition: DirectionalPaperPosition | null;
  latestDecision: DirectionalPaperDecision | null;
  latestEvaluation: DirectionalPaperEvaluation | null;
  completedPositions: number;
  winningPositions: number;
  losingPositions: number;
  winRatePercent: number | null;
  totalRealizedPnlUsd: number;
  totalFeesUsd: number;
  totalFundingUsd: number;
}

export function createDirectionalPaperSchema(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS directional_paper_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mode TEXT NOT NULL CHECK (mode IN ('BACKTEST', 'FORWARD')),
      status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'COMPLETED', 'PAUSED')),
      strategy_version TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      initial_equity_usd REAL NOT NULL,
      realized_balance_usd REAL NOT NULL,
      mark_equity_usd REAL NOT NULL,
      peak_equity_usd REAL NOT NULL,
      max_drawdown_percent REAL NOT NULL DEFAULT 0,
      last_processed_at TEXT,
      config_json TEXT NOT NULL,
      source_label TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_directional_one_active_forward
      ON directional_paper_runs((1)) WHERE mode = 'FORWARD' AND status = 'ACTIVE';
    CREATE INDEX IF NOT EXISTS idx_directional_runs_started
      ON directional_paper_runs(started_at DESC, id DESC);

    CREATE TABLE IF NOT EXISTS directional_paper_positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL,
      side TEXT NOT NULL CHECK (side IN ('LONG', 'SHORT')),
      status TEXT NOT NULL CHECK (status IN ('OPEN', 'CLOSED')),
      opened_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      closed_at TEXT,
      signal_price REAL NOT NULL,
      entry_fill_price REAL NOT NULL,
      exit_fill_price REAL,
      quantity REAL NOT NULL,
      leverage REAL NOT NULL,
      margin_usd REAL NOT NULL,
      notional_usd REAL NOT NULL,
      take_profit_price REAL NOT NULL,
      stop_loss_price REAL NOT NULL,
      liquidation_price REAL NOT NULL,
      trailing_stop_price REAL,
      best_price REAL NOT NULL,
      entry_fee_usd REAL NOT NULL,
      exit_fee_usd REAL NOT NULL DEFAULT 0,
      funding_payment_usd REAL NOT NULL DEFAULT 0,
      unrealized_pnl_usd REAL NOT NULL DEFAULT 0,
      realized_pnl_usd REAL,
      close_reason TEXT,
      FOREIGN KEY(run_id) REFERENCES directional_paper_runs(id)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_directional_one_open_per_run
      ON directional_paper_positions(run_id) WHERE status = 'OPEN';
    CREATE INDEX IF NOT EXISTS idx_directional_positions_run_time
      ON directional_paper_positions(run_id, opened_at DESC, id DESC);

    CREATE TABLE IF NOT EXISTS directional_paper_decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL,
      position_id INTEGER,
      captured_at TEXT NOT NULL,
      action TEXT NOT NULL CHECK (action IN ('WAIT', 'OPEN_LONG', 'OPEN_SHORT', 'HOLD', 'CLOSE')),
      reason_code TEXT NOT NULL,
      rationale TEXT NOT NULL,
      price_usd REAL NOT NULL,
      confidence REAL NOT NULL,
      features_json TEXT NOT NULL,
      UNIQUE(run_id, captured_at),
      FOREIGN KEY(run_id) REFERENCES directional_paper_runs(id),
      FOREIGN KEY(position_id) REFERENCES directional_paper_positions(id)
    );

    CREATE INDEX IF NOT EXISTS idx_directional_decisions_run_time
      ON directional_paper_decisions(run_id, captured_at DESC, id DESC);

    CREATE TABLE IF NOT EXISTS directional_paper_fills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      position_id INTEGER NOT NULL,
      filled_at TEXT NOT NULL,
      fill_type TEXT NOT NULL CHECK (fill_type IN ('ENTRY', 'EXIT')),
      order_side TEXT NOT NULL CHECK (order_side IN ('BUY', 'SELL')),
      price_usd REAL NOT NULL,
      quantity REAL NOT NULL,
      notional_usd REAL NOT NULL,
      fee_usd REAL NOT NULL,
      slippage_bps REAL NOT NULL,
      UNIQUE(position_id, fill_type),
      FOREIGN KEY(position_id) REFERENCES directional_paper_positions(id)
    );

    CREATE INDEX IF NOT EXISTS idx_directional_fills_time
      ON directional_paper_fills(filled_at DESC, id DESC);

    CREATE TABLE IF NOT EXISTS directional_paper_evaluations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      position_id INTEGER NOT NULL,
      evaluated_at TEXT NOT NULL,
      mark_price_usd REAL NOT NULL,
      raw_unrealized_pnl_usd REAL NOT NULL,
      estimated_exit_fee_usd REAL NOT NULL,
      funding_payment_usd REAL NOT NULL,
      net_unrealized_pnl_usd REAL NOT NULL,
      account_equity_usd REAL NOT NULL,
      drawdown_percent REAL NOT NULL,
      take_profit_price REAL NOT NULL,
      stop_loss_price REAL NOT NULL,
      liquidation_price REAL NOT NULL,
      trailing_stop_price REAL,
      UNIQUE(position_id, evaluated_at),
      FOREIGN KEY(position_id) REFERENCES directional_paper_positions(id)
    );

    CREATE INDEX IF NOT EXISTS idx_directional_evaluations_time
      ON directional_paper_evaluations(evaluated_at DESC, id DESC);
  `);
}

function jsonObject(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

export class DirectionalPaperStore {
  private readonly database: DatabaseSync;

  constructor(databasePath = applicationDatabasePath()) {
    this.database = openApplicationDatabase(databasePath, { foreignKeys: true });
    createDirectionalPaperSchema(this.database);
  }

  transaction<T>(operation: () => T): T {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.database.exec('COMMIT');
      return result;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  createRun(input: {
    mode: DirectionalRunMode;
    startedAt: string;
    config: DirectionalStrategyConfig;
    sourceLabel: string;
  }): DirectionalPaperRun {
    const equity = input.config.initialCapitalUsd;
    const result = this.database
      .prepare(
        `INSERT INTO directional_paper_runs (
          mode, status, strategy_version, started_at,
          initial_equity_usd, realized_balance_usd, mark_equity_usd, peak_equity_usd,
          config_json, source_label
        ) VALUES (?, 'ACTIVE', ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.mode,
        input.config.strategyVersion,
        input.startedAt,
        equity,
        equity,
        equity,
        equity,
        JSON.stringify(input.config),
        input.sourceLabel
      );
    return this.getRun(Number(result.lastInsertRowid))!;
  }

  getRun(id: number): DirectionalPaperRun | null {
    const row = this.database.prepare('SELECT * FROM directional_paper_runs WHERE id = ?').get(id) as
      Record<string, string | number | null> | undefined;
    return row ? this.mapRun(row) : null;
  }

  getActiveForwardRun(): DirectionalPaperRun | null {
    const row = this.database
      .prepare("SELECT * FROM directional_paper_runs WHERE mode = 'FORWARD' AND status = 'ACTIVE' LIMIT 1")
      .get() as Record<string, string | number | null> | undefined;
    return row ? this.mapRun(row) : null;
  }

  getLatestRun(mode?: DirectionalRunMode): DirectionalPaperRun | null {
    const row = mode
      ? (this.database
          .prepare('SELECT * FROM directional_paper_runs WHERE mode = ? ORDER BY id DESC LIMIT 1')
          .get(mode) as Record<string, string | number | null> | undefined)
      : (this.database.prepare('SELECT * FROM directional_paper_runs ORDER BY id DESC LIMIT 1').get() as
          Record<string, string | number | null> | undefined);
    return row ? this.mapRun(row) : null;
  }

  getRecentRuns(limit = 20): DirectionalPaperRun[] {
    return (
      this.database
        .prepare('SELECT * FROM directional_paper_runs ORDER BY id DESC LIMIT ?')
        .all(limit) as Array<Record<string, string | number | null>>
    ).map(row => this.mapRun(row));
  }

  updateRunMark(input: {
    id: number;
    realizedBalanceUsd: number;
    markEquityUsd: number;
    peakEquityUsd: number;
    maxDrawdownPercent: number;
    lastProcessedAt: string;
  }): DirectionalPaperRun {
    this.database
      .prepare(
        `UPDATE directional_paper_runs SET
          realized_balance_usd = ?, mark_equity_usd = ?, peak_equity_usd = ?,
          max_drawdown_percent = ?, last_processed_at = ?
        WHERE id = ?`
      )
      .run(
        input.realizedBalanceUsd,
        input.markEquityUsd,
        input.peakEquityUsd,
        input.maxDrawdownPercent,
        input.lastProcessedAt,
        input.id
      );
    return this.getRun(input.id)!;
  }

  completeRun(id: number, endedAt: string): DirectionalPaperRun {
    this.database
      .prepare(
        `UPDATE directional_paper_runs
         SET status = 'COMPLETED', ended_at = ?, last_processed_at = ?
         WHERE id = ? AND status = 'ACTIVE'`
      )
      .run(endedAt, endedAt, id);
    return this.getRun(id)!;
  }

  hasDecision(runId: number, capturedAt: string): boolean {
    return Boolean(
      this.database
        .prepare('SELECT 1 FROM directional_paper_decisions WHERE run_id = ? AND captured_at = ?')
        .get(runId, capturedAt)
    );
  }

  saveDecision(input: Omit<DirectionalPaperDecision, 'id'>): DirectionalPaperDecision {
    const result = this.database
      .prepare(
        `INSERT INTO directional_paper_decisions (
          run_id, position_id, captured_at, action, reason_code, rationale,
          price_usd, confidence, features_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.runId,
        input.positionId,
        input.capturedAt,
        input.action,
        input.reasonCode,
        input.rationale,
        input.priceUsd,
        input.confidence,
        JSON.stringify(input.features)
      );
    return this.getDecision(Number(result.lastInsertRowid))!;
  }

  getDecision(id: number): DirectionalPaperDecision | null {
    const row = this.database.prepare('SELECT * FROM directional_paper_decisions WHERE id = ?').get(id) as
      Record<string, string | number | null> | undefined;
    return row ? this.mapDecision(row) : null;
  }

  getRecentDecisions(runId: number, limit = 100): DirectionalPaperDecision[] {
    return (
      this.database
        .prepare(
          'SELECT * FROM directional_paper_decisions WHERE run_id = ? ORDER BY captured_at DESC, id DESC LIMIT ?'
        )
        .all(runId, limit) as Array<Record<string, string | number | null>>
    ).map(row => this.mapDecision(row));
  }

  createPosition(
    input: Omit<
      DirectionalPaperPosition,
      | 'id'
      | 'status'
      | 'updatedAt'
      | 'closedAt'
      | 'exitFillPrice'
      | 'exitFeeUsd'
      | 'fundingPaymentUsd'
      | 'unrealizedPnlUsd'
      | 'realizedPnlUsd'
      | 'closeReason'
    >
  ): DirectionalPaperPosition {
    const result = this.database
      .prepare(
        `INSERT INTO directional_paper_positions (
          run_id, side, status, opened_at, updated_at, signal_price, entry_fill_price,
          quantity, leverage, margin_usd, notional_usd, take_profit_price, stop_loss_price,
          liquidation_price, trailing_stop_price, best_price, entry_fee_usd
        ) VALUES (?, ?, 'OPEN', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.runId,
        input.side,
        input.openedAt,
        input.openedAt,
        input.signalPrice,
        input.entryFillPrice,
        input.quantity,
        input.leverage,
        input.marginUsd,
        input.notionalUsd,
        input.takeProfitPrice,
        input.stopLossPrice,
        input.liquidationPrice,
        input.trailingStopPrice,
        input.bestPrice,
        input.entryFeeUsd
      );
    return this.getPosition(Number(result.lastInsertRowid))!;
  }

  getPosition(id: number): DirectionalPaperPosition | null {
    const row = this.database.prepare('SELECT * FROM directional_paper_positions WHERE id = ?').get(id) as
      Record<string, string | number | null> | undefined;
    return row ? this.mapPosition(row) : null;
  }

  getOpenPosition(runId: number): DirectionalPaperPosition | null {
    const row = this.database
      .prepare("SELECT * FROM directional_paper_positions WHERE run_id = ? AND status = 'OPEN' LIMIT 1")
      .get(runId) as Record<string, string | number | null> | undefined;
    return row ? this.mapPosition(row) : null;
  }

  getRecentPositions(runId: number, limit = 100): DirectionalPaperPosition[] {
    return (
      this.database
        .prepare(
          'SELECT * FROM directional_paper_positions WHERE run_id = ? ORDER BY opened_at DESC, id DESC LIMIT ?'
        )
        .all(runId, limit) as Array<Record<string, string | number | null>>
    ).map(row => this.mapPosition(row));
  }

  getLatestClosedPosition(runId: number): DirectionalPaperPosition | null {
    const row = this.database
      .prepare(
        "SELECT * FROM directional_paper_positions WHERE run_id = ? AND status = 'CLOSED' ORDER BY closed_at DESC, id DESC LIMIT 1"
      )
      .get(runId) as Record<string, string | number | null> | undefined;
    return row ? this.mapPosition(row) : null;
  }

  updateOpenPosition(input: {
    id: number;
    updatedAt: string;
    bestPrice: number;
    trailingStopPrice: number | null;
    unrealizedPnlUsd: number;
    fundingPaymentUsd: number;
  }): DirectionalPaperPosition {
    this.database
      .prepare(
        `UPDATE directional_paper_positions SET
          updated_at = ?, best_price = ?, trailing_stop_price = ?,
          unrealized_pnl_usd = ?, funding_payment_usd = ?
        WHERE id = ? AND status = 'OPEN'`
      )
      .run(
        input.updatedAt,
        input.bestPrice,
        input.trailingStopPrice,
        input.unrealizedPnlUsd,
        input.fundingPaymentUsd,
        input.id
      );
    return this.getPosition(input.id)!;
  }

  closePosition(input: {
    id: number;
    closedAt: string;
    exitFillPrice: number;
    exitFeeUsd: number;
    fundingPaymentUsd: number;
    realizedPnlUsd: number;
    closeReason: string;
  }): DirectionalPaperPosition {
    this.database
      .prepare(
        `UPDATE directional_paper_positions SET
          status = 'CLOSED', updated_at = ?, closed_at = ?, exit_fill_price = ?,
          exit_fee_usd = ?, funding_payment_usd = ?, unrealized_pnl_usd = 0,
          realized_pnl_usd = ?, close_reason = ?
        WHERE id = ? AND status = 'OPEN'`
      )
      .run(
        input.closedAt,
        input.closedAt,
        input.exitFillPrice,
        input.exitFeeUsd,
        input.fundingPaymentUsd,
        input.realizedPnlUsd,
        input.closeReason,
        input.id
      );
    return this.getPosition(input.id)!;
  }

  saveFill(input: Omit<DirectionalPaperFill, 'id'>): DirectionalPaperFill {
    const result = this.database
      .prepare(
        `INSERT INTO directional_paper_fills (
          position_id, filled_at, fill_type, order_side, price_usd,
          quantity, notional_usd, fee_usd, slippage_bps
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.positionId,
        input.filledAt,
        input.fillType,
        input.orderSide,
        input.priceUsd,
        input.quantity,
        input.notionalUsd,
        input.feeUsd,
        input.slippageBps
      );
    const row = this.database
      .prepare('SELECT * FROM directional_paper_fills WHERE id = ?')
      .get(Number(result.lastInsertRowid)) as Record<string, string | number>;
    return this.mapFill(row);
  }

  getFills(positionId: number): DirectionalPaperFill[] {
    return (
      this.database
        .prepare('SELECT * FROM directional_paper_fills WHERE position_id = ? ORDER BY id ASC')
        .all(positionId) as Array<Record<string, string | number>>
    ).map(row => this.mapFill(row));
  }

  saveEvaluation(input: Omit<DirectionalPaperEvaluation, 'id'>): DirectionalPaperEvaluation {
    const result = this.database
      .prepare(
        `INSERT INTO directional_paper_evaluations (
          position_id, evaluated_at, mark_price_usd, raw_unrealized_pnl_usd,
          estimated_exit_fee_usd, funding_payment_usd, net_unrealized_pnl_usd,
          account_equity_usd, drawdown_percent, take_profit_price, stop_loss_price,
          liquidation_price, trailing_stop_price
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.positionId,
        input.evaluatedAt,
        input.markPriceUsd,
        input.rawUnrealizedPnlUsd,
        input.estimatedExitFeeUsd,
        input.fundingPaymentUsd,
        input.netUnrealizedPnlUsd,
        input.accountEquityUsd,
        input.drawdownPercent,
        input.takeProfitPrice,
        input.stopLossPrice,
        input.liquidationPrice,
        input.trailingStopPrice
      );
    return this.getEvaluation(Number(result.lastInsertRowid))!;
  }

  getEvaluation(id: number): DirectionalPaperEvaluation | null {
    const row = this.database.prepare('SELECT * FROM directional_paper_evaluations WHERE id = ?').get(id) as
      Record<string, string | number | null> | undefined;
    return row ? this.mapEvaluation(row) : null;
  }

  getRecentEvaluations(positionId: number, limit = 100): DirectionalPaperEvaluation[] {
    return (
      this.database
        .prepare(
          'SELECT * FROM directional_paper_evaluations WHERE position_id = ? ORDER BY evaluated_at DESC, id DESC LIMIT ?'
        )
        .all(positionId, limit) as Array<Record<string, string | number | null>>
    ).map(row => this.mapEvaluation(row));
  }

  getPerformance(runId: number): DirectionalRunPerformance {
    const run = this.getRun(runId);
    if (!run) throw new Error('Directional paper run not found');
    const aggregate = this.database
      .prepare(
        `SELECT
          COALESCE(SUM(CASE WHEN status = 'CLOSED' THEN 1 ELSE 0 END), 0) AS completed,
          COALESCE(SUM(CASE WHEN status = 'CLOSED' AND realized_pnl_usd > 0 THEN 1 ELSE 0 END), 0) AS wins,
          COALESCE(SUM(CASE WHEN status = 'CLOSED' AND realized_pnl_usd <= 0 THEN 1 ELSE 0 END), 0) AS losses,
          COALESCE(SUM(CASE WHEN status = 'CLOSED' THEN realized_pnl_usd ELSE 0 END), 0) AS realized_pnl,
          COALESCE(SUM(entry_fee_usd + exit_fee_usd), 0) AS fees,
          COALESCE(SUM(funding_payment_usd), 0) AS funding
        FROM directional_paper_positions
        WHERE run_id = ?`
      )
      .get(runId) as Record<string, number>;
    const activePosition = this.getOpenPosition(runId);
    const latestDecision = this.getRecentDecisions(runId, 1)[0] ?? null;
    const latestEvaluation = activePosition
      ? (this.getRecentEvaluations(activePosition.id, 1)[0] ?? null)
      : this.latestEvaluationForRun(runId);
    const completedPositions = Number(aggregate.completed);
    const winningPositions = Number(aggregate.wins);
    return {
      run,
      activePosition,
      latestDecision,
      latestEvaluation,
      completedPositions,
      winningPositions,
      losingPositions: Number(aggregate.losses),
      winRatePercent: completedPositions > 0 ? (winningPositions / completedPositions) * 100 : null,
      totalRealizedPnlUsd: Number(aggregate.realized_pnl),
      totalFeesUsd: Number(aggregate.fees),
      totalFundingUsd: Number(aggregate.funding),
    };
  }

  close(): void {
    this.database.close();
  }

  private latestEvaluationForRun(runId: number): DirectionalPaperEvaluation | null {
    const row = this.database
      .prepare(
        `SELECT e.* FROM directional_paper_evaluations e
         JOIN directional_paper_positions p ON p.id = e.position_id
         WHERE p.run_id = ? ORDER BY e.evaluated_at DESC, e.id DESC LIMIT 1`
      )
      .get(runId) as Record<string, string | number | null> | undefined;
    return row ? this.mapEvaluation(row) : null;
  }

  private mapRun(row: Record<string, string | number | null>): DirectionalPaperRun {
    return {
      id: Number(row.id),
      mode: String(row.mode) as DirectionalRunMode,
      status: String(row.status) as DirectionalRunStatus,
      strategyVersion: String(row.strategy_version),
      startedAt: String(row.started_at),
      endedAt: row.ended_at === null ? null : String(row.ended_at),
      initialEquityUsd: Number(row.initial_equity_usd),
      realizedBalanceUsd: Number(row.realized_balance_usd),
      markEquityUsd: Number(row.mark_equity_usd),
      peakEquityUsd: Number(row.peak_equity_usd),
      maxDrawdownPercent: Number(row.max_drawdown_percent),
      lastProcessedAt: row.last_processed_at === null ? null : String(row.last_processed_at),
      config: jsonObject(String(row.config_json)) as unknown as DirectionalStrategyConfig,
      sourceLabel: String(row.source_label),
    };
  }

  private mapPosition(row: Record<string, string | number | null>): DirectionalPaperPosition {
    return {
      id: Number(row.id),
      runId: Number(row.run_id),
      side: String(row.side) as DirectionalSide,
      status: String(row.status) as DirectionalPositionStatus,
      openedAt: String(row.opened_at),
      updatedAt: String(row.updated_at),
      closedAt: row.closed_at === null ? null : String(row.closed_at),
      signalPrice: Number(row.signal_price),
      entryFillPrice: Number(row.entry_fill_price),
      exitFillPrice: row.exit_fill_price === null ? null : Number(row.exit_fill_price),
      quantity: Number(row.quantity),
      leverage: Number(row.leverage),
      marginUsd: Number(row.margin_usd),
      notionalUsd: Number(row.notional_usd),
      takeProfitPrice: Number(row.take_profit_price),
      stopLossPrice: Number(row.stop_loss_price),
      liquidationPrice: Number(row.liquidation_price),
      trailingStopPrice: row.trailing_stop_price === null ? null : Number(row.trailing_stop_price),
      bestPrice: Number(row.best_price),
      entryFeeUsd: Number(row.entry_fee_usd),
      exitFeeUsd: Number(row.exit_fee_usd),
      fundingPaymentUsd: Number(row.funding_payment_usd),
      unrealizedPnlUsd: Number(row.unrealized_pnl_usd),
      realizedPnlUsd: row.realized_pnl_usd === null ? null : Number(row.realized_pnl_usd),
      closeReason: row.close_reason === null ? null : String(row.close_reason),
    };
  }

  private mapDecision(row: Record<string, string | number | null>): DirectionalPaperDecision {
    return {
      id: Number(row.id),
      runId: Number(row.run_id),
      positionId: row.position_id === null ? null : Number(row.position_id),
      capturedAt: String(row.captured_at),
      action: String(row.action) as DirectionalDecisionAction,
      reasonCode: String(row.reason_code),
      rationale: String(row.rationale),
      priceUsd: Number(row.price_usd),
      confidence: Number(row.confidence),
      features: jsonObject(String(row.features_json)),
    };
  }

  private mapFill(row: Record<string, string | number>): DirectionalPaperFill {
    return {
      id: Number(row.id),
      positionId: Number(row.position_id),
      filledAt: String(row.filled_at),
      fillType: String(row.fill_type) as 'ENTRY' | 'EXIT',
      orderSide: String(row.order_side) as 'BUY' | 'SELL',
      priceUsd: Number(row.price_usd),
      quantity: Number(row.quantity),
      notionalUsd: Number(row.notional_usd),
      feeUsd: Number(row.fee_usd),
      slippageBps: Number(row.slippage_bps),
    };
  }

  private mapEvaluation(row: Record<string, string | number | null>): DirectionalPaperEvaluation {
    return {
      id: Number(row.id),
      positionId: Number(row.position_id),
      evaluatedAt: String(row.evaluated_at),
      markPriceUsd: Number(row.mark_price_usd),
      rawUnrealizedPnlUsd: Number(row.raw_unrealized_pnl_usd),
      estimatedExitFeeUsd: Number(row.estimated_exit_fee_usd),
      fundingPaymentUsd: Number(row.funding_payment_usd),
      netUnrealizedPnlUsd: Number(row.net_unrealized_pnl_usd),
      accountEquityUsd: Number(row.account_equity_usd),
      drawdownPercent: Number(row.drawdown_percent),
      takeProfitPrice: Number(row.take_profit_price),
      stopLossPrice: Number(row.stop_loss_price),
      liquidationPrice: Number(row.liquidation_price),
      trailingStopPrice: row.trailing_stop_price === null ? null : Number(row.trailing_stop_price),
    };
  }
}
