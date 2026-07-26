import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const frontendScripts = [
  '/shared/api-client.js',
  '/shared/format.js',
  '/features/learning.js',
  '/features/market-data.js',
  '/features/execution.js',
  '/features/aggressive-paper.js',
  '/features/paper-agent.js',
  '/features/directional-paper.js',
  '/features/lp-analysis.js',
  '/app.js',
] as const;

test('frontend loads feature modules in dependency order with one bootstrap', () => {
  const html = readFileSync('public/index.html', 'utf8');
  const positions = frontendScripts.map(script => {
    const tag = `<script src="${script}" defer></script>`;
    assert.match(html, new RegExp(tag.replaceAll('/', '\\/')));
    return html.indexOf(tag);
  });

  assert.deepEqual(
    positions,
    [...positions].sort((left, right) => left - right)
  );
  assert.doesNotMatch(html, /dashboard\.js|src="\/api-client\.js"/);

  for (const script of frontendScripts) {
    assert.doesNotThrow(
      () => new Function(readFileSync(`public${script}`, 'utf8')),
      `${script} must remain valid classic JavaScript`
    );
  }

  const app = readFileSync('public/app.js', 'utf8');
  assert.match(app, /window\.BnbDashboard\.app\.init\(\)/);
  assert.match(app, /function dispose\(\)/);
  assert.match(app, /window\.runSimulation/);
  assert.match(app, /window\.loadPositionDashboard/);
});

test('frontend modules initialize against the preserved DOM contract', () => {
  const context: Record<string, any> = {
    clearInterval: () => undefined,
    clearTimeout: () => undefined,
    console,
    document: {
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
    },
    fetch: () => new Promise(() => undefined),
    setInterval: () => 1,
    setTimeout: () => 1,
  };
  context.window = context;

  for (const script of frontendScripts) {
    vm.runInNewContext(readFileSync(`public${script}`, 'utf8'), context, { filename: script });
  }

  assert.equal(typeof context.BnbDashboard.app.dispose, 'function');
  assert.equal(typeof context.runSimulation, 'function');
  assert.equal(typeof context.loadAgentDashboard, 'function');
  context.BnbDashboard.app.dispose();
});
