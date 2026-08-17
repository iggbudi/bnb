export interface ExecutionConfig {
  liveExecutionEnabled: boolean;
  adminToken: string;
  limits: {
    maxCapitalUsd: number;
    maxDailyLossUsd: number;
    proposalExpiryMinutes: number;
  };
}

export interface BnbAppConfig {
  port: number;
  host: string;
  backupDirectory: string;
  trustProxy: boolean;
  jsonBodyLimit: string;
  corsAllowedOrigins: ReadonlySet<string>;
  positionLifecycleEnabled: boolean;
  aggressivePaperEnabled: boolean;
  directionalPaperEnabled: boolean;
  directionalOpposingBreakeven: boolean;
  directionalShortEnabled: boolean;
  directionalMaxDrawdownPercent: number;
  mintReceiptMinimumConfirmations: number;
  rpcHeavyConcurrency: number;
  apiRateLimitPerMinute: number;
  aiRateLimitPerFifteenMinutes: number;
  exitAdminRateLimitPerMinute: number;
  shutdownTimeoutMs: number;
  openAiConfigured: boolean;
  execution: ExecutionConfig;
}

function positiveNumber(environment: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const value = Number(environment[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function loadBnbAppConfig(environment: NodeJS.ProcessEnv = process.env): BnbAppConfig {
  const portValue = environment.PORT || '3000';
  const port = Number(portValue);
  const corsAllowedOrigins = new Set(
    (environment.CORS_ALLOWED_ORIGINS || `http://127.0.0.1:${portValue},http://localhost:${portValue}`)
      .split(',')
      .map(origin => origin.trim())
      .filter(Boolean)
  );

  return {
    port,
    host: environment.HOST || '127.0.0.1',
    backupDirectory: environment.SQLITE_BACKUP_DIR || 'backups',
    trustProxy: environment.TRUST_PROXY === 'true',
    jsonBodyLimit: environment.JSON_BODY_LIMIT || '32kb',
    corsAllowedOrigins,
    positionLifecycleEnabled: environment.POSITION_LIFECYCLE_ENABLED === 'true',
    aggressivePaperEnabled: environment.AGGRESSIVE_PAPER_ENABLED !== 'false',
    directionalPaperEnabled: environment.DIRECTIONAL_PAPER_ENABLED !== 'false',
    // Aktivasi exit OPPOSING_SIGNAL di breakeven untuk run forward (hasil
    // backtest varian fwdrun.md: kerugian turun ~60% tanpa mengurangi jumlah trade).
    directionalOpposingBreakeven: environment.DIRECTIONAL_OPPOSING_BREAKEVEN !== 'false',
    // Eksperimen long-only: false menolak sinyal ENTER_SHORT (SHORT terbukti merugi di semua rezim).
    directionalShortEnabled: environment.DIRECTIONAL_SHORT_ENABLED !== 'false',
    // Circuit breaker: hentikan run (PAUSED) saat max drawdown mencapai ambang ini (0 = nonaktif).
    directionalMaxDrawdownPercent: (() => {
      const value = Number(environment.DIRECTIONAL_MAX_DRAWDOWN_PERCENT);
      return Number.isFinite(value) && value >= 0 ? value : 25;
    })(),
    mintReceiptMinimumConfirmations: Math.min(
      100,
      Math.max(1, Math.floor(positiveNumber(environment, 'MINT_RECEIPT_MIN_CONFIRMATIONS', 3)))
    ),
    rpcHeavyConcurrency: Math.floor(positiveNumber(environment, 'RPC_HEAVY_CONCURRENCY', 2)),
    apiRateLimitPerMinute: Math.floor(positiveNumber(environment, 'API_RATE_LIMIT_PER_MINUTE', 120)),
    aiRateLimitPerFifteenMinutes: Math.floor(positiveNumber(environment, 'AI_RATE_LIMIT_PER_15_MINUTES', 4)),
    exitAdminRateLimitPerMinute: Math.floor(
      positiveNumber(environment, 'EXIT_ADMIN_RATE_LIMIT_PER_MINUTE', 60)
    ),
    shutdownTimeoutMs: Math.floor(positiveNumber(environment, 'SHUTDOWN_TIMEOUT_MS', 15_000)),
    openAiConfigured: Boolean(environment.OPENAI_API_KEY),
    execution: {
      liveExecutionEnabled: environment.LIVE_EXECUTION_ENABLED === 'true',
      adminToken: environment.EXECUTION_ADMIN_TOKEN || '',
      limits: {
        maxCapitalUsd: positiveNumber(environment, 'LIVE_EXECUTION_MAX_CAPITAL_USD', 100),
        maxDailyLossUsd: positiveNumber(environment, 'LIVE_EXECUTION_MAX_DAILY_LOSS_USD', 5),
        proposalExpiryMinutes: positiveNumber(environment, 'LIVE_EXECUTION_PROPOSAL_EXPIRY_MINUTES', 15),
      },
    },
  };
}
