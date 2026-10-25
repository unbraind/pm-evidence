import assert from 'node:assert/strict';
import { test } from 'node:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cite, check, review, show, affected } from '../index.ts';
import { digest } from '../src/core.ts';
import { tracker } from './helpers.ts';
import type { EvidenceState, CheckRow } from '../src/types.ts';

/** Deterministic xorshift generator; every failure reports a reproducible sequence index. */
function random(seed: number): () => number { let value = seed; return () => { value ^= value << 13; value ^= value >>> 17; value ^= value << 5; return value >>> 0; }; }
/** Reference model stores exact input bytes and logical operation identities without normalization. */
interface ModelCitation { revision: string; retained: boolean; reviews: Set<string>; lastCheck?: CheckRow }

test('500 seeded operation sequences preserve SDK-read state through old-input replay and exact whitespace variants', async t => {
  const f = await tracker(t); const next = random(0x5eeda11);
  await f.client.create({ id: 'evidence-test-parent', type: 'Feature', title: 'Relationship parent' });
  await f.client.create({ id: 'evidence-test-dependency', type: 'Task', title: 'Relationship dependency' });
  const customStatus = `working_${next().toString(36)}`;
  await f.client.schemaAddStatus(customStatus, { role: ['active'] });
  await f.client.update(f.item, { title: 'Native fields survive', description: '  Intentional whitespace\nSecond line.  ', body: 'Native body\r\nwith exact lines.', status: customStatus, parent: 'evidence-test-parent', dep: ['id=evidence-test-dependency,kind=depends_on'], tags: 'synthetic,model', priority: 1, file: ['path: existing.md\nscope: project\nnote: Preserve native link'], comment: ['Existing native comment'], note: ['Existing native note'], learning: ['Existing native learning'], doc: ['path: docs/model.md\nscope: project\nnote: Native documentation'], test: ['command: node --version\nnote: Native test'] });
  const baseline = (await f.client.get(f.item, { full: true })).item;
  const stableKeys = Object.keys(baseline).filter(key => !['updated_at', 'updated_by', 'evidence_state', 'files', 'comments', 'collection_counts'].includes(key));
  const inputs = ['{"policy":1}', '{ "policy": 1 }', '{\r\n  "policy": 1\r\n}', '{\n "policy": 2\n}', '{"policy":"\\u0061"}', '{"policy":"a"}'];
  const model = new Map<string, ModelCitation>(); let revision = 0;
  const comments = [...(baseline.comments ?? []).map(entry => entry.text)];
  const options = { ...f.options, budget: 30000 };
  for (let sequence = 0; sequence < 500; sequence++) {
    // Each sequence has four random operations; older source inputs remain eligible forever.
    for (let step = 0; step < 4; step++) {
      const input = inputs[next() % inputs.length]; await writeFile(join(f.root, 'policy.json'), input);
      const operation = model.size === 0 ? 0 : next() % 5;
      if (operation === 0) {
        const retained = (next() & 1) === 1;
        const result = await cite(f.item, 'policy.json', { ...options, selector: { kind: 'pointer', pointer: '' }, retain: retained });
        const previous = model.get(result.citation);
        if (previous === undefined) { model.set(result.citation, { revision: digest(input), retained, reviews: new Set() }); revision++; comments.push(`evidence cite ${result.citation}`); }
        else if (retained && !previous.retained) { previous.retained = true; revision++; comments.push(`evidence retain ${result.citation}`); }
      } else if (operation === 1) {
        const citation = [...model.keys()][next() % model.size];
        const result = await review(f.item, { ...options, citation, disposition: 'still-valid', reason: 'Seeded repeated review' });
        const previous = model.get(citation)!;
        if (!previous.reviews.has(result.observation)) { previous.reviews.add(result.observation); revision++; comments.push(`evidence review ${result.observation} still-valid`); }
      } else if (operation === 2) {
        // Record only during the warm-up; later checks exercise genuinely read-only paths.
        const record = sequence < 10;
        const result = await check([f.item], { ...options, record });
        assert.equal(result.receipt.verification?.sourceReads, 1);
        for (const row of result.rows) { const expected = model.get(row.citation)!; assert.equal(row.currentRevision, digest(input)); assert.equal(row.oldDigest, expected.revision); assert.equal(row.currentDigest, digest(input)); assert.equal(row.freshness, expected.revision === digest(input) ? 'current' : 'changed'); if (record) expected.lastCheck = row; }
        if (record) { revision++; comments.push('evidence check: compact status observation'); }
      } else if (operation === 3) await show(f.item, options);
      else await affected({ ...options, changed: ['policy.json'], depth: next() % 4 });
    }
    const item = (await f.client.get(f.item, { full: true })).item;
    const saved = JSON.parse(String(item.evidence_state)) as EvidenceState;
    assert.equal(saved.revision, revision, `sequence ${sequence}`); assert.equal(saved.citations.length, model.size);
    for (const citation of saved.citations) {
      const expected = model.get(citation.id)!; assert.ok(expected);
      assert.equal(citation.descriptor.provider, 'json'); assert.equal(citation.descriptor.source, 'policy.json'); assert.equal(citation.descriptor.revision, expected.revision); assert.equal(citation.fragmentDigest, expected.revision);
      assert.deepEqual(citation.descriptor.selector, { kind: 'pointer', pointer: '' }); assert.equal(citation.descriptor.jsonEncoding, 'source-bytes-v1');
      assert.equal(citation.retained !== undefined, expected.retained); if (citation.retained !== undefined) assert.equal(digest(Buffer.from(citation.retained, 'base64').toString('utf8')), expected.revision);
      assert.deepEqual(new Set(citation.reviews.map(entry => entry.id)), expected.reviews);
      assert.deepEqual(citation.lastCheck, expected.lastCheck); assert.equal(citation.provenance.item, f.item); assert.equal(citation.provenance.author, 'fixture');
    }
    assert.deepEqual(item.comments?.map(entry => entry.text), comments, `comments at sequence ${sequence}`);
    assert.deepEqual(item.files, [...baseline.files ?? [], { path: 'policy.json', scope: 'project', note: 'pm-evidence source identity relative to caller-selected root' }]);
    assert.deepEqual(item.collection_counts, { ...baseline.collection_counts, comments: comments.length, files: (baseline.files?.length ?? 0) + 1 });
    for (const key of stableKeys) assert.deepEqual(item[key], baseline[key], `native ${key} at sequence ${sequence}`);
  }
  t.diagnostic(`seed=0x5eeda11; sequences=500; operations=2000; citations=${model.size}; evidence revisions=${revision}; SDK readbacks=500; native fields=${stableKeys.length}`);
});
