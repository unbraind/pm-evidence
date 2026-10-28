import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/** Run function-only negative controls in disposable sources with the existing dependency graph. */
export async function withSourceCopy(action: (root: string, repository: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'evidence-revert-')); const repository = resolve(import.meta.dirname, '..');
  try {
    for (const path of ['src', 'test', 'index.ts', 'package.json']) await cp(join(repository, path), join(root, path), { recursive: true });
    await symlink(join(repository, 'node_modules'), join(root, 'node_modules'), 'dir');
    await action(root, repository);
  } finally { await rm(root, { recursive: true, force: true }); }
}

/** Require one isolated behavioral regression to fail after a function-only negative control. */
export function expectBehavioralFailure(suite: string, pattern: string): void {
  const run = spawnSync(process.execPath, ['--test', '--test-concurrency=1', '--test-reporter=tap', '--test-name-pattern', pattern, suite], { encoding: 'utf8', timeout: 120000 });
  assert.equal(run.error, undefined); assert.equal(run.status, 1, run.stdout + run.stderr); assert.match(run.stdout, /# fail 1/);
}
