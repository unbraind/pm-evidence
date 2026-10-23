import type { PmClient } from '@unbrained/pm-cli/sdk';

/** Independent availability and exact-byte freshness axes. */
export type Resolution = 'resolved' | 'missing' | 'inaccessible' | 'ambiguous' | 'unsupported';
/** Equality of the selected fragment, independent of whole-source revision. */
export type Freshness = 'current' | 'changed' | 'unknown';
/** Precisely selected text with neighboring bytes used only for exact boundary recovery. */
export interface Anchor { quote: string; before: string; after: string }
/** External-source selectors; paragraph is one-based within an ATX heading section. */
export type Selector = { kind: 'lines'; start: number; end: number } | { kind: 'heading'; heading: string; paragraph: number } | { kind: 'pointer'; pointer: string };
/** Root-relative source descriptor, with no machine-specific root persisted. */
export interface Descriptor { provider: string; source: string; revision: string; selector: Selector; anchor?: Anchor }
/** Explicit human review dispositions do not assert semantic truth. */
export type Disposition = 'still-valid' | 're-anchored' | 'superseded' | 'invalid';
/** Append-only review observation with a deterministic retry identity. */
export interface Observation { id: string; author: string; at: string; disposition: Disposition; reason: string; replacement?: string }
/** Durable citation stored on its native citing item. */
export interface Citation { id: string; descriptor: Descriptor; fragmentDigest: string; retained?: string; provenance: { item: string; author: string; at: string }; reviews: Observation[]; lastCheck?: CheckRow; lastCheckedAt?: string }
/** Compact check result; source text appears only inside explicitly requested data blocks. */
export interface CheckRow { item: string; citation: string; resolution: Resolution; freshness: Freshness; currentResolution: Resolution; oldDigest: string; currentDigest: string | null; sourceChanged: boolean | null; currentRevision: string | null; replay: boolean; diff?: { type: 'source-data'; old?: string[]; current: string[] }; remedy?: string }
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
/** Bounded impact over certified SDK item and relationship reads. */
export interface AffectedOptions extends CheckOptions { changed?: readonly string[]; depth?: number; limit?: number }
/** Review retries preserve the original descriptor; re-anchoring creates a separate citation. */
export interface ReviewOptions extends EvidenceOptions { citation: string; disposition: Disposition; reason: string; expectedRevision?: number; selector?: Selector }
/** Bounded output always distinguishes enumerated scope from omitted rows. */
export interface Packet<T> { rows: T[]; scope: { items: number; citations: number; depth?: number; changed?: readonly string[]; traversalLimit?: number }; receipt: { returned: number; omitted: number; complete: boolean; sourceComplete: boolean; estimator: 'ceil(utf8_bytes/4)' }; estimatedTokens: number }
/** A relationship path explains why a context item requires review. */
export interface Impact { item: string; type: string; evidenceItem: string; citation: string; resolution: Resolution; freshness: Freshness; path: string[] }
/** Versioned package-owned field value, not a replacement core item schema. */
export interface EvidenceState { version: 1; revision: number; citations: Citation[] }
