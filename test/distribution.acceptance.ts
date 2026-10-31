import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { gitEnvironment, npmEnvironment } from '../scripts/environment.ts';
import { artifactInventory, assertArtifactGraph, assertPackageEntrypoints, committedArtifacts } from './distribution-helpers.ts';

/** Compile in a pristine tree so an old output file or an incremental local build cannot satisfy the gate. */
function cleanBuild(root: string): Map<string, Buffer> {
  const repository = resolve(import.meta.dirname, '..');
  for (const path of ['src', 'index.ts', 'tsconfig.json', 'package.json']) cpSync(join(repository, path), join(root, path), { recursive: true });
  symlinkSync(join(repository, 'node_modules'), join(root, 'node_modules'), 'dir');
  execFileSync(process.execPath, [join(repository, 'node_modules', 'typescript', 'bin', 'tsc')], { cwd: root, env: npmEnvironment(gitEnvironment(process.env)), stdio: 'pipe' });
  return artifactInventory(root);
}

test('every committed and working compiled artifact matches a pristine source build', t => {
  const root = mkdtempSync(join(tmpdir(), 'evidence-distribution-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const repository = resolve(import.meta.dirname, '..'); const expected = cleanBuild(root);
  assertArtifactGraph(expected, committedArtifacts(repository, 'HEAD', gitEnvironment(process.env)), 'HEAD');
  assertArtifactGraph(expected, artifactInventory(repository), 'working tree');
  assertPackageEntrypoints(JSON.parse(readFileSync(join(repository, 'package.json'), 'utf8')) as Record<string, unknown>, expected);
  console.log(`Distribution: ${expected.size} committed artifacts match a pristine build`);
});

test('graph oracle detects missing, stale and extra artifacts at every compiled path', t => {
  const root = mkdtempSync(join(tmpdir(), 'evidence-distribution-law-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const expected = cleanBuild(root);
  assertArtifactGraph(expected, new Map(expected), 'unchanged');
  for (const [path, bytes] of expected) {
    const missing = new Map(expected); missing.delete(path);
    assert.throws(() => assertArtifactGraph(expected, missing, 'missing'), /inventory differs/);
    const stale = new Map(expected); stale.set(path, Buffer.concat([bytes, Buffer.from('\n')]));
    assert.throws(() => assertArtifactGraph(expected, stale, 'stale'), /differs from the clean compiler output/);
    const extra = new Map(expected); extra.set(`${path}.orphan`, bytes);
    assert.throws(() => assertArtifactGraph(expected, extra, 'extra'), /inventory differs/);
  }
  for (const field of ['main', 'types', 'exports', 'bin']) {
    assert.throws(() => assertPackageEntrypoints({ [field]: { nested: './dist/missing.js' } }, expected), /promised entrypoint/);
  }
  console.log(`Distribution oracle: ${expected.size * 3} adversarial mutations refused`);
});
