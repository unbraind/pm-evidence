import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { open, readFile, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import type { CommandHandlerContext } from '@unbrained/pm-cli/sdk/authoring';
import { decodeToon } from '@unbrained/pm-cli/sdk/testing';
import { BUNDLE_MAX_BYTES, bundleTarget } from '../index.ts';
import { runCommand } from '../src/commands.ts';
import { bundleFixture, authorization } from './bundle-helpers.ts';
import { extension, environment } from './helpers.ts';
import { durable } from './tracker-image.ts';

test('native no-git CLI exports compact receipts, validates files, inspects TOON/JSON and imports with explicit authorization', async t => {
  const f = await bundleFixture(t); await extension(f.workspace);
  const cli = (args: string[]) => spawnSync(process.execPath, [join(import.meta.dirname, '../node_modules/.bin/pm'), 'evidence', ...args], { cwd: f.root, encoding: 'utf8', env: environment(f.root, f.workspace) });
  for (const name of ['bundle-target', 'bundle-consent', 'bundle-export', 'bundle-inspect', 'bundle-import']) assert.ok(cli(['--help']).stdout.includes(name));
  const target = cli(['bundle-target', f.target, '--json']); assert.equal(target.status, 0, target.stderr);
  const auth = JSON.parse(target.stdout) as { item: string; revision: string };
  const exported = cli(['bundle-export', f.item, '--citation', f.citations[0], '--citation', f.citations[1], '--out', 'bundle.json', '--json']);
  assert.equal(exported.status, 0, exported.stderr); assert.ok(Buffer.byteLength(exported.stdout) < 1000); assert.ok(!exported.stdout.includes('retained'));
  assert.equal((await stat(join(f.root, 'bundle.json'))).mode & 0o777, 0o600);
  assert.equal(cli(['bundle-export', f.item, '--citation', f.citations[0], '--out', 'bundle.json']).status, 2);
  const common = ['bundle.json', '--item', f.target, '--expected-revision', auth.revision, '--authorize'];
  assert.equal(cli(['bundle-import', 'bundle.json', '--item', f.target, '--expected-revision', auth.revision]).status, 2);
  for (const format of [[], ['--json']]) {
    const inspection = cli(['bundle-inspect', ...common, '--budget', '800', ...format]); assert.equal(inspection.status, 0, inspection.stderr);
    const value = (format.length === 0 ? decodeToon(inspection.stdout) : JSON.parse(inspection.stdout)) as { receipt: { returned: number } };
    assert.equal(value.receipt.returned, 2); assert.ok(Math.ceil(Buffer.byteLength(inspection.stdout) / 4) <= 800);
  }
  const preview = cli(['bundle-import', ...common, '--preview', '--json']); assert.equal(preview.status, 0, preview.stderr); assert.match(preview.stdout, /"preview": true/);
  assert.equal(cli(['bundle-import', ...common, '--json']).status, 0);
  assert.equal(cli(['bundle-import', ...common, '--json']).status, 3);
  const source = await bundleTarget(f.item, f.options);
  const revoked = cli(['bundle-consent', f.item, '--citation', f.citations[0], '--expected-revision', source.revision, '--consent', 'revoked', '--json']); assert.equal(revoked.status, 0, revoked.stderr);
  assert.equal(cli(['bundle-export', f.item, '--citation', f.citations[0], '--out', 'revoked.json']).status, 2);
});

test('command boundary rejects malformed files, flags and extreme values without durable writes', async t => {
  const f = await bundleFixture(t); const auth = await authorization(f); const file = join(f.root, 'bundle.json'); await writeFile(file, JSON.stringify(f.bundle));
  const ctx = { command: 'evidence bundle-import', pm_root: f.workspace, args: [file], options: { item: f.target, expectedRevision: auth.revision, authorize: true }, global: { author: 'fixture' }, sdk: { client: f.client } } as unknown as CommandHandlerContext;
  const before = await durable(f.workspace);
  await runCommand('bundle-inspect', ctx);
  await assert.rejects(runCommand('bundle-target', { ...ctx, args: ['absent'] }), { exitCode: 2 });
  for (const flags of [{ item: '' }, { item: f.target, expectedRevision: '' }, { ...ctx.options, authorize: false }, { ...ctx.options, expectedRevision: ' ' }, { ...ctx.options, budget: 'Infinity' }]) await assert.rejects(runCommand('bundle-inspect', { ...ctx, options: flags }), { exitCode: 2 });
  for (const text of ['{', '\uFEFF{}', '{"entries":[]}', 'null']) { await writeFile(file, text); await assert.rejects(runCommand('bundle-import', ctx), { exitCode: 2 }); }
  await writeFile(file, Buffer.from([0xff])); await assert.rejects(runCommand('bundle-import', ctx), { exitCode: 2 });
  await writeFile(file, 'x'.repeat(BUNDLE_MAX_BYTES + 1)); await assert.rejects(runCommand('bundle-import', ctx), { exitCode: 2 });
  await assert.rejects(runCommand('bundle-import', { ...ctx, args: [f.root] }), { exitCode: 2 });
  await assert.rejects(runCommand('bundle-import', { ...ctx, args: [join(f.root, 'missing.json')] }), { exitCode: 2 });
  await assert.rejects(runCommand('bundle-export', { ...ctx, args: [f.item], options: { out: file } }), { exitCode: 2 });
  const source = await bundleTarget(f.item, f.options);
  await runCommand('bundle-consent', { ...ctx, args: [f.item], options: { citation: f.citations[0], expectedRevision: source.revision, consent: 'granted' } });
  assert.deepEqual(await durable(f.workspace), before);
  await writeFile(file, JSON.stringify(f.bundle));
  const bytes = await readFile(file); assert.ok(bytes.length < BUNDLE_MAX_BYTES);
});

test('complete-input boundary refuses real short reads and file replacement during a descriptor read', async t => {
  const f = await bundleFixture(t); const auth = await authorization(f); const path = join(f.root, 'race.json');
  await writeFile(path, JSON.stringify(f.bundle) + '\n');
  const ctx = { command: 'evidence bundle-import', pm_root: f.workspace, args: [path], options: { item: f.target, expectedRevision: auth.revision, authorize: true }, global: { author: 'fixture' } } as CommandHandlerContext;
  const handle = await open(path); const prototype = Object.getPrototypeOf(handle) as { read: typeof handle.read }; const original = prototype.read; await handle.close();
  const inputIdentity = await stat(path);
  for (const mode of ['short', 'same-size-edit'] as const) {
    let changed = false;
    prototype.read = async function (this: typeof handle, ...args: Parameters<typeof handle.read>) {
      const result = await original.apply(this, args);
      const current = await this.stat();
      if (!changed && current.dev === inputIdentity.dev && current.ino === inputIdentity.ino) {
        changed = true;
        if (mode === 'short') return { ...result, bytesRead: result.bytesRead - 1 };
        await writeFile(path, 'x'.repeat(result.bytesRead));
      }
      return result;
    } as typeof handle.read;
    try { await assert.rejects(runCommand('bundle-import', ctx), { exitCode: 2 }, mode); assert.ok(changed); }
    finally { Object.assign(prototype, { read: original }); await writeFile(path, JSON.stringify(f.bundle) + '\n'); }
  }
  assert.equal((await f.client.get(f.target, { full: true })).item.evidence_state, undefined);
});
