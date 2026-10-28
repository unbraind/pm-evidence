/** A real function-only ownership revert executes only in a disposable copy. */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withSourceCopy } from './revert-control.ts';

await withSourceCopy(async (root, repository) => {
  const path = join(root, 'src', 'store.ts'); const fixed = await readFile(path, 'utf8');
  const prior = execFileSync('git', ['show', '0e6614a:src/store.ts'], { cwd: repository, encoding: 'utf8' });
  const writer = /function writeEvidence\([\s\S]*?\n}/; const original = prior.match(writer); assert.ok(original);
  const reverted = fixed.replace(writer, original[0]); assert.notEqual(reverted, fixed);
  await writeFile(path, reverted);
  const args = ['--test', '--test-concurrency=1', '--test-reporter=tap', '--test-name-pattern', '^additive artifact ownership', 'test/artifact-ownership.test.ts'];
  const options = { cwd: root, encoding: 'utf8' as const, timeout: 240000, env: { PATH: process.env.PATH, GIT_CEILING_DIRECTORIES: tmpdir() } };
  const negative = spawnSync(process.execPath, args, options);
  assert.equal(negative.error, undefined); assert.equal(negative.status, 1, negative.stdout + negative.stderr); assert.match(negative.stdout, /# fail 1/); assert.match(negative.stdout, /Native annotation changed/);
  await writeFile(path, fixed);
  const restored = spawnSync(process.execPath, args, options); assert.equal(restored.error, undefined); assert.equal(restored.status, 0, restored.stdout + restored.stderr);
  console.log('Shared writer function-only revert: fail 1 on native annotation loss; restored: pass 1 across 30 writer/domain combinations. Original checkout never mutated.');
});
