import assert from 'node:assert/strict';
import { mkdir, symlink, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { mutateItem, readSettings } from '@unbrained/pm-cli/sdk';
import * as sdk from '../dist/index.js';
import { affected, check, cite, EvidenceError } from '../index.ts';
import { digest } from '../src/core.ts';
import { sourceIdentity } from '../src/sources.ts';
import { Store } from '../src/store.ts';
import { tracker } from './helpers.ts';

/** Each lexical class is checked through both authored source and the built SDK. */
const spellings = [
  './docs/sample.txt', '././docs/sample.txt', 'docs/./sample.txt', 'docs//sample.txt',
  'docs/part/../sample.txt', 'docs/sample.txt/', 'docs//./part/../sample.txt///',
];
for (const spelling of spellings) test(`canonical spelling ${spelling} writes and filters legacy citations`, async t => {
  for (const api of [{ cite, affected }, sdk]) {
    const f = await tracker(t); const store = new Store(f.options);
    await mkdir(join(f.root, 'docs')); await writeFile(join(f.root, 'docs/sample.txt'), 'before\nold value\nafter');
    await f.client.create({ id: 'evidence-test-dependent', type: 'Task', title: 'Dependent context', dep: [`id=${f.item},kind=depends_on`] });
    const options = { ...f.options, selector: { kind: 'lines', start: 2, end: 2 } as const };
    const receipt = await api.cite(f.item, spelling, options);
    assert.equal((await store.get(f.item)).value.citations[0].descriptor.source, 'docs/sample.txt');
    assert.equal((await api.cite(f.item, 'docs/sample.txt', options)).citation, receipt.citation);
    await store.mutate(f.item, value => { value.citations[0].descriptor.source = spelling; return { value: true, observation: 'Previously accepted relative spelling' }; });
    await writeFile(join(f.root, 'docs/sample.txt'), 'before\nnew value\nafter');
    const settings = { ...f.options, budget: 10000 };
    const full = await api.affected(settings);
    assert.equal(full.rows.length, 2); assert.ok(full.rows.every(row => row.freshness === 'changed'));
    for (const changed of [['docs/sample.txt'], [spelling], ['docs//part/../sample.txt/']]) {
      const filtered = await api.affected({ ...settings, changed });
      assert.deepEqual(filtered.rows, full.rows);
      assert.equal(filtered.receipt.verification?.sourceReads, 1); assert.equal(filtered.receipt.sourceComplete, true);
      assert.deepEqual(filtered.scope.changed, changed);
    }
  }
});

test('canonical JSON paths share the file identity contract and normalize both filter sides', async t => {
  const f = await tracker(t); await mkdir(join(f.root, 'docs')); await writeFile(join(f.root, 'docs/data.json'), '{"x":1}');
  await cite(f.item, './docs//part/../data.json/', { ...f.options, selector: { kind: 'pointer', pointer: '/x' } });
  const store = new Store(f.options); assert.equal((await store.get(f.item)).value.citations[0].descriptor.source, 'docs/data.json');
  await store.mutate(f.item, value => { value.citations[0].descriptor.source = 'docs/./data.json'; return { value: true, observation: 'Legacy JSON spelling' }; });
  await writeFile(join(f.root, 'docs/data.json'), '{"x":2}');
  const result = await affected({ ...f.options, changed: ['././docs//data.json/'] });
  assert.deepEqual(result.rows.map(row => [row.item, row.freshness]), [[f.item, 'changed']]); assert.equal(result.receipt.sourceComplete, true);
});

test('canonical read keys coalesce legacy spellings across check and affected', async t => {
  const f = await tracker(t); await mkdir(join(f.root, 'docs')); await writeFile(join(f.root, 'docs/sample.txt'), 'first\nsecond');
  for (const line of [1, 2]) await cite(f.item, 'docs/sample.txt', { ...f.options, selector: { kind: 'lines', start: line, end: line } });
  await new Store(f.options).mutate(f.item, value => { value.citations[0].descriptor.source = 'docs//./sample.txt'; value.citations[1].descriptor.source = '././docs/sample.txt/'; return { value: true, observation: 'Legacy shared-source spellings' }; });
  await writeFile(join(f.root, 'docs/sample.txt'), 'changed first\nchanged second');
  for (const result of [await check([], { ...f.options, record: false, budget: 10000 }), await affected({ ...f.options, changed: ['docs/sample.txt'], budget: 10000 })]) {
    assert.equal(result.rows.length, 2); assert.equal(result.receipt.verification?.sourceReads, 1); assert.equal(result.receipt.verification?.sources, 1);
  }
});

test('canonical custom-provider comparisons preserve opaque repeated separators and cache identities', async t => {
  const f = await tracker(t); let changed = false; const calls: string[] = [];
  const adapters = [{ provider: 'opaque', read: async (source: string) => { calls.push(source); const text = `${source}:${changed}`; return { text, revision: digest(text) }; } }];
  for (const source of ['docs//sample.txt', 'docs/sample.txt']) await cite(f.item, source, { ...f.options, provider: 'opaque', adapters, selector: { kind: 'lines', start: 1, end: 1 } });
  assert.deepEqual((await new Store(f.options).get(f.item)).value.citations.map(citation => citation.descriptor.source), ['docs//sample.txt', 'docs/sample.txt']);
  changed = true; calls.length = 0;
  const full = await check([], { ...f.options, adapters, record: false, budget: 10000 });
  assert.equal(full.rows.length, 2); assert.equal(full.receipt.verification?.sourceReads, 2); assert.deepEqual(calls, ['docs//sample.txt', 'docs/sample.txt']);
  calls.length = 0;
  const filtered = await affected({ ...f.options, adapters, changed: ['docs//sample.txt'] });
  assert.equal(filtered.rows.length, 1); assert.equal(filtered.rows[0].citation, full.rows[0].citation); assert.deepEqual(calls, ['docs//sample.txt']);
  await assert.rejects(affected({ ...f.options, adapters, changed: ['docs/part/../sample.txt'] }), { code: 'invalid' });
});

test('canonical operands allow confined parents and refuse unusable inputs before reads or writes', async t => {
  const f = await tracker(t); const before = (await f.client.get(f.item, { full: true })).item;
  assert.equal(sourceIdentity('docs/part/../sample.txt/'), 'docs/sample.txt');
  for (const operand of [undefined, null, 42]) assert.throws(() => sourceIdentity(operand as unknown as string), { code: 'invalid' });
  for (const source of ['', '.', './', 'docs/..', '..', '../escape', 'docs/../../escape', '/absolute', 'C:drive', './C:drive', 'bad\\path', 'bad\u0000path']) {
    assert.throws(() => sourceIdentity(source), error => error instanceof EvidenceError && error.code === 'invalid' && error.remedy.length > 0);
    await assert.rejects(affected({ ...f.options, changed: [source] }), { code: 'invalid' });
    await assert.rejects(cite(f.item, source, { ...f.options, selector: { kind: 'lines', start: 1, end: 1 } }), { code: 'invalid' });
  }
  assert.deepEqual((await f.client.get(f.item, { full: true })).item, before);
});

test('canonical inside-root symlink spellings remain matched and readable', async t => {
  const f = await tracker(t); await mkdir(join(f.root, 'docs')); await writeFile(join(f.root, 'docs/sample.txt'), 'old');
  await symlink('docs', join(f.root, 'alias'), 'dir');
  await cite(f.item, './alias//sample.txt/', { ...f.options, selector: { kind: 'lines', start: 1, end: 1 } });
  assert.equal((await new Store(f.options).get(f.item)).value.citations[0].descriptor.source, 'alias/sample.txt');
  await writeFile(join(f.root, 'docs/sample.txt'), 'new');
  const result = await affected({ ...f.options, changed: ['alias/./sample.txt'] });
  assert.equal(result.rows.length, 1); assert.equal(result.rows[0].freshness, 'changed'); assert.equal(result.receipt.sourceComplete, true);
});

test('canonical outside-root symlink spellings refuse cite and remain explicit in affected', async t => {
  const f = await tracker(t); const outside = await tracker(t);
  await writeFile(join(f.root, 'sample.txt'), 'old'); await writeFile(join(outside.root, 'sample.txt'), 'outside');
  await symlink('.', join(f.root, 'alias'), 'dir');
  await cite(f.item, 'alias/sample.txt', { ...f.options, selector: { kind: 'lines', start: 1, end: 1 } });
  await new Store(f.options).mutate(f.item, value => { value.citations[0].descriptor.source = 'alias//./sample.txt'; return { value: true, observation: 'Legacy symlink source spelling' }; });
  await unlink(join(f.root, 'alias')); await symlink(outside.root, join(f.root, 'alias'), 'dir');
  await assert.rejects(cite(f.item, 'alias/part/../sample.txt/', { ...f.options, selector: { kind: 'lines', start: 1, end: 1 } }), { code: 'boundary' });
  const result = await affected({ ...f.options, changed: ['./alias/sample.txt/'] });
  assert.equal(result.rows.length, 1); assert.equal(result.rows[0].code, 'boundary'); assert.ok(result.rows[0].remedy);
  assert.equal(result.receipt.sourceComplete, false); assert.equal(result.receipt.complete, false);
});

test('canonical source discovery preserves native artifact spellings without duplicate links', async t => {
  const f = await tracker(t); await mkdir(join(f.root, 'docs')); await writeFile(join(f.root, 'docs/sample.txt'), 'claim');
  const files = [
    { path: './docs//sample.txt', scope: 'project' as const, note: 'Native annotation' },
    { path: 'docs/sample.txt', scope: 'global' as const, note: 'Separate root' },
    { path: 'https://example.invalid/doc', scope: 'project' as const },
    { path: '../external.txt', scope: 'project' as const },
  ];
  await mutateItem({ pmRoot: f.workspace, settings: await readSettings(f.workspace), id: f.item, op: 'update', author: 'fixture', mutate: document => { document.metadata.files = files; return { changedFields: ['files'] }; } });
  const before = (await f.client.get(f.item, { full: true })).item.files;
  await cite(f.item, 'docs/part/../sample.txt/', { ...f.options, selector: { kind: 'lines', start: 1, end: 1 } });
  assert.deepEqual((await f.client.get(f.item, { full: true })).item.files, before);
});
