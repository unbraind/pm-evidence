import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { activateExtensionForTest, decodeToon } from '@unbrained/pm-cli/sdk/testing';
import type { CommandHandlerContext } from '@unbrained/pm-cli/sdk/authoring';
import evidence, { cite } from '../index.ts';
import { runCommand, selector } from '../src/commands.ts';
import { tracker, extension, environment } from './helpers.ts';

/** Invoke a genuine native host in a tracker with no git executable or ancestor discovery. */
function cli(root: string, workspace: string, args: string[]) { return spawnSync(process.execPath, [join(import.meta.dirname, '../node_modules/.bin/pm'), 'evidence', ...args], { cwd: root, encoding: 'utf8', env: environment(root, workspace) }); }

test('gitless native host supports five commands, TOON/JSON budgets and inert refusals', async t => {
  const f = await tracker(t); await extension(f.workspace); await writeFile(join(f.root, 'doc.md'), 'Before\nCited bytes\nAfter\n');
  const activation = await activateExtensionForTest(evidence, { capabilities: ['commands', 'schema'] }); assert.equal(activation.failed.length, 0);
  const help = cli(f.root, f.workspace, ['--help']); assert.equal(help.status, 0, help.stderr);
  for (const command of ['cite', 'check', 'affected', 'review', 'show']) assert.ok(help.stdout.includes(command));
  const citation = cli(f.root, f.workspace, ['cite', f.item, 'doc.md', '--lines', '2-2', '--root', '.', '--retain', '--json']); assert.equal(citation.status, 0, citation.stderr);
  const id = (JSON.parse(citation.stdout) as { citation: string }).citation;
  for (const format of [[], ['--json']]) {
    const result = cli(f.root, f.workspace, ['check', f.item, '--budget', '800', '--diff', ...format]); assert.equal(result.status, 0, result.stderr);
    const value = (format.length === 0 ? decodeToon(result.stdout) : JSON.parse(result.stdout)) as { rows: { freshness: string }[] };
    assert.equal(value.rows[0].freshness, 'current'); assert.ok(Math.ceil(Buffer.byteLength(result.stdout) / 4) <= 800);
  }
  const all = cli(f.root, f.workspace, ['check', '--json']); assert.equal(all.status, 0, all.stderr);
  const show = cli(f.root, f.workspace, ['show', f.item, '--json']); assert.equal(show.status, 0, show.stderr); assert.ok(show.stdout.includes('lastCheck'));
  const review = cli(f.root, f.workspace, ['review', f.item, '--citation', id, '--disposition', 'still-valid', '--reason', 'Reviewed bytes', '--json']); assert.equal(review.status, 0, review.stderr);
  const impact = cli(f.root, f.workspace, ['affected', '--changed', 'doc.md', '--changed', 'other.md', '--depth', '2', '--budget', '800', '--json']); assert.equal(impact.status, 0, impact.stderr);
  const refusal = cli(f.root, f.workspace, ['cite', f.item, '../outside', '--lines', '1-1']); assert.equal(refusal.status, 2); assert.ok(!refusal.stderr.includes(f.root)); assert.match(refusal.stderr, /Remedy:/);
});

test('in-process command dispatch covers selectors, defaults and typed unexpected errors', async t => {
  const f = await tracker(t); await writeFile(join(f.root, 'doc.md'), '# Policy\n\nCited paragraph.\n'); await writeFile(join(f.root, 'doc.json'), '{"a":1}');
  const ctx = { command: 'evidence cite', pm_root: f.workspace, args: [f.item, 'doc.md'], options: { root: f.root, heading: 'Policy' }, global: { author: 'fixture' } } as CommandHandlerContext;
  await runCommand('cite', ctx); await runCommand('cite', { ...ctx, args: [f.item, 'doc.json'], options: { root: f.root, pointer: '/a' } });
  await runCommand('check', { ...ctx, args: [f.item], options: { root: f.root } });
  await runCommand('affected', { ...ctx, args: [], options: { root: f.root, changed: 'doc.md' } });
  await runCommand('affected', { ...ctx, args: [], options: { root: f.root } });
  await assert.rejects(runCommand('unknown', ctx), { exitCode: 2 });
  await assert.rejects(runCommand('cite', { ...ctx, args: [], options: {} }), { exitCode: 2 });
  await assert.rejects(runCommand('show', { ...ctx, args: ['absent'] }), { exitCode: 2 });
  assert.throws(() => selector({})); assert.throws(() => selector({ lines: 'x-y' })); assert.throws(() => selector({ lines: '1-2', pointer: '/x' }));
  const receipt = await cite(f.item, 'doc.json', { ...f.options, selector: { kind: 'pointer', pointer: '' } });
  const original = process.cwd();
  await runCommand('review', { ...ctx, options: { root: f.root, citation: receipt.citation, disposition: 'invalid', reason: 'Superseded fixture' } });
  await assert.rejects(runCommand('review', { ...ctx, options: { root: f.root, citation: receipt.citation, disposition: 'invalid', reason: 'Stale review', expectedRevision: 0 } }), { exitCode: 3 });
  await runCommand('review', { ...ctx, options: { root: f.root, citation: receipt.citation, disposition: 're-anchored', reason: 'Explicit pointer replacement', pointer: '' } });
  assert.equal(process.cwd(), original);
});
