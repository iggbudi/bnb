import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('agent dashboard exposes simulation-only directional performance separately from LP', () => {
  const html = readFileSync('public/index.html', 'utf8');
  const dashboard = readFileSync('public/features/directional-paper.js', 'utf8');
  const app = readFileSync('public/app.js', 'utf8');
  const server = readFileSync('src/features/directional-paper/http/routes.ts', 'utf8');

  assert.match(html, /data-tab="directional"/);
  assert.match(html, /id="tab-directional"/);
  assert.match(html, /src="\/features\/directional-paper\.js"/);
  assert.match(server, /\/api\/agent\/directional-performance/);
  assert.match(server, /\/api\/agent\/directional-positions\/:id/);
  assert.match(server, /liveExecutionEnabled: false/);
  assert.match(dashboard, /Perpetual Paper Trading/);
  assert.match(dashboard, /loadDirectionalDashboard/);
  assert.match(dashboard, /sampled close pool/);
  assert.match(dashboard, /High\/low intramenit/);
  assert.match(app, /directionalPaper\.loadDirectionalDashboard/);
  assert.doesNotThrow(() => new Function(dashboard));
});
