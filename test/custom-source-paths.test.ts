import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import * as sdk from '../dist/index.js';
import { affected, check, cite } from '../index.ts';
import { digest } from '../src/core.ts';
import { sourceIdentity } from '../src/sources.ts';
import { Store } from '../src/store.ts';
import { tracker } from './helpers.ts';

/** Exercise opaque source reads on one genuine gitless tracker with a controlled revision change. */
async function customTracker(t: TestContext) {
  const fixture = await tracker(t); let version = 'old'; const calls: string[] = [];
  const adapters = [{ provider: 'opaque', read: async (source: string) => {
    calls.push(source); const text = [source, version].join(':');
    return { revision: digest(text), text };
  } }];
  return { ...fixture, calls, change: () => { version = 'new'; }, options: { ...fixture.options, adapters, budget: 10000 } };
}

test('custom source identity is idempotent without collapsing opaque suffixes', () => {
  for (const suffix of ['sample.txt', 'docs//sample.txt', 'docs/./sample.txt', 'docs/sample.txt/', '.', '']) {
    for (let count = 1; count <= 20; count++) {
      const source = './'.repeat(count) + suffix;
      const identity = sourceIdentity(source, 'opaque');
      assert.equal(identity, suffix || '.');
      assert.equal(sourceIdentity(identity, 'opaque'), identity);
    }
  }
});

test('custom provider repeated-dot reproduction finds changed evidence through source and built SDKs', async t => {
  for (const api of [{ cite, check, affected }, sdk]) {
    const f = await customTracker(t); const { options, calls } = f;
    const cited = await api.cite(f.item, '././sample.txt', { ...options, provider: 'opaque', selector: { kind: 'lines', start: 1, end: 1 } });
    f.change();
    const full = await api.check([], { ...options, record: false });
    assert.equal(full.rows.length, 1); assert.equal(full.rows[0].freshness, 'changed');
    const filtered = await api.affected({ ...options, changed: ['././sample.txt'] });
    assert.deepEqual(filtered.rows.map(row => [row.item, row.citation, row.freshness]), [[f.item, cited.citation, 'changed']]);
    assert.equal(filtered.receipt.complete, true); assert.equal(filtered.receipt.sourceComplete, true);
    assert.equal(filtered.receipt.verification?.sourceReads, 1);
    assert.deepEqual(calls, ['sample.txt', 'sample.txt', 'sample.txt']);
  }
});

test('custom legacy descriptors share canonical reads and retain distinct opaque identities', async t => {
  for (const api of [{ cite, check, affected }, sdk]) {
    const f = await customTracker(t); const { options, calls } = f;
    await f.client.create({ id: 'evidence-test-dependent', type: 'Task', title: 'Dependent context', dep: [`id=${f.item},kind=depends_on`] });
    for (const item of [f.item, 'evidence-test-dependent']) await api.cite(item, 'sample.txt', { ...options, provider: 'opaque', selector: { kind: 'lines', start: 1, end: 1 } });
    const store = new Store(f.options);
    await store.mutate(f.item, value => { value.citations[0].descriptor.source = './sample.txt'; return { value: true, observation: 'Released repeated-dot descriptor' }; });
    for (const source of ['docs//sample.txt', 'docs/./sample.txt', 'docs/sample.txt/']) await api.cite(f.item, '././' + source, { ...options, provider: 'opaque', selector: { kind: 'lines', start: 1, end: 1 } });
    f.change(); calls.length = 0;
    const full = await api.check([], { ...options, record: false });
    assert.equal(full.rows.length, 5); assert.ok(full.rows.every(row => row.freshness === 'changed'));
    assert.equal(full.receipt.verification?.sourceReads, 4);
    const before = (await store.get(f.item)).value;
    for (const operand of ['sample.txt', './sample.txt', '././sample.txt', './././sample.txt']) {
      calls.length = 0;
      const filtered = await api.affected({ ...options, changed: [operand] });
      assert.equal(filtered.rows.length, 3); assert.ok(filtered.rows.every(row => row.freshness === 'changed'));
      assert.equal(filtered.receipt.verification?.sourceReads, 1); assert.equal(filtered.receipt.complete, true);
      assert.deepEqual(calls, ['sample.txt']);
    }
    for (const source of ['docs//sample.txt', 'docs/./sample.txt', 'docs/sample.txt/']) {
      calls.length = 0;
      const filtered = await api.affected({ ...options, changed: ['././' + source] });
      assert.equal(filtered.rows.length, 2); assert.deepEqual(calls, [source]);
    }
    assert.deepEqual((await store.get(f.item)).value, before);
  }
});
