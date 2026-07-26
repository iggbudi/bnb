import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('agent dashboard separates actual aggressive portfolio from overlapping full-range signals', () => {
  const html = readFileSync('public/index.html', 'utf8');
  const aggressive = readFileSync('public/features/aggressive-paper.js', 'utf8');
  const agent = readFileSync('public/features/paper-agent.js', 'utf8');
  const learning = readFileSync('public/features/learning.js', 'utf8');
  const routes = readFileSync('src/features/aggressive-paper/http/routes.ts', 'utf8');
  const service = readFileSync(
    'src/features/aggressive-paper/application/aggressive-paper-service.ts',
    'utf8'
  );
  const frontend = `${html}\n${aggressive}\n${agent}\n${learning}`;

  assert.match(routes, /\/api\/agent\/aggressive-performance/);
  assert.match(routes, /\/api\/agent\/aggressive-positions\/:id/);
  assert.match(service, /processAggressivePaperLifecycle/);
  assert.match(frontend, /Performa Paper Agresif · Portfolio Aktual/);
  assert.match(frontend, /Nilai Portfolio Jika Exit/);
  assert.match(frontend, /Fee Paper Teramati On-chain/);
  assert.match(frontend, /P&amp;L Sinyal Overlap · Bukan Portfolio/);
  assert.match(frontend, /Diagnostik Sinyal Full-Range/);
  assert.match(frontend, /ONCHAIN_FEE_GROWTH_GLOBAL_X128_WITH_IN_RANGE_OCCUPANCY|feeGrowthGlobal on-chain/);
  assert.match(html, /src="\/features\/aggressive-paper\.js"/);
  assert.match(html, /src="\/features\/paper-agent\.js"/);
  assert.doesNotThrow(() => new Function(aggressive));
  assert.doesNotThrow(() => new Function(agent));
});
