import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { check, cite, review, show, validateRecord, RecordValidationError } from '../index.ts';
import { spawnSync } from 'node:child_process';
import { testEnvironment } from '../scripts/environment.ts';
import { apply, assertReadable, boundaries, full, random } from './record-boundaries.ts';
import type { Shape } from './record-boundaries.ts';
import { stateSchema } from '../src/citation-schema.ts';
import { Store } from '../src/store.ts';
import { citedTracker, tracker } from './helpers.ts';

/** Exact authoritative tracker image; SDK read-usage receipts and metadata caches are runtime state. */
async function durable(workspace: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  /** Enumerate only this disposable tracker, including metadata, history and SDK state. */
  async function visit(relative: string): Promise<void> {
    for (const entry of await readdir(join(workspace, relative), { withFileTypes: true })) {
      const name = join(relative, entry.name);
      if (name === 'runtime') continue;
      if (entry.isDirectory()) await visit(name); else result[name] = createHash('sha256').update(await readFile(join(workspace, name))).digest('hex');
    }
  }
  await visit(''); return result;
}
test('record law: 10000 reviews refuse the 10001st before writing', async t => {
  const f = await citedTracker(t); const store = new Store(f.options); const prior = await store.get(f.item); const value = full(prior.value.citations[0]);
  value.citations[0].reviews = Array.from({ length: 10000 }, (_, i) => ({ ...value.citations[0].reviews[0], id: `review-${i}` }));
  await store.commit(f.item, prior.raw, value, 'Boundary fixture', prior.item.updated_at);
  const before = await durable(f.workspace);
  await assert.rejects(review(f.item, { ...f.options, citation: f.citation.citation, disposition: 'still-valid', reason: 'New review beyond the durable limit' }), (error: unknown) => {
    assert.ok(error instanceof RecordValidationError); assert.equal(error.code, 'schema'); assert.equal(error.limit, '10000'); assert.equal(error.observed, 10001); assert.match(error.remedy, /current revision/); return true;
  });
  assert.deepEqual(await durable(f.workspace), before); assert.equal((await show(f.item, f.options)).citations[0].reviews.length, 10000);
  assert.notEqual((await check([f.item], { ...f.options, record: false })).rows[0].code, 'schema');
});

test('every schema boundary follows the complete-record write/read law', async t => {
  const f = await citedTracker(t); const store = new Store(f.options); const original = await store.get(f.item); const base = full(original.value.citations[0]);
  const cases = boundaries(z.toJSONSchema(stateSchema, { unrepresentable: 'any' }) as Shape);
  let tested = 0; let accepted = 0; let refused = 0;
  const next = random(0x5c4e6a); for (let i = cases.length - 1; i > 0; i--) { const j = (next() >>> 8) % (i + 1); [cases[i], cases[j]] = [cases[j], cases[i]]; }
  for (const boundary of cases) {
    const value = structuredClone(base); apply(value, boundary);
    // Nonempty source strings must also satisfy the containment refinement, independently of length.
    const expected = boundary.accepted && boundary.path.join('.') !== 'citations.0.provenance.item' && !(boundary.path.at(-1) === 'source' && typeof Reflect.get(value.citations[0].descriptor, 'source') === 'string' && value.citations[0].descriptor.source === '');
    if (expected) {
      assert.doesNotThrow(() => validateRecord(value, f.item), boundary.name);
      // Isolate large SDK metadata caches and parser copies to one disposable process.
      if (JSON.stringify(value).length > 1_000_000) {
        const run = spawnSync(process.execPath, ['test/record-boundary.worker.ts', JSON.stringify(boundary)], { encoding: 'utf8', env: testEnvironment(process.env), timeout: 120000 });
        assert.equal(run.error, undefined, boundary.name); assert.equal(run.status, 0, `${boundary.name}: ${run.stdout} ${run.stderr}`);
      } else {
        const current = await store.get(f.item);
        await store.commit(f.item, current.raw, value, 'Schema-derived boundary write', current.item.updated_at);
        await assertReadable(f, value);
      }
      accepted++;
    } else {
      const current = await store.get(f.item); const before = await durable(f.workspace);
      assert.throws(() => validateRecord(value, f.item), RecordValidationError, boundary.name);
      await assert.rejects(store.commit(f.item, current.raw, value, 'Invalid boundary candidate', current.item.updated_at), RecordValidationError, boundary.name);
      assert.deepEqual(await durable(f.workspace), before, boundary.name); refused++;
    }
    tested++;
  }
  for (const pointer of ['relative', '/~', '/~2', '/~01']) {
    const value = structuredClone(base); value.citations[0].descriptor.selector = { kind: 'pointer', pointer };
    if (pointer === '/~01') assert.doesNotThrow(() => validateRecord(value)); else assert.throws(() => validateRecord(value), RecordValidationError);
  }
  for (const source of ['../escape', '/absolute', 'a/../escape']) { const value = structuredClone(base); value.citations[0].descriptor.source = source; assert.throws(() => validateRecord(value), RecordValidationError); }
  const duplicate = structuredClone(base); duplicate.citations.push(duplicate.citations[0]); assert.throws(() => validateRecord(duplicate), RecordValidationError);
  const sparse = structuredClone(base); sparse.citations = Array(1); assert.throws(() => validateRecord(sparse), RecordValidationError);
  const reverse = structuredClone(base); reverse.citations[0].descriptor.selector = { kind: 'lines', start: 2, end: 1 }; assert.throws(() => validateRecord(reverse), RecordValidationError);
  const extra = { ...base, foreign: true }; assert.throws(() => validateRecord(extra), RecordValidationError);
  assert.throws(() => validateRecord(null), RecordValidationError);
  t.diagnostic(JSON.stringify({ seed: '0x5c4e6a', schemaDerivedBoundaryCases: tested, accepted, refused, refinements: 10, unicode: 'literal UTF-16 lengths' }));
});

test('seeded mutation law: successes are SDK-readable and every refusal preserves durable bytes', async t => {
  const seeds = [0x26a044, 0xc0a1e5ce]; let steps = 0; let refusals = 0; let successes = 0;
  for (const seed of seeds) for (let batch = 0; batch < 25; batch++) {
    const f = await citedTracker(t); const store = new Store(f.options); const initial = await store.get(f.item); const next = random(seed + batch);
    const base = full(initial.value.citations[0]);
    const cases = boundaries(z.toJSONSchema(stateSchema, { unrepresentable: 'any' }) as Shape).filter(entry => !entry.accepted);
    for (let sequence = 0; sequence < 10; sequence++) for (let operation = 0; operation < 4; operation++) {
      const current = await store.get(f.item); const before = await durable(f.workspace); const choice = (next() >>> 8) % 7;
      try {
        if (choice === 0) {
          const source = sequence % 3 === 0 ? 'doc.md' : `doc-${sequence % 3}.md`; await writeFile(join(f.root, source), 'Claim');
          await cite(f.item, source, { ...f.options, selector: { kind: 'lines', start: 1, end: 1 }, retain: sequence % 2 === 0 });
        }
        else if (choice === 1 || choice === 2) {
          if (choice === 2) await writeFile(join(f.root, 'doc.md'), `Claim revision ${batch}-${sequence}`);
          await review(f.item, { ...f.options, citation: f.citation.citation, disposition: choice === 1 ? 'still-valid' : 're-anchored', selector: { kind: 'lines', start: 1, end: 1 }, reason: ['e\u0301Р', 'x'.repeat(999), 'x'.repeat(1000), 'x'.repeat(1001), '', 'x'.repeat(100000)][(next() >>> 8) % 6] });
        } else if (choice === 3) await check([f.item], { ...f.options, budget: 10000 });
        else if (choice === 4) { const candidate = structuredClone(base); apply(candidate, cases[(batch * 10 + sequence) % cases.length]); await store.commit(f.item, current.raw, candidate, 'Generated complete record', current.item.updated_at); }
        else if (choice === 5) await store.mutate(f.item, value => { value.revision = [Number.MAX_SAFE_INTEGER - 1, Number.MAX_SAFE_INTEGER, -2][(next() >>> 8) % 3]; return { value: true, observation: 'Generated revision boundary' }; });
        else await store.commit(f.item, current.raw, structuredClone(initial.value), 'Older input replay at current target revision', current.item.updated_at);
        successes++;
        const saved = await f.client.get(f.item, { full: true }); validateRecord(JSON.parse(String(saved.item.evidence_state)));
        await show(f.item, f.options); const checked = await check([f.item], { ...f.options, record: false, budget: 100000 }); assert.ok(checked.rows.every(row => row.code !== 'schema'));
      } catch (error) {
        assert.equal((error as { code?: string }).code === 'schema' || (error as { code?: string }).code === 'invalid', true, String(error));
        assert.deepEqual(await durable(f.workspace), before); refusals++;
      }
      steps++;
    }
    await rm(f.root, { recursive: true, force: true });
  }
  assert.ok(successes > 0 && refusals > 0); t.diagnostic(JSON.stringify({ seeds: seeds.map(seed => seed.toString(16)), sequences: 500, trackers: 50, steps, successes, refusals, sdkReadAfterEverySuccess: true }));
});


test('preflight refuses before schema registration and check recording exposes complete-state bounds', async t => {
  const f = await tracker(t); const store = new Store(f.options); const before = await durable(f.workspace);
  await assert.rejects(store.mutate(f.item, value => { value.revision = Number.MAX_SAFE_INTEGER; return { value: true, observation: 'Invalid first write' }; }), RecordValidationError);
  assert.deepEqual(await durable(f.workspace), before);
  const g = await citedTracker(t); const other = new Store(g.options); const current = await other.get(g.item); current.value.revision = Number.MAX_SAFE_INTEGER;
  await other.commit(g.item, current.raw, current.value, 'Valid final revision', current.item.updated_at);
  const second = 'evidence-test-second'; await g.client.create({ id: second, type: 'Decision', title: 'Second revision boundary' });
  const target = await other.getRaw(second); const record = structuredClone(current.value); record.citations[0].provenance.item = second;
  await other.commit(second, target.raw, record, 'Second valid final revision', target.item.updated_at);
  const image = await durable(g.workspace); const result = await check([g.item, second], { ...g.options, budget: 5000 });
  assert.equal(result.receipt.verification?.foreignItems, 0); assert.equal(result.receipt.verification?.recordedItems, 0);
  assert.equal(result.receipt.verification?.refusal?.code, 'schema'); assert.equal(result.receipt.verification?.refusal?.limit, String(Number.MAX_SAFE_INTEGER));
  assert.equal(result.receipt.verification?.refusal?.field, 'revision'); assert.equal(result.receipt.complete, false);
  assert.deepEqual(await durable(g.workspace), image);
});
