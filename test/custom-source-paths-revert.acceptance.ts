/** Rebuild a disposable SDK after reverting only custom-provider source identity normalization. */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { withSourceCopy } from './revert-control.ts';

await withSourceCopy(async (root, repository) => {
  await cp(join(repository, 'tsconfig.json'), join(root, 'tsconfig.json'));
  const path = join(root, 'src/sources.ts'); const fixed = await readFile(path, 'utf8');
  const reverted = fixed.replace("return source.replace(/^(?:\\.\\/)+/, '') || '.';", "return source.replace(/^\\.\\//, '');");
  assert.notEqual(reverted, fixed);
  const options = { cwd: root, encoding: 'utf8' as const, timeout: 240000, env: { PATH: process.env.PATH, GIT_CEILING_DIRECTORIES: tmpdir() } };
  /** Rebuild both the authored function and the package SDK before each proof run. */
  const build = () => execFileSync(process.execPath, [join(repository, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.json'], options);
  const args = ['--test', '--test-concurrency=2', '--test-reporter=tap', 'test/custom-source-paths.test.ts'];
  try {
    await writeFile(path, reverted); build();
    const result = spawnSync(process.execPath, args, options);
    assert.equal(result.error, undefined); assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /# fail 3\b/);
    console.log('sourceIdentity custom-provider branch reverted to #42: 3 tests fail');
  } finally { await writeFile(path, fixed); build(); }
  const { error, status, stdout, stderr } = spawnSync(process.execPath, args, options);
  assert.ifError(error); assert.equal(status, 0, stdout + stderr);
  console.log('sourceIdentity restored and SDK rebuilt: 3 tests pass');
});
