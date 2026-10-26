import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { dirname } from 'node:path';

/** Archive committed public inputs into a scratch directory and independently fence git discovery. */
export function copyPublicSnapshot(repository: string, root: string, paths: string[]): void {
  const archive = execFileSync('git', ['archive', 'origin/main', ...paths], { cwd: repository, maxBuffer: 64 * 1024 * 1024 });
  execFileSync('tar', ['-x', '-C', root], { input: archive });
  assert.notEqual(spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: root, env: { ...process.env, GIT_CEILING_DIRECTORIES: dirname(root) } }).status, 0);
}
