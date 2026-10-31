import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import * as sourceSdk from '../index.ts';
import { artifactInventory, assertArtifactGraph, committedArtifacts } from './distribution-helpers.ts';
import { gitEnvironment, npmEnvironment } from '../scripts/environment.ts';

/** Execute one packed-consumer step with isolated configuration and an asserted exit status. */
function execute(cwd: string, executable: string, args: string[], env: NodeJS.ProcessEnv): string {
  const result = spawnSync(executable, args, { cwd, env, encoding: 'utf8', timeout: 300000 }); assert.equal(result.error, undefined); assert.equal(result.status, 0, result.stdout + result.stderr); return result.stdout;
}
for (const artifact of ['packed', 'git']) for (const manager of ['npm', 'bun']) test(`${artifact} ${manager} and ${manager === 'npm' ? 'npx' : 'bunx'} evidence journey`, t => {
  const repository = resolve(import.meta.dirname, '..'); const root = mkdtempSync(join(tmpdir(), 'evidence-packed-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const env = { ...npmEnvironment(gitEnvironment(process.env)), HOME: root, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_CEILING_DIRECTORIES: root, PM_AUTHOR: 'packed-fixture' };
  const head = execute(repository, 'git', ['rev-parse', 'HEAD'], env).trim();
  const expectedArtifacts = committedArtifacts(repository, head, env);
  const pack = JSON.parse(execute(repository, 'npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', root], env)) as { filename: string; integrity: string; files: { path: string }[] }[];
  assert.ok(pack[0].files.every(file => /^(dist\/|manifest\.json$|package\.json$|README\.md$|ARCHITECTURE\.md$|docs\/(?:real-data|record-validation|portable-bundles)\.md$|LICENSE$|CHANGELOG\.md$)/.test(file.path)));
  const tarball = join(root, pack[0].filename);
  assert.equal(`sha512-${createHash('sha512').update(readFileSync(tarball)).digest('base64')}`, pack[0].integrity);
  let dependency = `file:${tarball}`;
  if (artifact === 'git') {
    const snapshot = join(root, 'snapshot');
    execute(root, 'git', ['clone', '--no-hardlinks', '--no-checkout', repository, snapshot], env);
    execute(snapshot, 'git', ['checkout', '--detach', head], env);
    dependency = `git+${pathToFileURL(snapshot).href}#${head}`;
  }
  const consumer = join(root, manager); mkdirSync(consumer);
  const manifest = JSON.parse(readFileSync(join(repository, 'package.json'), 'utf8')) as { devDependencies: Record<string, string> };
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ name: 'evidence-packed-fixture', private: true, type: 'module', dependencies: { 'pm-evidence': dependency, '@unbrained/pm-cli': manifest.devDependencies['@unbrained/pm-cli'] }, scripts: { evidence: 'pm evidence' } }));
  execute(consumer, manager, ['install', '--ignore-scripts'], env);
  assertArtifactGraph(expectedArtifacts, artifactInventory(join(consumer, 'node_modules', 'pm-evidence')), `${artifact} ${manager} installed graph`);
  if (artifact === 'git') assert.ok(readFileSync(join(consumer, manager === 'npm' ? 'package-lock.json' : 'bun.lock'), 'utf8').includes(head), 'The consumer lock must retain the exact Git revision');
  console.log(JSON.stringify({ artifact, manager, sourceCommit: head, installedFiles: expectedArtifacts.size, tarballIntegrity: pack[0].integrity, lifecycleScripts: false }));
  const hostEnv = { ...env, PM_PATH: join(consumer, '.agents', 'pm') }; const runner = manager === 'npm' ? 'npx' : 'bunx'; const prefix = manager === 'npm' ? ['--no-install', 'pm'] : ['--bun', '--no-install', 'pm'];
  const pm = (args: string[]) => execute(consumer, runner, [...prefix, ...args], hostEnv);
  const exactSource = '{"n":9007199254740993,"__proto__":1e309,"text":"literal\\ntext"}';
  writeFileSync(join(consumer, 'embed.ts'), `import * as sdk from 'pm-evidence';\nimport { check, affected, review, cite, replay, fileAdapter, resolveFragmentText } from 'pm-evidence';\nimport type { Descriptor } from 'pm-evidence';\nfor (const name of ${JSON.stringify(Object.keys(sourceSdk))}) if (!(name in sdk)) throw Error('Missing public export: '+name);\nif (sdk.default.version !== ${JSON.stringify(JSON.parse(readFileSync(join(repository, 'package.json'), 'utf8')).version)}) throw Error('Compiled extension version drift');\nconst workspace = process.env.PM_PATH; if (!workspace) throw Error('Tracker workspace is required');\nconst result = await check(['packed-decision'], { workspace, root: '.', record: false });\nif (result.rows[0].freshness !== 'changed' || [affected,review,cite,replay,fileAdapter.read].some(fn => typeof fn !== 'function')) throw Error('SDK failed');\nconst source = ${JSON.stringify(exactSource)};\nfor (const [pointer, expected] of [['/n','9007199254740993'],['/__proto__','1e309'],['/text',${JSON.stringify('"literal\\ntext"')}],['',source]]) {\nconst descriptor: Descriptor = {provider:'json',source:'data.json',revision:'a'.repeat(64),jsonEncoding:'source-bytes-v1',selector:{kind:'pointer',pointer}};\nif (resolveFragmentText(source,descriptor) !== expected) throw Error('Exact public fragment SDK failed');\n}\nconsole.log('SDK accepted');\n`);
  execute(consumer, process.execPath, [join(repository, 'node_modules', 'typescript', 'bin', 'tsc'), '--noEmit', '--strict', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2024', '--types', 'node', '--typeRoots', join(repository, 'node_modules', '@types'), 'embed.ts'], hostEnv);
  pm(['init', '--prefix', 'packed', '--defaults', '--agent-guidance', 'skip']); pm(['package', 'install', artifact === 'git' ? './node_modules/pm-evidence' : tarball]);
  assert.notEqual(spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: consumer, env: hostEnv }).status, 0);
  for (const name of ['cite', 'check', 'affected', 'review', 'show', 'bind', 'criteria', 'bundle-target', 'bundle-consent', 'bundle-export', 'bundle-import', 'bundle-inspect']) assert.ok(pm(['evidence', '--help']).includes(name));
  pm(['create', 'Decision', '--id', 'packed-decision', '--title', 'Packed evidence decision', '--ac', 'Packed criterion', '--parent', 'none', '--file', 'path=doc.md,scope=project,note=Packed source annotation']);
  writeFileSync(join(consumer, 'doc.md'), 'Before\nOriginal claim\nAfter');
  const citation = JSON.parse(pm(['evidence', 'cite', 'packed-decision', 'doc.md', '--lines', '2-2', '--retain', '--json'])) as { citation: string };
  const sourceTarget = JSON.parse(pm(['evidence', 'bundle-target', 'packed-decision', '--json'])) as { revision: string };
  pm(['evidence', 'bundle-consent', 'packed-decision', '--citation', citation.citation, '--expected-revision', sourceTarget.revision, '--consent', 'granted']);
  pm(['evidence', 'bundle-export', 'packed-decision', '--citation', citation.citation, '--out', 'bundle.json']);
  pm(['create', 'Decision', '--id', 'packed-recipient', '--title', 'Portable recipient', '--parent', 'none', '--file', 'path=doc.md,scope=project,note=Packed recipient annotation']);
  const recipient = JSON.parse(pm(['evidence', 'bundle-target', 'packed-recipient', '--json'])) as { revision: string };
  const bundleArgs = ['bundle.json', '--item', 'packed-recipient', '--expected-revision', recipient.revision, '--authorize'];
  pm(['evidence', 'bundle-inspect', ...bundleArgs]); pm(['evidence', 'bundle-import', ...bundleArgs, '--preview']);
  assert.match(pm(['evidence', 'bundle-import', ...bundleArgs, '--json']), /"added": 1/);
  assert.match(execute(consumer, join(consumer, 'node_modules', '.bin', 'pm'), ['evidence', 'bundle-target', 'packed-recipient', '--json'], hostEnv), /revision/);
  const criterion = (JSON.parse(pm(['evidence', 'criteria', 'packed-decision', '--json'])) as { rows: { criterion: string; revision: string }[] }).rows[0];
  pm(['evidence', 'bind', 'packed-decision', '--citation', citation.citation, '--criterion', criterion.criterion, '--criterion-revision', criterion.revision]);
  assert.match(pm(['evidence', 'criteria', 'packed-decision', '--json']), /current-source/);
  assert.equal((JSON.parse(pm(['evidence', 'check', 'packed-decision', '--json'])) as { rows: { freshness: string }[] }).rows[0].freshness, 'current');
  writeFileSync(join(consumer, 'doc.md'), 'Before\nChanged claim\nAfter');
  const checked = JSON.parse(execute(consumer, manager, ['run', '--silent', 'evidence', '--', 'check', 'packed-decision', '--diff', '--json'], hostEnv)) as { rows: { freshness: string }[] }; assert.equal(checked.rows[0].freshness, 'changed');
  pm(['evidence', 'review', 'packed-decision', '--citation', citation.citation, '--disposition', 'invalid', '--reason', 'Packed fixture changed']);
  assert.ok(pm(['evidence', 'affected', '--changed', 'doc.md', '--json']).includes('packed-decision'));
  assert.ok(pm(['evidence', 'show', 'packed-decision', '--json']).includes('lastCheck'));
  for (const [item, note] of [['packed-decision', 'Packed source annotation'], ['packed-recipient', 'Packed recipient annotation']]) {
    const links = JSON.parse(pm(['files', item, '--list', '--json'])) as { files: { path: string; scope: string; note?: string }[] };
    assert.deepEqual(links.files, [{ path: 'doc.md', scope: 'project', note }]);
  }
  for (const name of ['show', 'check', 'affected', 'criteria', 'bundle-target']) {
    const args = name === 'affected' ? ['--changed', 'doc.md'] : ['packed-decision'];
    assert.ok(pm(['evidence', name, ...args]).trim().length > 0, `${name} renders TOON`);
    assert.equal(typeof JSON.parse(pm(['evidence', name, ...args, '--json'])), 'object', `${name} renders JSON`);
  }
  assert.match(execute(consumer, manager === 'npm' ? process.execPath : 'bun', ['embed.ts'], hostEnv), /SDK accepted/);
  const globalRoot = join(root, 'global'); const globalBin = join(globalRoot, 'bin'); mkdirSync(globalRoot); mkdirSync(globalBin);
  const globalEnv = { ...hostEnv, NPM_CONFIG_PREFIX: globalRoot, BUN_INSTALL_GLOBAL_DIR: join(globalRoot, 'install'), BUN_INSTALL_BIN: globalBin };
  const install = manager === 'npm' ? ['install', '--global', '--ignore-scripts'] : ['add', '--global', '--ignore-scripts'];
  execute(consumer, manager, [...install, `@unbrained/pm-cli@${manifest.devDependencies['@unbrained/pm-cli']}`, artifact === 'git' ? dependency : tarball], globalEnv);
  const globalResult = execute(consumer, join(globalBin, 'pm'), ['evidence', 'criteria', 'packed-decision', '--json'], globalEnv);
  assert.match(globalResult, /lost-source/);
  const globalTarget = JSON.parse(execute(consumer, join(globalBin, 'pm'), ['evidence', 'bundle-target', 'packed-recipient', '--json'], globalEnv)) as { revision: string };
  const globalArgs = ['bundle.json', '--item', 'packed-recipient', '--expected-revision', globalTarget.revision, '--authorize', '--json'];
  assert.match(execute(consumer, join(globalBin, 'pm'), ['evidence', 'bundle-inspect', ...globalArgs], globalEnv), /fragmentDigest/);
  assert.match(execute(consumer, join(globalBin, 'pm'), ['evidence', 'bundle-import', ...globalArgs], globalEnv), /unchanged/);
  const globalPm = (args: string[]) => execute(consumer, join(globalBin, 'pm'), args, globalEnv);
  globalPm(['create', 'Decision', '--id', 'packed-global-recipient', '--title', 'Global portable recipient', '--parent', 'none', '--file', 'path=doc.md,scope=project,note=Global recipient annotation']);
  const authorization = JSON.parse(globalPm(['evidence', 'bundle-target', 'packed-global-recipient', '--json'])) as { revision: string };
  assert.match(globalPm(['evidence', 'bundle-import', 'bundle.json', '--item', 'packed-global-recipient', '--expected-revision', authorization.revision, '--authorize', '--json']), /"added": 1/);
  globalPm(['evidence', 'check', 'packed-decision', '--root', '.', '--json']);
  assert.match(globalPm(['files', 'packed-global-recipient', '--list', '--json']), /Global recipient annotation/);
  assert.match(globalPm(['files', 'packed-decision', '--list', '--json']), /Packed source annotation/);
});
