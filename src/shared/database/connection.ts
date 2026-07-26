import 'dotenv/config';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export interface OpenDatabaseOptions {
  foreignKeys?: boolean;
}

export function applicationDatabasePath(): string {
  return resolve(process.env.SQLITE_PATH || 'data/bnb-viewer.sqlite');
}

export function openApplicationDatabase(
  databasePath = applicationDatabasePath(),
  options: OpenDatabaseOptions = {}
): DatabaseSync {
  if (databasePath !== ':memory:') mkdirSync(dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  database.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
  if (options.foreignKeys) database.exec('PRAGMA foreign_keys = ON;');
  return database;
}
