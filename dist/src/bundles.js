import { z } from 'zod';
import { boundedArray, citationSchema, envelope, parseCitation, validateRecord } from './citation-schema.js';
import { digest, EvidenceError, packet } from './core.js';
import { replay } from './evidence.js';
import { citationById, state, Store } from './store.js';
/** Portable fragments are bounded independently of the larger native citation record. */
export const BUNDLE_MAX_BYTES = 4_194_304;
/** Policy is part of the hash: no unselected evidence, native relationships or review claims travel. */
export const BUNDLE_POLICY = {
    retention: 'selected-fragments-only', consent: 'snapshot-not-onward-permission',
    omitted: ['unselected-citations', 'whole-sources', 'native-fields-and-relationships', 'reviews', 'criterion-bindings', 'last-checks'],
};
/** Portable fields derive from the citation producer, preserving exact source text and identities. */
const entrySchema = citationSchema.pick({ id: true, descriptor: true, fragmentDigest: true, retained: true, provenance: true, origin: true }).required({ retained: true });
/** The same payload schema constructs exports and validates every incoming bundle. */
const payloadSchema = z.strictObject({ kind: z.literal('pm-evidence/retained'), version: z.literal(1), policy: z.strictObject({ retention: z.literal(BUNDLE_POLICY.retention), consent: z.literal(BUNDLE_POLICY.consent), omitted: boundedArray(z.enum(BUNDLE_POLICY.omitted), 6).refine(values => JSON.stringify(values) === JSON.stringify(BUNDLE_POLICY.omitted)) }), entries: boundedArray(entrySchema, 128).refine(values => values.length > 0 && new Set(values.map(value => value.id)).size === values.length) });
/** Strict complete bundle envelope; hashes detect corruption, not sender authenticity. */
export const bundleSchema = payloadSchema.extend({ hash: z.string().regex(/^[a-f0-9]{64}$/) });
/** Explicit, bounded source selection never defaults to every citation on an item. */
const selectionSchema = z.strictObject({ item: z.string().min(1).max(4096), citations: boundedArray(citationSchema.shape.id, 128).refine(values => values.length > 0 && new Set(values).size === values.length) });
/** Authorization names the exact native history generation, including edit/restore cycles. */
export const bundleAuthorizationSchema = z.strictObject({ item: z.string().min(1).max(4096), revision: z.string().regex(/^[a-f0-9]{64}$/), authorized: z.literal(true) });
/** Sharing permission is independent of local retained-byte storage permission. */
const consentSchema = selectionSchema.extend({ revision: bundleAuthorizationSchema.shape.revision, consent: z.enum(['granted', 'revoked']) });
/** Finite bounded import receipts never include source fragments. */
export const bundleImportReceiptSchema = z.strictObject({ item: z.string().min(1), hash: bundleSchema.shape.hash, status: z.enum(['imported', 'unchanged', 'skipped']), added: z.number().int().min(0).max(128), existing: z.number().int().min(0).max(128), preview: z.boolean(), code: z.literal('schema').optional(), remedy: z.string().optional() });
/** Strict schema errors refuse without reflecting untrusted content in diagnostics. */
function parse(schema, input) {
    const result = schema.safeParse(input);
    if (!result.success)
        throw new EvidenceError('invalid', 'Invalid bundle input', 'Use the documented bundle schema, dense selection and explicit current target authorization');
    return result.data;
}
/** Bound aggregate data before JSON allocation, then enforce the exact escaped transport size. */
function encoding(value) {
    let bytes = 0;
    const encoded = JSON.stringify(value, (_key, operand) => {
        if (typeof operand === 'string') {
            bytes += Buffer.byteLength(operand);
            if (bytes > BUNDLE_MAX_BYTES)
                throw new EvidenceError('size', 'Bundle exceeds 4 MiB', 'Select fewer or smaller retained fragments');
        }
        return operand;
    });
    if (Buffer.byteLength(encoded) > BUNDLE_MAX_BYTES)
        throw new EvidenceError('size', 'Escaped bundle exceeds 4 MiB', 'Select fewer or smaller retained fragments');
    return encoded;
}
/** Validate all selected bytes before returning any fragment, metadata or mutation plan. */
export function validateBundle(input) {
    const value = parse(bundleSchema, input);
    const { hash, ...payload } = value;
    encoding(value);
    if (digest(JSON.stringify(payload)) !== hash)
        throw new EvidenceError('integrity', 'Bundle hash does not match', 'Obtain a complete unmodified bundle from an authorized source');
    for (const entry of value.entries) {
        const decoded = Buffer.from(entry.retained, 'base64');
        if (decoded.toString('base64') !== entry.retained || Buffer.from(decoded.toString('utf8')).compare(decoded) !== 0 || digest(decoded.toString('utf8')) !== entry.fragmentDigest)
            throw new EvidenceError('integrity', 'Retained bytes do not match their exact UTF-8 digest', 'Obtain an intact canonical-base64 bundle from the source');
        replay({ ...entry, reviews: [] });
    }
    return value;
}
/** Fence permissions on native history, never a content-only or wall-clock key. */
function authorize(expected, actual) {
    if (expected !== actual)
        throw new EvidenceError('conflict', 'Target authorization revision changed', 'Read bundle-target and explicitly authorize its current revision before retrying');
}
/** Return a current native target generation without inferring consent or writing item history. */
export async function bundleTarget(item, options) {
    parse(selectionSchema.shape.item, item);
    return new Store(options).exchange(item, async (document, revision) => ({ result: { item: document.metadata.id, revision } }));
}
/** Grant or revoke onward sharing for explicit citations under the native item lease. */
export async function setBundleConsent(input, options) {
    const request = parse(consentSchema, input);
    const store = new Store(options);
    return store.exchange(request.item, async (document, revision) => {
        authorize(request.revision, revision);
        const value = state(document.metadata.evidence_state, document.metadata.id);
        const entries = request.citations.map(id => citationById(value.citations, id));
        const changed = entries.some(entry => entry.exportConsent !== request.consent);
        for (const entry of entries)
            entry.exportConsent = request.consent;
        if (changed)
            value.revision++;
        return { result: { item: document.metadata.id, consent: request.consent, citations: entries.length }, ...(changed ? { value, observation: `evidence sharing consent ${request.consent}` } : {}) };
    });
}
/** Export only selected retained artifacts after checking live sharing permission under the item lease. */
export async function exportBundle(input, options) {
    const request = parse(selectionSchema, input);
    return new Store(options).exchange(request.item, async (document) => {
        const value = envelope(document.metadata.evidence_state);
        const selected = new Map();
        // Invalid unselected records remain isolated; selecting a malformed record refuses the export.
        for (const raw of value.citations) {
            const identity = citationSchema.shape.id.safeParse(typeof raw === 'object' && raw !== null ? Reflect.get(raw, 'id') : undefined);
            if (!identity.success || !request.citations.includes(identity.data))
                continue;
            const citation = parseCitation(raw, document.metadata.id);
            if (selected.has(citation.id))
                throw new EvidenceError('schema', 'Selected citation identity is duplicated', 'Restore unique citation identities before exporting');
            if (citation.exportConsent !== 'granted')
                throw new EvidenceError('boundary', 'Selected citation lacks current sharing consent', 'Obtain permission and explicitly grant bundle-consent for every selected citation');
            replay(citation);
            selected.set(citation.id, parse(entrySchema, { id: citation.id, descriptor: citation.descriptor, fragmentDigest: citation.fragmentDigest, retained: citation.retained, provenance: citation.provenance, ...(citation.origin === undefined ? {} : { origin: citation.origin }) }));
        }
        if (selected.size !== request.citations.length)
            throw new EvidenceError('missing', 'Selected citation is unavailable', 'Choose existing retained citations from evidence show');
        const payload = parse(payloadSchema, { kind: 'pm-evidence/retained', version: 1, policy: BUNDLE_POLICY, entries: request.citations.map(id => selected.get(id)) });
        return { result: validateBundle({ ...payload, hash: digest(encoding(payload)) }) };
    });
}
/** Keep origin identity while rebinding ownership to the explicitly authorized existing native item. */
function imported(entry, item) {
    const id = `ev-${digest(JSON.stringify([item, entry.descriptor, entry.fragmentDigest])).slice(0, 24)}`;
    return parseCitation({ ...entry, id, provenance: { ...entry.provenance, item }, origin: entry.origin ?? { ...entry.provenance, citation: entry.id }, reviews: [], exportConsent: 'revoked' }, item);
}
/** One planner serves preview and apply, comparing current transported fields and preserving native fields. */
function plan(bundle, raw, item, preview) {
    let value;
    try {
        value = state(raw, item);
    }
    catch {
        return { result: parse(bundleImportReceiptSchema, { item, hash: bundle.hash, status: 'skipped', added: 0, existing: 0, preview, code: 'schema', remedy: 'Foreign or malformed target evidence was preserved; choose an owned valid target' }) };
    }
    let added = 0;
    let existing = 0;
    for (const entry of bundle.entries) {
        const candidate = imported(entry, item);
        const prior = value.citations.find(citation => citation.id === candidate.id);
        if (prior === undefined) {
            value.citations.push(candidate);
            added++;
        }
        else {
            if (JSON.stringify([prior.descriptor, prior.fragmentDigest, prior.retained, prior.origin]) !== JSON.stringify([candidate.descriptor, candidate.fragmentDigest, candidate.retained, candidate.origin]))
                throw new EvidenceError('conflict', 'Existing citation has conflicting source identity or retained bytes', 'Review the current citation and choose another target; imports never overwrite native evidence');
            existing++;
        }
    }
    if (added > 0) {
        value.revision++;
        validateRecord(value, item);
    }
    return { result: parse(bundleImportReceiptSchema, { item, hash: bundle.hash, status: added > 0 ? 'imported' : 'unchanged', added, existing, preview }), ...(added > 0 ? { value } : {}) };
}
/** Validate the entire bundle and authorization before preview or atomic single-target import. */
export async function importBundle(input, authorization, options) {
    const bundle = validateBundle(input);
    const request = parse(bundleAuthorizationSchema, authorization);
    parse(z.boolean().optional(), options.preview);
    const store = new Store(options);
    // Preflight uses the same locked planner as apply, before optional schema registration.
    const preflight = await store.exchange(request.item, async (document, revision) => {
        authorize(request.revision, revision);
        return { result: plan(bundle, document.metadata.evidence_state, document.metadata.id, options.preview === true) };
    });
    if (preflight.value === undefined || options.preview === true)
        return preflight.result;
    await store.register();
    return store.exchange(request.item, async (document, revision) => {
        authorize(request.revision, revision);
        return plan(bundle, document.metadata.evidence_state, document.metadata.id, false);
    });
}
/** Inspect validated metadata only after explicit target authorization; source bytes stay inert and private. */
export async function inspectBundle(input, authorization, options) {
    const bundle = validateBundle(input);
    const request = parse(bundleAuthorizationSchema, authorization);
    const rows = bundle.entries.map(entry => ({ citation: entry.id, source: entry.descriptor.source, provider: entry.descriptor.provider, revision: entry.descriptor.revision, fragmentDigest: entry.fragmentDigest, bytes: Buffer.byteLength(replay({ ...entry, reviews: [] })) }));
    const result = packet(rows, { items: 1, citations: rows.length }, options.budget);
    return new Store(options).exchange(request.item, async (_document, revision) => { authorize(request.revision, revision); return { result }; });
}
//# sourceMappingURL=bundles.js.map