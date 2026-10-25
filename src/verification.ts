import { PmClient } from '@unbrained/pm-cli/sdk';
import { EvidenceError, requireInput } from './core.ts';
import { snapshot, sourceIdentity } from './sources.ts';
import type { AffectedOptions, Citation, SourceSnapshot, VerificationReceipt } from './types.ts';

/** Bound all verification arrays and counters before enumeration or source access. */
const MAX_ENTRIES = 10_000;
/** Bound retained source bytes across the entire invocation, independently of per-read bounds. */
const MAX_SNAPSHOT_BYTES = 67_108_864;
/** Dense arrays cannot hide invalid operands in holes skipped by Array.every. */
function dense(value: unknown, limit: number): value is unknown[] { return Array.isArray(value) && value.length <= limit && Array.from({ length: value.length }, (_, index) => Object.hasOwn(value, index)).every(Boolean); }
/** Validate finite integers without coercing SDK inputs. */
function integer(value: unknown, min: number, max: number): boolean { return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max; }
/** Bound text operands without reflecting their contents in refusals. */
function text(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 4096 && !/[\u0000-\u001f\u007f-\u009f]/.test(value); }
/** One strict boundary schema shared by SDK verification and CLI dispatch, with no coercion. */
export function verificationInput(items: readonly string[], options: AffectedOptions): void {
  requireInput(dense(items, MAX_ENTRIES) && items.every(text), 'Verification requires at most 10000 dense item IDs');
  requireInput(typeof options === 'object' && options !== null && !Array.isArray(options), 'Verification options must be an object');
  const allowed = new Set(['workspace', 'root', 'author', 'client', 'adapters', 'maxBytes', 'timeoutMs', 'signal', 'budget', 'diff', 'revision', 'record', 'changed', 'depth', 'limit']);
  requireInput(Object.keys(options).every(key => allowed.has(key)) && text(options.workspace), 'Verification options contain unknown fields or an invalid workspace');
  for (const value of [options.root, options.author]) requireInput(value === undefined || text(value), 'Verification root and author must be bounded text');
  for (const [value, min, max] of [[options.maxBytes, 1, 16_777_216], [options.timeoutMs, 1, 60_000], [options.budget, 1, 1_000_000], [options.depth, 0, 16], [options.limit, 1, MAX_ENTRIES]] as const) requireInput(value === undefined || integer(value, min, max), 'Verification numeric bounds are invalid');
  for (const value of [options.diff, options.record]) requireInput(value === undefined || typeof value === 'boolean', 'Verification flags must be booleans');
  requireInput(options.revision === undefined || options.revision === 'current' || options.revision === 'cited', 'Verification revision must be current or cited');
  requireInput(options.signal === undefined || options.signal instanceof AbortSignal, 'Verification signal must be an AbortSignal');
  requireInput(options.client === undefined || options.client instanceof PmClient, 'Verification client must be a native PmClient');
  if (options.changed !== undefined) requireInput(dense(options.changed, MAX_ENTRIES) && options.changed.every(text), 'Changed sources must be a bounded dense text array');
  if (options.adapters !== undefined) {
    requireInput(dense(options.adapters, 64), 'Adapters must be a dense array of at most 64 readers');
    for (const adapter of options.adapters) requireInput(typeof adapter === 'object' && adapter !== null && Object.keys(adapter).every(key => ['provider', 'read'].includes(key)) && text(adapter.provider) && typeof adapter.read === 'function', 'Adapters require only a bounded provider and read function');
    requireInput(new Set(options.adapters.map(adapter => adapter.provider)).size === options.adapters.length, 'Adapter providers must be unique');
  }
}
/** Validate stored citation operands before using their fields or recording observations on them. */
export function verificationCitations(citations: Citation[]): void {
  requireInput(dense(citations, MAX_ENTRIES), 'Citation scope must be dense and bounded');
  requireInput(new Set(citations.map(citation => citation.id)).size === citations.length, 'Citation identities must be unique');
  for (const citation of citations) {
    const descriptor = citation.descriptor; const selector = descriptor?.selector;
    requireInput([citation.id, citation.fragmentDigest, citation.provenance?.item, descriptor?.provider, descriptor?.source, descriptor?.revision].every(text), 'Citation metadata is foreign or malformed');
    requireInput(selector !== undefined && selector !== null, 'Citation selector is missing');
    if (selector.kind === 'lines') requireInput(integer(selector.start, 1, Number.MAX_SAFE_INTEGER) && integer(selector.end, selector.start, Number.MAX_SAFE_INTEGER), 'Citation line range is invalid');
    else if (selector.kind === 'heading') requireInput(text(selector.heading) && integer(selector.paragraph, 1, Number.MAX_SAFE_INTEGER), 'Citation heading is invalid');
    else requireInput(selector.kind === 'pointer' && typeof selector.pointer === 'string' && selector.pointer.length <= 4096, 'Citation pointer is invalid');
    if (descriptor.anchor !== undefined) requireInput([descriptor.anchor?.quote, descriptor.anchor?.before, descriptor.anchor?.after].every(value => typeof value === 'string' && value.length <= 16_777_216), 'Citation anchor is invalid');
    if (descriptor.anchor?.sectionPath !== undefined) requireInput(dense(descriptor.anchor.sectionPath, 16) && descriptor.anchor.sectionPath.every(text), 'Citation heading ancestry is invalid');
    if (citation.retained !== undefined) requireInput(typeof citation.retained === 'string' && citation.retained.length <= 22_369_624, 'Citation retained bytes are invalid');
  }
}
/** Share successes and refusals for exactly one invocation and one caller-selected authority. */
export class Verification {
  /** Snapshot promises own copied immutable data, never adapter-owned mutable objects. */
  readonly reads = new Map<string, Promise<SourceSnapshot>>();
  /** Always included before output budgeting; no source text appears here. */
  readonly receipt: VerificationReceipt = { sourceReads: 0, sources: 0, checked: 0, canceled: false, recordedItems: 0, skippedItems: 0, foreignItems: 0 };
  /** Frozen caller configuration prevents mid-check changes of source authority. */
  readonly options: AffectedOptions;
  /** Total bytes retained by successful source reads. */
  private bytes = 0;
  /** Capture one invocation's adapters and limits; callers validate at their public boundary. */
  constructor(options: AffectedOptions) { this.options = Object.freeze({ ...options, changed: options.changed === undefined ? undefined : Object.freeze([...options.changed]), adapters: options.adapters === undefined ? undefined : Object.freeze(options.adapters.map(adapter => Object.freeze({ provider: adapter.provider, read: adapter.read.bind(adapter) }))) }); }
  /** Cancellation is sticky even when the signal fires after the final read. */
  canceled(): boolean { this.receipt.canceled ||= this.options.signal?.aborted === true; return this.receipt.canceled; }
  /** Resolve every selector against the same provider/source bytes, including across cited revisions. */
  async read(provider: string, source: string): Promise<SourceSnapshot> {
    if (this.canceled()) throw new EvidenceError('canceled', 'Verification was canceled', 'Retry the check with a live signal; this receipt is incomplete');
    const identity = sourceIdentity(source); const key = JSON.stringify([provider, identity]);
    let read = this.reads.get(key);
    if (read === undefined) {
      if (this.reads.size >= MAX_ENTRIES) throw new EvidenceError('size', 'Verification source limit reached', 'Split the check into batches of at most 10000 sources');
      this.receipt.sources++;
      read = this.load(provider, identity); this.reads.set(key, read);
    }
    return read;
  }
  /** Count guarded snapshot attempts, copying successful reads before an adapter can mutate them. */
  private async load(provider: string, source: string): Promise<SourceSnapshot> {
    if (this.bytes >= MAX_SNAPSHOT_BYTES) throw new EvidenceError('size', 'Verification snapshot byte limit reached', 'Split the check into batches retaining less than 64 MiB of source bytes');
    this.receipt.sourceReads++;
    const read = await snapshot(provider, source, this.options); const size = Buffer.byteLength(read.text);
    if (this.bytes + size > MAX_SNAPSHOT_BYTES) throw new EvidenceError('size', 'Verification snapshot byte limit reached', 'Split the check into batches retaining less than 64 MiB of source bytes');
    this.bytes += size;
    return Object.freeze({ text: read.text, revision: read.revision });
  }
  /** Verify all emitted counters before returning a successful packet. */
  finish(): VerificationReceipt {
    this.canceled();
    requireInput(Object.entries(this.receipt).every(([key, value]) => key === 'canceled' ? typeof value === 'boolean' : integer(value, 0, MAX_ENTRIES)) && this.receipt.sourceReads <= this.receipt.sources, 'Verification produced invalid counters');
    const refusal: VerificationReceipt['refusal'] = this.receipt.canceled ? { code: 'canceled', remedy: 'Retry the incomplete check with a live signal' } : this.receipt.foreignItems > 0 ? { code: 'schema', remedy: 'Foreign or malformed evidence was skipped; inspect its owner and schema before retrying' } : this.receipt.skippedItems > 0 ? { code: 'conflict', remedy: 'Evidence changed before recording; re-read the current target and retry the skipped observations' } : undefined;
    return { ...this.receipt, ...(refusal === undefined ? {} : { refusal }) };
  }
}
