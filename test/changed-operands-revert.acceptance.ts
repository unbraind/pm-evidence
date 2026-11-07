/** Prove the whole corpus contract fails when only affected is reverted, rebuilding the shipped SDK. */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { withSourceCopy } from './revert-control.ts';

await withSourceCopy(async (root, repository) => {
  const file = join(root, 'src/evidence.ts'); const fixed = await readFile(file, 'utf8');
  const old = JSON.parse(await readFile(join(root, 'test/fixtures/changed-operands-affected-before.json'), 'utf8')) as { baseline: string; affected: string };
  assert.equal(old.baseline, 'b724679');
  const start = fixed.indexOf('export async function affected('); const end = fixed.indexOf('/** Re-anchor one coherent', start);
  assert.ok(start >= 0 && end > start);
  const broken = fixed.slice(0, start) + old.affected + '\n' + fixed.slice(end);
  assert.notEqual(broken, fixed);
  await cp(join(repository, 'tsconfig.json'), join(root, 'tsconfig.json'));
  const context = { cwd: root, encoding: 'utf8' as const, timeout: 300000, env: { PATH: process.env.PATH } };
  /** Compile clean disposable artifacts before either API is exercised. */
  const rebuild = () => execFileSync(process.execPath, [join(repository, 'node_modules/typescript/bin/tsc')], context);
  /** Preserve source and compiled API coverage with bounded native test concurrency. */
  const run = () => spawnSync(process.execPath, ['--test', '--test-concurrency=2', '--test-reporter=tap', 'test/changed-operands.test.ts'], context);
  try {
    await writeFile(file, broken); rebuild();
    const negative = run(); assert.ifError(negative.error);
    assert.equal(negative.status, 1, negative.stdout + negative.stderr);
    assert.match(negative.stdout, /# fail 2\b/); assert.match(negative.stdout, /Accepted custom-only operands must work for every corpus/);
    console.log('affected reverted to b724679: both API contract tests fail on the mixed-provider corpus');
  } finally { await writeFile(file, fixed); rebuild(); }
  const restored = run(); assert.ifError(restored.error);
  assert.equal(restored.status, 0, restored.stdout + restored.stderr); assert.match(restored.stdout, /# pass 2\b/);
  console.log('affected restored: both APIs pass all 65 ordered corpora, early-refusal, legacy and native JSON/TOON checks');
});
