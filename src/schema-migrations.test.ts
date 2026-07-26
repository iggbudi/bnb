import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { OnchainStore } from './features/market-data/index.js';
import {
  APPLICATION_MIGRATIONS,
  APPLICATION_SCHEMA_VERSION,
  FEATURE_SCHEMA_CONTRIBUTIONS,
  applyApplicationMigrations,
} from './app/migrations.js';
import { SchemaMigrationRunner, type SchemaMigration } from './shared/database/migration-runner.js';
import { SnapshotStore } from './features/market-data/index.js';

test('schema migration runner applies ordered migrations exactly once', () => {
  const directory = mkdtempSync(join(tmpdir(), 'bnb-migrations-'));
  const databasePath = join(directory, 'test.sqlite');
  let executions = 0;
  const migrations: SchemaMigration[] = [
    {
      version: 1,
      name: 'create_example',
      up(database) {
        executions++;
        database.exec('CREATE TABLE example (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
      },
    },
    {
      version: 2,
      name: 'add_example_index',
      up(database) {
        executions++;
        database.exec('CREATE INDEX idx_example_value ON example(value)');
      },
    },
  ];

  try {
    const runner = new SchemaMigrationRunner(databasePath, migrations);
    assert.deepEqual(
      runner.migrate().map(item => item.version),
      [1, 2]
    );
    assert.deepEqual(
      runner.migrate().map(item => item.version),
      [1, 2]
    );
    assert.equal(executions, 2);

    const database = new DatabaseSync(databasePath);
    const count = database.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get() as {
      count: number;
    };
    assert.equal(count.count, 2);
    database.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('application migration adds the directional paper ledger without changing snapshots', () => {
  const directory = mkdtempSync(join(tmpdir(), 'bnb-application-migration-'));
  const databasePath = join(directory, 'test.sqlite');
  const snapshots = new SnapshotStore(databasePath);
  const onchain = new OnchainStore(databasePath);
  snapshots.close();
  onchain.close();

  try {
    const applied = new SchemaMigrationRunner(databasePath, APPLICATION_MIGRATIONS).migrate();
    assert.equal(applied.at(-1)?.version, APPLICATION_SCHEMA_VERSION);
    const database = new DatabaseSync(databasePath);
    const tables = database
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name LIKE 'directional_paper_%'
         ORDER BY name`
      )
      .all() as Array<{ name: string }>;
    assert.deepEqual(
      tables.map(row => row.name),
      [
        'directional_paper_decisions',
        'directional_paper_evaluations',
        'directional_paper_fills',
        'directional_paper_positions',
        'directional_paper_runs',
      ]
    );
    assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE name = 'pool_snapshots'").get());
    database.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('feature schema ownership upgrades a version 3 database idempotently', () => {
  const directory = mkdtempSync(join(tmpdir(), 'bnb-feature-schema-'));
  const databasePath = join(directory, 'test.sqlite');
  const snapshots = new SnapshotStore(databasePath);
  const onchain = new OnchainStore(databasePath);
  snapshots.save(
    {
      price: 600,
      tvl: 1_000_000,
      volume24h: 100_000,
      volume6h: 25_000,
      volume1h: 5_000,
      volLiqRatio: 0.1,
      estimatedFees24h: 10,
      estimatedAPR: 0.365,
      priceChange1h: 0,
      priceChange6h: 0,
      priceChange24h: 0,
      txns24h: { buys: 10, sells: 8 },
      wbnbInPool: 1_000,
      usdtInPool: 600_000,
      pairAddress: '0xpool',
    },
    new Date('2026-01-01T00:00:00.000Z')
  );
  snapshots.close();
  onchain.close();

  try {
    const version3Migrations = APPLICATION_MIGRATIONS.filter(migration => migration.version <= 3);
    new SchemaMigrationRunner(databasePath, version3Migrations).migrate();

    assert.deepEqual(
      applyApplicationMigrations(databasePath).map(migration => migration.version),
      [1, 2, 3, 4]
    );
    assert.deepEqual(
      applyApplicationMigrations(databasePath).map(migration => migration.version),
      [1, 2, 3, 4]
    );
    assert.equal(new Set(FEATURE_SCHEMA_CONTRIBUTIONS.map(item => item.feature)).size, 6);

    const database = new DatabaseSync(databasePath);
    const snapshotCount = database.prepare('SELECT COUNT(*) AS count FROM pool_snapshots').get() as {
      count: number;
    };
    const quickCheck = database.prepare('PRAGMA quick_check').get() as { quick_check: string };
    const requiredIndexes = [
      'idx_exit_proposals_one_active_per_position',
      'idx_position_actions_hourly_idempotency',
      'idx_position_evaluations_hourly_idempotency',
    ];
    const indexes = database
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'index' AND name IN (?, ?, ?)
         ORDER BY name`
      )
      .all(...requiredIndexes) as Array<{ name: string }>;
    assert.equal(snapshotCount.count, 1);
    assert.deepEqual(
      indexes.map(index => index.name),
      [...requiredIndexes].sort()
    );
    assert.equal(quickCheck.quick_check, 'ok');
    database.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('failed schema migration rolls back both schema and version record', () => {
  const directory = mkdtempSync(join(tmpdir(), 'bnb-migration-rollback-'));
  const databasePath = join(directory, 'test.sqlite');
  const runner = new SchemaMigrationRunner(databasePath, [
    {
      version: 1,
      name: 'failing_migration',
      up(database) {
        database.exec('CREATE TABLE should_rollback (id INTEGER PRIMARY KEY)');
        throw new Error('intentional failure');
      },
    },
  ]);

  try {
    assert.throws(() => runner.migrate(), /Schema migration 1.*failed/);
    const database = new DatabaseSync(databasePath);
    const table = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'should_rollback'")
      .get();
    assert.equal(table, undefined);
    const count = database.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get() as {
      count: number;
    };
    assert.equal(count.count, 0);
    database.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
