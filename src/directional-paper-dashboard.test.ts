import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('agent dashboard exposes simulation-only directional performance separately from LP', () => {
  const html = readFileSync('public/index.html', 'utf8');
  const dashboard = readFileSync('public/dashboard.js', 'utf8');
  const server = readFileSync('src/app/runtime.ts', 'utf8');

  assert.match(html, /data-tab="directional"/);
  assert.match(html, /id="tab-directional"/);
  assert.match(server, /\/api\/agent\/directional-performance/);
  assert.match(server, /\/api\/agent\/directional-positions\/:id/);
  assert.match(server, /liveExecutionEnabled: false/);
  assert.match(dashboard, /Perpetual Paper Trading/);
  assert.match(dashboard, /loadDirectionalDashboard/);
  assert.match(dashboard, /sampled close pool/);
  assert.match(dashboard, /High\/low intramenit/);
  assert.doesNotThrow(() => new Function(dashboard));
});
