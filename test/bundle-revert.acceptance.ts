/** Function-only behavioral negative controls run solely in a disposable source copy. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = await mkdtemp(join(tmpdir(), 'bundle-revert-')); const repository = resolve(import.meta.dirname, '..');
try {
  for (const path of ['src', 'test', 'index.ts', 'package.json']) await cp(join(repository, path), join(root, path), { recursive: true });
  await symlink(join(repository, 'node_modules'), join(root, 'node_modules'), 'dir');
  const file = join(root, 'src', 'bundles.ts'); const original = await readFile(file, 'utf8');
  const commandsFile = join(root, 'src', 'bundle-commands.ts'); const commands = await readFile(commandsFile, 'utf8');
  const cases = [
    { name: 'complete checksum', pattern: '^tampered complete bundle', changed: original.replace(/  if \(digest\(JSON.stringify\(payload\)\) !== hash\)[^\n]+\n/, '') },
    { name: 'explicit selection', pattern: '^selected bundle validates', changed: original.replace('!request.citations.includes(identity.data)', 'false').replace('selected.size !== request.citations.length', 'selected.size < request.citations.length').replace('entries: request.citations.map(id => selected.get(id))', 'entries: [...selected.values()]') },
    { name: 'target generation fence', pattern: '^consent revocation blocks', changed: original.replace('if (expected !== actual)', 'if (false)') },
    { name: 'live sharing permission', pattern: '^consent revocation blocks', changed: original.replace("if (citation.exportConsent !== 'granted')", 'if (false)') },
    { name: 'retained replay bytes', pattern: '^selected bundle validates', changed: original.replace('...entry, id, provenance:', '...entry, retained: undefined, id, provenance:') },
    { name: 'complete CLI input snapshot', pattern: '^complete-input boundary', changed: commands.replace(/      requireInput\(bytesRead === stat.size[^\n]+\n/, '').replace(/      requireInput\(JSON.stringify\(\[after.dev[^\n]+\n/, ''), command: true },
  ];
  for (const control of cases) {
    await writeFile(file, original); await writeFile(commandsFile, commands);
    assert.notEqual(control.changed, control.command === true ? commands : original); await writeFile(control.command === true ? commandsFile : file, control.changed);
    const run = spawnSync(process.execPath, ['--test', '--test-concurrency=1', '--test-reporter=tap', '--test-name-pattern', control.pattern, control.command === true ? 'test/bundle-commands.test.ts' : 'test/bundles.test.ts'], { cwd: root, encoding: 'utf8', timeout: 120000, env: { PATH: process.env.PATH, GIT_CEILING_DIRECTORIES: tmpdir() } });
    assert.equal(run.error, undefined); assert.equal(run.status, 1, run.stdout + run.stderr); assert.match(run.stdout, /# fail 1/);
    console.log(JSON.stringify({ functionOnlyRevert: control.name, negativeControl: 'fail 1', disposableCopy: true }));
  }
  await writeFile(file, original); await writeFile(commandsFile, commands);
  const restored = spawnSync(process.execPath, ['--test', '--test-concurrency=1', 'test/bundles.test.ts'], { cwd: root, encoding: 'utf8', timeout: 120000, env: { PATH: process.env.PATH, GIT_CEILING_DIRECTORIES: tmpdir() } });
  assert.equal(restored.error, undefined); assert.equal(restored.status, 0, restored.stdout + restored.stderr);
  console.log('Restored implementation: 5/5 bundle tests passing; original checkout never mutated.');
} finally { await rm(root, { recursive: true, force: true }); }
