import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { decodeToon } from '@unbrained/pm-cli/sdk/testing';
import { bindCriterion, check, cite, criterionFacts, review } from '../index.ts';
import { Store } from '../src/store.ts';
import { digest } from '../src/core.ts';
import { criterionTracker } from './criteria-helpers.ts';
import { environment, extension, tracker } from './helpers.ts';
import { atBoundary } from './store-boundaries.ts';
import type { Packet, CheckRow, CriterionFact } from '../index.ts';

/** Colliding wall-clock values are deliberately real native SDK writes, never edited item files. */
const clock = new Date('2032-03-04T05:06:07.000Z');
/** Every public writer shares the same state-safety law at every package store boundary. */
const producers = ['cite', 'retain', 'review', 're-anchor', 'bind', 'check'] as const;
/** Both sides of every package store await are tested on one shared non-git tracker. */
const boundaries = ['register:before', 'register:after', 'get:before', 'get:after', 'author:before', 'author:after', 'commit:before', 'commit:after'];

test('fixed-clock state safety: every writer preserves peer evidence at every store boundary', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: clock });
  for (const producer of producers) for (const boundary of boundaries) {
    const f = await criterionTracker(t); const before = (await f.client.get(f.item, { full: true })).item;
    await writeFile(join(f.root, 'extra.json'), '{"value":1}');
    if (producer === 're-anchor') await writeFile(join(f.root, 'doc.md'), 'Replacement claim');
    await atBoundary(boundary, async () => {
      await review(f.item, { ...f.options, author: 'peer', citation: f.citation.citation, disposition: 'still-valid', reason: 'Persisted peer review' });
      assert.equal((await f.client.get(f.item, { full: true })).item.updated_at, before.updated_at, 'Native timestamp must collide');
    }, async () => {
      if (producer === 'cite') await cite(f.item, 'extra.json', { ...f.options, selector: { kind: 'pointer', pointer: '' } });
      else if (producer === 'retain') await cite(f.item, 'doc.md', { ...f.options, retain: true, selector: { kind: 'lines', start: 1, end: 1 } });
      else if (producer === 'review' || producer === 're-anchor') await review(f.item, { ...f.options, citation: f.citation.citation, disposition: producer === 'review' ? 'invalid' : 're-anchored', reason: 'Own review', selector: { kind: 'lines', start: 1, end: 1 } });
      else if (producer === 'bind') await bindCriterion(f.request, f.options);
      else await check([f.item], { ...f.options, budget: 30000 });
    });
    const native = (await f.client.get(f.item, { full: true })).item;
    const state = (await new Store(f.options).get(f.item)).value;
    assert.equal(state.citations.find(entry => entry.id === f.citation.citation)!.reviews.filter(entry => entry.author === 'peer').length, 1, `${producer}/${boundary}`);
    assert.equal(native.comments?.filter(entry => entry.text.includes('evidence review')).length, producer === 'review' || producer === 're-anchor' ? 2 : 1);
    assert.equal(native.parent, before.parent); assert.equal(native.body, before.body); assert.equal(native.status, before.status);
  }
  t.diagnostic('6 writers x 8 boundaries = 48 native fixed-clock interleavings; every peer review preserved');
});

test('fixed-clock first writes merge a persisted peer citation without relying on an existing envelope', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: clock });
  const f = await tracker(t); await writeFile(join(f.root, 'doc.md'), 'First claim'); await writeFile(join(f.root, 'peer.md'), 'Peer claim');
  const before = (await f.client.get(f.item, { full: true })).item;
  await atBoundary('commit:before', async () => { await cite(f.item, 'peer.md', { ...f.options, selector: { kind: 'lines', start: 1, end: 1 } }); }, async () => {
    await cite(f.item, 'doc.md', { ...f.options, selector: { kind: 'lines', start: 1, end: 1 } });
  });
  assert.equal((await f.client.get(f.item, { full: true })).item.updated_at, before.updated_at);
  assert.deepEqual((await new Store(f.options).get(f.item)).value.citations.map(entry => entry.descriptor.source).sort(), ['doc.md', 'peer.md']);
});

test('fixed-clock criterion edits and ABA revisions refuse old bindings and invalidate read-only facts', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: clock });
  for (const aba of [false, true]) {
    const f = await criterionTracker(t); const before = (await f.client.get(f.item, { full: true })).item;
    await atBoundary('commit:before', async () => {
      await f.client.update(f.item, { acceptanceCriteria: 'Peer criterion' });
      if (aba) await f.client.update(f.item, { acceptanceCriteria: 'Outcome' });
    }, async () => { await assert.rejects(bindCriterion(f.request, f.options), { code: 'conflict' }); });
    assert.equal((await f.client.get(f.item, { full: true })).item.updated_at, before.updated_at);
    assert.equal((await new Store(f.options).get(f.item)).value.citations[0].criteria, undefined);
  }
  const f = await criterionTracker(t); await bindCriterion(f.request, f.options);
  const facts = await criterionFacts([f.item], { ...f.options, adapters: [{ provider: 'file', read: async () => {
    await f.client.update(f.item, { acceptanceCriteria: 'Temporary criterion' });
    await f.client.update(f.item, { acceptanceCriteria: 'Outcome' });
    return { text: 'Exact claim', revision: digest('Exact claim') };
  } }] });
  assert.equal(facts.rows[0].support, 'unknown'); assert.equal(facts.rows[0].code, 'conflict'); assert.equal(facts.receipt.complete, false);
});

test('fixed-clock CLI JSON and TOON report peer success without erasing its review', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: clock });
  for (const json of [false, true]) {
    const f = await criterionTracker(t); await extension(f.workspace);
    const args = ['--import', new URL('./clock-race.preload.ts', import.meta.url).href, join(import.meta.dirname, '../node_modules/.bin/pm'), 'evidence', 'bind', f.item, '--citation', f.citation.citation, '--criterion', f.request.criterion.text, '--criterion-revision', f.request.criterion.revision, ...(json ? ['--json'] : [])];
    const result = spawnSync(process.execPath, args, { cwd: f.root, env: environment(f.root, f.workspace), encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr); const wire = (json ? JSON.parse(result.stdout) : decodeToon(result.stdout)) as { citation: string }; assert.equal(wire.citation, f.citation.citation);
    assert.equal((await new Store(f.options).get(f.item)).value.citations[0].reviews.filter(entry => entry.author === 'peer').length, 1);
    for (const command of ['check', 'criteria']) {
      const rendered = spawnSync(process.execPath, [args[0], args[1], args[2], 'evidence', command, f.item, '--budget', '30000', ...(json ? ['--json'] : [])], { cwd: f.root, env: environment(f.root, f.workspace), encoding: 'utf8' });
      assert.equal(rendered.status, 0, rendered.stderr);
      const packet = (json ? JSON.parse(rendered.stdout) : decodeToon(rendered.stdout)) as Packet<CheckRow | CriterionFact>;
      if (command === 'check') { assert.equal(packet.receipt.verification?.skippedItems, 1); assert.equal(packet.receipt.complete, false); }
      else { const fact = packet.rows[0] as CriterionFact; assert.equal(fact.support, 'current-source'); assert.equal(fact.truthAssessed, false); }
    }
    assert.equal((await new Store(f.options).get(f.item)).value.citations[0].reviews.filter(entry => entry.author === 'peer').length, 2);
  }
});
