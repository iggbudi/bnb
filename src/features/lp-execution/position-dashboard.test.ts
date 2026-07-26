import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('position lifecycle dashboard is wired to read-only position APIs', () => {
  const html = readFileSync('public/index.html', 'utf8');
  const dashboard = readFileSync('public/features/execution.js', 'utf8');
  const app = readFileSync('public/app.js', 'utf8');
  const frontend = `${html}\n${dashboard}\n${app}`;
  assert.match(html, /data-tab="position"/);
  assert.match(html, /id="positionDashboard"/);
  assert.match(html, /src="\/features\/execution\.js"/);
  assert.match(frontend, /async function loadPositionDashboard/);
  assert.match(frontend, /fetchApi\('\/api\/positions\/status'\)/);
  assert.match(frontend, /fetchApi\(`\/api\/positions\/\$\{selected\.id\}`\)/);
  assert.match(frontend, /Review 7d/);
  assert.match(frontend, /Final\/Exit 14d/);
  assert.match(frontend, /Verified PancakeSwap V3 NFT/);
  assert.match(frontend, /nftReceiptVerification/);
  assert.match(frontend, /Unsigned Exit Planner/);
  assert.match(frontend, /decreaseLiquidity → collect/);
  assert.match(frontend, /Stage F Shadow Validation/);
  assert.match(frontend, /shadowValidation/);
  assert.match(frontend, /Stage G Paper Activation/);
  assert.match(frontend, /activationEligible/);
  assert.match(app, /execution\.loadPositionDashboard/);
  assert.doesNotThrow(() => new Function(dashboard));
});
