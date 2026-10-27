import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { commitItemMutations } from '@unbrained/pm-cli/sdk';
import { affected, check, cite, EvidenceError, review, tokens } from '../index.ts';
import type { CheckOptions, SourceAdapter, Citation } from '../index.ts';
import { digest } from '../src/core.ts';
import { snapshot, readFileSnapshot } from '../src/sources.ts';
import { Store } from '../src/store.ts';
import { Verification, verificationCitations, verificationInput } from '../src/verification.ts';
import { checkCitation } from '../src/evidence.ts';
import { tracker, citedTracker } from './helpers.ts';

test('fifty citations across items and cited revisions use one immutable source read per check', async t => {
  const f = await tracker(t); const source = Array.from({ length: 50 }, (_, i) => `Unique public claim number ${i}.`).join('\n');
  await writeFile(join(f.root, 'doc.md'), source);
  await f.client.create({ id: 'evidence-test-second', type: 'Decision', title: 'Second citing decision' });
  for (let i = 0; i < 50; i++) await cite(i < 25 ? f.item : 'evidence-test-second', 'doc.md', { ...f.options, selector: { kind: 'lines', start: i + 1, end: i + 1 } });
  let reads = 0;
  const adapter: SourceAdapter = { provider: 'file', read: async (source, context) => { reads++; return readFileSnapshot(source, context); } };
  const options = { ...f.options, adapters: [adapter], record: false, budget: 100000 };
  const result = await check([], options);
  assert.equal(result.rows.length, 50); assert.ok(result.rows.every(row => row.freshness === 'current'));
  assert.deepEqual(result.receipt.verification, { sourceReads: 1, sources: 1, checked: 50, canceled: false, recordedItems: 0, skippedItems: 0, foreignItems: 0 });
  assert.equal(reads, 1); assert.equal(new Set(result.rows.map(row => row.currentRevision)).size, 1);
  await new Store(f.options).mutate(f.item, value => { value.citations[0].descriptor.revision = digest('earlier revision'); return { value: true, observation: 'Synthetic earlier cited revision' }; });
  const bounded = await check([], { ...options, budget: 800 });
  assert.equal(bounded.receipt.verification?.sourceReads, 1); assert.equal(reads, 2);
  assert.equal(bounded.receipt.returned + bounded.receipt.omitted, 50); assert.equal(bounded.estimatedTokens, tokens(bounded)); assert.ok(bounded.estimatedTokens <= 800);
  await affected(options); assert.equal(reads, 3);
  const canceled = await check([], { ...options, signal: AbortSignal.abort() });
  assert.equal(canceled.receipt.complete, false); assert.equal(canceled.receipt.verification?.checked, 0); assert.equal(canceled.receipt.verification?.sourceReads, 0); assert.ok(canceled.rows.every(row => row.code === 'canceled'));
});

test('one racing source read refuses every citation without mixed revisions or retrying the source', async t => {
  const f = await tracker(t); const file = join(f.root, 'doc.md'); await writeFile(file, 'Claim one\nClaim two');
  for (const line of [1, 2]) await cite(f.item, 'doc.md', { ...f.options, selector: { kind: 'lines', start: line, end: line }, retain: true });
  let reads = 0;
  const adapter: SourceAdapter = { provider: 'file', read: (source, context) => { reads++; return readFileSnapshot(source, context, () => writeFile(file, 'Changed one\nChanged two')); } };
  const result = await check([], { ...f.options, adapters: [adapter], record: false, revision: 'cited', budget: 3000 });
  assert.equal(reads, 1); assert.equal(result.receipt.complete, false);
  assert.ok(result.rows.every(row => row.code === 'race' && row.currentDigest === null && row.currentRevision === null && row.replay));
  assert.ok(result.rows.every(row => row.remedy?.includes('Retry')));
});

test('external cancellation interrupts an uncooperative reader and returns an incomplete non-recording receipt', async t => {
  const f = await citedTracker(t);
  const before = (await f.client.get(f.item, { full: true })).item;
  const controller = new AbortController();
  const adapter: SourceAdapter = { provider: 'file', read: async () => { controller.abort(); return new Promise(() => {}); } };
  const result = await check([], { ...f.options, adapters: [adapter], signal: controller.signal, budget: 3000 });
  assert.equal(result.receipt.complete, false); assert.equal(result.receipt.sourceComplete, false);
  assert.equal(result.receipt.verification?.canceled, true); assert.equal(result.receipt.verification?.sourceReads, 1);
  assert.equal(result.rows[0].code, 'canceled'); assert.ok(result.rows[0].remedy);
  assert.deepEqual((await f.client.get(f.item, { full: true })).item, before);
  const impact = await affected({ ...f.options, signal: AbortSignal.abort() }); assert.equal(impact.receipt.verification?.canceled, true); assert.equal(impact.receipt.complete, false);
});

test('snapshot promises copy adapter data, preserve provider authority and memoize failures only within the invocation', async () => {
  const mutable = { text: 'claim', revision: digest('claim') }; let calls = 0;
  const adapter = { provider: 'trusted', read: async () => { calls++; return mutable; } };
  const options = { workspace: '.', adapters: [adapter], maxBytes: 100 };
  const verification = new Verification(options);
  const first = await verification.read('trusted', './doc'); mutable.text = 'changed'; mutable.revision = digest('changed');
  adapter.read = async () => { throw Error('changed adapter'); };
  assert.equal((await verification.read('trusted', 'doc')).text, 'claim'); assert.ok(Object.isFrozen(first)); assert.equal(calls, 1);
  await assert.rejects(new Verification(options).read('trusted', 'doc'), { code: 'inaccessible' });
  for (let i = 0; i < 2; i++) await assert.rejects(verification.read('other-provider', 'doc'), { code: 'unsupported' });
  assert.equal(verification.finish().sourceReads, 2);
  await assert.rejects(verification.read('trusted', '../escape'), EvidenceError);
  const simultaneous = new Verification({ workspace: '.', adapters: [{ provider: 'trusted', read: async () => ({ text: 'claim', revision: digest('claim') }) }] });
  assert.deepEqual(await Promise.all([simultaneous.read('trusted', 'doc'), simultaneous.read('trusted', 'doc')]), [first, first]); assert.equal(simultaneous.finish().sourceReads, 1);
});

test('verification uses one strict boundary for dense arrays, finite bounds and bounded typed operands', async t => {
  const f = await tracker(t); let reads = 0;
  const adapter: SourceAdapter = { provider: 'file', read: async () => { reads++; return { text: 'x', revision: digest('x') }; } };
  const options = { ...f.options, adapters: [adapter] };
  for (const items of [Array(1), [undefined], [1], [''], ['x'.repeat(4097)], Array(10001).fill('id')]) await assert.rejects(check(items as string[], options), { code: 'invalid' });
  const invalid: unknown[] = [null, [], {}, { ...options, unknown: true }, { ...options, root: 3 }, { ...options, author: '' }, { ...options, diff: 1 }, { ...options, record: 'yes' }, { ...options, revision: 'past' }, { ...options, signal: {} }, { ...options, client: {} }, { ...options, changed: Array(1) }, { ...options, changed: [''] }, { ...options, adapters: Array(1) }, { ...options, adapters: Array(65).fill(adapter) }, { ...options, adapters: [null] }, { ...options, adapters: [{ provider: '', read: adapter.read }] }, { ...options, adapters: [{ provider: 'file', read: 1 }] }, { ...options, adapters: [{ ...adapter, extra: true }] }, { ...options, adapters: [adapter, adapter] }];
  for (const key of ['maxBytes', 'timeoutMs', 'budget', 'depth', 'limit']) for (const value of [NaN, Infinity, -Infinity, Number.MAX_VALUE, -1, 0.5, '1', null]) invalid.push({ ...options, [key]: value });
  for (const option of invalid) await assert.rejects(check([], option as CheckOptions), { code: 'invalid' });
  for (const client of [null, 3]) assert.throws(() => verificationInput([], { ...f.options, client } as unknown as CheckOptions), { code: 'invalid' });
  verificationInput([], { ...f.options, client: f.client, diff: false, record: false, revision: 'current', maxBytes: 1, timeoutMs: 1, budget: 1, depth: 0, limit: 1, changed: [] });
  verificationInput([], { ...f.options, maxBytes: 16777216, timeoutMs: 60000, budget: 1000000, depth: 16, limit: 10000 });
  assert.equal(reads, 0);
  for (const payload of [null, { text: 1, revision: 'x' }, { text: 'x', revision: Infinity }, { text: 'x'.repeat(101), revision: digest('x'.repeat(101)) }]) await assert.rejects(snapshot('test', 'doc', { ...f.options, maxBytes: 100, adapters: [{ provider: 'test', read: async () => payload as { text: string; revision: string } }] }), { code: 'invalid' });
});

test('source count and aggregate snapshot memory are bounded with finite receipt counters', async () => {
  const tiny = { text: '', revision: digest('') };
  const verification = new Verification({ workspace: '.', adapters: [{ provider: 'tiny', read: async () => tiny }] });
  for (let i = 0; i < 10000; i++) await verification.read('tiny', `doc-${i}`);
  await assert.rejects(verification.read('tiny', 'overflow'), { code: 'size' }); assert.equal(verification.finish().sources, 10000);
  const text = 'x'.repeat(16777216); const large = { text, revision: digest(text) };
  const full = new Verification({ workspace: '.', maxBytes: 16777216, adapters: [{ provider: 'large', read: async () => large }] });
  for (let i = 0; i < 4; i++) await full.read('large', `doc-${i}`);
  await assert.rejects(full.read('large', 'overflow'), { code: 'size' }); assert.equal(full.finish().sourceReads, 4);
  const partial = new Verification({ workspace: '.', maxBytes: 16777216, adapters: [{ provider: 'large', read: async () => large }] });
  await partial.read('large', 'first'); large.text += 'x'; large.revision = digest(large.text);
  // Exercise an aggregate overflow without exceeding the per-source bound.
  large.text = 'y'.repeat(15000000); large.revision = digest(large.text);
  for (let i = 0; i < 3; i++) await partial.read('large', `part-${i}`);
  await assert.rejects(partial.read('large', 'overflow'), { code: 'size' });
  Object.assign(partial.receipt, { checked: Infinity }); assert.throws(() => partial.finish(), { code: 'invalid' });
});

test('peer revisions and foreign evidence are skipped with explicit incomplete receipt counts', async t => {
  const f = await citedTracker(t); const citation = f.citation;
  const adapter: SourceAdapter = { provider: 'file', read: async (source, context) => { await review(f.item, { ...f.options, citation: citation.citation, disposition: 'still-valid', reason: 'Competing review' }); return readFileSnapshot(source, context); } };
  const result = await check([], { ...f.options, adapters: [adapter] });
  assert.equal(result.receipt.verification?.skippedItems, 1); assert.equal(result.receipt.verification?.recordedItems, 0); assert.equal(result.receipt.complete, false);
  assert.equal((await new Store(f.options).get(f.item)).value.citations[0].reviews.length, 1);
  await commitItemMutations({ pmRoot: f.workspace, transactionId: 'fixture-foreign', author: 'fixture', mutations: [{ op: 'update', id: f.item, options: { evidenceState: '{"version":2,"revision":1,"citations":[]}' } }] });
  const foreign = (await f.client.get(f.item, { full: true })).item;
  for (const result of [await check([], f.options), await check([f.item], f.options), await affected(f.options)]) { assert.equal(result.receipt.verification?.foreignItems, 1); assert.equal(result.receipt.complete, false); }
  assert.deepEqual((await f.client.get(f.item, { full: true })).item, foreign);
  assert.ok((await readFile(join(f.workspace, 'history', `${f.item}.jsonl`), 'utf8')).includes('Competing review'));
});

test('stored operand schema rejects malformed foreign citations before recording and fuzzes both receipt sides', async t => {
  const f = await tracker(t); await writeFile(join(f.root, 'doc.md'), '# Policy\n\nClaim'); await writeFile(join(f.root, 'doc.json'), '{"n":1}');
  await cite(f.item, 'doc.md', { ...f.options, selector: { kind: 'heading', heading: 'Policy', paragraph: 1 }, retain: true });
  await cite(f.item, 'doc.md', { ...f.options, selector: { kind: 'lines', start: 3, end: 3 } });
  await cite(f.item, 'doc.json', { ...f.options, selector: { kind: 'pointer', pointer: '/n' } });
  const saved = (await new Store(f.options).get(f.item)).value.citations; verificationCitations(saved);
  const citation = saved[0];
  const invalid: unknown[] = [Array(1), [citation, citation], [{ ...citation, id: '' }], [{ ...citation, provenance: undefined }], [{ ...citation, descriptor: undefined }], [{ ...citation, descriptor: null }]];
  for (const selector of [undefined, null, { kind: 'lines', start: 0, end: 1 }, { kind: 'lines', start: 2, end: 1 }, { kind: 'heading', heading: '', paragraph: 1 }, { kind: 'heading', heading: 'Policy', paragraph: Infinity }, { kind: 'unknown' }, { kind: 'pointer', pointer: 1 }, { kind: 'pointer', pointer: 'x'.repeat(4097) }]) invalid.push([{ ...citation, descriptor: { ...citation.descriptor, selector } }]);
  for (const anchor of [null, { quote: 1, before: '', after: '' }, { quote: 'Claim', before: '', after: '', sectionPath: Array(1) }, { quote: 'Claim', before: '', after: '', sectionPath: [1] }]) invalid.push([{ ...citation, descriptor: { ...citation.descriptor, anchor } }]);
  for (const retained of [1, 'a'.repeat(22369625)]) invalid.push([{ ...citation, retained }]);
  for (const value of invalid) assert.throws(() => verificationCitations(value as Citation[]));
  const malformed = structuredClone(citation); malformed.descriptor.selector = null as unknown as Citation['descriptor']['selector'];
  assert.equal((await checkCitation(malformed, f.options)).code, 'schema');
  const native = (await new Store(f.options).get(f.item)).value; native.citations[0].provenance.item = 'foreign-owner';
  await commitItemMutations({ pmRoot: f.workspace, author: 'fixture', transactionId: 'foreign-owner-fixture', mutations: [{ op: 'update', id: f.item, options: { evidenceState: JSON.stringify(native) } }] });
  const result = await check([f.item], f.options); assert.equal(result.receipt.verification?.foreignItems, 0); assert.equal(result.receipt.verification?.invalidCitations, 1); assert.equal(result.receipt.verification?.sourceReads, 2); assert.equal(result.rows.filter(row => row.freshness === 'current').length, 2);
  for (const bound of [undefined, '10000', 10000, NaN, Infinity, -Infinity]) {
    const session = new Verification(f.options); session.receipt.refusal = { code: 'schema', remedy: 'Retry', limit: bound, observed: bound };
    if (typeof bound === 'number' && !Number.isFinite(bound)) assert.throws(() => session.finish(), { code: 'invalid' }); else assert.equal(session.finish().refusal?.code, 'schema');
  }
  let seed = 0x1025;
  const values = [NaN, Infinity, -Infinity, -Number.MAX_VALUE, Number.MAX_VALUE, -1, 0, 0.1, 1, 16, 10000, 60000, 1000000, 16777216, Number.MAX_SAFE_INTEGER, '1', null];
  const keys = ['maxBytes', 'timeoutMs', 'budget', 'depth', 'limit'] as const;
  for (let sample = 0; sample < 500; sample++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; const key = keys[seed % keys.length]; const value = values[(seed >>> 8) % values.length];
    const options = { ...f.options, [key]: value };
    try { verificationInput([], options); } catch (error) { assert.ok(error instanceof EvidenceError); assert.ok(error.remedy.length > 0); }
    const session = new Verification(f.options); session.receipt.checked = value as number;
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 10000) { const receipt = session.finish(); for (const count of Object.values(receipt).filter(entry => typeof entry === 'number')) assert.ok(Number.isFinite(count) && count >= 0 && count <= 10000 && Number.isSafeInteger(count)); }
    else assert.throws(() => session.finish(), { code: 'invalid' });
  }
});

test('in-flight caller option changes cannot redirect tracker writes or source authority', async t => {
  const f = await citedTracker(t);
  const options = { ...f.options, budget: 3000, adapters: [] as SourceAdapter[] };
  options.adapters.push({ provider: 'file', read: async (source, context) => {
    options.workspace = join(f.root, 'different-tracker'); options.root = join(f.root, 'different-sources'); options.budget = Infinity;
    options.adapters.length = 0;
    return readFileSnapshot(source, context);
  } });
  const result = await check([f.item], options);
  assert.equal(result.rows[0].freshness, 'current'); assert.equal(result.receipt.verification?.recordedItems, 1);
  assert.equal((await new Store(f.options).get(f.item)).value.citations[0].lastCheck?.freshness, 'current');
});
