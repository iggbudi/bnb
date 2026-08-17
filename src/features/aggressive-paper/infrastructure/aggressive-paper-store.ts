import { DatabaseSync } from 'node:sqlite';
import { applicationDatabasePath, openApplicationDatabase } from '../../../shared/database/connection.js';
import { prepareStoreSchema, type StoreSchemaOptions } from '../../../shared/database/store-schema.js';

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

export interface AggressiveProjectionEvidence {
  status: 'INSUFFICIENT_SAMPLE' | 'OBSERVATION_READY';
  minimumCompletedPositions: number;
  minimumObservedCalendarDays: number;
  completedPositions: number;
  observedCalendarDays: number;
  averageHoldHours: number | null;
  averageProjectedNetReturn30dPercent: number | null;
  averageRealizedCycleReturnPercent: number | null;
  targetHitRatePercent: number | null;
  noFeasibleRecenterRatePercent: number | null;
  blockers: string[];
  executionAuthority: false;
}

export interface AggressivePaperPerformance {
  initialCapitalUsd: number;
  portfolioValueUsd: number;
  portfolioPnlUsd: number;
  portfolioReturnPercent: number;
  annualizedReturnPercent: number | null;
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
  projectionEvidence: AggressiveProjectionEvidence;
}

export function createAggressivePaperSchema(database: DatabaseSync): void {
  database.exec(`

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

import { AggressivePerformanceRepository } from './aggressive-performance-repository.js';

export class AggressivePaperStore extends AggressivePerformanceRepository {
  constructor(databasePath = applicationDatabasePath(), schemaOptions: StoreSchemaOptions = {}) {
    const database = openApplicationDatabase(databasePath, { foreignKeys: true });
    try {
      prepareStoreSchema(
        database,
        'aggressive-paper',
        ['aggressive_paper_positions', 'aggressive_paper_actions', 'aggressive_paper_evaluations'],
        createAggressivePaperSchema,
        schemaOptions
      );
    } catch (error) {
      database.close();
      throw error;
    }
    super(database);
  }
}
