import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { bundleTarget, cite, exportBundle, setBundleConsent } from '../index.ts';
import type { CitationBundle, BundleAuthorization } from '../index.ts';
import { digest } from '../src/core.ts';
import { tracker } from './helpers.ts';

/** Genuine SDK fixtures include two selected fragments and one excluded source. */
export async function bundleFixture(t: TestContext) {
  const f = await tracker(t); const citations: string[] = [];
  for (const [source, text] of [['selected.md', '  Exact\tclaim\r\nSecond line  '], ['data.json', '{ "number": 9007199254740993, "other": true }'], ['unselected.md', 'SECRET-UNSELECTED']]) {
    await writeFile(join(f.root, source), text);
    citations.push((await cite(f.item, source, { ...f.options, retain: true, selector: source.endsWith('json') ? { kind: 'pointer', pointer: '/number' } : { kind: 'lines', start: 1, end: 2 - Number(source === 'unselected.md') } })).citation);
  }
  await setBundleConsent({ ...(await bundleTarget(f.item, f.options)), citations, consent: 'granted' }, f.options);
  const bundle = await exportBundle({ item: f.item, citations: citations.slice(0, 2) }, f.options);
  const target = 'evidence-test-recipient'; await f.client.create({ id: target, type: 'Decision', title: 'Native recipient', unset: ['parent', 'assignee', 'sprint', 'release'] });
  return { ...f, citations, bundle, target };
}
/** Explicit target authorization is renewed from native history for each attempt. */
export async function authorization(f: Awaited<ReturnType<typeof bundleFixture>>): Promise<BundleAuthorization> {
  return { ...await bundleTarget(f.target, f.options), authorized: true };
}
/** Recompute only the outer checksum to test independent validation of retained bytes and sizes. */
export function rehash(bundle: CitationBundle): CitationBundle {
  const { hash: _hash, ...payload } = bundle;
  return { ...payload, hash: digest(JSON.stringify(payload)) };
}
/** Interpose a boundary on the real locked store while peer operations still use the complete SDK. */
export function sameNative(before: Record<string, unknown>, after: Record<string, unknown>): void {
  for (const key of Object.keys(before)) if (!['evidence_state', 'comments', 'collection_counts', 'files', 'updated_at', 'updated_by'].includes(key)) assert.deepEqual(after[key], before[key], key);
}
