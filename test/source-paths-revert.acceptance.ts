/** Function-only revert proofs execute in a disposable copy and rebuild the SDK for every case. */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { withSourceCopy } from './revert-control.ts';
import { digest } from '../src/core.ts';

/** Extract a complete column-aligned function, retaining its public signature during body reverts. */
function body(source: string, name: string, method = false): string {
  const pattern = method ? new RegExp(`  async ${name}\\([^\\n]*[\\s\\S]*?\\n  }`) : new RegExp(`(?:export )?(?:async )?function ${name}\\([^\\n]*[\\s\\S]*?\\n}`);
  const match = source.match(pattern); assert.ok(match, name); return match[0];
}

await withSourceCopy(async (root, sourceRepository) => {
  await cp(join(sourceRepository, 'tsconfig.json'), join(root, 'tsconfig.json'));
  const repository = root;
  const fixture = JSON.parse(await readFile(join(root, 'test/fixtures/source-paths-baselines.json'), 'utf8')) as { functions: Record<string, string>; sha256: Record<string, string> };
  const baselines = new Map(Object.entries(fixture.functions)); const hashes = new Map(Object.entries(fixture.sha256));
  for (const [name, baseline] of baselines) assert.equal(digest(baseline), hashes.get(name), `Immutable baseline fixture ${name}`);
  const options = { cwd: root, encoding: 'utf8' as const, timeout: 240000, env: { PATH: process.env.PATH, GIT_CEILING_DIRECTORIES: tmpdir() } };
  const cases = [
    { file: 'src/sources.ts', name: 'sourceIdentity', pattern: '^canonical (?!custom-provider)', failures: 14 },
    { file: 'src/sources.ts', name: 'sourceIdentity', revision: 'fd1453b', fixture: 'rootIdentityGuard', pattern: '^canonical root identities', failures: 1 },
    { file: 'src/evidence.ts', name: 'affected', pattern: '^canonical spelling', failures: 7 },
    { file: 'src/evidence.ts', name: 'prepare', pattern: '^canonical custom-provider', failures: 1 },
    { file: 'src/sources.ts', name: 'snapshot', pattern: '^canonical custom-provider', failures: 1 },
    { file: 'src/verification.ts', name: 'read', method: true, pattern: '^canonical custom-provider', failures: 1 },
    { file: 'src/store.ts', name: 'writeEvidence', pattern: '^canonical source discovery', failures: 1 },
  ];
  for (const proof of cases) {
    const path = join(root, proof.file); const fixed = await readFile(path, 'utf8'); const current = body(fixed, proof.name, proof.method);
    const baseline = baselines.get(proof.fixture ?? proof.name); assert.ok(baseline, proof.name);
    let replacement = baseline;
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
    console.log(JSON.stringify({ function: proof.name, baseline: proof.revision ?? '6e626ce', pattern: proof.pattern, revertedFailures: proof.failures, restored: 'pass', disposableCopy: true, rebuiltSdk: true }));
  }
});
