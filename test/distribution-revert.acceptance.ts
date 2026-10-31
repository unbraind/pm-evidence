import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test, type TestContext } from 'node:test';
import { gitEnvironment, npmEnvironment, testEnvironment } from '../scripts/environment.ts';

/** Mutate only disposable Git clones; the reviewed tree and its build outputs remain untouched. */
function controlRepository(t: TestContext): { root: string; env: NodeJS.ProcessEnv } {
  const repository = resolve(import.meta.dirname, '..'); const root = mkdtempSync(join(tmpdir(), 'evidence-distribution-revert-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const env = { ...testEnvironment(npmEnvironment(gitEnvironment(process.env))), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
  command(repository, 'git', ['clone', '--no-hardlinks', repository, root], env);
  symlinkSync(join(repository, 'node_modules'), join(root, 'node_modules'), 'dir');
  return { root, env };
}

/** Require fixture setup to succeed without displaying local paths in successful receipts. */
function command(root: string, executable: string, args: string[], env: NodeJS.ProcessEnv): void {
  const result = spawnSync(executable, args, { cwd: root, env, encoding: 'utf8', timeout: 300000 });
  assert.equal(result.error, undefined); assert.equal(result.status, 0, result.stdout + result.stderr);
}

/** Pin each mutant as a real commit so git consumers cannot accidentally read the fixed working tree. */
function commit(root: string, env: NodeJS.ProcessEnv): void {
  command(root, 'git', ['-c', 'user.name=SteveBot', '-c', 'user.email=1153461+unbraind@users.noreply.github.com', 'commit', '-m', 'test: disposable distribution negative control'], env);
}

/** Assert a specific behavioral failure count, excluding install/setup failures as evidence. */
function refusal(root: string, suite: string, count: number, evidence: RegExp, env: NodeJS.ProcessEnv): void {
  const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', '--test-reporter=tap', suite], { cwd: root, env, encoding: 'utf8', timeout: 600000 });
  assert.equal(result.error, undefined); assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, new RegExp(`# fail ${count}\\b`)); assert.match(result.stdout, evidence);
  assert.doesNotMatch(result.stdout, /EAI_AGAIN|ETIMEDOUT|ECONNRESET/);
}

test('removing only committed dist fails the graph gate and all four scripts-disabled install journeys', t => {
  const { root, env } = controlRepository(t);
  command(root, 'git', ['rm', '-r', 'dist'], env); commit(root, env);
  refusal(root, 'test/distribution.acceptance.ts', 1, /HEAD: compiled file inventory differs/, env);
  refusal(root, 'test/install.acceptance.ts', 4, /ENOENT.*scandir.*dist/, env);
  console.log('Missing-dist revert: graph gate fails 1/2; npm/Bun tarball and commit-pinned git journeys fail 4/4');
});

test('reverting only a compiled runtime artifact fails pristine-build parity', t => {
  const { root, env } = controlRepository(t); const path = join(root, 'dist', 'index.js');
  const fixed = readFileSync(path, 'utf8');
  const stale = fixed.replace(/version: "[^"]+"/, 'version: "0.0.0"'); assert.notEqual(stale, fixed);
  writeFileSync(path, stale); command(root, 'git', ['add', 'dist/index.js'], env); commit(root, env);
  refusal(root, 'test/distribution.acceptance.ts', 1, /HEAD: dist\/index.js differs from the clean compiler output/, env);
  console.log('Stale-artifact revert: only dist/index.js changed; pristine-build gate fails 1/2');
});
