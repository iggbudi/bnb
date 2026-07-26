import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const sourceRoot = resolve('src');
const appRoot = join(sourceRoot, 'app');
const featuresRoot = join(sourceRoot, 'features');
const sharedRoot = join(sourceRoot, 'shared');

function typescriptFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).flatMap(entry => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? typescriptFiles(path) : path.endsWith('.ts') ? [path] : [];
  });
}

function imports(source: string): string[] {
  return [...source.matchAll(/(?:from\s+|import\s*)['"]([^'"]+)['"]/g)].map(match => match[1]);
}

function isFeaturePublicApi(path: string): boolean {
  const parts = relative(featuresRoot, path).split(sep);
  return parts.length === 2 && parts[1] === 'index.ts';
}

function featureDependencyEdges(typeOnly: boolean): string[] {
  const edges = new Set<string>();
  for (const file of typescriptFiles(featuresRoot).filter(path => !path.endsWith('.test.ts'))) {
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
      const isTypeOnly =
        statement.importClause?.isTypeOnly === true ||
        (bindings !== undefined &&
          ts.isNamedImports(bindings) &&
          bindings.elements.length > 0 &&
          bindings.elements.every(element => element.isTypeOnly));
      if (isTypeOnly === typeOnly) edges.add(`${owner} -> ${targetSlice}`);
    }
  }
  return [...edges].sort();
}

test('application composition modules use feature public APIs only', () => {
  const violations = typescriptFiles(appRoot).flatMap(file =>
    imports(readFileSync(file, 'utf8'))
      .map(specifier => ({ specifier, target: resolve(file, '..', specifier.replace(/\.js$/, '.ts')) }))
      .filter(({ target }) => !relative(featuresRoot, target).startsWith(`..${sep}`))
      .filter(({ target }) => !isFeaturePublicApi(target))
      .map(({ specifier }) => `${relative(sourceRoot, file)} -> ${specifier}`)
  );

  assert.deepEqual(violations, []);
});

test('feature slices cannot import app or another slice internals', () => {
  const violations: string[] = [];
  for (const file of typescriptFiles(featuresRoot)) {
    const relativeFile = relative(featuresRoot, file);
    const ownSlice = relativeFile.split(sep)[0];
    for (const specifier of imports(readFileSync(file, 'utf8'))) {
      const resolvedImport = resolve(file, '..', specifier.replace(/\.js$/, '.ts'));
      const relativeImport = relative(featuresRoot, resolvedImport);
      if (!relative(appRoot, resolvedImport).startsWith(`..${sep}`)) {
        violations.push(`${relativeFile} -> ${specifier}`);
        continue;
      }
      if (!relativeImport.startsWith(`..${sep}`)) {
        const targetSlice = relativeImport.split(sep)[0];
        if (targetSlice !== ownSlice && !isFeaturePublicApi(resolvedImport)) {
          violations.push(`${relativeFile} -> ${specifier}`);
        }
      }
    }
  }

  assert.deepEqual(violations, []);
});

test('feature dependency graph is explicit and runtime acyclic', () => {
  const runtimeEdges = featureDependencyEdges(false);
  assert.deepEqual(runtimeEdges, [
    'aggressive-paper -> lp-analysis',
    'directional-paper -> market-data',
    'lp-analysis -> market-data',
    'lp-execution -> lp-analysis',
    'paper-agent -> learning',
    'paper-agent -> lp-analysis',
  ]);

  const graph = new Map<string, string[]>();
  for (const edge of runtimeEdges) {
    const [from, to] = edge.split(' -> ') as [string, string];
    graph.set(from, [...(graph.get(from) ?? []), to]);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (slice: string): void => {
    assert(!visiting.has(slice), `Runtime feature dependency cycle contains ${slice}`);
    if (visited.has(slice)) return;
    visiting.add(slice);
    for (const target of graph.get(slice) ?? []) visit(target);
    visiting.delete(slice);
    visited.add(slice);
  };
  for (const slice of graph.keys()) visit(slice);
});

test('type-only feature dependency graph is captured as an architecture baseline', () => {
  assert.deepEqual(featureDependencyEdges(true), [
    'aggressive-paper -> market-data',
    'directional-paper -> market-data',
    'learning -> paper-agent',
    'lp-analysis -> learning',
    'lp-analysis -> market-data',
    'lp-analysis -> paper-agent',
    'lp-execution -> learning',
    'lp-execution -> market-data',
    'lp-execution -> paper-agent',
    'operations -> directional-paper',
    'operations -> market-data',
    'operations -> paper-agent',
    'paper-agent -> aggressive-paper',
    'paper-agent -> learning',
    'paper-agent -> lp-execution',
    'paper-agent -> market-data',
  ]);
});

test('feature public APIs use explicit exports and approved composition stores only', () => {
  const approvedInfrastructureExports = new Set([
    'AggressivePaperStore',
    'DirectionalPaperStore',
    'LifecycleActivationStore',
    'ExecutionStore',
    'PositionStore',
    'ShadowModeStore',
    'OnchainStore',
    'SnapshotStore',
    'AgentStore',
    'AgentModelRecord',
    'PaperAgentDecision',
    'PaperAgentDecisionInput',
    'PaperAgentPerformance',
    'OnchainPoolSnapshot',
    'PancakeV3OnchainState',
    'DatabaseStorageStats',
    'HistoricalPeriodStats',
    'PoolSnapshot',
    'PoolSnapshotInput',
    'WalCheckpointResult',
    'feeGrowthDelta',
    'aggressivePaperSchema',
    'directionalPaperSchema',
    'learningSchema',
    'lpExecutionSchema',
    'marketDataSchema',
    'paperAgentSchema',
    'createDirectionalPaperSchema',
  ]);
  const violations: string[] = [];
  for (const indexFile of readdirSync(featuresRoot).map(slice => join(featuresRoot, slice, 'index.ts'))) {
    const sourceText = readFileSync(indexFile, 'utf8');
    if (/export\s+\*/.test(sourceText)) violations.push(`${relative(sourceRoot, indexFile)} wildcard export`);
    const source = ts.createSourceFile(indexFile, sourceText, ts.ScriptTarget.Latest, true);
    for (const statement of source.statements) {
      if (!ts.isExportDeclaration(statement) || !statement.moduleSpecifier) continue;
      const specifier = String((statement.moduleSpecifier as ts.StringLiteral).text);
      if (!specifier.includes('/infrastructure/')) continue;
      const clause = statement.exportClause;
      if (!clause || !ts.isNamedExports(clause)) {
        violations.push(`${relative(sourceRoot, indexFile)} -> ${specifier}`);
        continue;
      }
      for (const element of clause.elements) {
        const name = (element.propertyName ?? element.name).text;
        if (!approvedInfrastructureExports.has(name)) {
          violations.push(`${relative(sourceRoot, indexFile)} exports ${name}`);
        }
      }
    }
  }
  assert.deepEqual(violations, []);
});

test('shared modules do not depend on app or feature slices', () => {
  const violations = typescriptFiles(sharedRoot).flatMap(file =>
    imports(readFileSync(file, 'utf8'))
      .map(specifier => ({ specifier, target: resolve(file, '..', specifier.replace(/\.js$/, '.ts')) }))
      .filter(
        ({ target }) =>
          !relative(appRoot, target).startsWith(`..${sep}`) ||
          !relative(featuresRoot, target).startsWith(`..${sep}`)
      )
      .map(({ specifier }) => `${relative(sourceRoot, file)} -> ${specifier}`)
  );

  assert.deepEqual(violations, []);
});

test('feature stores use the shared SQLite connection policy', () => {
  const violations = typescriptFiles(featuresRoot)
    .filter(file => file.endsWith('-store.ts'))
    .filter(file => {
      const source = readFileSync(file, 'utf8');
      return (
        !source.includes('openApplicationDatabase') ||
        source.includes('new DatabaseSync') ||
        source.includes('process.env.SQLITE_PATH')
      );
    })
    .map(file => relative(sourceRoot, file));

  assert.deepEqual(violations, []);
});

test('slice domain modules stay independent from HTTP, SQLite, env, and app', () => {
  const violations: string[] = [];
  for (const file of typescriptFiles(featuresRoot).filter(path => path.includes(`${sep}domain${sep}`))) {
    const source = readFileSync(file, 'utf8');
    const forbiddenImport = imports(source).find(
      specifier =>
        specifier === 'express' ||
        specifier === 'node:sqlite' ||
        specifier.includes('/app/') ||
        specifier.includes('scheduled-task') ||
        specifier.includes('operational-controls')
    );
    if (forbiddenImport || source.includes('process.env')) {
      violations.push(relative(sourceRoot, file));
    }
  }

  assert.deepEqual(violations, []);
});

test('root source directory contains tests only', () => {
  const rootModules = readdirSync(sourceRoot)
    .filter(entry => statSync(join(sourceRoot, entry)).isFile() && entry.endsWith('.ts'))
    .filter(entry => !entry.endsWith('.test.ts'));

  assert.deepEqual(rootModules, []);
});

test('process scripts use final application entry points', () => {
  const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
    scripts: Record<string, string>;
  };
  assert.equal(packageJson.scripts.dev, 'tsx watch src/app/server.ts');
  assert.equal(packageJson.scripts.start, 'node dist/app/server.js');
  assert.equal(packageJson.scripts['backtest:directional'], 'tsx src/app/directional-backtest.ts');
  assert.match(readFileSync('scripts/start-background.sh', 'utf8'), /node dist\/app\/server\.js/);
});
