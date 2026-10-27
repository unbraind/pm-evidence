import assert from 'node:assert/strict';
import { test } from 'node:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { splitAcceptanceCriteria } from '@unbrained/pm-cli/sdk';
import { bindCriterion, cite, criterionFacts, parseCitation } from '../index.ts';
import type { Citation, CriterionRef } from '../index.ts';
import { tracker } from './helpers.ts';

/** Reproducible bounded integer generator; the reference model has no text normalization. */
function random(seed: number): () => number { let state = seed; return () => { state = Math.imul(state, 1664525) + 1013904223; return state >>> 0; }; }

test('500 seeded binding sequences read native state through the SDK under custom statuses and ambient focus', async t => {
  const f = await tracker(t); const next = random(0xc17e2026);
  for (const [id, type] of [['evidence-test-parent', 'Feature'], ['evidence-test-dependency', 'Task'], ['evidence-test-focus', 'Task']]) await f.client.create({ id, type, title: 'Synthetic native relationship', unset: ['parent'] });
  const status = `custom_${next().toString(36)}`; await f.client.schemaAddStatus(status, { role: ['active'] });
  await f.client.update(f.item, { acceptanceCriteria: 'First; Second', title: 'Preserved title', description: ' Native description\r\nwith spaces. ', body: 'Native body\r\n', status, parent: 'evidence-test-parent', dep: ['id=evidence-test-dependency,kind=depends_on'], tags: 'model,bindings', priority: 1, note: ['Keep note'], learning: ['Keep learning'], doc: ['path: docs/reference.md\nscope: project'], test: ['command: node --version'], file: ['path: native.md\nscope: project'] });
  const inputs = ['{"first":1,"second":2}', '{ "first": 1, "second": 2 }', '{\r\n"first": 3,\r\n"second": 2\r\n}', '{"first":1,"second":4}'];
  await writeFile(join(f.root, 'source.json'), inputs[0]);
  const citations = [];
  for (const pointer of ['/first', '/second']) citations.push((await cite(f.item, 'source.json', { ...f.options, selector: { kind: 'pointer', pointer }, retain: true })).citation);
  const baseline = (await f.client.get(f.item, { full: true })).item;
  const stable = Object.keys(baseline).filter(key => !['updated_at', 'updated_by', 'evidence_state', 'acceptance_criteria', 'comments', 'collection_counts'].includes(key));
  const model = new Map(citations.map(id => [id, [] as CriterionRef[]])); let expectedRevision = 2;
  const variants = ['First; Second', 'First changed; Second', '  First ; Second  ', 'First;\r\nSecond', 'First; Second changed'];
  const lastGenerations = new Map<string, { revision: string; live: boolean }>(); let source = inputs[0];
  for (let sequence = 0; sequence < 500; sequence++) {
    for (let step = 0; step < 3; step++) {
      const operation = (next() >>> 8) % 5;
      if (operation === 0) { source = inputs[(next() >>> 8) % inputs.length]; await writeFile(join(f.root, 'source.json'), source); }
      else if (operation === 1 && sequence < 60) {
        await f.client.update(f.item, { acceptanceCriteria: variants[(next() >>> 8) % variants.length] });
        const current = splitAcceptanceCriteria((await f.client.get(f.item, { full: true })).item.acceptance_criteria);
        for (const [text, previous] of lastGenerations) if (!current.includes(text)) previous.live = false;
      }
      else if (operation === 2) await f.client.focus((next() & 1) === 0 ? 'evidence-test-focus' : 'evidence-test-parent');
      else if (operation === 3) {
        const facts = await criterionFacts([f.item], { ...f.options, budget: 30000 });
        const available = facts.rows.filter(row => row.revision !== null && row.support !== 'criterion-changed');
        if (available.length > 0) {
          const selected = available[(next() >>> 8) % available.length]; const citation = citations[(next() >>> 8) % citations.length]; const ref = { text: selected.criterion, revision: selected.revision! };
          await bindCriterion({ item: f.item, citation, criterion: ref }, f.options);
          const bound = model.get(citation)!;
          if (!bound.some(entry => entry.text === ref.text && entry.revision === ref.revision)) { bound.push(ref); expectedRevision++; }
        }
      } else {
        // Older declarations remain eligible for replay after criterion edits and source restoration.
        const citation = citations[(next() >>> 8) % citations.length]; const refs = model.get(citation)!;
        if (refs.length > 0) {
          const ref = refs[(next() >>> 8) % refs.length];
          const current = (await criterionFacts([f.item], { ...f.options, budget: 30000 })).rows.some(row => row.criterion === ref.text && row.revision === ref.revision);
          if (current) await bindCriterion({ item: f.item, citation, criterion: ref }, f.options);
          else await assert.rejects(bindCriterion({ item: f.item, citation, criterion: ref }, f.options), { code: 'conflict' });
        }
      }
    }
    const item = (await f.client.get(f.item, { full: true })).item;
    const saved = JSON.parse(String(item.evidence_state)) as { revision: number; citations: Citation[] };
    assert.equal(saved.revision, expectedRevision, `revision at sequence ${sequence}`);
    for (const citation of saved.citations) {
      assert.deepEqual(citation.criteria ?? [], model.get(citation.id), `bindings at sequence ${sequence}`);
      assert.deepEqual(parseCitation(JSON.parse(JSON.stringify(citation)), f.item), citation);
    }
    for (const key of stable) assert.deepEqual(item[key], baseline[key], `native ${key} at sequence ${sequence}`);
    assert.deepEqual(item.comments?.slice(0, baseline.comments?.length), baseline.comments);
    assert.equal(item.collection_counts?.comments, (baseline.comments?.length ?? 0) + expectedRevision - 2);
    const current = splitAcceptanceCriteria(item.acceptance_criteria);
    const facts = await criterionFacts([f.item], { ...f.options, budget: 30000 });
    const live = new Map(facts.rows.filter(row => row.revision !== null).map(row => [row.criterion, row.revision!]));
    assert.deepEqual(new Set(live.keys()), new Set(current));
    for (const [text, previous] of lastGenerations) if (!current.includes(text)) previous.live = false;
    for (const [text, revision] of live) {
      const previous = lastGenerations.get(text);
      if (previous?.live === true) assert.equal(revision, previous.revision, `unchanged generation at sequence ${sequence}`);
      else if (previous !== undefined) assert.notEqual(revision, previous.revision, `restored generation at sequence ${sequence}`);
      lastGenerations.set(text, { revision, live: true });
    }
    for (const [citation, refs] of model) for (const ref of refs) {
      const row = facts.rows.find(row => row.citation === citation && row.criterion === ref.text && row.boundRevision === ref.revision)!;
      assert.ok(row); assert.equal(row.truthAssessed, false);
      if (live.get(ref.text) !== ref.revision) assert.equal(row.support, 'criterion-changed');
      else { const original: number = citation === citations[0] ? 1 : 2; const value = JSON.parse(source) as { first: number; second: number }; assert.equal(row.support, (citation === citations[0] ? value.first : value.second) === original ? 'current-source' : 'lost-source'); }
    }
  }
  t.diagnostic(`seed=0xc17e2026; sequences=500; operations=1500; SDK state readbacks=500; native fields=${stable.length}; bindings=${expectedRevision - 2}; exact source and criterion replays included`);
});
