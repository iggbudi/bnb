import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import test from 'node:test';

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
