import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { decodeToon } from '@unbrained/pm-cli/sdk/testing';
import { bindCriterion, cite, criterionFacts, criterionBindingSchema, criterionFactSchema, criterionRefSchema, parseCitation } from '../index.ts';
import type { CriterionBinding, CriterionFact, Packet } from '../index.ts';
import { Store } from '../src/store.ts';
import { digest } from '../src/core.ts';
import { extension, environment, tracker } from './helpers.ts';

import { binding, writeEvidence, criterionTracker } from './criteria-helpers.ts';

test('criterion edits and isolated fragment edits invalidate only their exact bindings, never prove truth', async t => {
  const f = await tracker(t); await f.client.update(f.item, { acceptanceCriteria: 'First outcome; Second outcome' });
  await writeFile(join(f.root, 'a.json'), '{"value":1}'); await writeFile(join(f.root, 'b.json'), '{"value":2}');
  const a = await cite(f.item, 'a.json', { ...f.options, selector: { kind: 'pointer', pointer: '/value' } });
  const b = await cite(f.item, 'b.json', { ...f.options, selector: { kind: 'pointer', pointer: '/value' } });
  const first = await binding(f, a.citation, 'First outcome'); const second = await binding(f, b.citation, 'Second outcome');
  for (const request of [first, second]) { assert.deepEqual(await bindCriterion(request, f.options), request); assert.ok(criterionBindingSchema.safeParse(request).success); }
  const before = (await f.client.get(f.item, { full: true })).item;
  await bindCriterion(first, f.options); assert.deepEqual((await f.client.get(f.item, { full: true })).item, before);
  await writeFile(join(f.root, 'a.json'), '{"value":3}');
  const sourceEdit = await criterionFacts([f.item], { ...f.options, budget: 30000 });
  assert.deepEqual(sourceEdit.rows.map(row => [row.criterion, row.support]), [['First outcome', 'lost-source'], ['Second outcome', 'current-source']]);
  assert.equal(sourceEdit.receipt.verification?.sourceReads, 2); assert.ok(sourceEdit.rows.every(row => row.truthAssessed === false));
  await f.client.update(f.item, { acceptanceCriteria: 'Changed first; Second outcome' });
  const edited = await criterionFacts([f.item], { ...f.options, budget: 30000 });
  assert.equal(edited.rows.find(row => row.criterion === 'First outcome')?.support, 'criterion-changed');
  assert.equal(edited.rows.find(row => row.criterion === 'Second outcome')?.support, 'current-source');
  assert.equal(edited.rows.find(row => row.criterion === 'Changed first')?.support, 'unbound');
  await assert.rejects(bindCriterion(first, f.options), { code: 'conflict' });
  await f.client.update(f.item, { acceptanceCriteria: 'First outcome; Second outcome' });
  await assert.rejects(bindCriterion(first, f.options), { code: 'conflict' });
  const restored = await binding(f, a.citation, 'First outcome'); assert.notEqual(restored.criterion.revision, first.criterion.revision);
  await bindCriterion(restored, f.options);
  const saved = (await new Store(f.options).get(f.item)).value;
  for (const citation of saved.citations) assert.deepEqual(parseCitation(JSON.parse(JSON.stringify(citation)), f.item), citation);
  assert.equal(saved.citations[0].criteria?.length, 2);
  for (const row of edited.rows) assert.deepEqual(criterionFactSchema.parse(JSON.parse(JSON.stringify(row))), row);
});

test('duplicate criteria, malformed siblings, foreign envelopes and missing sources remain separate facts', async t => {
  const f = await criterionTracker(t); const citation = f.citation;
  const request = await binding(f, citation.citation, 'Outcome'); await bindCriterion(request, f.options);
  await f.client.update(f.item, { acceptanceCriteria: 'Outcome; Outcome' });
  assert.equal((await criterionFacts([f.item], { ...f.options, budget: 30000 })).rows[0].support, 'ambiguous-criterion');
  await assert.rejects(bindCriterion(request, f.options), { code: 'conflict' });
  await f.client.update(f.item, { acceptanceCriteria: 'Outcome' }); await bindCriterion(await binding(f, citation.citation, 'Outcome'), f.options);
  const good = (await new Store(f.options).get(f.item)).value;
  for (const broken of [{ ...good, citations: [{ bad: true }, ...good.citations] }, { ...good, citations: [...good.citations, good.citations[0]] }, { version: 99 }]) {
    await writeEvidence(f, JSON.stringify(broken));
    const result = await criterionFacts([], { ...f.options, budget: 30000 });
    assert.ok(result.rows.some(row => row.code === 'schema')); assert.equal(result.receipt.complete, false);
    if ('citations' in broken) assert.ok(result.rows.some(row => row.support === 'current-source'));
  }
  await writeEvidence(f, JSON.stringify(good));
  await writeFile(join(f.root, 'doc.md'), 'Exact claim\nExact claim');
  assert.ok((await criterionFacts([f.item], { ...f.options, budget: 30000 })).rows.some(row => row.resolution === 'ambiguous'));
});

test('strict request and result schemas refuse sparse arrays, extreme numeric options and unknown qualifiers', async t => {
  const f = await tracker(t);
  await assert.rejects(bindCriterion({} as CriterionBinding, f.options), { code: 'invalid' });
  assert.equal(criterionRefSchema.safeParse({ text: '', revision: '0'.repeat(64) }).success, false);
  assert.equal(criterionFactSchema.safeParse({ truthAssessed: true }).success, false);
  for (const value of [NaN, Infinity, -Infinity, -1, 0, Number.MAX_VALUE, 1.5]) await assert.rejects(criterionFacts([f.item], { ...f.options, budget: value }), { code: 'invalid' });
  for (const options of [{ record: true }, { revision: 'cited' as const }, { diff: true }, { unexpected: true }]) await assert.rejects(criterionFacts([f.item], { ...f.options, ...options }), { code: 'invalid' });
  await assert.rejects(criterionFacts(new Array<string>(1), f.options), { code: 'invalid' });
  await assert.rejects(criterionFacts(['missing-target'], f.options), { code: 'sdk' });
  assert.equal((await criterionFacts([f.item, f.item], f.options)).scope.items, 1);
  await assert.rejects(criterionFacts([f.item], { ...f.options, budget: 1 }), { code: 'budget' });
  await f.client.update(f.item, { acceptanceCriteria: 'x'.repeat(65_537) });
  const oversized = await criterionFacts([f.item], { ...f.options, budget: 30000 }); assert.equal(oversized.rows[0].code, 'size');
  const historyPath = join(f.workspace, 'history', `${f.item}.jsonl`); const history = await readFile(historyPath, 'utf8');
  await writeFile(historyPath, ''); assert.equal((await criterionFacts([f.item], f.options)).rows[0].code, 'integrity');
  await writeFile(historyPath, history.replace(/"record_hash":"[a-f0-9]+"/, '"record_hash":"bad"'));
  assert.equal((await criterionFacts([f.item], f.options)).rows[0].code, 'integrity');
  await writeFile(historyPath, 'unparseable history\n');
  await assert.rejects(criterionFacts([f.item], f.options), { code: 'sdk' });
});

test('bounded adapter refuses oversized fact expansion before returning any successful packet', async t => {
  const f = await criterionTracker(t); const store = new Store(f.options); const saved = (await store.get(f.item)).value;
  const refs = Array.from({ length: 64 }, (_, index) => ({ text: `Old criterion ${index}`, revision: digest(`revision ${index}`) }));
  saved.citations = Array.from({ length: 157 }, (_, index) => ({ ...saved.citations[0], id: `ev-${digest(String(index)).slice(0, 24)}`, criteria: refs }));
  await writeEvidence(f, JSON.stringify(saved));
  await assert.rejects(criterionFacts([f.item], { ...f.options, budget: 1000000 }), { code: 'size' });
});

test('native gitless CLI binds revisions and renders bounded TOON/JSON adapter facts', async t => {
  const f = await criterionTracker(t, 'CLI outcome'); const citation = f.citation; await extension(f.workspace);
  const request = await binding(f, citation.citation, 'CLI outcome');
  const cli = (args: string[]) => spawnSync(process.execPath, [join(import.meta.dirname, '../node_modules/.bin/pm'), 'evidence', ...args], { cwd: f.root, env: environment(f.root, f.workspace), encoding: 'utf8' });
  const bound = cli(['bind', f.item, '--citation', citation.citation, '--criterion', request.criterion.text, '--criterion-revision', request.criterion.revision, '--json']); assert.equal(bound.status, 0, bound.stderr);
  for (const format of [[], ['--json']]) {
    const result = cli(['criteria', '--budget', '800', ...format]); assert.equal(result.status, 0, result.stderr);
    const decoded = (format.length === 0 ? decodeToon(result.stdout) : JSON.parse(result.stdout)) as Packet<CriterionFact>;
    assert.equal(decoded.rows[0].support, 'current-source'); assert.equal(decoded.rows[0].truthAssessed, false); assert.ok(Buffer.byteLength(result.stdout) <= 3200);
  }
  const refusal = cli(['bind', f.item, '--citation', citation.citation, '--criterion', 'Old text', '--criterion-revision', request.criterion.revision]); assert.equal(refusal.status, 3); assert.match(refusal.stderr, /Remedy:/); assert.ok(!refusal.stderr.includes(f.root));
});
