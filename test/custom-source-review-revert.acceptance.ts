/** Revert each review fix independently in a disposable tree and rebuild the shipped SDK. */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withSourceCopy } from './revert-control.ts';

await withSourceCopy(async (root, repository) => {
  const baseline = JSON.parse(await readFile(join(root, 'test/fixtures/custom-source-retry-cite.json'), 'utf8')) as Record<string, string>;
  const options = { cwd: root, encoding: 'utf8' as const, timeout: 240000, env: { PATH: process.env.PATH, GIT_CEILING_DIRECTORIES: tmpdir() } };
  assert.equal(baseline.baseline, '9de21eb');
  await cp(join(repository, 'tsconfig.json'), join(root, 'tsconfig.json'));
  const compiler = join(repository, 'node_modules/typescript/bin/tsc');
  /** Both APIs must execute the same behavior after every function-only mutation. */
  const build = () => execFileSync(process.execPath, [compiler, '--project', join(root, 'tsconfig.json')], options);
  for (const [name, file, next, suite, pattern] of [
    ['existingCitation', 'src/evidence.ts', '/** Record exact evidence', 'test/custom-source-retry.test.ts', 'custom exact IDs'],
    ['cite', 'src/evidence.ts', '/** Verify retained', 'test/custom-source-retry.test.ts', 'custom retries preserve'],
    ['review', 'src/evidence.ts', '/** Return citation', 'test/custom-source-retry.test.ts', 'custom re-anchor retries'],
    ['sourceIdentity', 'src/sources.ts', '/** Require a canonical', 'test/custom-source-paths.test.ts', 'custom leading slash'],
    ['affected', 'src/evidence.ts', '/** Re-anchor one coherent', 'test/custom-source-paths.test.ts', 'custom leading slash'],
  ]) {
    const path = join(root, file); const fixed = await readFile(path, 'utf8');
    const start = fixed.indexOf(`${name === 'existingCitation' ? '' : name === 'sourceIdentity' ? 'export ' : 'export async '}function ${name}(`); const end = fixed.indexOf(next, start);
    assert.ok(start >= 0 && end > start);
    const reverted = fixed.slice(0, start) + baseline[name] + '\n' + fixed.slice(end);
    assert.notEqual(reverted, fixed);
    const args = ['--test', '--test-concurrency=1', '--test-reporter=tap', '--test-name-pattern', pattern, suite];
    try {
      await writeFile(path, reverted); build();
      const result = spawnSync(process.execPath, args, options);
      assert.ifError(result.error); assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stdout, /# fail 1\b/);
      assert.match(result.stdout, /AssertionError/, 'Negative control must reach its behavioral assertions');
      console.log(`${name} reverted independently: 1 regression fails`);
    } finally { await writeFile(path, fixed); build(); }
    const restored = spawnSync(process.execPath, args, options);
    assert.ifError(restored.error); assert.equal(restored.status, 0, restored.stdout + restored.stderr);
    assert.match(restored.stdout, /# pass 1\b/);
    console.log(`${name} restored and SDK rebuilt: 1 regression passes`);
  }
});
