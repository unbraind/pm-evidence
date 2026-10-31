import { Verification } from './verification.ts';
import type { AffectedOptions, CheckOptions, CheckRow, Citation, CiteOptions, EvidenceOptions, Impact, ReviewOptions } from './types.ts';
/** Record exact evidence on an existing item; retries do not duplicate citations. */
export declare function cite(item: string, source: string, options: CiteOptions): Promise<{
    item: string;
    citation: string;
    fragmentDigest: string;
    revision: string;
}>;
/** Verify retained original bytes instead of reconstructing missing history. */
export declare function replay(citation: Citation): string;
/** Resolve one citation against current bytes, independently checking pinned replay availability. */
export declare function checkCitation(input: unknown, options: CheckOptions, verification?: Verification, context?: {
    item: string;
    index: number;
    seen: Set<string>;
}): Promise<CheckRow>;
/** Check selected items or the certified full corpus, persisting compact last-check observations. */
export declare function check(items: readonly string[] | undefined, options: CheckOptions): Promise<import("./types.ts").Packet<{
    item: string;
    citation: string;
    resolution: "ambiguous" | "inaccessible" | "missing" | "resolved" | "unsupported";
    freshness: "changed" | "current" | "unknown";
    currentResolution: "ambiguous" | "inaccessible" | "missing" | "resolved" | "unsupported";
    oldDigest: string;
    currentDigest: string | null;
    sourceChanged: boolean | null;
    currentRevision: string | null;
    replay: boolean;
    diff?: {
        type: "source-data";
        old?: string[] | undefined;
        current: string[];
    } | undefined;
    code?: "ambiguous" | "boundary" | "budget" | "canceled" | "conflict" | "inaccessible" | "integrity" | "invalid" | "missing" | "race" | "schema" | "sdk" | "size" | "timeout" | "unsupported" | undefined;
    remedy?: string | undefined;
    citationIndex?: number | undefined;
}>>;
/** Traverse SDK relationships from changed evidence with explicit depth and output receipts. */
export declare function affected(options: AffectedOptions): Promise<import("./types.ts").Packet<Impact>>;
/** Append an idempotent review through lock-held expected-state mutation, preserving original evidence. */
export declare function review(item: string, options: ReviewOptions): Promise<{
    item: string;
    citation: string;
    observation: string;
    replacement?: string | undefined;
}>;
/** Return citation metadata and last checks; anchors and retained bytes stay out of routine output. */
export declare function show(item: string, options: EvidenceOptions): Promise<{
    item: string;
    revision: number;
    citations: {
        id: string;
        provider: string;
        source: string;
        sourceRevision: string;
        selector: {
            kind: "lines";
            start: number;
            end: number;
        } | {
            kind: "heading";
            heading: string;
            paragraph: number;
        } | {
            kind: "pointer";
            pointer: string;
        };
        fragmentDigest: string;
        retained: boolean;
        provenance: {
            item: string;
            author: string;
            at: string;
        };
        exportConsent: "granted" | "revoked" | undefined;
        origin: {
            item: string;
            citation: string;
            author: string;
            at: string;
        } | undefined;
        reviews: {
            id: string;
            author: string;
            at: string;
            disposition: "invalid" | "re-anchored" | "still-valid" | "superseded";
            reason: string;
            replacement?: string | undefined;
        }[];
        lastCheck: {
            item: string;
            citation: string;
            resolution: "ambiguous" | "inaccessible" | "missing" | "resolved" | "unsupported";
            freshness: "changed" | "current" | "unknown";
            currentResolution: "ambiguous" | "inaccessible" | "missing" | "resolved" | "unsupported";
            oldDigest: string;
            currentDigest: string | null;
            sourceChanged: boolean | null;
            currentRevision: string | null;
            replay: boolean;
            diff?: {
                type: "source-data";
                old?: string[] | undefined;
                current: string[];
            } | undefined;
            code?: "ambiguous" | "boundary" | "budget" | "canceled" | "conflict" | "inaccessible" | "integrity" | "invalid" | "missing" | "race" | "schema" | "sdk" | "size" | "timeout" | "unsupported" | undefined;
            remedy?: string | undefined;
            citationIndex?: number | undefined;
        } | undefined;
        lastCheckedAt: string | undefined;
    }[];
}>;
//# sourceMappingURL=evidence.d.ts.map