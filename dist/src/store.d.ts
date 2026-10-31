import { PmClient } from '@unbrained/pm-cli/sdk';
import type { GetResult, ItemDocument, PmCompleteListResult } from '@unbrained/pm-cli/sdk';
import type { SchemaFieldDefinition } from '@unbrained/pm-cli/sdk/authoring';
import type { Citation, CheckRow, EvidenceOptions, EvidenceState } from './types.ts';
import type { EvidenceEnvelope } from './citation-schema.ts';
/** Synchronous and asynchronous producers share one fresh native-target callback contract. */
type MutationAction<T, S> = (value: S, item: GetResult['item']) => {
    value: T;
    observation: string;
} | undefined | Promise<{
    value: T;
    observation: string;
} | undefined>;
/** Domain preconditions run under the same SDK item lease as the evidence write. */
export type EvidenceGuard = (item: Pick<GetResult['item'], 'id' | 'acceptance_criteria'>) => Promise<void>;
/** A locked exchange computes its result from current native state, with an optional evidence write. */
export interface EvidenceExchange<T> {
    result: T;
    value?: EvidenceState;
    observation?: string;
}
/** Registered scalar JSON envelope keeps evidence on native items with SDK history. */
export declare const FIELDS: SchemaFieldDefinition[];
/** Missing fields have a valid first revision without bootstrapping item writes. */
export declare function state(raw: unknown, owner?: string): EvidenceState;
/** SDK-only storage, schema, settings and lock-held compare-and-swap operations. */
export declare class Store {
    /** Caller-owned SDK clients support host backends without storage assumptions on reads. */
    readonly client: PmClient;
    /** Bind an explicit tracker, attribution and optional active host dispatcher. */
    readonly options: EvidenceOptions;
    /** Bind the explicit workspace and SDK client. */
    constructor(options: EvidenceOptions);
    /** Resolve attribution through the canonical SDK precedence and workspace settings. */
    author(): Promise<string>;
    /** Apply schema through the SDK; a conflicting type fails closed. */
    register(): Promise<void>;
    /** Certify the full item corpus rather than infer completeness from a bounded list. */
    all(): Promise<PmCompleteListResult['items']>;
    /** Read exact current item metadata and native revision envelope. */
    get(id: string): Promise<{
        item: GetResult['item'];
        value: EvidenceState;
        raw: unknown;
    }>;
    /** Native target read without interpreting individual citation entries. */
    getRaw(id: string): Promise<{
        item: GetResult['item'];
        raw: unknown;
    }>;
    /** Read, authorize and optionally change evidence inside one SDK lease, including no-op retries. */
    exchange<T>(id: string, action: (document: ItemDocument, revision: string) => Promise<EvidenceExchange<T>>): Promise<T>;
    /** Compare exact evidence and validate domain preconditions inside the SDK's fenced item mutation. */
    commit(id: string, raw: unknown, value: EvidenceEnvelope, observation: string, _expectedUpdatedAt?: string, guard?: EvidenceGuard): Promise<void>;
    /** Retry a bounded CAS mutation against fresh state, retaining other writers' records. */
    mutate<T>(id: string, action: MutationAction<T, EvidenceState>, expectedRevision?: number, expectedRaw?: unknown, guard?: EvidenceGuard): Promise<T | undefined>;
    /** Build compact observations without accepting malformed sibling records for persistence. */
    observe(id: string, rows: readonly CheckRow[], expectedRevision: number, expectedRaw: unknown, canceled: () => boolean): Promise<boolean | undefined>;
    /** Reuse one native CAS/retry path for strict producers and per-entry observation recording. */
    private mutateValue;
}
/** Stable citation lookup refuses absent identities without returning unrelated item data. */
export declare function citationById(citations: Citation[], id: string): Citation;
export {};
//# sourceMappingURL=store.d.ts.map