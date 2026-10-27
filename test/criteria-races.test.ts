import assert from 'node:assert/strict';
import { test } from 'node:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { bindCriterion, cite, criterionFacts } from '../index.ts';
import { Store } from '../src/store.ts';
import { digest } from '../src/core.ts';
import { tracker } from './helpers.ts';
import { binding, writeEvidence, criterionTracker } from './criteria-helpers.ts';
import { atBoundary } from './store-boundaries.ts';

/** Every lifecycle await boundary shares one real non-git tracker with the competing writer. */
const boundaries = ['register:before', 'register:after', 'get:before', 'get:after', 'author:before', 'author:after', 'commit:before', 'commit:after'];

test('binding revalidates criterion edits at every store boundary, including recovery and unchanged paths', async t => {
  for (const boundary of boundaries) {
    const f = await criterionTracker(t, 'Current outcome'); const request = f.request;
    await atBoundary(boundary, async () => { await f.client.update(f.item, { acceptanceCriteria: 'Peer outcome' }); }, async () => {
      await assert.rejects(bindCriterion(request, f.options), { code: 'conflict' }, boundary);
    });
    const saved = (await new Store(f.options).get(f.item)).value;
    assert.equal(saved.citations[0].criteria?.length ?? 0, boundary === 'commit:after' ? 1 : 0, boundary);
    assert.equal((await f.client.get(f.item, { full: true })).item.acceptance_criteria, 'Peer outcome');
  }
  t.diagnostic('8/8 store await boundaries injected with criterion edits; no stale successful binding');
});

test('same-binding peer success is reported truthfully and deduplicated at every store boundary', async t => {
  for (const boundary of boundaries) {
    const f = await criterionTracker(t, 'Shared outcome'); const request = f.request;
    await atBoundary(boundary, async () => { await bindCriterion(request, { ...f.options, author: 'peer' }); }, async () => {
      assert.deepEqual(await bindCriterion(request, f.options), request);
    });
    assert.deepEqual((await new Store(f.options).get(f.item)).value.citations[0].criteria, [request.criterion]);
  }
  t.diagnostic('8/8 store await boundaries injected with peer success; exactly one binding retained');
});

test('read-only criterion facts disclose native edits during source reads and foreign peer replacement', async t => {
  const f = await tracker(t); await f.client.update(f.item, { acceptanceCriteria: 'Read outcome' });
  await writeFile(join(f.root, 'doc.md'), 'Read claim');
  const citation = await cite(f.item, 'doc.md', { ...f.options, selector: { kind: 'lines', start: 1, end: 1 } });
  await bindCriterion(await binding(f, citation.citation, 'Read outcome'), f.options);
  const result = await criterionFacts([f.item], { ...f.options, adapters: [{ provider: 'file', read: async () => {
    await f.client.update(f.item, { acceptanceCriteria: 'Edited outcome' });
    return { text: 'Read claim', revision: digest('Read claim') };
  } }] });
  assert.equal(result.rows[0].support, 'unknown'); assert.equal(result.rows[0].code, 'conflict'); assert.equal(result.receipt.complete, false);
  await atBoundary('get:after', async () => { await writeEvidence(f, '{"version":99}'); }, async () => {
    const raced = await criterionFacts([f.item], f.options); assert.ok(raced.rows.every(row => row.support !== 'current-source')); assert.equal(raced.receipt.complete, false);
  });
  await atBoundary('get:after', async () => { await f.client.update(f.item, { acceptanceCriteria: 'New history outcome' }); }, async () => {
    const raced = await criterionFacts([f.item], f.options); assert.equal(raced.rows[0].code, 'conflict'); assert.equal(raced.rows[0].support, 'unknown');
  });
  await atBoundary('get:after', async () => { await writeFile(join(f.workspace, 'history', `${f.item}.jsonl`), 'unparseable synthetic history\n'); }, async () => {
    const raced = await criterionFacts([f.item], f.options); assert.equal(raced.rows[0].code, 'integrity');
  });
});
