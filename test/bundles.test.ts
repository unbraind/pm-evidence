import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BUNDLE_MAX_BYTES, bundleTarget, exportBundle, importBundle, inspectBundle, replay, setBundleConsent, validateBundle } from '../index.ts';
import type { BundleAuthorization, BundleConsent, Citation, CitationBundle } from '../index.ts';
import { Store } from '../src/store.ts';
import { durable } from './tracker-image.ts';
import { bundleFixture, authorization, rehash, sameNative } from './bundle-helpers.ts';
import { tracker } from './helpers.ts';
import { writeEvidence } from './criteria-helpers.ts';
import { digest } from '../src/core.ts';

test('selected bundle validates, inspects, previews and replays through SDK native state with no sources', async t => {
  const f = await bundleFixture(t); const auth = await authorization(f); const before = (await f.client.get(f.target, { full: true })).item;
  const original = await durable(f.workspace);
  assert.deepEqual(validateBundle(JSON.parse(JSON.stringify(f.bundle))), f.bundle);
  assert.ok(!JSON.stringify(f.bundle).includes('SECRET-UNSELECTED')); assert.ok(!JSON.stringify(f.bundle).includes('unselected.md'));
  assert.equal(f.bundle.entries.length, 2); assert.equal(f.bundle.policy.retention, 'selected-fragments-only');
  const inspection = await inspectBundle(f.bundle, auth, f.options); assert.equal(inspection.rows.length, 2); assert.equal(inspection.receipt.complete, true); assert.ok(inspection.estimatedTokens <= 800);
  const preview = await importBundle(f.bundle, auth, { ...f.options, preview: true }); assert.equal(preview.added, 2);
  assert.deepEqual(await durable(f.workspace), original);
  for (const source of ['selected.md', 'data.json', 'unselected.md']) await rm(join(f.root, source));
  const receipt = await importBundle(f.bundle, auth, f.options); assert.deepEqual({ ...preview, preview: false }, receipt);
  const saved = (await f.client.get(f.target, { full: true })).item; sameNative(before, saved);
  const state = JSON.parse(String(saved.evidence_state)) as { citations: Citation[] };
  assert.deepEqual(state.citations.map(replay), ['  Exact\tclaim\r\nSecond line  ', '9007199254740993']);
  assert.deepEqual(state.citations.map(entry => entry.origin?.citation), f.bundle.entries.map(entry => entry.id));
  assert.deepEqual(state.citations.map(entry => entry.descriptor), f.bundle.entries.map(entry => entry.descriptor));
  assert.ok(state.citations.every(entry => entry.exportConsent === 'revoked' && entry.provenance.item === f.target && entry.reviews.length === 0));
  await assert.rejects(importBundle(f.bundle, auth, f.options), { code: 'conflict' });
  const fresh = await authorization(f); const stable = await durable(f.workspace);
  assert.equal((await importBundle(f.bundle, fresh, f.options)).status, 'unchanged'); assert.deepEqual(await durable(f.workspace), stable);
  await assert.rejects(exportBundle({ item: f.target, citations: state.citations.map(entry => entry.id) }, f.options), { code: 'boundary' });
  await setBundleConsent({ item: fresh.item, revision: fresh.revision, citations: state.citations.map(entry => entry.id), consent: 'granted' }, f.options);
  const onward = await exportBundle({ item: f.target, citations: state.citations.map(entry => entry.id) }, f.options);
  const third = 'evidence-test-third'; await f.client.create({ id: third, type: 'Decision', title: 'Onward recipient', unset: ['parent'] });
  await importBundle(onward, { ...await bundleTarget(third, f.options), authorized: true }, f.options);
  const thirdState = (await new Store(f.options).get(third)).value;
  assert.deepEqual(thirdState.citations.map(entry => entry.origin), state.citations.map(entry => entry.origin));
  assert.deepEqual(thirdState.citations.map(replay), state.citations.map(replay));
});

test('tampered complete bundle and missing target authorization refuse before all durable writes', async t => {
  const f = await bundleFixture(t); const auth = await authorization(f); const before = await durable(f.workspace);
  const cases: unknown[] = [null, {}, { ...f.bundle, foreign: true }, { ...f.bundle, version: Infinity }, { ...f.bundle, entries: Array(2) }, { ...f.bundle, entries: [] }, { ...f.bundle, entries: Array(129).fill(f.bundle.entries[0]) }, { ...f.bundle, entries: [f.bundle.entries[0], f.bundle.entries[0]] }, { ...f.bundle, policy: { ...f.bundle.policy, omitted: [] } }];
  for (const mutation of ['hash', 'descriptor', 'bytes', 'invalid-utf8', 'base64', 'digest', 'size']) {
    const copy = structuredClone(f.bundle);
    if (mutation === 'hash') copy.hash = '0'.repeat(64);
    if (mutation === 'descriptor') copy.entries[1].descriptor.source = 'different.json';
    if (mutation === 'bytes') copy.entries[1].retained = Buffer.from('different').toString('base64');
    if (mutation === 'invalid-utf8') copy.entries[0].retained = '/w==';
    if (mutation === 'base64') copy.entries[0].retained += '\n';
    if (mutation === 'digest') copy.entries[0].fragmentDigest = 'f'.repeat(64);
    if (mutation === 'size') { const text = 'x'.repeat(BUNDLE_MAX_BYTES); copy.entries[0].retained = Buffer.from(text).toString('base64'); copy.entries[0].fragmentDigest = digest(text); }
    cases.push(['bytes', 'invalid-utf8', 'base64', 'digest', 'size'].includes(mutation) ? rehash(copy) : copy);
  }
  for (const input of cases) {
    assert.throws(() => validateBundle(input));
    await assert.rejects(inspectBundle(input, auth, f.options)); await assert.rejects(importBundle(input, auth, f.options));
    assert.deepEqual(await durable(f.workspace), before);
  }
  for (const length of [129, 1_000_000_000, 2 ** 32 - 1]) {
    assert.throws(() => validateBundle({ ...f.bundle, entries: Array(length) }), { code: 'invalid' });
    await assert.rejects(exportBundle({ item: f.item, citations: Array(length) }, f.options), { code: 'invalid' });
  }
  for (const number of [NaN, Infinity, -Infinity, -1, 0, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    const candidate = structuredClone(f.bundle); candidate.entries[0].descriptor.selector = { kind: 'lines', start: number, end: number };
    assert.throws(() => validateBundle(rehash(candidate)), { code: 'invalid' });
  }
  const next = (() => { let seed = 0xfeed1028; return () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0); })();
  for (let index = 0; index < 256; index++) {
    const candidate = structuredClone(f.bundle); candidate.entries[next() % candidate.entries.length].retained += String.fromCharCode(next() % 127);
    assert.throws(() => validateBundle(rehash(candidate))); // Every emitted producer value already passed validateBundle in the model suite.
  }
  for (const invalid of [{ ...auth, authorized: false }, { ...auth, revision: '' }, { ...auth, revision: Infinity }, { ...auth, item: '' }, { ...auth, extra: true }]) {
    await assert.rejects(importBundle(f.bundle, invalid as unknown as BundleAuthorization, f.options), { code: 'invalid' });
    await assert.rejects(inspectBundle(f.bundle, invalid as unknown as BundleAuthorization, f.options), { code: 'invalid' });
  }
  for (const budget of [NaN, Infinity, -Infinity, -1, 0, 1, 1.5, Number.MAX_VALUE]) await assert.rejects(inspectBundle(f.bundle, auth, { ...f.options, budget }));
  await assert.rejects(importBundle(f.bundle, auth, { ...f.options, preview: 'yes' as unknown as boolean }), { code: 'invalid' });
  assert.deepEqual(await durable(f.workspace), before);
  await assert.rejects(bundleTarget('', f.options), { code: 'invalid' });
  t.diagnostic('256 seeded retained-byte fuzz cases plus dense-array, 32-bit length, non-finite, fractional and out-of-domain coordinates');
});

test('consent revocation blocks new exports, remains explicit for old records, and target ABA invalidates authorization', async t => {
  const f = await bundleFixture(t); const source = await bundleTarget(f.item, f.options);
  await setBundleConsent({ ...source, citations: [f.citations[0]], consent: 'revoked' }, f.options);
  const stable = await durable(f.workspace);
  await assert.rejects(exportBundle({ item: f.item, citations: [f.citations[0]] }, f.options), { code: 'boundary' });
  await assert.rejects(setBundleConsent({ ...source, citations: [f.citations[0]], consent: 'granted' }, f.options), { code: 'conflict' });
  await assert.rejects(exportBundle({ item: f.item, citations: [] }, f.options), { code: 'invalid' });
  await assert.rejects(exportBundle({ item: f.item, citations: [f.citations[1], f.citations[1]] }, f.options), { code: 'invalid' });
  await assert.rejects(exportBundle({ item: f.item, citations: [`ev-${'0'.repeat(24)}`] }, f.options), { code: 'missing' });
  await assert.rejects(setBundleConsent({ ...source, consent: 'other', citations: [] } as unknown as BundleConsent, f.options), { code: 'invalid' });
  const current = await bundleTarget(f.item, f.options);
  await setBundleConsent({ ...current, citations: [f.citations[0]], consent: 'revoked' }, f.options);
  assert.deepEqual(await durable(f.workspace), stable);
  const auth = await authorization(f); const native = (await f.client.get(f.target, { full: true })).item;
  await f.client.update(f.target, { title: 'Peer edit', unset: ['parent'] }); await f.client.update(f.target, { title: native.title, unset: ['parent'] });
  assert.notEqual((await authorization(f)).revision, auth.revision);
  await assert.rejects(importBundle(f.bundle, auth, f.options), { code: 'conflict' });
  await assert.rejects(inspectBundle(f.bundle, auth, f.options), { code: 'conflict' });
  // A valid previously produced record still reads; absence of sharing consent never grants it.
  const store = new Store(f.options); const value = await store.get(f.item); delete value.value.citations[1].exportConsent;
  await store.commit(f.item, value.raw, value.value, 'Legacy consent-free citation');
  await assert.rejects(exportBundle({ item: f.item, citations: [f.citations[1]] }, f.options), { code: 'boundary' });
});

test('bad unselected records fail alone, foreign targets skip, and conflicting transported identity refuses atomically', async t => {
  const f = await bundleFixture(t); const store = new Store(f.options); const value = await store.get(f.item);
  const malformed = { ...value.value, citations: [...value.value.citations, null] };
  await writeEvidence(f, JSON.stringify(malformed));
  assert.equal((await exportBundle({ item: f.item, citations: [f.citations[0]] }, f.options)).entries.length, 1);
  for (const bad of [{ ...value.value.citations[0], retained: 12 }, value.value.citations[0]]) {
    await writeEvidence(f, JSON.stringify({ ...malformed, citations: [...malformed.citations, bad] }));
    await assert.rejects(exportBundle({ item: f.item, citations: [f.citations[0]] }, f.options), { code: 'schema' });
  }
  await writeEvidence({ ...f, item: f.target }, '{"version":999}');
  const auth = await authorization(f); const before = await durable(f.workspace);
  const skipped = await importBundle(f.bundle, auth, f.options); assert.equal(skipped.status, 'skipped'); assert.equal(skipped.code, 'schema'); assert.deepEqual(await durable(f.workspace), before);
  await writeEvidence({ ...f, item: f.target }, JSON.stringify({ version: 1, revision: 0, citations: [] }));
  await importBundle(f.bundle, await authorization(f), f.options);
  const imported = await store.get(f.target); delete imported.value.citations[0].origin;
  await store.commit(f.target, imported.raw, imported.value, 'Native source identity conflict');
  const conflictBefore = await durable(f.workspace); const conflictAuth = await authorization(f);
  for (const preview of [true, false]) await assert.rejects(importBundle(f.bundle, conflictAuth, { ...f.options, preview }), { code: 'conflict' });
  assert.deepEqual(await durable(f.workspace), conflictBefore);
  // An existing pre-feature empty tracker gets its field registered through the SDK after validation.
  const g = await tracker(t); await importBundle(f.bundle, { ...await bundleTarget(g.item, g.options), authorized: true }, g.options);
  assert.equal((await new Store(g.options).get(g.item)).value.citations.length, 2);
  const history = join(g.workspace, 'history', `${g.item}.jsonl`); await writeFile(history, 'invalid synthetic history');
  await assert.rejects(bundleTarget(g.item, g.options), { code: 'integrity' });
});
