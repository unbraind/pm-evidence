/** Compare origin/main and candidate builds on unchanged public tracker copies outside git. */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdtemp, mkdir, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const repositories = process.argv.slice(2); assert.ok(repositories.length > 0, 'Pass public repository checkouts');
const root = await mkdtemp(join(tmpdir(), 'evidence-sdk-differential-'));
const packageRoot = resolve(import.meta.dirname, '..');
try {
  const baseline = join(root, 'baseline'); await mkdir(baseline);
  const baselineHead = execFileSync('git', ['rev-parse', 'origin/main'], { encoding: 'utf8' }).trim();
  const source = execFileSync('git', ['archive', 'origin/main', 'src', 'index.ts', 'tsconfig.json', 'package.json'], { maxBuffer: 16 * 1024 * 1024 });
  execFileSync('tar', ['-x', '-C', baseline], { input: source });
  await symlink(join(packageRoot, 'node_modules'), join(baseline, 'node_modules'), 'dir');
  await mkdir(join(baseline, 'test'));
  await copyFile(join(packageRoot, 'test', 'sdk-differential-runner.ts'), join(baseline, 'test', 'sdk-differential-runner.ts'));
  execFileSync(process.execPath, [join(packageRoot, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', join(baseline, 'tsconfig.json')]);
  for (const [index, repository] of repositories.entries()) {
    const head = execFileSync('git', ['rev-parse', 'origin/main'], { cwd: repository, encoding: 'utf8' }).trim();
    const identity = execFileSync('git', ['config', '--get', 'remote.origin.url'], { cwd: repository, encoding: 'utf8' }).trim();
    assert.match(identity, /(?:[:/])unbraind\/pm-[\w-]+(?:\.git)?$/);
    const copy = join(root, `tracker-${index}`); await mkdir(copy);
    const files = execFileSync('git', ['ls-tree', '-r', '--name-only', 'origin/main', '.agents/pm'], { cwd: repository, encoding: 'utf8' }).trim().split('\n');
    const archive = execFileSync('git', ['archive', 'origin/main', '.agents/pm'], { cwd: repository, maxBuffer: 64 * 1024 * 1024 });
    execFileSync('tar', ['-x', '-C', copy], { input: archive });
    const hashes = await Promise.all(files.map(async file => createHash('sha256').update(await readFile(join(copy, file))).digest('hex')));
    const env = { ...process.env, PATH: '', GIT_CEILING_DIRECTORIES: dirname(root), PM_AUTHOR: 'fixture' };
    assert.notEqual(spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: copy, env: { ...env, PATH: process.env.PATH } }).status, 0);
    const results = [baseline, packageRoot].map(build => JSON.parse(execFileSync(process.execPath, [join(build, 'test', 'sdk-differential-runner.ts'), join(copy, '.agents', 'pm')], { cwd: copy, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })) as { items: number; comparisons: number; outputs: unknown[] });
    assert.deepEqual(results[1], results[0]);
    assert.deepEqual(await Promise.all(files.map(async file => createHash('sha256').update(await readFile(join(copy, file))).digest('hex'))), hashes);
    console.log(JSON.stringify({ repository: identity.match(/unbraind\/pm-[\w-]+/)![0].replace(/\.git$/, ''), head, baselineHead, items: results[0].items, comparisons: results[0].comparisons, identical: true, intentionalDifferences: [], sourceFilesUnchanged: files.length, noGit: true }));
  }
} finally { await rm(root, { recursive: true, force: true }); }
