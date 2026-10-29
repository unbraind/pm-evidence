import { citationSchema, envelope, parseCitation, parseSelector, RecordValidationError } from './citation-schema.js';
import { RelationshipGraph } from '@unbrained/pm-cli/sdk';
import { digest, EvidenceError, inert, packet, requireInput } from './core.js';
import { anchor, resolveFragment, select } from './selectors.js';
import { snapshot, sourceIdentity } from './sources.js';
import { citationById, Store } from './store.js';
import { Verification, verificationInput } from './verification.js';
/** Build a source-bound citation without reading or rewriting the native item schema. */
async function prepare(item, source, options, author, sourceSnapshot, sectionScoped = false) {
    const selector = parseSelector(options.selector);
    const identity = sourceIdentity(source);
    const provider = options.provider ?? (selector.kind === 'pointer' ? 'json' : 'file');
    requireInput(provider !== 'json' || selector.kind === 'pointer', 'JSON sources require a pointer selector');
    const read = sourceSnapshot ?? await snapshot(provider, identity, options);
    const selected = select(read.text, selector);
    const descriptor = { provider, source: identity, revision: read.revision, selector, ...(selector.kind === 'pointer' ? { jsonEncoding: 'source-bytes-v1' } : { anchor: anchor(read.text, selected, selector.kind === 'heading' || sectionScoped) }) };
    if (descriptor.anchor !== undefined)
        resolveFragment(read.text, descriptor);
    const fragmentDigest = digest(selected.text);
    return parseCitation({ id: `ev-${digest(JSON.stringify([item, descriptor, fragmentDigest])).slice(0, 24)}`, descriptor, fragmentDigest, ...(options.retain === true ? { retained: Buffer.from(selected.text).toString('base64') } : {}), provenance: { item, author, at: new Date().toISOString() }, reviews: [] }, item);
}
/** Record exact evidence on an existing item; retries do not duplicate citations. */
export async function cite(item, source, options) {
    const store = new Store(options);
    const author = await store.author();
    const canonical = (await store.get(item)).item.id;
    const citation = await prepare(canonical, source, options, author);
    await store.mutate(canonical, value => { const prior = value.citations.find(entry => entry.id === citation.id); if (prior !== undefined) {
        if (citation.retained !== undefined && prior.retained === undefined) {
            prior.retained = citation.retained;
            return { value: prior, observation: `evidence retain ${prior.id}` };
        }
        return undefined;
    } value.citations.push(citation); return { value: citation, observation: `evidence cite ${citation.id}` }; });
    return { item: canonical, citation: citation.id, fragmentDigest: citation.fragmentDigest, revision: citation.descriptor.revision };
}
/** Verify retained original bytes instead of reconstructing missing history. */
export function replay(citation) {
    if (citation.retained === undefined)
        throw new EvidenceError('missing', 'Original fragment bytes were not retained', 'Cite with --retain when immutable replay is required');
    const original = Buffer.from(citation.retained, 'base64').toString('utf8');
    if (digest(original) !== citation.fragmentDigest)
        throw new EvidenceError('schema', 'Retained fragment digest does not match', 'Restore the original retained bytes from audited history');
    return original;
}
/** Resolve one citation against current bytes, independently checking pinned replay availability. */
export async function checkCitation(input, options, verification, context) {
    const candidate = typeof input === 'object' && input !== null ? input : {};
    const identity = citationSchema.shape.id.safeParse(candidate.id);
    const old = citationSchema.shape.fragmentDigest.safeParse(candidate.fragmentDigest);
    const row = { item: context?.item ?? '', citation: identity.success ? identity.data : `invalid-${context?.index ?? 0}`, resolution: 'missing', freshness: 'unknown', currentResolution: 'missing', oldDigest: old.success ? old.data : '', currentDigest: null, sourceChanged: null, currentRevision: null, replay: false };
    let citation;
    try {
        citation = parseCitation(input, context?.item);
        row.item = citation.provenance.item;
        if (context?.seen.has(citation.id))
            throw new EvidenceError('schema', 'Citation identity is duplicated', 'Inspect the reported citationIndex and restore unique producer records');
        context?.seen.add(citation.id);
    }
    catch {
        row.resolution = 'inaccessible';
        row.currentResolution = 'inaccessible';
        row.code = 'schema';
        row.citationIndex = (context?.index ?? 0) + 1;
        row.remedy = 'Restore this citation using the producer schema; valid siblings are still checked';
        if (verification !== undefined)
            verification.receipt.invalidCitations = (verification.receipt.invalidCitations ?? 0) + 1;
        return row;
    }
    try {
        const read = await (verification === undefined ? snapshot(citation.descriptor.provider, citation.descriptor.source, options) : verification.read(citation.descriptor.provider, citation.descriptor.source));
        row.currentRevision = read.revision;
        row.sourceChanged = read.revision !== citation.descriptor.revision;
        const fragment = resolveFragment(read.text, citation.descriptor);
        row.currentDigest = digest(fragment.text);
        row.resolution = 'resolved';
        row.currentResolution = 'resolved';
        row.freshness = row.currentDigest === row.oldDigest ? 'current' : 'changed';
        if (options.diff === true && row.freshness === 'changed')
            row.diff = { type: 'source-data', ...(citation.retained === undefined ? {} : { old: replay(citation).split('\n').map(inert) }), current: fragment.text.split('\n').map(inert) };
    }
    catch (error) {
        const refusal = error instanceof EvidenceError ? error : new EvidenceError('schema', 'Citation metadata cannot be resolved', 'Inspect the citation owner and restore a valid descriptor before retrying');
        const status = ['missing', 'ambiguous', 'unsupported'].includes(refusal.code) ? refusal.code : 'inaccessible';
        row.resolution = status;
        row.currentResolution = status;
        row.code = refusal.code;
        row.remedy = refusal.remedy;
    }
    if (options.revision === 'cited') {
        try {
            replay(citation);
            row.resolution = 'resolved';
            row.replay = true;
        }
        catch {
            row.resolution = 'missing';
            row.remedy = 'Original bytes unavailable; cite with --retain for historical replay';
        }
    }
    return row;
}
/** Check selected items or the certified full corpus, persisting compact last-check observations. */
export async function check(items = [], options) {
    verificationInput(items, options);
    const verification = new Verification(options);
    const settings = verification.options;
    const store = new Store(settings);
    const selected = items.length === 0 ? await store.all() : await Promise.all([...new Set(items)].map(async (id) => (await store.client.get(id, { full: true })).item));
    requireInput(selected.length <= 10_000, 'Check scope exceeds 10000 items; select a smaller batch');
    const rows = [];
    const observed = [];
    for (const item of selected) {
        const raw = item.evidence_state;
        const value = verificationState(raw, verification);
        if (value === undefined)
            continue;
        requireInput(rows.length + value.citations.length <= 10_000, 'Check scope exceeds 10000 citations; select a smaller batch');
        const itemRows = [];
        const seen = new Set();
        for (const [index, citation] of value.citations.entries()) {
            const row = await checkCitation(citation, settings, verification, { item: item.id, index, seen });
            rows.push(row);
            itemRows.push(row);
            if (row.code !== 'canceled')
                verification.receipt.checked++;
        }
        if (value.citations.length > 0)
            observed.push({ item: item.id, revision: value.revision, raw, rows: itemRows });
    }
    if (settings.record !== false && !verification.canceled())
        for (const observation of observed) {
            if (verification.canceled()) {
                verification.receipt.skippedItems++;
                continue;
            }
            try {
                const recorded = await store.observe(observation.item, observation.rows, observation.revision, observation.raw, () => verification.canceled());
                if (recorded === true)
                    verification.receipt.recordedItems++;
                else
                    verification.receipt.skippedItems++;
            }
            catch (error) {
                if (!(error instanceof EvidenceError) || !['conflict', 'schema'].includes(error.code))
                    throw error;
                if (error instanceof RecordValidationError)
                    verification.receipt.refusal ??= { code: error.code, remedy: error.remedy, field: error.field, limit: error.limit, observed: error.observed };
                else if (error.code === 'schema')
                    verification.receipt.foreignItems++;
                verification.receipt.skippedItems++;
            }
        }
    return packet(rows, { items: selected.length, citations: rows.length }, settings.budget, !verification.canceled() && verification.receipt.skippedItems === 0 && verification.receipt.foreignItems === 0 && rows.every(row => row.freshness !== 'unknown'), verification.finish());
}
/** Skip foreign or malformed envelopes without overwriting records owned by another writer. */
function verificationState(raw, verification) {
    try {
        return envelope(raw);
    }
    catch {
        verification.receipt.foreignItems++;
        return undefined;
    }
}
/** Traverse SDK relationships from changed evidence with explicit depth and output receipts. */
export async function affected(options) {
    verificationInput([], options);
    const verification = new Verification(options);
    const settings = verification.options;
    const store = new Store(settings);
    const items = await store.all();
    const native = RelationshipGraph.fromItems(items);
    const graph = new RelationshipGraph(native.nodes(), native.edges().map(edge => edge.kind === 'parent' ? { ...edge, source: edge.target, target: edge.source } : edge));
    const rows = [];
    let sourceComplete = true;
    const depth = settings.depth ?? 2;
    const limit = settings.limit ?? 100;
    const paths = settings.changed?.map(sourceIdentity);
    let checked = 0;
    requireInput(items.length <= 10_000, 'Impact scope exceeds 10000 items');
    for (const item of items) {
        const seen = new Set();
        for (const [index, citation] of (verificationState(item.evidence_state, verification)?.citations ?? []).entries()) {
            if (paths !== undefined) {
                const parsed = citationSchema.safeParse(citation);
                if (parsed.success && parsed.data.provenance.item === item.id && !paths.includes(parsed.data.descriptor.source) && !seen.has(parsed.data.id)) {
                    seen.add(parsed.data.id);
                    continue;
                }
            }
            checked++;
            requireInput(checked <= 10_000, 'Impact scope exceeds 10000 citations');
            const result = await checkCitation(citation, settings, verification, { item: item.id, index, seen });
            if (result.code !== 'canceled')
                verification.receipt.checked++;
            if (result.freshness === 'unknown')
                sourceComplete = false;
            if (result.freshness === 'current')
                continue;
            const closure = graph.closure(item.id, { direction: 'incoming', kinds: ['parent', 'depends_on', 'blocked_by'], maxDepth: depth, limit });
            if (closure.meta.truncated)
                sourceComplete = false;
            for (const target of [item.id, ...closure.value]) {
                const path = target === item.id ? [item.id] : graph.shortestPath(item.id, target, { direction: 'incoming', kinds: ['parent', 'depends_on', 'blocked_by'], maxDepth: depth, limit }).value;
                rows.push({ item: target, type: items.find(entry => entry.id === target).type, evidenceItem: item.id, citation: result.citation, ...(result.code === undefined ? {} : { code: result.code, remedy: result.remedy, citationIndex: result.citationIndex }), resolution: result.resolution, freshness: result.freshness, path });
            }
        }
    }
    return packet(rows, { items: items.length, citations: checked, depth, changed: paths, traversalLimit: limit }, settings.budget, sourceComplete && !verification.canceled() && verification.receipt.foreignItems === 0, verification.finish());
}
/** Re-anchor one coherent current snapshot, using exact recovery or an explicit replacement selector. */
async function reanchor(item, original, options, author) {
    const read = await snapshot(original.descriptor.provider, original.descriptor.source, options);
    let selector;
    if (options.selector !== undefined)
        selector = options.selector;
    else if (original.descriptor.selector.kind === 'pointer')
        selector = original.descriptor.selector;
    else {
        const fragment = resolveFragment(read.text, original.descriptor);
        const start = read.text.slice(0, fragment.start).split('\n').length;
        selector = { kind: 'lines', start, end: start + fragment.text.split('\n').length - 1 };
    }
    return prepare(item, original.descriptor.source, { ...options, provider: original.descriptor.provider, selector, retain: original.retained !== undefined }, author, read, original.descriptor.selector.kind === 'heading' || original.descriptor.anchor?.sectionPath !== undefined);
}
/** Append an idempotent review through lock-held expected-state mutation, preserving original evidence. */
export async function review(item, options) {
    requireInput(['still-valid', 're-anchored', 'superseded', 'invalid'].includes(options.disposition) && options.reason.trim().length > 0 && !/[\u0000-\u001f\u007f-\u009f]/.test(options.reason), 'Review requires a valid disposition and a plain-text reason');
    const store = new Store(options);
    const author = await store.author();
    const canonical = (await store.get(item)).item.id;
    const original = citationById((await store.get(canonical)).value.citations, options.citation);
    const replacement = options.disposition === 're-anchored' ? await reanchor(canonical, original, options, author) : undefined;
    const id = `review-${digest(JSON.stringify([canonical, options.citation, author, options.disposition, options.reason, replacement?.id])).slice(0, 24)}`;
    const observation = { id, author, at: new Date().toISOString(), disposition: options.disposition, reason: options.reason, ...(replacement === undefined ? {} : { replacement: replacement.id }) };
    await store.mutate(canonical, value => { const current = citationById(value.citations, options.citation); if (current.reviews.some(entry => entry.id === id))
        return undefined; current.reviews.push(observation); if (replacement !== undefined && !value.citations.some(entry => entry.id === replacement.id))
        value.citations.push(replacement); return { value: true, observation: `evidence review ${id} ${options.disposition}` }; }, options.expectedRevision);
    return { item: canonical, citation: options.citation, observation: id, ...(replacement === undefined ? {} : { replacement: replacement.id }) };
}
/** Return citation metadata and last checks; anchors and retained bytes stay out of routine output. */
export async function show(item, options) {
    const current = await new Store(options).get(item);
    return { item: current.item.id, revision: current.value.revision, citations: current.value.citations.map(entry => ({ id: entry.id, provider: entry.descriptor.provider, source: entry.descriptor.source, sourceRevision: entry.descriptor.revision, selector: entry.descriptor.selector, fragmentDigest: entry.fragmentDigest, retained: entry.retained !== undefined, provenance: entry.provenance, exportConsent: entry.exportConsent, origin: entry.origin, reviews: entry.reviews, lastCheck: entry.lastCheck, lastCheckedAt: entry.lastCheckedAt })) };
}
//# sourceMappingURL=evidence.js.map