import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { artifactKey, parseAnnotationTextInput } from '@unbrained/pm-cli/sdk';
import type { LinkedArtifact } from '@unbrained/pm-cli/sdk';
import { bundleTarget, cite, exportBundle, importBundle, inspectBundle, replay, review, setBundleConsent, validateBundle } from '../index.ts';
import type { Citation, CitationBundle } from '../index.ts';
import { bundleFixture, authorization, nativeFileInputs, sameNative } from './bundle-helpers.ts';

/** Deterministic integer choices make every generated sequence reproducible. */
function random(seed: number): () => number { let value = seed; return () => (value = (Math.imul(value, 1664525) + 1013904223) >>> 0); }

test('500 seeded transfer sequences model SDK read-back, older replays, CRLF, native fields, relationships and custom status roles', async t => {
  const next = random(0xb0d1e2026); let steps = 0; let imported = 0; let unchanged = 0; let refusals = 0; let producers = 0;
  for (let batch = 0; batch < 25; batch++) {
    const f = await bundleFixture(t);
    const parent = 'evidence-test-parent'; const dependency = 'evidence-test-dependency';
    for (const id of [parent, dependency]) await f.client.create({ id, type: 'Task', title: 'Native model relationship', unset: ['parent', 'assignee', 'sprint', 'release'] });
    const custom = `phase_${next().toString(36)}`;
    await f.client.schemaAddStatus(custom, { role: [(['active', 'blocked'] as const)[next() % 2]] });
    await f.client.update(f.target, { title: 'Native title', description: '  Native\r\n description  ', body: 'Native\r\nbody\n', status: custom, parent, dep: [`id=${dependency},kind=depends_on`], tags: 'native,bundle-model', priority: 1, acceptanceCriteria: ' Native outcome ; Second ', note: ['Native note'], learning: ['Native learning'], file: nativeFileInputs(`Native annotation ${batch}`), doc: ['path: native-doc.md\nscope: project'], test: ['command: node --version'], unset: ['assignee', 'sprint', 'release'] });
    let baseline = (await f.client.get(f.target, { full: true })).item;
    let nativeFiles = new Map((baseline.files ?? []).map(file => [artifactKey(file), file]));
    let expectedFiles = new Map<string, LinkedArtifact>(nativeFiles);
    const comments = (baseline.comments ?? []).map(entry => ({ text: entry.text, author: entry.author }));
    const model = new Map<string, { entry: CitationBundle['entries'][number]; consent: 'granted' | 'revoked'; reviews: string[] }>();
    const history: CitationBundle[] = [f.bundle]; const selected = [...f.citations]; const granted = new Set(selected);
    const sourceModel = new Map(f.citations.map((id, index) => [id, ['  Exact\tclaim\r\nSecond line  ', '9007199254740993', 'SECRET-UNSELECTED'][index]]));
    /** Every producer output validates and round-trips through whitespace-expanded JSON. */
    const produced = async (item: string, citation: string): Promise<CitationBundle> => {
      const output = await exportBundle({ item, citations: [citation] }, f.options);
      assert.deepEqual(validateBundle(JSON.parse(` \r\n${JSON.stringify(output, null, 2)}\r\n`)), output);
      history.push(output); producers++; return output;
    };
    let revision = 0; let targetComments = baseline.comments?.length ?? 0;
    for (let sequence = 0; sequence < 20; sequence++) {
      for (let operation = 0; operation < 4; operation++) {
        const beforeRevision = revision;
        const choice = next() % 9;
        if (choice === 0) {
          const id = selected[next() % selected.length]; const consent = granted.has(id) ? 'revoked' : 'granted';
          await setBundleConsent({ ...await bundleTarget(f.item, f.options), citations: [id], consent }, f.options);
          if (consent === 'granted') granted.add(id); else granted.delete(id);
        } else if (choice === 1) {
          const id = selected[next() % selected.length];
          if (granted.has(id)) {
            await produced(f.item, id);
          } else { await assert.rejects(exportBundle({ item: f.item, citations: [id] }, f.options), { code: 'boundary' }); refusals++; }
        } else if (choice === 2 || choice === 3 || choice === 8) {
          const input = history[next() % history.length]; const auth = await authorization(f);
          const preview = await importBundle(input, auth, { ...f.options, preview: true });
          const expectedAdded = input.entries.filter(entry => !model.has(entry.origin?.citation ?? entry.id)).length;
          assert.equal(preview.added, expectedAdded); assert.equal(preview.existing, input.entries.length - expectedAdded);
          const applied = await importBundle(input, auth, f.options); assert.deepEqual(applied, { ...preview, preview: false });
          if (expectedAdded > 0) { revision++; targetComments++; imported++; comments.push({ text: parseAnnotationTextInput('evidence bundle import'), author: 'fixture' }); } else unchanged++;
          for (const entry of input.entries) if (!model.has(entry.origin?.citation ?? entry.id)) model.set(entry.origin?.citation ?? entry.id, { entry, consent: 'revoked', reviews: [] });
        } else if (choice === 4) {
          await f.client.focus(next() % 2 === 0 ? parent : dependency);
          const variants = ['Native text', '  Native text  ', 'Native\r\ntext', 'Native\ntext'];
          await f.client.update(f.target, { description: variants[next() % variants.length], parent, file: [`path=selected.md,scope=project,note=Native revision ${sequence}`], unset: ['assignee', 'sprint', 'release'] });
          baseline = (await f.client.get(f.target, { full: true })).item;
          nativeFiles = new Map((baseline.files ?? []).map(file => [artifactKey(file), file])); expectedFiles = new Map(nativeFiles);
        } else if (choice === 5) {
          const source = 'variant.md'; const text = [' Leading spaces  ', 'First\r\nSecond  ', 'First\nSecond  ', '\tUnicode λ\r\n É '][next() % 4];
          await writeFile(join(f.root, source), text);
          const id = (await cite(f.item, source, { ...f.options, retain: true, selector: { kind: 'lines', start: 1, end: text.includes('\n') ? 2 : 1 } })).citation;
          if (!selected.includes(id)) selected.push(id);
          sourceModel.set(id, text);
          await setBundleConsent({ ...await bundleTarget(f.item, f.options), citations: [id], consent: 'granted' }, f.options); granted.add(id);
          const output = await produced(f.item, id); assert.equal(replay({ ...output.entries[0], reviews: [] }), text);
        } else if (model.size > 0) {
          const saved = JSON.parse(String((await f.client.get(f.target, { full: true })).item.evidence_state)) as { citations: Citation[] };
          const citation = saved.citations[next() % saved.citations.length]; const expected = model.get(citation.origin!.citation)!;
          if (choice === 6) {
            const consent = expected.consent === 'granted' ? 'revoked' : 'granted';
            await setBundleConsent({ ...await bundleTarget(f.target, f.options), citations: [citation.id], consent }, f.options); expected.consent = consent;
            comments.push({ text: parseAnnotationTextInput(`evidence sharing consent ${consent}`), author: 'fixture' });
            if (consent === 'granted') await produced(f.target, citation.id);
          } else {
            const reason = `Review ${sequence}-${operation}`; const receipt = await review(f.target, { ...f.options, citation: citation.id, disposition: 'still-valid', reason }); expected.reviews.push(reason);
            comments.push({ text: parseAnnotationTextInput(`evidence review ${receipt.observation} still-valid`), author: 'fixture' });
          }
          revision++; targetComments++;
        }
        if (revision !== beforeRevision) for (const { entry } of model.values()) {
          const file = { path: entry.descriptor.source, scope: 'project' as const, note: 'pm-evidence source identity relative to caller-selected root' }; const key = artifactKey(file);
          if (!expectedFiles.has(key)) expectedFiles.set(key, file);
        }
        const native = (await f.client.get(f.target, { full: true })).item; sameNative(baseline, native);
        const actual = native.evidence_state === undefined ? { revision: 0, citations: [] as Citation[] } : JSON.parse(String(native.evidence_state)) as { revision: number; citations: Citation[] };
        assert.equal(actual.revision, revision); assert.equal(actual.citations.length, model.size); assert.equal(native.comments?.length ?? 0, targetComments);
        assert.deepEqual((native.comments ?? []).map(entry => ({ text: entry.text, author: entry.author })), comments);
        assert.deepEqual(native.files ?? [], [...expectedFiles.values()]);
        for (const citation of actual.citations) {
          const expected = model.get(citation.origin!.citation)!; assert.ok(expected);
          assert.deepEqual(citation.descriptor, expected.entry.descriptor); assert.equal(citation.retained, expected.entry.retained); assert.equal(citation.fragmentDigest, expected.entry.fragmentDigest);
          assert.deepEqual(citation.provenance, { ...expected.entry.provenance, item: f.target }); assert.deepEqual(citation.origin, expected.entry.origin ?? { ...expected.entry.provenance, citation: expected.entry.id });
          assert.equal(citation.exportConsent, expected.consent); assert.deepEqual(citation.reviews.map(entry => entry.reason), expected.reviews);
          for (const observation of citation.reviews) { assert.equal(observation.author, 'fixture'); assert.equal(observation.disposition, 'still-valid'); assert.equal(new Date(observation.at).toISOString(), observation.at); }
          assert.equal(replay(citation), Buffer.from(expected.entry.retained, 'base64').toString('utf8'));
        }
        const files = new Set(native.files?.map(entry => entry.path)); assert.ok(files.has('original.md'));
        for (const { entry } of model.values()) assert.ok(files.has(entry.descriptor.source));
        for (const file of native.files ?? []) if (file.path !== 'original.md') {
          const owner = nativeFiles.get(artifactKey(file));
          if (owner !== undefined) assert.deepEqual(file, owner);
          else { assert.equal(file.scope, 'project'); assert.equal(file.note, 'pm-evidence source identity relative to caller-selected root'); }
        }
        const sourceNative = (await f.client.get(f.item, { full: true })).item;
        const sourceState = JSON.parse(String(sourceNative.evidence_state)) as { citations: Citation[] };
        assert.equal(sourceState.citations.length, sourceModel.size);
        for (const citation of sourceState.citations) {
          assert.equal(citation.exportConsent, granted.has(citation.id) ? 'granted' : 'revoked');
          assert.equal(replay(citation), sourceModel.get(citation.id));
        }
        steps++;
      }
      const inspection = await inspectBundle(history[next() % history.length], await authorization(f), { ...f.options, budget: 500 });
      assert.ok(inspection.estimatedTokens <= 500 && Number.isSafeInteger(inspection.estimatedTokens));
    }
    await rm(f.root, { recursive: true, force: true });
  }
  assert.ok(imported > 0 && unchanged > 0 && refusals > 0 && producers > 0);
  t.diagnostic(JSON.stringify({ seed: '0xb0d1e2026', sequences: 500, operations: steps, SDKReadBacks: steps, imported, unchanged, consentRefusals: refusals, validatedProducers: producers, trackers: 25, nativeRelationships: 'parent+depends_on', normalization: 'SDK read-back only' }));
});
