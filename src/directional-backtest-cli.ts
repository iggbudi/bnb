import 'dotenv/config';

import { runDirectionalBacktest } from './directional-paper-manager.js';
import { DirectionalPaperStore } from './directional-paper-store.js';
import { DEFAULT_DIRECTIONAL_CONFIG } from './directional-strategy.js';
import { SnapshotStore } from './snapshot-store.js';

function argument(name: string, fallback: number): number {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return fallback;
  const value = Number(process.argv[index + 1]);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`--${name} must be positive`);
  return value;
}

const hours = argument('hours', 60 * 24);
const snapshotStore = new SnapshotStore();
const directionalStore = new DirectionalPaperStore();

try {
  const snapshots = snapshotStore.getHistory(hours, Math.ceil(hours * 60));
  const performance = runDirectionalBacktest({
    snapshots,
    store: directionalStore,
    config: { ...DEFAULT_DIRECTIONAL_CONFIG },
    sourceLabel: `pool_snapshots_${hours}h_minute_close`,
  });
  console.log(
    JSON.stringify(
      {
        runId: performance.run.id,
        snapshots: snapshots.length,
        startedAt: performance.run.startedAt,
        endedAt: performance.run.endedAt,
        initialEquityUsd: performance.run.initialEquityUsd,
        finalEquityUsd: performance.run.markEquityUsd,
        returnPercent: (performance.run.markEquityUsd / performance.run.initialEquityUsd - 1) * 100,
        maxDrawdownPercent: performance.run.maxDrawdownPercent,
        completedPositions: performance.completedPositions,
        winningPositions: performance.winningPositions,
        losingPositions: performance.losingPositions,
        winRatePercent: performance.winRatePercent,
        totalFeesUsd: performance.totalFeesUsd,
        fundingRate8h: performance.run.config.fundingRate8h,
      },
      null,
      2
    )
  );
} finally {
  directionalStore.close();
  snapshotStore.close();
}
