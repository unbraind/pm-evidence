import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { readFile, chmod } from 'node:fs/promises';
import { digest } from '../src/core.ts';

/** Require a public fleet repository and pin the exact committed snapshot under evaluation. */
export function publicSnapshotInfo(repository: string): { identity: string; head: string } {
  const identity = execFileSync('git', ['config', '--get', 'remote.origin.url'], { cwd: repository, encoding: 'utf8' }).trim().match(/unbraind\/(pm-[\w-]+)/)?.[0];
  assert.ok(identity);
  assert.equal(JSON.parse(execFileSync('gh', ['repo', 'view', identity, '--json', 'isPrivate'], { encoding: 'utf8' })).isPrivate, false);
  return { identity, head: execFileSync('git', ['rev-parse', 'origin/main'], { cwd: repository, encoding: 'utf8' }).trim() };
}
/** Independently hash every committed snapshot file after evidence setup or verification. */
export async function snapshotDigests(root: string, files: string[]): Promise<string[]> {
  return Promise.all(files.map(async file => digest(await readFile(join(root, file), 'utf8'))));
}
/** Freeze snapshot inputs before a read-only measurement and retain their independent hashes. */
export async function freezeSnapshot(root: string, files: string[]): Promise<string[]> {
  const hashes = await snapshotDigests(root, files);
  for (const file of files) await chmod(join(root, file), 0o444);
  return hashes;
}

/** Archive committed public inputs into a scratch directory and independently fence git discovery. */
export function copyPublicSnapshot(repository: string, root: string, paths: string[]): string[] {
  const archive = execFileSync('git', ['archive', 'origin/main', ...paths], { cwd: repository, maxBuffer: 64 * 1024 * 1024 });
  execFileSync('tar', ['-x', '-C', root], { input: archive });
  assert.notEqual(spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: root, env: { ...process.env, GIT_CEILING_DIRECTORIES: dirname(root) } }).status, 0);
  return execFileSync('git', ['ls-tree', '-r', '--name-only', 'origin/main', ...paths], { cwd: repository, encoding: 'utf8' }).trim().split('\n');
}
