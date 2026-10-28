import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { artifactKey, mutateItem, readSettings } from '@unbrained/pm-cli/sdk';
import { decodeToon } from '@unbrained/pm-cli/sdk/testing';
import type { LinkedArtifact } from '@unbrained/pm-cli/sdk';
import { bindCriterion, bundleTarget, check, cite, exportBundle, importBundle, inspectBundle, review, setBundleConsent } from '../index.ts';
import { bundleFixture, authorization, seedNativeFiles } from './bundle-helpers.ts';
import { binding } from './criteria-helpers.ts';
import { environment, extension } from './helpers.ts';
import { atBoundary } from './store-boundaries.ts';

/** Native SDK read-back is the annotation oracle, including missing notes and independent scopes. */
function preserves<T extends Pick<LinkedArtifact, 'path' | 'scope'>>(owned: readonly T[], current: readonly T[]): void {
  const actual = new Map(current.map(file => [artifactKey(file), file]));
  for (const file of owned) assert.deepEqual(actual.get(artifactKey(file)), file, `Native annotation changed for ${artifactKey(file)}`);
  assert.equal(actual.size, current.length, 'Source discovery must not duplicate an SDK artifact identity');
}

test('additive artifact ownership survives every evidence writer and native note domain', async t => {
  for (const note of ['Native selected annotation', '', '  Unicode λ and whitespace  ']) {
    const f = await bundleFixture(t);
    for (const item of [f.item, f.target]) await seedNativeFiles(f.client, item, note);
    await f.client.update(f.item, { acceptanceCriteria: 'Native criterion', unset: ['parent', 'assignee', 'sprint', 'release'] });
    const owned = new Map(await Promise.all([f.item, f.target].map(async item => [item, (await f.client.get(item, { full: true })).item.files ?? []] as const)));
    const operations: [string, () => Promise<unknown>][] = [
      ['cite', () => cite(f.item, 'selected.md', { ...f.options, retain: true, selector: { kind: 'lines', start: 1, end: 1 } })],
      ['check', () => check([f.item], { ...f.options, budget: 10000 })],
      ['review', () => review(f.item, { ...f.options, citation: f.citations[0], disposition: 'still-valid', reason: 'Preserve native annotations' })],
      ['criterion binding', async () => bindCriterion(await binding(f, f.citations[0], 'Native criterion'), f.options)],
      ['consent', async () => setBundleConsent({ ...await bundleTarget(f.item, f.options), citations: [f.citations[0]], consent: 'revoked' }, f.options)],
      ['inspect', async () => inspectBundle(f.bundle, await authorization(f), f.options)],
      ['preview', async () => importBundle(f.bundle, await authorization(f), { ...f.options, preview: true })],
      ['import', async () => importBundle(f.bundle, await authorization(f), f.options)],
      ['unchanged import', async () => importBundle(f.bundle, await authorization(f), f.options)],
      ['re-anchor', async () => { await writeFile(join(f.root, 'selected.md'), 'Revised retained fragment'); return review(f.item, { ...f.options, citation: f.citations[0], disposition: 're-anchored', selector: { kind: 'lines', start: 1, end: 1 }, reason: 'Explicitly revised source' }); }],
    ];
    for (const [name, operation] of operations) {
      await operation();
      for (const [item, files] of owned) preserves(files, (await f.client.get(item, { full: true })).item.files ?? []);
      t.diagnostic(`${name}: native annotation domain ${JSON.stringify(note)} preserved`);
    }
    const recipient = (await f.client.get(f.target, { full: true })).item;
    assert.deepEqual(recipient.files, owned.get(f.target), 'Imports with no absent file identities preserve the native array order too');
    assert.ok(!recipient.files?.some(file => file.path === 'unselected.md'), 'Bundle import must still exclude unselected sources');
    assert.ok((await f.client.get(f.item, { full: true })).item.files?.some(file => file.path === 'unselected.md'), 'Missing selected source identities must still be linked');
  }
});

test('competing native annotation edits survive each CAS write boundary on a non-git tracker', async t => {
  for (const boundary of ['register:before', 'register:after', 'get:before', 'get:after', 'author:before', 'author:after', 'commit:before', 'commit:after']) {
    const f = await bundleFixture(t); let peer: LinkedArtifact[] = [];
    await atBoundary(boundary, async () => {
      await f.client.update(f.item, { file: ['path=selected.md,scope=project,note=Peer owns this annotation'], unset: ['parent', 'assignee', 'sprint', 'release'] });
      peer = (await f.client.get(f.item, { full: true })).item.files ?? [];
    }, async () => { await review(f.item, { ...f.options, citation: f.citations[0], disposition: 'still-valid', reason: 'Concurrent native annotation' }); });
    preserves(peer, (await f.client.get(f.item, { full: true })).item.files ?? []);
  }
});

test('foreign duplicate native links remain byte-equivalent when new citation identities are added', async t => {
  const f = await bundleFixture(t); const native: LinkedArtifact[] = [
    { path: 'selected.md', scope: 'project', note: 'First native annotation' },
    { path: 'selected.md', scope: 'project', note: 'Second native annotation' },
  ];
  for (const id of [f.item, f.target]) {
    await mutateItem({ pmRoot: f.workspace, settings: await readSettings(f.workspace), id, op: 'update', author: 'fixture', mutate: document => { document.metadata.files = structuredClone(native); return { changedFields: ['files'] }; } });
    assert.deepEqual((await f.client.get(id, { full: true })).item.files, native, 'The native SDK accepts this persisted legacy collection');
  }
  await check([f.item], { ...f.options, budget: 10000 });
  await importBundle(f.bundle, await authorization(f), f.options);
  for (const id of [f.item, f.target]) {
    const actual = (await f.client.get(id, { full: true })).item.files ?? [];
    assert.deepEqual(actual.slice(0, native.length), native, 'Existing native rows must never be normalized or discarded');
    assert.ok(actual.some(file => file.path === 'data.json' && file.scope === 'project'));
  }
});

test('no-git CLI and native JSON/TOON output preserve annotations during import and ordinary writes', async t => {
  const f = await bundleFixture(t); await extension(f.workspace);
  for (const item of [f.item, f.target]) await seedNativeFiles(f.client, item, 'CLI native selected note');
  const baseline = (await f.client.get(f.target, { full: true })).item.files ?? [];
  const source = (await f.client.get(f.item, { full: true })).item.files ?? [];
  await writeFile(join(f.root, 'bundle.json'), JSON.stringify(await exportBundle({ item: f.item, citations: f.citations.slice(0, 2) }, f.options)));
  const cli = (args: string[]) => {
    const run = spawnSync(process.execPath, [join(import.meta.dirname, '../node_modules/.bin/pm'), ...args], { cwd: f.root, encoding: 'utf8', env: environment(f.root, f.workspace) });
    assert.equal(run.status, 0, run.stderr); return run.stdout;
  };
  /** Compare each presentation against the host's own rendered baseline, without hand normalization. */
  const renderedFiles = (item: string, format: string[]) => {
    const output = cli(['files', item, '--list', ...format]);
    return ((format.length === 0 ? decodeToon(output) : JSON.parse(output)) as { files: (Pick<LinkedArtifact, 'path' | 'scope'> & { note?: string | null })[] }).files;
  };
  for (const format of [[], ['--json']]) {
    const renderedBefore = new Map([f.item, f.target].map(item => [item, renderedFiles(item, format)]));
    const auth = await authorization(f);
    cli(['evidence', 'bundle-import', 'bundle.json', '--item', f.target, '--expected-revision', auth.revision, '--authorize', ...format]);
    cli(['evidence', 'check', f.item, '--root', '.', ...format]);
    for (const [item, files] of [[f.item, source], [f.target, baseline]] as const) {
      preserves(renderedBefore.get(item)!, renderedFiles(item, format)); preserves(files, (await f.client.get(item, { full: true })).item.files ?? []);
    }
  }
});
