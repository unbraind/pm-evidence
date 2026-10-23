import { RelationshipGraph } from '@unbrained/pm-cli/sdk';
import { digest, EvidenceError, inert, packet, requireInput } from './core.ts';
import { anchor, resolveFragment, select } from './selectors.ts';
import { snapshot, sourceIdentity } from './sources.ts';
import { citationById, state, Store } from './store.ts';
import type { AffectedOptions, CheckOptions, CheckRow, Citation, CiteOptions, EvidenceOptions, Impact, ReviewOptions, Resolution, SourceSnapshot, Selector } from './types.ts';

/** Build a source-bound citation without reading or rewriting the native item schema. */
async function prepare(item: string, source: string, options: CiteOptions, author: string, sourceSnapshot?: SourceSnapshot): Promise<Citation> {
  const identity = sourceIdentity(source); const provider = options.provider ?? (options.selector.kind === 'pointer' ? 'json' : 'file');
  requireInput(provider !== 'json' || options.selector.kind === 'pointer', 'JSON sources require a pointer selector');
  const read = sourceSnapshot ?? await snapshot(provider, identity, options); const selected = select(read.text, options.selector);
  const descriptor = { provider, source: identity, revision: read.revision, selector: options.selector, ...(options.selector.kind === 'pointer' ? {} : { anchor: anchor(read.text, selected) }) };
  if (descriptor.anchor !== undefined) resolveFragment(read.text, descriptor);
  const fragmentDigest = digest(selected.text);
  return { id: `ev-${digest(JSON.stringify([item, descriptor, fragmentDigest])).slice(0, 24)}`, descriptor, fragmentDigest, ...(options.retain === true ? { retained: Buffer.from(selected.text).toString('base64') } : {}), provenance: { item, author, at: new Date().toISOString() }, reviews: [] };
}
/** Record exact evidence on an existing item; retries do not duplicate citations. */
export async function cite(item: string, source: string, options: CiteOptions) {
  const store = new Store(options); const author = await store.author(); const canonical = (await store.get(item)).item.id; const citation = await prepare(canonical, source, options, author);
  await store.mutate(canonical, value => { const prior = value.citations.find(entry => entry.id === citation.id); if (prior !== undefined) { if (citation.retained !== undefined && prior.retained === undefined) { prior.retained = citation.retained; return { value: prior, observation: `evidence retain ${prior.id}` }; } return undefined; } value.citations.push(citation); return { value: citation, observation: `evidence cite ${citation.id}` }; });
  return { item: canonical, citation: citation.id, fragmentDigest: citation.fragmentDigest, revision: citation.descriptor.revision };
}
/** Verify retained original bytes instead of reconstructing missing history. */
export function replay(citation: Citation): string {
  if (citation.retained === undefined) throw new EvidenceError('missing', 'Original fragment bytes were not retained', 'Cite with --retain when immutable replay is required');
  const original = Buffer.from(citation.retained, 'base64').toString('utf8');
  if (digest(original) !== citation.fragmentDigest) throw new EvidenceError('schema', 'Retained fragment digest does not match', 'Restore the original retained bytes from audited history');
  return original;
}
/** Resolve one citation against current bytes, independently checking pinned replay availability. */
export async function checkCitation(citation: Citation, options: CheckOptions): Promise<CheckRow> {
  const row: CheckRow = { item: citation.provenance.item, citation: citation.id, resolution: 'missing', freshness: 'unknown', currentResolution: 'missing', oldDigest: citation.fragmentDigest, currentDigest: null, sourceChanged: null, currentRevision: null, replay: false };
  try {
    const read = await snapshot(citation.descriptor.provider, citation.descriptor.source, options);
    row.currentRevision = read.revision; row.sourceChanged = read.revision !== citation.descriptor.revision;
    const fragment = resolveFragment(read.text, citation.descriptor); row.currentDigest = digest(fragment.text); row.resolution = 'resolved'; row.currentResolution = 'resolved';
    row.freshness = row.currentDigest === row.oldDigest ? 'current' : 'changed';
    if (options.diff === true && row.freshness === 'changed') row.diff = { type: 'source-data', ...(citation.retained === undefined ? {} : { old: replay(citation).split('\n').map(inert) }), current: fragment.text.split('\n').map(inert) };
  } catch (error) {
    const refusal = error as EvidenceError;
    const status: Resolution = ['missing', 'ambiguous', 'unsupported'].includes(refusal.code) ? refusal.code as Resolution : 'inaccessible';
    row.resolution = status; row.currentResolution = status; row.remedy = refusal.remedy;
  }
  if (options.revision === 'cited') { try { replay(citation); row.resolution = 'resolved'; row.replay = true; } catch { row.resolution = 'missing'; row.remedy = 'Original bytes unavailable; cite with --retain for historical replay'; } }
  return row;
}
/** Check selected items or the certified full corpus, persisting compact last-check observations. */
export async function check(items: readonly string[] = [], options: CheckOptions) {
  const store = new Store(options); const selected = items.length === 0 ? await store.all() : await Promise.all([...new Set(items)].map(async id => (await store.get(id)).item));
  const rows: CheckRow[] = [];
  for (const item of selected) {
    const citations = state(item.evidence_state).citations;
    for (const citation of citations) rows.push(await checkCitation(citation, options));
    if (options.record !== false && citations.length > 0) await store.mutate(item.id, value => { for (const citation of value.citations) { const row = rows.find(entry => entry.citation === citation.id); if (row !== undefined) { citation.lastCheck = { ...row, diff: undefined }; citation.lastCheckedAt = new Date().toISOString(); } } return { value: true, observation: 'evidence check: compact status observation' }; });
  }
  return packet(rows, { items: selected.length, citations: rows.length }, options.budget);
}
/** Traverse SDK relationships from changed evidence with explicit depth and output receipts. */
export async function affected(options: AffectedOptions) {
  const store = new Store(options); const items = await store.all(); const native = RelationshipGraph.fromItems(items); const graph = new RelationshipGraph(native.nodes(), native.edges().map(edge => edge.kind === 'parent' ? { ...edge, source: edge.target, target: edge.source } : edge)); const rows: Impact[] = []; let sourceComplete = true;
  const depth = options.depth ?? 2; const limit = options.limit ?? 100;
  requireInput(Number.isSafeInteger(depth) && depth >= 0 && depth <= 16 && Number.isSafeInteger(limit) && limit >= 1 && limit <= 10_000, 'Invalid impact depth or traversal limit');
  const paths = options.changed?.map(sourceIdentity); let checked = 0;
  for (const item of items) for (const citation of state(item.evidence_state).citations) {
    if (paths !== undefined && !paths.includes(citation.descriptor.source)) continue;
    checked++;
    const result = await checkCitation(citation, options);
    if (result.freshness === 'unknown') sourceComplete = false;
    if (result.freshness === 'current') continue;
    const closure = graph.closure(item.id, { direction: 'incoming', kinds: ['parent', 'depends_on', 'blocked_by'], maxDepth: depth, limit });
    if (closure.meta.truncated) sourceComplete = false;
    for (const target of [item.id, ...closure.value]) {
      const path = target === item.id ? [item.id] : graph.shortestPath(item.id, target, { direction: 'incoming', kinds: ['parent', 'depends_on', 'blocked_by'], maxDepth: depth, limit }).value;
      rows.push({ item: target, type: items.find(entry => entry.id === target)!.type, evidenceItem: item.id, citation: citation.id, resolution: result.resolution, freshness: result.freshness, path });
    }
  }
  return packet(rows, { items: items.length, citations: checked, depth, changed: paths, traversalLimit: limit }, options.budget, sourceComplete);
}
/** Re-anchor one coherent current snapshot, using exact recovery or an explicit replacement selector. */
async function reanchor(item: string, original: Citation, options: ReviewOptions, author: string): Promise<Citation> {
  const read = await snapshot(original.descriptor.provider, original.descriptor.source, options);
  let selector: Selector;
  if (options.selector !== undefined) selector = options.selector;
  else if (original.descriptor.selector.kind === 'pointer') selector = original.descriptor.selector;
  else {
    const fragment = resolveFragment(read.text, original.descriptor);
    const start = read.text.slice(0, fragment.start).split('\n').length;
    selector = { kind: 'lines', start, end: start + fragment.text.split('\n').length - 1 };
  }
  return prepare(item, original.descriptor.source, { ...options, provider: original.descriptor.provider, selector, retain: original.retained !== undefined }, author, read);
}
/** Append an idempotent review through lock-held expected-state mutation, preserving original evidence. */
export async function review(item: string, options: ReviewOptions) {
  requireInput(['still-valid', 're-anchored', 'superseded', 'invalid'].includes(options.disposition) && options.reason.trim().length > 0 && options.reason.length <= 1000 && !/[\u0000-\u001f\u007f-\u009f]/.test(options.reason), 'Review requires a valid disposition and a plain-text reason');
  const store = new Store(options); const author = await store.author(); const canonical = (await store.get(item)).item.id; const original = citationById((await store.get(canonical)).value.citations, options.citation);
  const replacement = options.disposition === 're-anchored' ? await reanchor(canonical, original, options, author) : undefined;
  const id = `review-${digest(JSON.stringify([canonical, options.citation, author, options.disposition, options.reason, replacement?.id])).slice(0, 24)}`;
  const observation = { id, author, at: new Date().toISOString(), disposition: options.disposition, reason: options.reason, ...(replacement === undefined ? {} : { replacement: replacement.id }) };
  await store.mutate(canonical, value => { const current = citationById(value.citations, options.citation); if (current.reviews.some(entry => entry.id === id)) return undefined; current.reviews.push(observation); if (replacement !== undefined && !value.citations.some(entry => entry.id === replacement.id)) value.citations.push(replacement); return { value: true, observation: `evidence review ${id} ${options.disposition}` }; }, options.expectedRevision);
  return { item: canonical, citation: options.citation, observation: id, ...(replacement === undefined ? {} : { replacement: replacement.id }) };
}
/** Return citation metadata and last checks; anchors and retained bytes stay out of routine output. */
export async function show(item: string, options: EvidenceOptions) {
  const current = await new Store(options).get(item);
  return { item: current.item.id, revision: current.value.revision, citations: current.value.citations.map(entry => ({ id: entry.id, provider: entry.descriptor.provider, source: entry.descriptor.source, sourceRevision: entry.descriptor.revision, selector: entry.descriptor.selector, fragmentDigest: entry.fragmentDigest, retained: entry.retained !== undefined, provenance: entry.provenance, reviews: entry.reviews, lastCheck: entry.lastCheck, lastCheckedAt: entry.lastCheckedAt })) };
}
