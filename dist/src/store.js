import { artifactKey, certifyCompleteListResult, dedupeLinkedArtifacts, getHistoryPath, mutateItem, nowIso, parseAnnotationTextInput, PmClient, readHistoryEntries, readSettings, selectImportAuthor, verifyHistoryEntries } from '@unbrained/pm-cli/sdk';
import { digest, EvidenceError } from './core.js';
import { parseCitation, envelope, validateRecord } from './citation-schema.js';
/** One SDK-owned native metadata projection for both conditional and locked evidence writes. */
function writeEvidence(document, value, observation, author) {
    const owned = new Set((document.metadata.files ?? []).map(artifactKey));
    const files = [...new Set(value.citations.filter(entry => ['file', 'json'].includes(entry.descriptor.provider)).map(entry => entry.descriptor.source))].map(source => ({ path: source, scope: 'project', note: 'pm-evidence source identity relative to caller-selected root' })).filter(file => !owned.has(artifactKey(file)));
    Object.assign(document.metadata, { evidence_state: JSON.stringify(value), ...(files.length > 0 ? { files: [...document.metadata.files ?? [], ...dedupeLinkedArtifacts(files)] } : {}), comments: [...document.metadata.comments ?? [], { text: parseAnnotationTextInput(observation), author, created_at: nowIso() }] });
    return ['evidence_state', 'comments', ...(files.length > 0 ? ['files'] : [])];
}
/** Use a monotone native stream generation and verify the locked materialized document. */
async function nativeRevision(workspace, document) {
    try {
        const history = await readHistoryEntries(getHistoryPath(workspace, document.metadata.id), document.metadata.id);
        if (history.length > 0 && verifyHistoryEntries(history, document).ok)
            return digest(JSON.stringify([history.length, history.at(-1).record_hash, history.at(-1).after_hash]));
    }
    catch { /* Convert SDK parser diagnostics to the package's safe typed refusal below. */ }
    throw new EvidenceError('integrity', 'Evidence history integrity verification failed', 'Check pm health and restore verified history before retrying');
}
/** Registered scalar JSON envelope keeps evidence on native items with SDK history. */
export const FIELDS = [{ name: 'evidence_state', type: 'string', optional: true }];
/** Missing fields have a valid first revision without bootstrapping item writes. */
export function state(raw, owner) {
    return validateRecord(envelope(raw), owner);
}
/** SDK-only storage, schema, settings and lock-held compare-and-swap operations. */
export class Store {
    /** Caller-owned SDK clients support host backends without storage assumptions on reads. */
    client;
    /** Bind an explicit tracker, attribution and optional active host dispatcher. */
    options;
    /** Bind the explicit workspace and SDK client. */
    constructor(options) { this.options = options; this.client = options.client ?? new PmClient({ pmRoot: options.workspace, author: options.author, noExtensions: true }); }
    /** Resolve attribution through the canonical SDK precedence and workspace settings. */
    async author() { return selectImportAuthor(this.options.author, (await readSettings(this.options.workspace)).author_default); }
    /** Apply schema through the SDK; a conflicting type fails closed. */
    async register() {
        await readSettings(this.options.workspace);
        const fields = (await this.client.schemaListFields()).fields;
        const field = fields.find(entry => entry.key === 'evidence_state');
        if (field === undefined)
            await this.client.schemaAddField('evidence_state', { type: 'string', description: 'pm-evidence versioned citation records', author: await this.author() });
        else if (field.type !== 'string')
            throw new EvidenceError('schema', 'Evidence field has an incompatible type', 'Restore evidence_state as a registered string field');
    }
    /** Certify the full item corpus rather than infer completeness from a bounded list. */
    async all() { return certifyCompleteListResult(await this.client.listAllComplete({ includeBody: false })).items; }
    /** Read exact current item metadata and native revision envelope. */
    async get(id) { const current = await this.getRaw(id); return { ...current, value: state(current.raw, current.item.id) }; }
    /** Native target read without interpreting individual citation entries. */
    async getRaw(id) { const item = (await this.client.get(id, { full: true })).item; return { item, raw: item.evidence_state }; }
    /** Read, authorize and optionally change evidence inside one SDK lease, including no-op retries. */
    async exchange(id, action) {
        const settings = await readSettings(this.options.workspace);
        const author = await this.author();
        const result = [];
        try {
            await mutateItem({ pmRoot: this.options.workspace, settings: { ...settings, locks: { ...settings.locks, wait_ms: 10_000 } }, id, op: 'update', author, skipNoop: true, mutate: async (document) => {
                    const revision = await nativeRevision(this.options.workspace, document);
                    const change = await action(document, revision);
                    result.push(change.result);
                    return { changedFields: change.value === undefined ? [] : writeEvidence(document, validateRecord(change.value, document.metadata.id), change.observation ?? 'evidence bundle import', author) };
                } });
        }
        catch (error) {
            if (error instanceof EvidenceError)
                throw error;
            throw new EvidenceError('sdk', 'Native bundle exchange failed', 'Check target identity, permissions and tracker health before retrying');
        }
        return result[0];
    }
    /** Compare exact evidence and validate domain preconditions inside the SDK's fenced item mutation. */
    async commit(id, raw, value, observation, _expectedUpdatedAt, guard) {
        const validated = validateRecord(value, id);
        const settings = await readSettings(this.options.workspace);
        const author = await this.author();
        await mutateItem({ pmRoot: this.options.workspace, settings: { ...settings, locks: { ...settings.locks, wait_ms: 10_000 } }, id, op: 'update', author, message: observation, mutate: async (document) => {
                if (document.metadata.evidence_state !== raw)
                    throw new Error('Target no longer carries upsert key evidence_state');
                const verification = verifyHistoryEntries(await readHistoryEntries(getHistoryPath(this.options.workspace, id), id), document);
                if (!verification.ok)
                    throw new EvidenceError('integrity', 'Evidence history integrity verification failed', 'Check pm health and restore verified history before retrying');
                await guard?.(document.metadata);
                return { changedFields: writeEvidence(document, validated, observation, author) };
            } });
    }
    /** Retry a bounded CAS mutation against fresh state, retaining other writers' records. */
    async mutate(id, action, expectedRevision, expectedRaw, guard) {
        return this.mutateValue(id, raw => state(raw, id), action, expectedRevision, expectedRaw, guard);
    }
    /** Build compact observations without accepting malformed sibling records for persistence. */
    async observe(id, rows, expectedRevision, expectedRaw, canceled) {
        return this.mutateValue(id, envelope, value => {
            if (canceled() || rows.every(row => row.code === 'schema'))
                return undefined;
            for (const [index, row] of rows.entries()) {
                if (row.code === 'schema')
                    continue;
                value.citations[index] = { ...parseCitation(value.citations[index], id), lastCheck: { ...row, diff: undefined }, lastCheckedAt: new Date().toISOString() };
            }
            return { value: true, observation: 'evidence check: compact status observation' };
        }, expectedRevision, expectedRaw);
    }
    /** Reuse one native CAS/retry path for strict producers and per-entry observation recording. */
    async mutateValue(id, parse, action, expectedRevision, expectedRaw, guard) {
        let registered = false;
        for (let attempt = 0; attempt < 8; attempt++) {
            const target = await this.getRaw(id);
            const current = { ...target, value: parse(target.raw) };
            if ((expectedRevision !== undefined && expectedRevision !== current.value.revision) || (expectedRaw !== undefined && expectedRaw !== current.raw))
                throw new EvidenceError('conflict', 'Expected evidence revision changed', 'Read evidence show and retry with its current revision');
            const change = await action(current.value, current.item);
            if (change === undefined)
                return undefined;
            current.value.revision++;
            validateRecord(current.value, current.item.id);
            if (!registered) {
                await this.register();
                registered = true;
                continue;
            }
            try {
                await this.commit(current.item.id, current.raw, current.value, change.observation, current.item.updated_at, guard);
                return change.value;
            }
            catch (error) {
                if (error instanceof EvidenceError)
                    throw error;
                if (!String(error).includes('upsert_match_changed') && !String(error).includes('no longer carries upsert key'))
                    throw new EvidenceError('sdk', 'SDK evidence mutation failed', 'Check pm health and retry the observation');
            }
        }
        throw new EvidenceError('conflict', 'Concurrent evidence writers exhausted retries', 'Retry after competing writes complete');
    }
}
/** Stable citation lookup refuses absent identities without returning unrelated item data. */
export function citationById(citations, id) { const citation = citations.find(entry => entry.id === id); if (citation === undefined)
    throw new EvidenceError('missing', 'Citation does not exist on this item', 'Use evidence show to choose an existing citation'); return citation; }
//# sourceMappingURL=store.js.map