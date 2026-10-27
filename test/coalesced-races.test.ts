import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { commitItemMutations } from '@unbrained/pm-cli/sdk';
import type { CommandHandlerContext } from '@unbrained/pm-cli/sdk/authoring';
import { check, cite, review } from '../index.ts';
import { runCommand } from '../src/commands.ts';
import type { CheckRow, Packet, SourceAdapter } from '../index.ts';
import { readFileSnapshot } from '../src/sources.ts';
import { Store } from '../src/store.ts';
import { tracker, citedTracker } from './helpers.ts';

import { atBoundary } from './store-boundaries.ts';

test('every recording step boundary preserves a competing revision on one non-git tracker', async t => {
  for (const boundary of ['register:before', 'register:after', 'get:before', 'get:after', 'author:before', 'author:after', 'commit:before', 'commit:after']) {
    const f = await citedTracker(t); const citation = f.citation;
    await atBoundary(boundary, async () => { await review(f.item, { ...f.options, citation: citation.citation, disposition: 'still-valid', reason: `Peer at ${boundary}` }); }, async () => {
      const result = await check([f.item], { ...f.options, budget: 3000 });
      const recorded = boundary === 'commit:after';
      assert.equal(result.receipt.verification?.recordedItems, recorded ? 1 : 0, boundary);
      assert.equal(result.receipt.verification?.skippedItems, recorded ? 0 : 1, boundary);
      assert.equal(result.receipt.complete, recorded, boundary);
    });
    const saved = (await new Store(f.options).get(f.item)).value;
    assert.equal(saved.citations[0].reviews.length, 1, boundary); assert.equal(saved.citations[0].reviews[0].reason, `Peer at ${boundary}`);
    assert.equal(saved.citations[0].lastCheck !== undefined, boundary === 'commit:after');
  }
  t.diagnostic('8/8 await boundaries injected; peer results preserved; no SDK mocks or git');
});

test('cancellation before mutation or between targets skips dependent recording work', async t => {
  for (const boundary of ['register:after', 'get:after', 'commit:after']) {
    const f = await tracker(t); await writeFile(join(f.root, 'doc.md'), 'Claim');
    await f.client.create({ id: 'evidence-test-second', type: 'Decision', title: 'Second cancellation target' });
    for (const item of [f.item, 'evidence-test-second']) await cite(item, 'doc.md', { ...f.options, selector: { kind: 'lines', start: 1, end: 1 } });
    const controller = new AbortController();
    await atBoundary(boundary, async () => controller.abort(), async () => {
      const result = await check([f.item, 'evidence-test-second'], { ...f.options, signal: controller.signal, budget: 3000 });
      assert.equal(result.receipt.verification?.canceled, true); assert.equal(result.receipt.complete, false);
      assert.equal(result.receipt.verification?.recordedItems, boundary === 'commit:after' ? 1 : 0); assert.equal(result.receipt.verification?.skippedItems, boundary === 'commit:after' ? 1 : 2);
    });
  }
});

test('foreign replacement during recording skips safely while real SDK integrity failures still refuse', async t => {
  for (const foreign of [true, false]) {
    const f = await citedTracker(t);
    await atBoundary('register:after', async () => {
      if (foreign) await commitItemMutations({ pmRoot: f.workspace, transactionId: 'peer-foreign', author: 'peer', mutations: [{ op: 'update', id: f.item, options: { evidenceState: '{"version":99,"revision":2,"citations":[]}' } }] });
      else {
        const path = join(f.workspace, 'history', `${f.item}.jsonl`); const entries = (await readFile(path, 'utf8')).trimEnd().split('\n');
        const first = JSON.parse(entries[0]) as Record<string, unknown>; first.record_hash = '0'.repeat(64); entries[0] = JSON.stringify(first); await writeFile(path, entries.join('\n') + '\n');
      }
    }, async () => {
      if (foreign) { const result = await check([f.item], f.options); assert.equal(result.receipt.verification?.foreignItems, 1); assert.equal(result.receipt.verification?.skippedItems, 1); assert.equal(result.receipt.complete, false); }
      else await assert.rejects(check([f.item], f.options), { code: 'integrity' });
    });
  }
});

test('CLI cancellation handler returns an incomplete receipt and releases its process listeners', async t => {
  const f = await citedTracker(t);
  const before = process.listeners('SIGINT').length;
  await atBoundary('register:after', async () => { const cancel = process.listeners('SIGINT').at(-1)!; cancel('SIGINT'); }, async () => {
    const ctx = { command: 'evidence check', pm_root: f.workspace, args: [f.item], options: { root: f.root }, global: { author: 'fixture' } } as CommandHandlerContext;
    const result = await runCommand('check', ctx) as Packet<CheckRow>;
    assert.equal(result.receipt.verification?.canceled, true); assert.equal(result.receipt.complete, false);
  });
  assert.equal(process.listeners('SIGINT').length, before);
});

test('replayed envelopes with the same numeric revision cannot receive stale observations after a CAS retry', async t => {
  const f = await citedTracker(t);
  const store = new Store(f.options); const original = await store.get(f.item);
  await atBoundary('get:after', async () => {
    const current = await store.get(f.item); current.value.citations[0].provenance.author = 'peer';
    // A replayed import may preserve the package revision counter; the full raw envelope still changes.
    await store.commit(f.item, current.raw, current.value, 'Synthetic same-revision envelope replay', current.item.updated_at);
  }, async () => {
    const result = await check([f.item], f.options); assert.equal(result.receipt.verification?.recordedItems, 0); assert.equal(result.receipt.verification?.skippedItems, 1); assert.equal(result.receipt.complete, false);
  });
  const current = await store.get(f.item); assert.equal(current.value.revision, original.value.revision); assert.equal(current.value.citations[0].provenance.author, 'peer'); assert.equal(current.value.citations[0].lastCheck, undefined);
});

test('idempotency keys bind identical evidence payloads to the current native target revision', async t => {
  const f = await citedTracker(t); const store = new Store(f.options); const original = await store.get(f.item);
  const target = structuredClone(original.value); target.revision++;
  await store.commit(f.item, original.raw, target, 'Revision-bound retry', original.item.updated_at);
  await commitItemMutations({ pmRoot: f.workspace, transactionId: 'fixture-replayed-input', author: 'peer', mutations: [{ op: 'update', id: f.item, options: { evidenceState: original.raw } }] });
  const replayed = await store.get(f.item); assert.equal(replayed.raw, original.raw); assert.notEqual(replayed.item.updated_at, original.item.updated_at);
  await store.commit(f.item, replayed.raw, target, 'Revision-bound retry', replayed.item.updated_at);
  assert.deepEqual((await store.get(f.item)).value, target);
});

test('target envelope is captured before source awaits even if an SDK result view refreshes in place', async t => {
  const f = await citedTracker(t); const store = new Store(f.options); const originalAll = Store.prototype.all;
  let selected: Awaited<ReturnType<Store['all']>> = [];
  Store.prototype.all = async function () { selected = await originalAll.call(this); return selected; };
  const adapter: SourceAdapter = { provider: 'file', read: async (source, context) => {
    const current = await store.get(f.item); current.value.citations[0].provenance.author = 'peer';
    await store.commit(f.item, current.raw, current.value, 'Synthetic result-view refresh', current.item.updated_at);
    Object.assign(selected.find(item => item.id === f.item)!, { evidence_state: (await store.get(f.item)).raw });
    return readFileSnapshot(source, context);
  } };
  try {
    const result = await check([], { ...f.options, adapters: [adapter] });
    assert.equal(result.receipt.verification?.recordedItems, 0); assert.equal(result.receipt.verification?.skippedItems, 1); assert.equal(result.receipt.complete, false);
    assert.equal((await store.get(f.item)).value.citations[0].lastCheck, undefined);
  } finally { Object.assign(Store.prototype, { all: originalAll }); }
});
