import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test, type TestContext } from 'node:test';
import { parseDocument } from 'yaml';
import { gitEnvironment, npmEnvironment, testEnvironment } from '../scripts/environment.ts';

/** One executable local release preparation step; no publishing jobs are evaluated. */
interface PrepareStep { name?: string; run?: string }

/** Exercise the actual version/build and commit scripts, then the shared artifact gate, in workflow order. */
function prepare(t: TestContext, steps: PrepareStep[]) {
  const repository = resolve(import.meta.dirname, '..'); const root = mkdtempSync(join(tmpdir(), 'evidence-release-distribution-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const env = { ...testEnvironment(npmEnvironment(gitEnvironment(process.env))), HOME: root, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', NPM_VERSION: '2099.1.1', RELEASE_TAG: 'synthetic-artifact-check', REPO_NAME: 'pm-evidence' };
  const clone = spawnSync('git', ['clone', '--no-hardlinks', repository, root], { env, encoding: 'utf8' });
  assert.equal(clone.status, 0, clone.stderr);
  symlinkSync(join(repository, 'node_modules'), join(root, 'node_modules'), 'dir');
  for (const step of steps) {
    if (!['Update release version', 'Commit release files', 'Run release checks'].includes(step.name ?? '')) continue;
    const gate = step.name === 'Run release checks';
    const result = spawnSync('bash', ['-c', gate ? 'npm run dist:check' : step.run!], { cwd: root, env, encoding: 'utf8', timeout: 120000 });
    assert.equal(result.error, undefined);
    if (gate) return result;
    assert.equal(result.status, 0, result.stdout + result.stderr);
  }
  throw new Error('The release preparation must reach artifact validation');
}

test('release preparation commits the rebuilt distribution before validating the immutable Git artifact', t => {
  const source = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
  const workflow = parseDocument(source).toJS() as { jobs: { prepare: { steps: PrepareStep[] } } };
  const steps = workflow.jobs.prepare.steps;
  const fixed = prepare(t, steps); assert.equal(fixed.status, 0, fixed.stdout + fixed.stderr); assert.match(fixed.stdout, /pass 2/);
  // Restore only the former ordering as a behavioral revert; the production build/commit scripts are unchanged.
  const commit = steps.find(step => step.name === 'Commit release files'); assert.ok(commit);
  const reverted = steps.filter(step => step !== commit); const check = reverted.findIndex(step => step.name === 'Run release checks');
  reverted.splice(check + 1, 0, commit);
  const stale = prepare(t, reverted); assert.equal(stale.status, 1, stale.stdout + stale.stderr);
  assert.match(stale.stdout, /HEAD: dist\/index.js differs from the clean compiler output/); assert.match(stale.stdout, /fail 1/);
});
