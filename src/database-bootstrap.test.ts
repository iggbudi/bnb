import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { bootstrapApplicationDatabase } from './app/database-bootstrap.js';
import {
  APPLICATION_MIGRATIONS,
  APPLICATION_SCHEMA_VERSION,
  FEATURE_SCHEMA_CONTRIBUTIONS,
} from './app/migrations.js';
import { BnbServiceContainer } from './app/container.js';
import { SnapshotStore } from './features/market-data/index.js';
import { openApplicationDatabase } from './shared/database/connection.js';
import { SchemaMigrationRunner } from './shared/database/migration-runner.js';

function withDatabase(run: (databasePath: string) => void): void {
  const directory = mkdtempSync(join(tmpdir(), 'bnb-bootstrap-'));
  try {
    run(join(directory, 'test.sqlite'));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function reconcileFeatureSchema(databasePath: string): void {
  const database = openApplicationDatabase(databasePath, { foreignKeys: true });
  try {
    for (const contribution of FEATURE_SCHEMA_CONTRIBUTIONS) contribution.createSchema(database);
  } finally {
    database.close();
  }
}

function assertHealthySchema(databasePath: string): void {
  const database = openApplicationDatabase(databasePath, { foreignKeys: true });
  try {
    assert.equal((database.prepare('PRAGMA quick_check').get() as { quick_check: string }).quick_check, 'ok');
    assert.equal(
      Number((database.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys),
      1
    );
    assert.equal(
      String((database.prepare('PRAGMA journal_mode').get() as { journal_mode: string }).journal_mode),
      'wal'
    );
    assert.equal(
      Number(
        (
          database.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as {
            version: number;
          }
        ).version
      ),
      APPLICATION_SCHEMA_VERSION
    );
  } finally {
    database.close();
  }
}

test('store construction validates schema without hidden DDL and releases failures', () => {
  withDatabase(databasePath => {
    assert.throws(() => new SnapshotStore(databasePath), /schema.*not initialized/i);
    const database = new DatabaseSync(databasePath);
    assert.equal(
      database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'pool_snapshots'")
        .get(),
      undefined
    );
    database.close();
  });
});

test('central bootstrap starts an empty database before constructing stores', () => {
  withDatabase(databasePath => {
    const migrations = bootstrapApplicationDatabase(databasePath);
    assert.deepEqual(
      migrations.map(item => item.version),
      [1, 2, 3, 4]
    );
    const container = new BnbServiceContainer(databasePath);
    container.close();
    assertHealthySchema(databasePath);
  });
});

test('parallel startup processes serialize bootstrap and record each migration once', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'bnb-bootstrap-parallel-'));
  const databasePath = join(directory, 'test.sqlite');
  const moduleUrl = pathToFileURL(resolve('src/app/database-bootstrap.ts')).href;
  const code = `import { bootstrapApplicationDatabase } from ${JSON.stringify(moduleUrl)}; bootstrapApplicationDatabase(${JSON.stringify(databasePath)});`;
  const run = () =>
    new Promise<void>((resolveRun, reject) => {
      const child = spawn(process.execPath, ['--import', 'tsx', '--eval', code], {
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      let stderr = '';
      child.stderr.on('data', chunk => (stderr += String(chunk)));
      child.once('error', reject);
      child.once('exit', code =>
        code === 0 ? resolveRun() : reject(new Error(`bootstrap child exited ${code}: ${stderr}`))
      );
    });
  try {
    await Promise.all([run(), run()]);
    const database = new DatabaseSync(databasePath);
    const rows = database
      .prepare('SELECT version, COUNT(*) AS count FROM schema_migrations GROUP BY version ORDER BY version')
      .all() as Array<{ version: number; count: number }>;
    assert.deepEqual(
      rows.map(row => ({ version: Number(row.version), count: Number(row.count) })),
      APPLICATION_MIGRATIONS.map(migration => ({ version: migration.version, count: 1 }))
    );
    database.close();
    assertHealthySchema(databasePath);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('central bootstrap adopts a legacy schema with no migration registry', () => {
  withDatabase(databasePath => {
    reconcileFeatureSchema(databasePath);
    const legacy = new DatabaseSync(databasePath);
    legacy
      .prepare(
        `INSERT INTO pool_snapshots (
          captured_minute, captured_at, pair_address, price, tvl,
          volume_24h, volume_6h, volume_1h, vol_liq_ratio,
          estimated_fees_24h, estimated_apr, price_change_1h, price_change_6h,
          price_change_24h, buys_24h, sells_24h, wbnb_in_pool, usdt_in_pool
        ) VALUES (1, '2026-01-01T00:00:00.000Z', 'legacy', 600, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1, 1, 1)`
      )
      .run();
    legacy.close();

    bootstrapApplicationDatabase(databasePath);
    const verified = new DatabaseSync(databasePath);
    assert.equal(
      (verified.prepare('SELECT COUNT(*) AS count FROM pool_snapshots').get() as { count: number }).count,
      1
    );
    verified.close();
    assertHealthySchema(databasePath);
  });
});

for (const version of [1, 2, 3, 4]) {
  test(`central bootstrap restarts a migration v${version} fixture idempotently`, () => {
    withDatabase(databasePath => {
      reconcileFeatureSchema(databasePath);
      new SchemaMigrationRunner(
        databasePath,
        APPLICATION_MIGRATIONS.filter(migration => migration.version <= version)
      ).migrate();

      // Simulate a missing operational index in an old backup. Schema contribution
      // reconciliation must restore it without changing historical migrations.
      const database = new DatabaseSync(databasePath);
      database.exec('DROP INDEX IF EXISTS idx_position_actions_hourly_idempotency');
      database.close();

      const first = bootstrapApplicationDatabase(databasePath);
      const second = bootstrapApplicationDatabase(databasePath);
      assert.deepEqual(first, second);
      const verified = new DatabaseSync(databasePath);
      assert.ok(
        verified
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_position_actions_hourly_idempotency'"
          )
          .get()
      );
      verified.close();
      assertHealthySchema(databasePath);
    });
  });
}
