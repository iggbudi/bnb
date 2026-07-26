import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { OnchainStore } from './onchain-store.js';
import {
  APPLICATION_SCHEMA_VERSION,
  SchemaMigrationRunner,
  APPLICATION_MIGRATIONS,
  type SchemaMigration,
} from './schema-migrations.js';
import { SnapshotStore } from './snapshot-store.js';

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
