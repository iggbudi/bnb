import assert from 'node:assert/strict';
import test from 'node:test';

import { loadBnbAppConfig } from './app/config.js';

test('application config preserves runtime defaults in one composition module', () => {
  const config = loadBnbAppConfig({});

  assert.equal(config.port, 3000);
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.backupDirectory, 'backups');
  assert.equal(config.positionLifecycleEnabled, false);
  assert.equal(config.aggressivePaperEnabled, true);
  assert.equal(config.directionalPaperEnabled, true);
  assert.equal(config.mintReceiptMinimumConfirmations, 3);
  assert.equal(config.shutdownTimeoutMs, 15_000);
  assert.deepEqual([...config.corsAllowedOrigins], ['http://127.0.0.1:3000', 'http://localhost:3000']);
});

test('application config validates numeric limits and explicit feature flags', () => {
  const config = loadBnbAppConfig({
    PORT: '3001',
    HOST: '0.0.0.0',
    CORS_ALLOWED_ORIGINS: 'https://example.com, https://admin.example.com ',
    POSITION_LIFECYCLE_ENABLED: 'true',
    AGGRESSIVE_PAPER_ENABLED: 'false',
    DIRECTIONAL_PAPER_ENABLED: 'false',
    MINT_RECEIPT_MIN_CONFIRMATIONS: '1000',
    RPC_HEAVY_CONCURRENCY: '-1',
    SHUTDOWN_TIMEOUT_MS: '2500.9',
    LIVE_EXECUTION_MAX_CAPITAL_USD: '250',
  });

  assert.equal(config.port, 3001);
  assert.equal(config.host, '0.0.0.0');
  assert.deepEqual([...config.corsAllowedOrigins], ['https://example.com', 'https://admin.example.com']);
  assert.equal(config.positionLifecycleEnabled, true);
  assert.equal(config.aggressivePaperEnabled, false);
  assert.equal(config.directionalPaperEnabled, false);
  assert.equal(config.mintReceiptMinimumConfirmations, 100);
  assert.equal(config.rpcHeavyConcurrency, 2);
  assert.equal(config.shutdownTimeoutMs, 2500);
  assert.equal(config.execution.limits.maxCapitalUsd, 250);
});
