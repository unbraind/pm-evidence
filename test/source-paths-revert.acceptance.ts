/** Function-only revert proofs execute in a disposable copy and rebuild the SDK for every case. */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { withSourceCopy } from './revert-control.ts';

/** Extract a complete column-aligned function, retaining its public signature during body reverts. */
function body(source: string, name: string, method = false): string {
  const pattern = method ? new RegExp(`  async ${name}\\([^\\n]*[\\s\\S]*?\\n  }`) : new RegExp(`(?:export )?(?:async )?function ${name}\\([^\\n]*[\\s\\S]*?\\n}`);
  const match = source.match(pattern); assert.ok(match, name); return match[0];
}

await withSourceCopy(async (root, repository) => {
  await cp(join(repository, 'tsconfig.json'), join(root, 'tsconfig.json'));
  const options = { cwd: root, encoding: 'utf8' as const, timeout: 240000, env: { PATH: process.env.PATH, GIT_CEILING_DIRECTORIES: tmpdir() } };
  const cases = [
    { file: 'src/sources.ts', name: 'sourceIdentity', pattern: '^canonical (?!custom-provider)', failures: 13 },
    { file: 'src/evidence.ts', name: 'affected', pattern: '^canonical spelling', failures: 7 },
    { file: 'src/evidence.ts', name: 'prepare', pattern: '^canonical custom-provider', failures: 1 },
    { file: 'src/sources.ts', name: 'snapshot', pattern: '^canonical custom-provider', failures: 1 },
    { file: 'src/verification.ts', name: 'read', method: true, pattern: '^canonical custom-provider', failures: 1 },
    { file: 'src/store.ts', name: 'writeEvidence', pattern: '^canonical source discovery', failures: 1 },
  ];
  for (const proof of cases) {
    const path = join(root, proof.file); const fixed = await readFile(path, 'utf8'); const current = body(fixed, proof.name, proof.method);
    const baseline = execFileSync('git', ['show', `6e626ce:${proof.file}`], { cwd: repository, encoding: 'utf8' });
    let replacement = body(baseline, proof.name, proof.method);
    if (proof.name === 'sourceIdentity') replacement = current.slice(0, current.indexOf('\n')) + replacement.slice(replacement.indexOf('\n'));
    if (proof.name === 'affected') replacement = replacement.replace('map(sourceIdentity)', 'map(source => sourceIdentity(source))');
    assert.notEqual(replacement, current);
    /** Rebuild exactly the implementation under test, including dist imports in the regression suite. */
    const build = () => execFileSync(process.execPath, [join(repository, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.json'], options);
    const args = ['--test', '--test-concurrency=1', '--test-reporter=tap', '--test-name-pattern', proof.pattern, 'test/source-paths.test.ts'];
    try {
      await writeFile(path, fixed.replace(current, replacement)); build();
      const reverted = spawnSync(process.execPath, args, options);
      assert.equal(reverted.error, undefined); assert.equal(reverted.status, 1, reverted.stdout + reverted.stderr);
      assert.match(reverted.stdout, new RegExp(`# fail ${proof.failures}\\b`), reverted.stdout);
    } finally { await writeFile(path, fixed); build(); }
    const restored = spawnSync(process.execPath, args, options);
    assert.deepEqual({ error: restored.error, status: restored.status }, { error: undefined, status: 0 }, restored.stdout + restored.stderr);
    console.log(JSON.stringify({ function: proof.name, pattern: proof.pattern, revertedFailures: proof.failures, restored: 'pass', disposableCopy: true, rebuiltSdk: true }));
  }
});
