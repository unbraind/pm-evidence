import assert from 'node:assert/strict';
import { check, show } from '../index.ts';
import type { citedTracker } from './helpers.ts';
import type { Citation, validateRecord } from '../index.ts';

/** Seeded scheduling independent of the package's validation or normalization. */
export function random(seed: number): () => number { let state = seed; return () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0); }
/** JSON Schema is derived from the one runtime schema, never a second handwritten limits table. */
export interface Shape { type?: string; properties?: Record<string, Shape>; items?: Shape; oneOf?: Shape[]; minimum?: number; maximum?: number; minLength?: number; maxLength?: number; maxItems?: number; enum?: string[]; const?: unknown; format?: string; pattern?: string }
/** A boundary edit carries its independently expected validation result. */
export interface Boundary { name: string; path: (string | number)[]; value: unknown; accepted: boolean; selector?: Citation['descriptor']['selector'] }
/** Build valid operands for each discriminated selector branch. */
const selectors: Citation['descriptor']['selector'][] = [{ kind: 'lines', start: 1, end: 1 }, { kind: 'heading', heading: 'Claim', paragraph: 1 }, { kind: 'pointer', pointer: '' }];
/** Derive structural bounds, enums and formats directly from the published full schema. */
export function boundaries(shape: Shape, path: (string | number)[] = [], selector?: Citation['descriptor']['selector']): Boundary[] {
  const result: Boundary[] = [];
  /** Save a complete test operand without allocating huge strings until this case executes. */
  const add = (name: string, value: unknown, accepted: boolean) => result.push({ name: `${path.join('.')}:${name}`, path, value, accepted, selector });
  if (shape.oneOf !== undefined) return shape.oneOf.flatMap((branch, i) => boundaries(branch, path, selectors[i]));
  for (const [key, child] of Object.entries(shape.properties ?? {})) result.push(...boundaries(child, [...path, key], selector));
  if (shape.items !== undefined) result.push(...boundaries(shape.items, [...path, 0], selector));
  for (const [label, bound] of [['minimum', shape.minimum], ['maximum', shape.maximum]] as const) if (bound !== undefined) {
    for (const delta of [-1, 0, 1]) add(`${label}${delta}`, bound + delta, label === 'minimum' ? delta >= 0 : delta <= 0);
    for (const number of [NaN, Infinity, -Infinity, 0.5]) add('noninteger', number, false);
  }
  for (const [label, bound] of [['minLength', shape.minLength], ['maxLength', shape.maxLength], ['maxItems', shape.maxItems]] as const) if (bound !== undefined) {
    for (const delta of [-1, 0, 1]) if (bound + delta >= 0) add(`${label}${delta}`, { length: bound + delta, array: label === 'maxItems' }, label === 'minLength' ? delta >= 0 : delta <= 0);
    if (label !== 'minLength') add('empty', { length: 0, array: label === 'maxItems' }, shape.minLength === undefined);
  }
  if (shape.enum !== undefined) { for (const value of shape.enum) add('enum', value, true); add('enum-invalid', 'foreign-enum', false); }
  if (shape.const !== undefined) add('literal-invalid', 'foreign-literal', false);
  if (shape.format !== undefined || shape.pattern !== undefined) { add('format-empty', '', false); add('format-invalid', 'confusable-ｅv-NaN', false); }
  return result;
}
/** Modify exactly one field, generating dense counts and literal Unicode without normalizing. */
export function apply(value: ReturnType<typeof validateRecord>, boundary: Boundary): void {
  if (boundary.selector !== undefined) value.citations[0].descriptor.selector = structuredClone(boundary.selector);
  let target: unknown = value;
  for (const key of boundary.path.slice(0, -1)) target = Reflect.get(target as object, key);
  const key = boundary.path.at(-1)!; let operand = boundary.value;
  if (typeof operand === 'object' && operand !== null && 'length' in operand) {
    const spec = operand as { length: number; array: boolean };
    if (spec.array) {
      const prior = Reflect.get(target as object, key) as unknown[];
      operand = Array.from({ length: spec.length }, (_, i) => {
        const entry: unknown = structuredClone(prior[0]);
        if (boundary.path.length === 1) (entry as Citation).id = `ev-${i.toString(16).padStart(24, '0')}`;
        return entry;
      });
    } else {
      // Zod string limits count UTF-16 code units: combining marks and confusables remain literal.
      operand = spec.length > 1_000_000 ? 'x'.repeat(spec.length) : 'e\u0301Р'.repeat(Math.ceil(spec.length / 3)).slice(0, spec.length);
      if (boundary.path.at(-1) === 'pointer' && spec.length > 0) operand = '/' + (operand as string).slice(1);
    }
  }
  Reflect.set(target as object, key, operand);
  // Keep the independent line-order constraint valid when testing a numeric field boundary.
  const selected = value.citations[0]?.descriptor.selector;
  if (selected?.kind === 'lines' && boundary.accepted && typeof operand === 'number') {
    if (key === 'start') selected.end = operand;
  }
}
/** Complete valid seed includes every optional native package field and selector witness. */
export function full(citation: Citation): ReturnType<typeof validateRecord> {
  const row = { item: citation.provenance.item, citation: citation.id, resolution: 'resolved' as const, freshness: 'current' as const, currentResolution: 'resolved' as const, oldDigest: citation.fragmentDigest, currentDigest: citation.fragmentDigest, sourceChanged: false, currentRevision: citation.descriptor.revision, replay: false, diff: { type: 'source-data' as const, old: ['Claim'], current: ['Claim'] }, code: 'missing' as const, remedy: 'Retry', citationIndex: 1 };
  return { version: 1, revision: 1, citations: [{ ...structuredClone(citation), descriptor: { ...citation.descriptor, anchor: { quote: 'Claim', before: '', after: '', sectionPath: ['Parent'] }, jsonEncoding: 'source-bytes-v1' }, retained: 'Q2xhaW0=', reviews: [{ id: 'review-fixture', author: 'fixture', at: citation.provenance.at, disposition: 'still-valid', reason: 'Reviewed', replacement: citation.id }], lastCheck: row, lastCheckedAt: citation.provenance.at }] };
}


/** Verify the actual native SDK record, then both public read paths without normalization. */
export async function assertReadable(f: Awaited<ReturnType<typeof citedTracker>>, value: ReturnType<typeof validateRecord>): Promise<void> {
  const saved = (await f.client.get(f.item, { full: true })).item;
  assert.deepEqual(JSON.parse(String(saved.evidence_state)), value);
  await show(f.item, f.options);
  const result = await check([f.item], { ...f.options, record: false, budget: 1000 });
  assert.ok(result.rows.every(row => row.code !== 'schema'));
}
