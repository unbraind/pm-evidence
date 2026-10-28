import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bundleTarget, exportBundle, importBundle, setBundleConsent } from '../index.ts';
import { Store } from '../src/store.ts';
import type { EvidenceExchange } from '../src/store.ts';
import type { ItemDocument } from '@unbrained/pm-cli/sdk';
import { bundleFixture, authorization } from './bundle-helpers.ts';
import { atBoundary } from './store-boundaries.ts';

/** Interleave before or after each exchange, without changing or mocking the native SDK. */
async function exchangeBoundary(index: number, phase: 'before' | 'after', competing: () => Promise<void>, run: () => Promise<void>): Promise<void> {
  const original = Store.prototype.exchange; let calls = 0; let injected = false;
  Store.prototype.exchange = async function<T>(id: string, action: (document: ItemDocument, revision: string) => Promise<EvidenceExchange<T>>): Promise<T> {
    const selected = ++calls === index;
    if (selected && phase === 'before') { injected = true; await competing(); }
    const exchange: Store['exchange'] = original.bind(this); const value = await exchange(id, action);
    if (selected && phase === 'after') { injected = true; await competing(); }
    return value;
  };
  try { await run(); assert.ok(injected); } finally { Object.assign(Store.prototype, { exchange: original }); }
}

test('imports revalidate target generations at every preflight, registration, authorization and apply boundary', async t => {
  let tested = 0;
  for (const boundary of ['author:before', 'author:after', 'register:before', 'register:after']) {
    const f = await bundleFixture(t); const auth = await authorization(f);
    await atBoundary(boundary, async () => { await f.client.update(f.target, { description: 'Peer preserved' }); }, async () => {
      await assert.rejects(importBundle(f.bundle, auth, f.options), { code: 'conflict' });
    });
    assert.equal((await f.client.get(f.target, { full: true })).item.evidence_state, undefined); tested++;
  }
  for (const index of [1, 2]) for (const phase of ['before', 'after'] as const) {
    const f = await bundleFixture(t); const auth = await authorization(f);
    await exchangeBoundary(index, phase, async () => { await f.client.update(f.target, { description: 'Peer preserved' }); }, async () => {
      if (index === 2 && phase === 'after') assert.equal((await importBundle(f.bundle, auth, f.options)).status, 'imported');
      else await assert.rejects(importBundle(f.bundle, auth, f.options), { code: 'conflict' });
    });
    const saved = (await f.client.get(f.target, { full: true })).item;
    assert.equal(saved.description, 'Peer preserved'); assert.equal(saved.evidence_state !== undefined, index === 2 && phase === 'after'); tested++;
  }
  t.diagnostic(`interleavings=${tested}; every package await boundary before apply refuses stale authorization; post-commit peer edit preserved`);
});

test('peer imports and foreign replacement are reported from current state rather than frozen preflight plans', async t => {
  for (const phase of ['before', 'after'] as const) {
    const f = await bundleFixture(t); const auth = await authorization(f);
    await exchangeBoundary(1, phase, async () => { await importBundle(f.bundle, auth, { ...f.options, author: 'peer' }); }, async () => {
      await assert.rejects(importBundle(f.bundle, auth, f.options), { code: 'conflict' });
    });
    const current = await authorization(f); assert.equal((await importBundle(f.bundle, current, f.options)).status, 'unchanged');
    assert.equal((await new Store(f.options).get(f.target)).value.citations.length, 2);
  }
  const f = await bundleFixture(t); const source = await bundleTarget(f.item, f.options);
  await exchangeBoundary(1, 'before', async () => { await setBundleConsent({ ...source, citations: [f.citations[0]], consent: 'revoked' }, f.options); }, async () => {
    await assert.rejects(exportBundle({ item: f.item, citations: [f.citations[0]] }, f.options), { code: 'boundary' });
  });
  const latest = await bundleTarget(f.item, f.options);
  await exchangeBoundary(1, 'before', async () => { await setBundleConsent({ ...latest, citations: [f.citations[0]], consent: 'granted' }, f.options); }, async () => {
    await assert.rejects(setBundleConsent({ ...latest, citations: [f.citations[0]], consent: 'revoked' }, f.options), { code: 'conflict' });
  });
});

test('a competing writer cannot enter the target lease during locked bundle reads or no-op retries', async t => {
  const f = await bundleFixture(t); await importBundle(f.bundle, await authorization(f), f.options);
  const store = new Store(f.options); let entered = false;
  let release: () => void = () => {}; const blocked = new Promise<void>(resolve => { release = resolve; });
  let ready: () => void = () => {}; const acquired = new Promise<void>(resolve => { ready = resolve; });
  const first = store.exchange(f.target, async (_document, revision) => { entered = true; ready(); await blocked; return { result: revision }; });
  await acquired; assert.equal(entered, true);
  let peerDone = false; const peer = f.client.update(f.target, { description: 'Peer after release' }).then(() => { peerDone = true; });
  try { await new Promise<void>(resolve => { setImmediate(resolve); }); assert.equal(peerDone, false); }
  finally { release(); }
  await first; await peer; assert.equal((await f.client.get(f.target, { full: true })).item.description, 'Peer after release');
  const current = await authorization(f); assert.equal((await importBundle(f.bundle, current, f.options)).status, 'unchanged');
  t.diagnostic('two writers on one no-git tracker; SDK lease excludes peer until the locked exchange releases');
});
