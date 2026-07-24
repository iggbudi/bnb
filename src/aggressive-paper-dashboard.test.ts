import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('agent dashboard separates actual aggressive portfolio from overlapping full-range signals', () => {
  const html = readFileSync('public/index.html', 'utf8');
  const dashboard = readFileSync('public/dashboard.js', 'utf8');
  const server = readFileSync('src/bnb-app.ts', 'utf8');
  const frontend = `${html}\n${dashboard}`;

  assert.match(server, /\/api\/agent\/aggressive-performance/);
  assert.match(server, /\/api\/agent\/aggressive-positions\/:id/);
  assert.match(server, /processAggressivePaperLifecycle/);
  assert.match(frontend, /Performa Paper Agresif · Portfolio Aktual/);
  assert.match(frontend, /Nilai Portfolio Jika Exit/);
  assert.match(frontend, /Fee Paper Teramati On-chain/);
  assert.match(frontend, /P&amp;L Sinyal Overlap · Bukan Portfolio/);
  assert.match(frontend, /Diagnostik Sinyal Full-Range/);
  assert.match(frontend, /ONCHAIN_FEE_GROWTH_GLOBAL_X128_WITH_IN_RANGE_OCCUPANCY|feeGrowthGlobal on-chain/);
  assert.match(html, /src="\/api-client\.js"/);
  assert.match(html, /src="\/dashboard\.js"/);
  assert.doesNotThrow(() => new Function(readFileSync('public/api-client.js', 'utf8')));
  assert.doesNotThrow(() => new Function(dashboard));
});
