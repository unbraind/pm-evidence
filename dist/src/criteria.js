import { applyHistoryPatch, getHistoryPath, readHistoryEntries, splitAcceptanceCriteria, verifyHistoryEntries } from '@unbrained/pm-cli/sdk';
import { z } from 'zod';
import { boundedArray, citationSchema, criterionRefSchema, envelope, parseCitation } from './citation-schema.js';
import { digest, EVIDENCE_CODES, EvidenceError, packet, requireInput } from './core.js';
import { checkCitation } from './evidence.js';
import { citationById, Store } from './store.js';
import { Verification, verificationInput } from './verification.js';
/** One strict request schema, shared by SDK binding and the CLI. */
export const criterionBindingSchema = z.strictObject({ item: z.string().min(1).max(4096), citation: citationSchema.shape.id, criterion: criterionRefSchema });
/** Source support is a byte-level fact; none of these states asserts criterion truth. */
export const criterionFactSchema = z.strictObject({ item: z.string().max(4096), criterion: z.string().max(65_536), revision: criterionRefSchema.shape.revision.nullable(), boundRevision: criterionRefSchema.shape.revision.nullable(), citation: citationSchema.shape.id.nullable(), support: z.enum(['current-source', 'lost-source', 'criterion-changed', 'ambiguous-criterion', 'unbound', 'unknown']), resolution: z.enum(['resolved', 'missing', 'inaccessible', 'ambiguous', 'unsupported']).nullable(), freshness: z.enum(['current', 'changed', 'unknown']).nullable(), truthAssessed: z.literal(false), code: z.enum(EVIDENCE_CODES).optional(), remedy: z.string().optional(), citationIndex: z.number().int().min(1).max(10_000).optional() });
/** Replay verified SDK history; surviving unique text retains identity through unrelated edits. */
async function generations(store, item) {
    const history = await readHistoryEntries(getHistoryPath(store.options.workspace, item.id), item.id);
    if (history.length === 0 || history.length > 10_000 || !verifyHistoryEntries(history).ok)
        throw new EvidenceError('integrity', 'Criterion history is unavailable or unverifiable', 'Restore verified SDK history with at most 10000 entries before binding criteria');
    let document = { metadata: {}, body: '' };
    let prior = new Map();
    for (const [index, entry] of history.entries()) {
        document = applyHistoryPatch(document, entry.patch, index + 1, entry.op);
        const text = document.metadata.acceptance_criteria;
        const criteria = splitAcceptanceCriteria(typeof text === 'string' ? text : undefined);
        const counts = new Map();
        for (const criterion of criteria)
            counts.set(criterion, (counts.get(criterion) ?? 0) + 1);
        const current = new Map();
        for (const [criterion, count] of counts) {
            const previous = prior.get(criterion);
            current.set(criterion, { text: criterion, count, revision: previous?.count === 1 && count === 1 ? previous.revision : digest(JSON.stringify([item.id, index, entry.record_hash, entry.after_hash, criterion, count])) });
        }
        prior = current;
    }
    if (document.metadata.acceptance_criteria !== item.acceptance_criteria)
        throw new EvidenceError('conflict', 'Criterion changed during history read', 'Read criteria again and bind its current revision');
    const parsed = boundedArray(criterionRefSchema.extend({ count: z.number().int().min(1).max(10_000) }), 10_000).safeParse([...prior.values()]);
    if (!parsed.success)
        throw new EvidenceError('size', 'Criteria exceed adapter bounds', 'Use at most 10000 criteria with at most 65536 characters each');
    return parsed.data;
}
/** Validate a criterion against verified current history, including when called inside the writer lease. */
async function currentCriterion(store, item, ref) {
    const current = (await generations(store, item)).find(entry => entry.text === ref.text);
    if (current?.count !== 1 || current.revision !== ref.revision)
        throw new EvidenceError('conflict', 'Criterion revision is absent, changed or ambiguous', 'Read evidence criteria and select a current unique criterion revision');
    return current;
}
/** Persist an exact binding through native revision CAS; retries inspect fresh SDK state. */
export async function bindCriterion(input, options) {
    const parsed = criterionBindingSchema.safeParse(input);
    if (!parsed.success)
        throw new EvidenceError('invalid', 'Invalid criterion binding', 'Supply item, citation and an exact text/revision pair from evidence criteria');
    verificationInput([], options);
    const request = parsed.data;
    const store = new Store(options);
    const canonical = (await store.get(request.item)).item.id;
    await store.mutate(canonical, async (value, item) => {
        const current = await currentCriterion(store, item, request.criterion);
        const citation = citationById(value.citations, request.citation);
        if (citation.criteria?.some(entry => entry.text === current.text && entry.revision === current.revision))
            return undefined;
        citation.criteria = [...citation.criteria ?? [], request.criterion];
        return { value: true, observation: `evidence bind ${citation.id} ${current.revision}` };
    }, undefined, undefined, async (item) => { await currentCriterion(store, item, request.criterion); });
    const saved = await store.get(canonical);
    const latest = (await generations(store, saved.item)).find(entry => entry.text === request.criterion.text);
    if (latest?.count !== 1 || latest.revision !== request.criterion.revision)
        throw new EvidenceError('conflict', 'Criterion changed before binding completed', 'Read current criteria before retrying the binding');
    return { ...request, item: canonical };
}
/** A blank fact reports an unbound criterion without claiming source availability. */
function fact(item, criterion, revision) {
    return { item, criterion, revision, boundRevision: null, citation: null, support: 'unbound', resolution: null, freshness: null, truthAssessed: false };
}
/** Validate emitted adapter rows through the same exported schema consumers use. */
function append(rows, value) {
    if (rows.length >= 10_000)
        throw new EvidenceError('size', 'Criterion facts exceed adapter bounds', 'Split the request into batches with at most 10000 criterion facts');
    rows.push(criterionFactSchema.parse(value));
}
/** Map a bound citation check into independent criterion and source freshness facts. */
function boundFact(item, binding, current, row) {
    const support = current !== undefined && current.count !== 1 ? 'ambiguous-criterion' : current === undefined || current.revision !== binding.revision ? 'criterion-changed' : row.resolution === 'resolved' && row.freshness === 'current' ? 'current-source' : 'lost-source';
    return { ...fact(item, binding.text, current?.revision ?? null), boundRevision: binding.revision, citation: row.citation, support, resolution: row.resolution, freshness: row.freshness, ...(row.code === undefined ? {} : { code: row.code, remedy: row.remedy }) };
}
/** Read-only criterion-to-citation adapter; no witness judgment, packing or status inference. */
export async function criterionFacts(items, options) {
    verificationInput(items, options);
    requireInput(options.record !== true && options.revision !== 'cited' && options.diff !== true, 'Criterion facts require read-only current verification without diffs');
    const store = new Store(options);
    const verification = new Verification(options);
    const rows = [];
    let targets;
    try {
        targets = items.length === 0 ? await store.all() : await Promise.all([...new Set(items)].map(async (id) => (await store.getRaw(id)).item));
    }
    catch {
        throw new EvidenceError('sdk', 'Criterion targets could not be read', 'Check target IDs and tracker health before retrying criterion facts');
    }
    requireInput(targets.length <= 10_000, 'Criterion target limit exceeded');
    let citations = 0;
    let complete = true;
    for (const target of targets) {
        const item = structuredClone(target);
        const start = rows.length;
        let current;
        try {
            current = await generations(store, item);
        }
        catch (error) {
            const refusal = error instanceof EvidenceError ? error : new EvidenceError('integrity', 'SDK history could not be replayed', 'Restore readable verified history before retrying criterion facts');
            append(rows, { ...fact(item.id, '', null), support: 'unknown', code: refusal.code, remedy: refusal.remedy });
            complete = false;
            continue;
        }
        const bound = new Set();
        try {
            const value = envelope(item.evidence_state);
            const seen = new Set();
            for (const [index, input] of value.citations.entries()) {
                requireInput(++citations <= 10_000, 'Criterion citation limit exceeded');
                let citation;
                try {
                    citation = parseCitation(input, item.id);
                    if (seen.has(citation.id))
                        throw new EvidenceError('schema', 'Duplicate citation', 'Restore unique citation identities');
                    seen.add(citation.id);
                }
                catch {
                    append(rows, { ...fact(item.id, '', null), support: 'unknown', code: 'schema', remedy: 'Restore the malformed citation identified by citationIndex', citationIndex: index + 1 });
                    complete = false;
                    continue;
                }
                if (citation.criteria === undefined || citation.criteria.length === 0)
                    continue;
                const check = await checkCitation(citation, options, verification);
                verification.receipt.checked++;
                for (const binding of citation.criteria) {
                    const generation = current.find(entry => entry.text === binding.text);
                    if (generation?.revision === binding.revision)
                        bound.add(binding.text);
                    const row = boundFact(item.id, binding, generation, check);
                    append(rows, row);
                    if (row.support !== 'current-source')
                        complete = false;
                }
            }
        }
        catch (error) {
            if (!(error instanceof EvidenceError) || error.code !== 'schema')
                throw error;
            verification.receipt.foreignItems++;
            complete = false;
            append(rows, { ...fact(item.id, '', null), support: 'unknown', code: 'schema', remedy: 'Foreign evidence envelope was preserved; inspect its owner and schema' });
        }
        for (const entry of current)
            if (!bound.has(entry.text))
                append(rows, { ...fact(item.id, entry.text, entry.revision), ...(entry.count === 1 ? {} : { support: 'ambiguous-criterion' }) });
        const latest = (await store.getRaw(item.id)).item;
        const latestCriteria = await generations(store, latest);
        if (latest.evidence_state !== item.evidence_state || JSON.stringify(latestCriteria) !== JSON.stringify(current)) {
            complete = false;
            for (const row of rows.slice(start))
                Object.assign(row, { support: 'unknown', code: 'conflict', remedy: 'Tracker changed during verification; read current criteria again' });
        }
    }
    return packet(rows.map(row => criterionFactSchema.parse(row)), { items: targets.length, citations }, options.budget, complete && !verification.canceled(), verification.finish());
}
//# sourceMappingURL=criteria.js.map