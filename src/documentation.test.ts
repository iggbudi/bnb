import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import test from 'node:test';
import ts from 'typescript';

function filesBelow(directory: string, suffix: string): string[] {
  return readdirSync(directory).flatMap(entry => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? filesBelow(path, suffix) : path.endsWith(suffix) ? [path] : [];
  });
}

const markdownFiles = [
  ...readdirSync('.').filter(file => file.endsWith('.md')),
  ...filesBelow('docs', '.md'),
];

function dependencyEdges(typeOnly: boolean): string[] {
  const featuresRoot = resolve('src/features');
  const edges = new Set<string>();
  for (const file of filesBelow(featuresRoot, '.ts').filter(path => !path.endsWith('.test.ts'))) {
    const owner = relative(featuresRoot, file).split(sep)[0]!;
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement)) continue;
      const specifier = String((statement.moduleSpecifier as ts.StringLiteral).text);
      const target = resolve(file, '..', specifier.replace(/\.js$/, '.ts'));
      const targetRelative = relative(featuresRoot, target);
      if (targetRelative.startsWith(`..${sep}`)) continue;
      const targetSlice = targetRelative.split(sep)[0]!;
      if (targetSlice === owner) continue;
      const bindings = statement.importClause?.namedBindings;
      const importIsTypeOnly =
        statement.importClause?.isTypeOnly === true ||
        (bindings !== undefined &&
          ts.isNamedImports(bindings) &&
          bindings.elements.length > 0 &&
          bindings.elements.every(element => element.isTypeOnly));
      if (importIsTypeOnly === typeOnly) edges.add(`${owner} -> ${targetSlice}`);
    }
  }
  return [...edges].sort();
}

function documentedEdges(source: string, heading: string): string[] {
  const section = source.split(`## ${heading}`)[1]?.split('\n## ')[0] ?? '';
  const block = section.match(/```text\n([\s\S]*?)```/)?.[1] ?? '';
  return block
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.includes(' -> '))
    .sort();
}

test('local Markdown links resolve to tracked documentation targets', () => {
  const missing: string[] = [];
  for (const file of markdownFiles) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
      const rawTarget = match[1]!.trim().replace(/^<|>$/g, '');
      if (/^(?:https?:|mailto:|#)/.test(rawTarget)) continue;
      const target = rawTarget.split('#')[0]!.split('?')[0]!;
      if (!target) continue;
      if (!existsSync(resolve(dirname(file), target))) missing.push(`${file} -> ${rawTarget}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('active status and runbooks describe final build and schema identity', () => {
  const progress = readFileSync('progress.md', 'utf8');
  const activeStatus = progress.split('## Arsip Milestone Historis')[0]!;
  assert.match(activeStatus, /node dist\/app\/server\.js/);
  assert.match(activeStatus, /schema aktif: \*\*v4\*\*/i);
  assert.match(activeStatus, /snapshot bertanggal/i);
  assert.doesNotMatch(activeStatus, /src\/(?:server-bnb|bnb-app)\.ts|137\/137|migration v3/i);

  const releaseRunbook = readFileSync('docs/runbook-termux-release.md', 'utf8');
  for (const required of [
    'backup',
    'npm run check',
    'background:stop',
    'background:start',
    'background:status',
    "ps -A -o pid,args | grep '[n]ode dist/app/server.js'",
    'PRAGMA quick_check',
    'rm -f "$BACKUP-wal" "$BACKUP-shm"',
    'schema_migrations',
    '/api/health/ready',
    '/api/execution/status',
    'Rollback',
  ]) {
    assert.ok(releaseRunbook.includes(required), `release runbook is missing ${required}`);
  }
  assert.match(releaseRunbook, /node dist\/app\/server\.js/);
  assert.match(releaseRunbook, /jangan membuka port langsung ke internet/i);

  assert.match(readFileSync('README.md', 'utf8'), /application schema v4/);
  assert.match(readFileSync('WIKI.md', 'utf8'), /application schema v4/);

  const environment = readFileSync('.env.example', 'utf8');
  assert.match(environment, /HOST=127\.0\.0\.1/);
  assert.match(environment, /TRUST_PROXY=false/);
  assert.match(environment, /do not set BNB_RELEASE_REVISION/i);
});

test('documented dependency graph and public port policy match active source', () => {
  const graph = readFileSync('docs/feature-dependency-graph.md', 'utf8');
  assert.deepEqual(documentedEdges(graph, 'Runtime edges'), dependencyEdges(false));
  assert.deepEqual(documentedEdges(graph, 'Type-only edges'), dependencyEdges(true));

  const architecture = readFileSync('docs/architecture.md', 'utf8');
  for (const slice of [
    'market-data',
    'lp-analysis',
    'paper-agent',
    'aggressive-paper',
    'directional-paper',
    'learning',
    'lp-execution',
    'operations',
  ]) {
    assert.match(architecture, new RegExp('\\|\\s+`' + slice + '`\\s+\\|'));
  }
  for (const port of [
    'MarketHistoryReader',
    'CurrentPoolStateReader',
    'ActiveModelReader',
    'PositionLifecyclePort',
    'PaperDecisionReader',
  ]) {
    assert.ok(architecture.includes(port), `architecture docs are missing port ${port}`);
  }
});

test('active deployment docs prohibit direct public exposure', () => {
  const activeDocs = ['README.md', 'WIKI.md', '.env.example', 'docs/runbook-termux-release.md'].map(file =>
    readFileSync(file, 'utf8')
  );
  assert.ok(activeDocs.every(source => /internet/i.test(source)));
  assert.match(activeDocs[0]!, /Jangan membuka port langsung ke internet/i);
  assert.match(activeDocs[1]!, /jangan membuka service langsung ke internet/i);
  assert.match(activeDocs[2]!, /Never expose this service directly to the internet/i);
});
