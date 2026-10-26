import assert from 'node:assert/strict';
import { test } from 'node:test';
import { writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { commitItemMutations } from '@unbrained/pm-cli/sdk';
import { affected, check, cite } from '../index.ts';
import type { Citation, Selector } from '../index.ts';
import { citationSchema, envelope, envelopeSchema, parseCitation, parseSelector } from '../src/citation-schema.ts';
import { checkCitation } from '../src/evidence.ts';
import { readFileSnapshot } from '../src/sources.ts';
import { tracker } from './helpers.ts';

test('review: tab ancestor headings round trip through cite check and affected', async t => {
  const f = await tracker(t); const path = join(f.root, 'policy.md');
  const original = '# Parent\tcontext\r\n\r\n## Policy\r\n\r\nAllow the synthetic operation.\r\n\r\nClosing source context stays unchanged for precise boundaries.\r\n';
  await writeFile(path, original);
  const result = await cite(f.item, 'policy.md', { ...f.options, selector: { kind: 'heading', heading: 'Policy', paragraph: 1 } });
  const current = await check([f.item], { ...f.options, budget: 5000 });
  assert.equal(current.rows[0].citation, result.citation); assert.equal(current.rows[0].freshness, 'current'); assert.equal(current.receipt.verification?.foreignItems, 0);
  assert.equal((await affected(f.options)).rows.length, 0);
  await writeFile(path, original.replace('Allow the synthetic operation.', 'Deny the synthetic operation.'));
  assert.equal((await check([f.item], { ...f.options, record: false })).rows[0].freshness, 'changed');
  assert.equal((await affected(f.options)).rows[0].freshness, 'changed');
});

test('malformed citations are individual refusals while valid siblings resolve and record', async t => {
  const f = await tracker(t); await writeFile(join(f.root, 'doc.md'), 'Valid sibling claim');
  const cited = await cite(f.item, 'doc.md', { ...f.options, selector: { kind: 'lines', start: 1, end: 1 } });
  const before = envelope((await f.client.get(f.item, { full: true })).item.evidence_state);
  const bad = { id: 'broken', descriptor: { selector: null }, extra: 'preserve this foreign record' };
  const mixed = { ...before, citations: [null, bad, ...before.citations, before.citations[0]] };
  await commitItemMutations({ pmRoot: f.workspace, author: 'fixture', transactionId: 'roundtrip-mixed', mutations: [{ op: 'update', id: f.item, options: { evidenceState: JSON.stringify(mixed) } }] });
  const result = await check([f.item], { ...f.options, budget: 20000 });
  assert.equal(result.rows.length, 4); assert.equal(result.rows[2].citation, cited.citation); assert.equal(result.rows[2].freshness, 'current');
  assert.deepEqual(result.rows.filter(row => row.code === 'schema').map(row => row.citationIndex), [1, 2, 4]);
  assert.equal(result.receipt.verification?.invalidCitations, 3); assert.equal(result.receipt.verification?.foreignItems, 0); assert.equal(result.receipt.verification?.recordedItems, 1); assert.equal(result.receipt.complete, false);
  const saved = envelope((await f.client.get(f.item, { full: true })).item.evidence_state);
  assert.deepEqual(saved.citations[0], null); assert.deepEqual(saved.citations[1], bad); assert.deepEqual(saved.citations[3], before.citations[0]);
  assert.equal(parseCitation(saved.citations[2], f.item).lastCheck?.freshness, 'current');
  const impact = await affected({ ...f.options, budget: 20000, changed: ['unrelated.md'] });
  assert.equal(impact.receipt.verification?.foreignItems, 0); assert.equal(impact.rows.filter(row => row.code === 'schema').length, 3);
  await commitItemMutations({ pmRoot: f.workspace, author: 'fixture', transactionId: 'roundtrip-all-bad', mutations: [{ op: 'update', id: f.item, options: { evidenceState: JSON.stringify({ ...mixed, citations: [null] }) } }] });
  const allBad = await check([f.item], f.options); assert.equal(allBad.receipt.verification?.recordedItems, 0); assert.equal(allBad.receipt.verification?.foreignItems, 0);
});

test('shared producer schema preserves literal headings and rejects unsupported source operands per entry', async t => {
  const f = await tracker(t); const heading = '**Tab\tcode `e\u0301 Рolicy`**';
  await writeFile(join(f.root, 'doc.md'), `# ${heading}\n\nLiteral claim\n\nClosing context with enough unchanged source characters.`);
  const provider = 'literal\tprovider e\u0301';
  const options = { ...f.options, adapters: [{ provider, read: readFileSnapshot }] };
  await cite(f.item, 'doc.md', { ...options, provider, selector: { kind: 'heading', heading, paragraph: 1 } });
  const value = envelope((await f.client.get(f.item, { full: true })).item.evidence_state); const citation = parseCitation(value.citations[0]);
  assert.equal(parseSelector(citation.descriptor.selector).kind, 'heading'); assert.equal((await check([f.item], { ...options, record: false })).rows[0].freshness, 'current');
  assert.equal(citationSchema.safeParse({ ...citation, descriptor: { ...citation.descriptor, source: '../outside' } }).success, false);
  assert.equal(envelopeSchema.safeParse({ ...value, citations: Array(1) }).success, false);
  assert.equal((await checkCitation(null, f.options)).code, 'schema');
  const hostile = { ...options, get diff(): boolean { throw new Error('Unexpected caller failure'); } };
  assert.equal((await checkCitation(citation, hostile)).code, 'schema');
});

/** Deterministic document generator with exact construction, not production normalization. */
function random(seed: number): () => number { let state = seed; return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state; }; }
/** Expected statuses follow a deliberately constructed mutation, independently of the selector implementation. */
interface DocumentCase { name: string; source: string; selector: Selector; fragment: string; changed: string; mutation: 'changed' | 'ambiguous' | 'missing' | 'current'; rejected?: Selector }
/** Produce Markdown and JSON with literal Unicode, tabs, escapes, long ancestry and deep duplicate headings. */
function document(index: number, next: () => number): DocumentCase {
  const unicode = ['e\u0301', 'é', 'Рolicy', 'Policy', '漢字', '👩‍💻', '**strong**', '`code`'];
  const token = unicode[(next() >>> 8) % unicode.length]; const nl = (next() >>> 8) % 2 === 0 ? '\r\n' : '\n'; const variant = (index >>> 1) % 4;
  const mutation = (['changed', 'ambiguous', 'missing', 'current'] as const)[variant];
  if (index % 2 === 0) {
    const key = `${token}\t/~${index}` + (index % 32 === 0 ? 'long'.repeat(1400) : '');
    const value = `Exact ${token} claim ${index}`; const model = { [key]: value, outside: [next(), null, true] };
    const source = JSON.stringify(model, null, index % 3 === 0 ? '\t' : 2).replaceAll('\n', nl);
    const pointer = '/' + key.replaceAll('~', '~0').replaceAll('/', '~1');
    const changed = mutation === 'changed' ? JSON.stringify({ ...model, [key]: value + ' changed' }) : mutation === 'ambiguous' ? `{${JSON.stringify(key)}:1,${JSON.stringify(key)}:2}` : JSON.stringify({ ...model, added: 'outside selected value' });
    return { name: `doc-${index}.json`, source, selector: { kind: 'pointer', pointer }, fragment: JSON.stringify(value), changed, mutation };
  }
  const depth = 2 + (next() >>> 8) % 5; const parents = Array.from({ length: depth - 1 }, (_, i) => `${'#'.repeat(i + 1)} Parent\t${token}${index % 31 === 0 ? 'long'.repeat(1400) : ' repeated'}`);
  const heading = `Policy ${token} ${index}` + (index % 43 === 0 ? ' heading'.repeat(750) : ''); const claim = `Unique literal ${token} claim ${index}.`;
  const prefix = parents.join(nl) + nl + nl; const policy = '#'.repeat(depth) + ' ' + heading + nl + nl;
  const suffix = nl + nl + 'Closing context remains stable beyond twenty four source characters.' + nl;
  const duplicateHeading = index % 7 === 0;
  const source = prefix + policy + claim + suffix + (duplicateHeading ? policy + `Different body ${index}.` + suffix : '') + (index % 29 === 0 ? 'x'.repeat(9000) : '');
  const line = (prefix + policy).split('\n').length;
  const selector: Selector = duplicateHeading ? { kind: 'lines', start: line, end: line } : { kind: 'heading', heading, paragraph: 1 };
  const fragment = claim + (nl === '\r\n' ? '\r' : '');
  const changed = mutation === 'changed' ? source.replace(claim, claim.replace('literal', 'updated')) : mutation === 'ambiguous' ? source + nl + claim + nl : 'Outside preface with enough context.' + nl + source;
  return { name: `doc-${index}.md`, source, selector, fragment, changed, mutation: mutation === 'changed' && duplicateHeading ? 'ambiguous' : mutation, ...(duplicateHeading ? { rejected: { kind: 'heading' as const, heading, paragraph: 1 } } : {}) };
}

test('1024 seeded Markdown and JSON documents round trip every accepted citation and classify mutations', async t => {
  const next = random(0x26c17e); let accepted = 0; let refused = 0; const totals = { changed: 0, ambiguous: 0, missing: 0, current: 0 };
  for (let batch = 0; batch < 64; batch++) {
    const f = await tracker(t); const cases = Array.from({ length: 16 }, (_, offset) => document(batch * 16 + offset, next)); const citations = new Map<string, DocumentCase>();
    for (const doc of cases) {
      await writeFile(join(f.root, doc.name), doc.source);
      if (doc.rejected !== undefined) { await assert.rejects(cite(f.item, doc.name, { ...f.options, selector: doc.rejected })); refused++; }
      const result = await cite(f.item, doc.name, { ...f.options, selector: doc.selector, retain: true }); citations.set(result.citation, doc); accepted++;
    }
    const options = { ...f.options, record: false, budget: 1000000 };
    const current = await check([f.item], options); assert.equal(current.rows.length, cases.length); assert.equal(current.receipt.verification?.foreignItems, 0); assert.equal(current.receipt.complete, true);
    const saved = envelope((await f.client.get(f.item, { full: true })).item.evidence_state);
    for (const raw of saved.citations) { const citation: Citation = parseCitation(raw, f.item); const doc = citations.get(citation.id)!; assert.equal(Buffer.from(citation.retained!, 'base64').toString('utf8'), doc.fragment); assert.equal(citation.fragmentDigest, createHash('sha256').update(doc.fragment).digest('hex')); }
    assert.ok(current.rows.every(row => row.resolution === 'resolved' && row.freshness === 'current')); assert.equal((await affected(options)).rows.length, 0);
    for (const doc of cases) { if (doc.mutation === 'missing') await unlink(join(f.root, doc.name)); else await writeFile(join(f.root, doc.name), doc.changed); }
    const changed = await check([f.item], options); const impact = await affected(options);
    assert.equal(changed.rows.length, cases.length); assert.equal(changed.receipt.verification?.foreignItems, 0); assert.equal(impact.receipt.verification?.foreignItems, 0);
    for (const row of changed.rows) {
      const expected = citations.get(row.citation)!.mutation; totals[expected]++;
      assert.equal(row.code === 'schema', false, `source ${citations.get(row.citation)!.name}`);
      assert.equal(row.resolution, expected === 'changed' || expected === 'current' ? 'resolved' : expected, `${citations.get(row.citation)!.name}: ${expected}; ${row.remedy ?? ''}`);
      assert.equal(row.freshness, expected === 'changed' || expected === 'current' ? expected : 'unknown');
      const affectedRow = impact.rows.find(entry => entry.citation === row.citation);
      if (expected === 'current') assert.equal(affectedRow, undefined); else { assert.equal(affectedRow?.resolution, row.resolution); assert.equal(affectedRow?.freshness, row.freshness); }
    }
  }
  assert.equal(accepted, 1024); assert.ok(refused > 0); t.diagnostic(JSON.stringify({ seed: '0x26c17e', documents: 1024, accepted, refused, mutations: totals, nonGitTrackers: 64, sdkReadbacks: 64 }));
});
