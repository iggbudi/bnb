import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, relative, resolve, sep } from 'node:path';
import test from 'node:test';

const sourceRoot = resolve('src');
const featuresRoot = join(sourceRoot, 'features');

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

test('application composition modules do not depend on compatibility wrappers', () => {
  const forbidden = new Set([
    '../bnb-app.js',
    '../bnb-schedulers.js',
    '../bnb-services.js',
    '../server-bnb.js',
  ]);
  const violations = typescriptFiles(join(sourceRoot, 'app')).flatMap(file =>
    imports(readFileSync(file, 'utf8'))
      .filter(specifier => forbidden.has(specifier))
      .map(specifier => `${relative(sourceRoot, file)} -> ${specifier}`)
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
      if (relativeImport.startsWith(`..${sep}`) && relativeImport.includes(`${sep}app${sep}`)) {
        violations.push(`${relativeFile} -> ${specifier}`);
        continue;
      }
      if (!relativeImport.startsWith(`..${sep}`)) {
        const targetSlice = relativeImport.split(sep)[0];
        if (targetSlice !== ownSlice && basename(resolvedImport) !== 'index.ts') {
          violations.push(`${relativeFile} -> ${specifier}`);
        }
      }
    }
  }

  assert.deepEqual(violations, []);
});

test('shared modules do not depend on app or feature slices', () => {
  const violations = typescriptFiles(join(sourceRoot, 'shared')).flatMap(file =>
    imports(readFileSync(file, 'utf8'))
      .filter(specifier => specifier.includes('/app/') || specifier.includes('/features/'))
      .map(specifier => `${relative(sourceRoot, file)} -> ${specifier}`)
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
      specifier => specifier === 'express' || specifier === 'node:sqlite' || specifier.includes('/app/')
    );
    if (forbiddenImport || source.includes('process.env')) {
      violations.push(relative(sourceRoot, file));
    }
  }

  assert.deepEqual(violations, []);
});
