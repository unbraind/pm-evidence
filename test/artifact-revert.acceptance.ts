/** A real function-only ownership revert executes only in a disposable copy. */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withSourceCopy } from './revert-control.ts';

await withSourceCopy(async (root, repository) => {
  const path = join(root, 'src', 'store.ts'); const fixed = await readFile(path, 'utf8');
  const options = { cwd: root, encoding: 'utf8' as const, timeout: 240000, env: { PATH: process.env.PATH, GIT_CEILING_DIRECTORIES: tmpdir() } };
  for (const [revision, pattern, diagnostic] of [['0e6614a', '^additive artifact ownership', 'Native annotation changed'], ['9aed762', '^foreign duplicate', 'Existing native rows must never be normalized or discarded']]) {
    const prior = execFileSync('git', ['show', `${revision}:src/store.ts`], { cwd: repository, encoding: 'utf8' });
    const original = prior.match(/function writeEvidence\([\s\S]*?\n}/); assert.ok(original);
    const reverted = fixed.replace(/function writeEvidence\([\s\S]*?\n}/, original[0]); assert.notEqual(reverted, fixed); await writeFile(path, reverted);
    const args = ['--test', '--test-concurrency=1', '--test-reporter=tap', '--test-name-pattern', pattern, 'test/artifact-ownership.test.ts'];
    const negative = spawnSync(process.execPath, args, options);
    assert.equal(negative.error, undefined); assert.equal(negative.status, 1, negative.stdout + negative.stderr); assert.match(negative.stdout, /# fail 1/); assert.ok(negative.stdout.includes(diagnostic));
    await writeFile(path, fixed);
    const restored = spawnSync(process.execPath, args, options); assert.equal(restored.error, undefined); assert.equal(restored.status, 0, restored.stdout + restored.stderr);
    console.log(JSON.stringify({ functionOnlyRevert: revision, pattern, negative: 'fail 1', restored: 'pass 1', disposableCopy: true }));
  }
});
