import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

/** Require one isolated behavioral regression to fail after a function-only negative control. */
export function expectBehavioralFailure(suite: string, pattern: string): void {
  const run = spawnSync(process.execPath, ['--test', '--test-concurrency=1', '--test-reporter=tap', '--test-name-pattern', pattern, suite], { encoding: 'utf8', timeout: 120000 });
  assert.equal(run.error, undefined); assert.equal(run.status, 1, run.stdout + run.stderr); assert.match(run.stdout, /# fail 1/);
}
