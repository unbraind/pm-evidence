import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { gitEnvironment, npmEnvironment } from '../scripts/environment.ts';

/** Execute one packed-consumer step with isolated configuration and an asserted exit status. */
function execute(cwd: string, executable: string, args: string[], env: NodeJS.ProcessEnv): string {
  const result = spawnSync(executable, args, { cwd, env, encoding: 'utf8', timeout: 300000 }); assert.equal(result.error, undefined); assert.equal(result.status, 0, result.stdout + result.stderr); return result.stdout;
}
for (const manager of ['npm', 'bun']) test(`packed ${manager} and ${manager === 'npm' ? 'npx' : 'bunx'} evidence journey`, t => {
  const repository = resolve(import.meta.dirname, '..'); const root = mkdtempSync(join(tmpdir(), 'evidence-packed-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const env = { ...npmEnvironment(gitEnvironment(process.env)), HOME: root, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_CEILING_DIRECTORIES: root, PM_AUTHOR: 'packed-fixture' };
  const pack = JSON.parse(execute(repository, 'npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', root], env)) as { filename: string; files: { path: string }[] }[];
  assert.ok(pack[0].files.every(file => /^(dist\/|manifest\.json$|package\.json$|README\.md$|ARCHITECTURE\.md$|docs\/(?:real-data|record-validation)\.md$|LICENSE$|CHANGELOG\.md$)/.test(file.path)));
  const tarball = join(root, pack[0].filename); const consumer = join(root, manager); mkdirSync(consumer);
  const manifest = JSON.parse(readFileSync(join(repository, 'package.json'), 'utf8')) as { devDependencies: Record<string, string> };
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ name: 'evidence-packed-fixture', private: true, type: 'module', dependencies: { 'pm-evidence': `file:${tarball}`, '@unbrained/pm-cli': manifest.devDependencies['@unbrained/pm-cli'] }, scripts: { evidence: 'pm evidence' } }));
  execute(consumer, manager, ['install', '--ignore-scripts'], env);
  const hostEnv = { ...env, PM_PATH: join(consumer, '.agents', 'pm') }; const runner = manager === 'npm' ? 'npx' : 'bunx'; const prefix = manager === 'npm' ? ['--no-install', 'pm'] : ['--bun', '--no-install', 'pm'];
  const pm = (args: string[]) => execute(consumer, runner, [...prefix, ...args], hostEnv);
  pm(['init', '--prefix', 'packed', '--defaults', '--agent-guidance', 'skip']); pm(['package', 'install', tarball]);
  for (const name of ['cite', 'check', 'affected', 'review', 'show', 'bind', 'criteria']) assert.ok(pm(['evidence', '--help']).includes(name));
  pm(['create', 'Decision', '--id', 'packed-decision', '--title', 'Packed evidence decision', '--ac', 'Packed criterion']);
  writeFileSync(join(consumer, 'doc.md'), 'Before\nOriginal claim\nAfter');
  const citation = JSON.parse(pm(['evidence', 'cite', 'packed-decision', 'doc.md', '--lines', '2-2', '--retain', '--json'])) as { citation: string };
  const criterion = (JSON.parse(pm(['evidence', 'criteria', 'packed-decision', '--json'])) as { rows: { criterion: string; revision: string }[] }).rows[0];
  pm(['evidence', 'bind', 'packed-decision', '--citation', citation.citation, '--criterion', criterion.criterion, '--criterion-revision', criterion.revision]);
  assert.match(pm(['evidence', 'criteria', 'packed-decision', '--json']), /current-source/);
  assert.equal((JSON.parse(pm(['evidence', 'check', 'packed-decision', '--json'])) as { rows: { freshness: string }[] }).rows[0].freshness, 'current');
  writeFileSync(join(consumer, 'doc.md'), 'Before\nChanged claim\nAfter');
  const checked = JSON.parse(execute(consumer, manager, ['run', '--silent', 'evidence', '--', 'check', 'packed-decision', '--diff', '--json'], hostEnv)) as { rows: { freshness: string }[] }; assert.equal(checked.rows[0].freshness, 'changed');
  pm(['evidence', 'review', 'packed-decision', '--citation', citation.citation, '--disposition', 'invalid', '--reason', 'Packed fixture changed']);
  assert.ok(pm(['evidence', 'affected', '--changed', 'doc.md', '--json']).includes('packed-decision'));
  assert.ok(pm(['evidence', 'show', 'packed-decision', '--json']).includes('lastCheck'));
  writeFileSync(join(consumer, 'embed.ts'), `import { check, affected, review, cite, replay, fileAdapter } from 'pm-evidence';\nconst result = await check(['packed-decision'], { workspace: process.env.PM_PATH, root: '.', record: false });\nif (result.rows[0].freshness !== 'changed' || [affected,review,cite,replay,fileAdapter.read].some(fn => typeof fn !== 'function')) throw Error('SDK failed');\nconsole.log('SDK accepted');\n`);
  assert.match(execute(consumer, manager === 'npm' ? process.execPath : 'bun', ['embed.ts'], hostEnv), /SDK accepted/);
  const globalRoot = join(root, 'global'); const globalBin = join(globalRoot, 'bin'); mkdirSync(globalRoot); mkdirSync(globalBin);
  const globalEnv = { ...hostEnv, NPM_CONFIG_PREFIX: globalRoot, BUN_INSTALL_GLOBAL_DIR: join(globalRoot, 'install'), BUN_INSTALL_BIN: globalBin };
  const install = manager === 'npm' ? ['install', '--global', '--ignore-scripts'] : ['add', '--global', '--ignore-scripts'];
  execute(consumer, manager, [...install, `@unbrained/pm-cli@${manifest.devDependencies['@unbrained/pm-cli']}`, tarball], globalEnv);
  const globalResult = execute(consumer, join(globalBin, 'pm'), ['evidence', 'criteria', 'packed-decision', '--json'], globalEnv);
  assert.match(globalResult, /lost-source/);
});
