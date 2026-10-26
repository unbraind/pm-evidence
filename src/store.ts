import { certifyCompleteListResult, commitItemMutations, getHistoryPath, PmClient, readHistoryEntries, readSettings, selectImportAuthor, verifyHistoryEntries } from '@unbrained/pm-cli/sdk';
import type { GetResult, PmCompleteListResult } from '@unbrained/pm-cli/sdk';
import type { SchemaFieldDefinition } from '@unbrained/pm-cli/sdk/authoring';
import type { Citation, CheckRow, EvidenceOptions, EvidenceState } from './types.ts';
import { digest, EvidenceError } from './core.ts';
import { citationSchema, envelope, envelopeSchema, stateSchema } from './citation-schema.ts';
import type { EvidenceEnvelope } from './citation-schema.ts';

/** Registered scalar JSON envelope keeps evidence on native items with SDK history. */
export const FIELDS: SchemaFieldDefinition[] = [{ name: 'evidence_state', type: 'string', optional: true }];
/** Missing fields have a valid first revision without bootstrapping item writes. */
export function state(raw: unknown): EvidenceState {
  try { return stateSchema.parse(envelope(raw)); }
  catch { throw new EvidenceError('schema', 'Evidence field is malformed', 'Restore a valid registered evidence_state value through pm'); }
}
/** SDK-only storage, schema, settings and lock-held compare-and-swap operations. */
export class Store {
  /** Caller-owned SDK clients support host backends without storage assumptions on reads. */
  readonly client: PmClient;
  /** Bind an explicit tracker, attribution and optional active host dispatcher. */
  readonly options: EvidenceOptions;
  /** Bind the explicit workspace and SDK client. */
  constructor(options: EvidenceOptions) { this.options = options; this.client = options.client ?? new PmClient({ pmRoot: options.workspace, author: options.author, noExtensions: true }); }
  /** Resolve attribution through the canonical SDK precedence and workspace settings. */
  async author(): Promise<string> { return selectImportAuthor(this.options.author, (await readSettings(this.options.workspace)).author_default); }
  /** Apply schema through the SDK; a conflicting type fails closed. */
  async register(): Promise<void> {
    await readSettings(this.options.workspace);
    const fields = (await this.client.schemaListFields()).fields;
    const field = fields.find(entry => entry.key === 'evidence_state');
    if (field === undefined) await this.client.schemaAddField('evidence_state', { type: 'string', description: 'pm-evidence versioned citation records', author: await this.author() });
    else if (field.type !== 'string') throw new EvidenceError('schema', 'Evidence field has an incompatible type', 'Restore evidence_state as a registered string field');
  }
  /** Certify the full item corpus rather than infer completeness from a bounded list. */
  async all(): Promise<PmCompleteListResult['items']> { return certifyCompleteListResult(await this.client.listAllComplete({ includeBody: false })).items; }
  /** Read exact current item metadata and native revision envelope. */
  async get(id: string): Promise<{ item: GetResult['item']; value: EvidenceState; raw: unknown }> { const current = await this.getRaw(id); return { ...current, value: state(current.raw) }; }
  /** Native target read without interpreting individual citation entries. */
  async getRaw(id: string): Promise<{ item: GetResult['item']; raw: unknown }> { const item = (await this.client.get(id, { full: true })).item; return { item, raw: item.evidence_state }; }
  /** Commit with a lock-held SDK field precondition; no raw tracker file writes. */
  async commit(id: string, raw: unknown, value: EvidenceEnvelope, observation: string, expectedUpdatedAt?: string): Promise<void> {
    const verification = verifyHistoryEntries(await readHistoryEntries(getHistoryPath(this.options.workspace, id), id));
    if (!verification.ok) throw new EvidenceError('integrity', 'Evidence history integrity verification failed', 'Check pm health and restore verified history before retrying');
    const encoded = JSON.stringify(envelopeSchema.parse(value));
    const owned = value.citations.flatMap(entry => { const result = citationSchema.safeParse(entry); return result.success && result.data.provenance.item === id ? [result.data] : []; });
    const files = [...new Set(owned.filter(entry => ['file', 'json'].includes(entry.descriptor.provider)).map(entry => entry.descriptor.source))].map(source => `path: ${source}\nscope: project\nnote: pm-evidence source identity relative to caller-selected root`);
    await commitItemMutations({ pmRoot: this.options.workspace, author: await this.author(), transactionId: `evidence-${digest(JSON.stringify([id, expectedUpdatedAt, raw, encoded, observation]))}`, lockWaitMs: 10_000, mutations: [{ op: 'update', id, match: raw === undefined ? { key: 'updated_at', value: expectedUpdatedAt } : { key: 'evidence_state', value: raw }, options: { evidenceState: encoded, file: files, comment: [observation] } }] });
  }
  /** Retry a bounded CAS mutation against fresh state, retaining other writers' records. */
  async mutate<T>(id: string, action: (value: EvidenceState) => { value: T; observation: string } | undefined, expectedRevision?: number, expectedRaw?: unknown): Promise<T | undefined> {
    return this.mutateValue(id, state, action, expectedRevision, expectedRaw);
  }
  /** Record only successfully validated entries; malformed sibling records remain untouched. */
  async observe(id: string, rows: readonly CheckRow[], expectedRevision: number, expectedRaw: unknown, canceled: () => boolean): Promise<boolean | undefined> {
    return this.mutateValue(id, envelope, value => {
      if (canceled() || rows.every(row => row.code === 'schema')) return undefined;
      for (const [index, row] of rows.entries()) {
        if (row.code === 'schema') continue;
        value.citations[index] = { ...citationSchema.parse(value.citations[index]), lastCheck: { ...row, diff: undefined }, lastCheckedAt: new Date().toISOString() };
      }
      return { value: true, observation: 'evidence check: compact status observation' };
    }, expectedRevision, expectedRaw);
  }
  /** Reuse one native CAS/retry path for strict producers and per-entry observation recording. */
  private async mutateValue<T, S extends EvidenceEnvelope>(id: string, parse: (raw: unknown) => S, action: (value: S) => { value: T; observation: string } | undefined, expectedRevision?: number, expectedRaw?: unknown): Promise<T | undefined> {
    await this.register();
    for (let attempt = 0; attempt < 8; attempt++) {
      const target = await this.getRaw(id); const current = { ...target, value: parse(target.raw) };
      if ((expectedRevision !== undefined && expectedRevision !== current.value.revision) || (expectedRaw !== undefined && expectedRaw !== current.raw)) throw new EvidenceError('conflict', 'Expected evidence revision changed', 'Read evidence show and retry with its current revision');
      const change = action(current.value); if (change === undefined) return undefined;
      current.value.revision++;
      try { await this.commit(current.item.id, current.raw, current.value, change.observation, current.item.updated_at); return change.value; }
      catch (error) { if (error instanceof EvidenceError) throw error; if (!String(error).includes('upsert_match_changed') && !String(error).includes('no longer carries upsert key')) throw new EvidenceError('sdk', 'SDK evidence mutation failed', 'Check pm health and retry the observation'); }
    }
    throw new EvidenceError('conflict', 'Concurrent evidence writers exhausted retries', 'Retry after competing writes complete');
  }
}
/** Stable citation lookup refuses absent identities without returning unrelated item data. */
export function citationById(citations: Citation[], id: string): Citation { const citation = citations.find(entry => entry.id === id); if (citation === undefined) throw new EvidenceError('missing', 'Citation does not exist on this item', 'Use evidence show to choose an existing citation'); return citation; }
