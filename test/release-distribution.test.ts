/** Execute the package-owned distribution hook before the pinned transaction checks it. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test, type TestContext } from 'node:test';
import { stampExtensionVersion } from 'pm-ops/daily-release';
import { gitEnvironment, npmEnvironment, testEnvironment } from '../scripts/environment.ts';

/** Version a real scratch checkout and execute its actual package hook and immutable artifact gate. */
function preparedDistribution(t: TestContext, commitArtifacts: boolean) {
  const repository = resolve(import.meta.dirname, '..');
  const root = mkdtempSync(join(tmpdir(), 'evidence-release-distribution-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const env = { ...testEnvironment(npmEnvironment(gitEnvironment(process.env))), HOME: root, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
  const clone = spawnSync('git', ['clone', '--no-hardlinks', repository, root], { env, encoding: 'utf8' });
  assert.equal(clone.status, 0, clone.stderr);
  symlinkSync(join(repository, 'node_modules'), join(root, 'node_modules'), 'dir');
  const manifest = JSON.parse(readFileSync(join(repository, 'package.json'), 'utf8')) as { version: string; scripts: Record<string, string> };
  manifest.version = '2099.1.1';
  if (!commitArtifacts) manifest.scripts['release:build'] = 'npm run build';
  writeFileSync(join(root, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
  const lock = JSON.parse(readFileSync(join(repository, 'package-lock.json'), 'utf8')) as { version: string; packages: Record<string, { version: string }> };
  lock.version = manifest.version; lock.packages[''].version = manifest.version;
  writeFileSync(join(root, 'package-lock.json'), JSON.stringify(lock, null, 2) + '\n');
  const extension = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')) as { version: string };
  extension.version = manifest.version;
  writeFileSync(join(root, 'manifest.json'), JSON.stringify(extension, null, 2) + '\n');
  for (const file of ['index.ts', 'src/index.ts', 'src/extension.ts']) {
    const path = join(root, file);
    if (existsSync(path)) writeFileSync(path, stampExtensionVersion(readFileSync(path, 'utf8'), manifest.version));
  }
  const built = spawnSync('npm', ['run', 'release:build'], { cwd: root, env, encoding: 'utf8', timeout: 120000 });
  assert.equal(built.status, 0, built.stdout + built.stderr);
  return spawnSync('npm', ['run', 'dist:check'], { cwd: root, env, encoding: 'utf8', timeout: 120000 });
}

test('the shared build hook commits rebuilt distribution before the immutable artifact gate', t => {
  const accepted = preparedDistribution(t, true);
  assert.equal(accepted.status, 0, accepted.stdout + accepted.stderr);
  const rejected = preparedDistribution(t, false);
  assert.notEqual(rejected.status, 0, 'reverting only the package build hook must reproduce stale committed artifacts');
  assert.match(rejected.stdout + rejected.stderr, /differs|inventory/u);
});
