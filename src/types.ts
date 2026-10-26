import type { PmClient } from '@unbrained/pm-cli/sdk';
import type { EvidenceCode } from './core.ts';
import type { Selector, Disposition, CheckRow, Resolution, Freshness } from './citation-schema.ts';

/** Citation, selector, ancestry and check contracts derive from the shared producer/consumer schema. */
export type { Anchor, Selector, Descriptor, Disposition, Observation, Citation, CheckRow, EvidenceState, Resolution, Freshness } from './citation-schema.ts';
/** Successful bounded adapter read bound to exactly one content revision. */
export interface SourceSnapshot { text: string; revision: string }
/** Caller bounds apply to custom adapters as well as built-in source reads. */
export interface ReadContext { root: string; maxBytes: number; signal: AbortSignal }
/** Pluggable source readers never require git, networks, or a specific tracker backend. */
export interface SourceAdapter { provider: string; read(source: string, context: ReadContext): Promise<SourceSnapshot> }
/** Explicit tracker and caller-selected source root, never inferred from git. */
export interface EvidenceOptions { workspace: string; root?: string; author?: string; client?: PmClient; adapters?: readonly SourceAdapter[]; maxBytes?: number; timeoutMs?: number; signal?: AbortSignal }
/** Cite parameters shared by CLI and in-process consumers. */
export interface CiteOptions extends EvidenceOptions { selector: Selector; provider?: string; retain?: boolean }
/** Bounded checks may request inert fragment differences or historical retained-byte replay. */
export interface CheckOptions extends EvidenceOptions { budget?: number; diff?: boolean; revision?: 'current' | 'cited'; record?: boolean }
/** Invocation-local read attempts, completed citation checks and observation outcomes. */
export interface VerificationReceipt { sourceReads: number; sources: number; checked: number; canceled: boolean; recordedItems: number; skippedItems: number; foreignItems: number; invalidCitations?: number; refusal?: { code: EvidenceCode; remedy: string; field?: string; limit?: number | string; observed?: number | string } }
/** Bounded impact over certified SDK item and relationship reads. */
export interface AffectedOptions extends CheckOptions { changed?: readonly string[]; depth?: number; limit?: number }
/** Review retries preserve the original descriptor; re-anchoring creates a separate citation. */
export interface ReviewOptions extends EvidenceOptions { citation: string; disposition: Disposition; reason: string; expectedRevision?: number; selector?: Selector }
/** Bounded output always distinguishes enumerated scope from omitted rows. */
export interface Packet<T> { rows: T[]; scope: { items: number; citations: number; depth?: number; changed?: readonly string[]; traversalLimit?: number }; receipt: { returned: number; omitted: number; complete: boolean; sourceComplete: boolean; estimator: 'ceil(utf8_bytes/4)'; verification?: VerificationReceipt }; estimatedTokens: number }
/** A relationship path explains why a context item requires review. */
export interface Impact { item: string; type: string; evidenceItem: string; citation: string; resolution: Resolution; freshness: Freshness; path: string[]; code?: EvidenceCode; remedy?: string; citationIndex?: number }
