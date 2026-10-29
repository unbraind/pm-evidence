import { z } from 'zod';
import type { EvidenceOptions } from './types.ts';
/** Portable fragments are bounded independently of the larger native citation record. */
export declare const BUNDLE_MAX_BYTES = 4194304;
/** Policy is part of the hash: no unselected evidence, native relationships or review claims travel. */
export declare const BUNDLE_POLICY: {
    readonly retention: 'selected-fragments-only';
    readonly consent: 'snapshot-not-onward-permission';
    readonly omitted: readonly ['unselected-citations', 'whole-sources', 'native-fields-and-relationships', 'reviews', 'criterion-bindings', 'last-checks'];
};
/** Strict complete bundle envelope; hashes detect corruption, not sender authenticity. */
export declare const bundleSchema: z.ZodObject<{
    kind: z.ZodLiteral<"pm-evidence/retained">;
    version: z.ZodLiteral<1>;
    policy: z.ZodObject<{
        retention: z.ZodLiteral<"selected-fragments-only">;
        consent: z.ZodLiteral<"snapshot-not-onward-permission">;
        omitted: z.ZodPipe<z.ZodCustom<unknown[], unknown[]>, z.ZodArray<z.ZodEnum<{
            "criterion-bindings": "criterion-bindings";
            "last-checks": "last-checks";
            "native-fields-and-relationships": "native-fields-and-relationships";
            reviews: "reviews";
            "unselected-citations": "unselected-citations";
            "whole-sources": "whole-sources";
        }>>>;
    }, z.core.$strict>;
    entries: z.ZodPipe<z.ZodCustom<unknown[], unknown[]>, z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        descriptor: z.ZodObject<{
            provider: z.ZodString;
            source: z.ZodString;
            revision: z.ZodString;
            selector: z.ZodDiscriminatedUnion<[z.ZodObject<{
                kind: z.ZodLiteral<"lines">;
                start: z.ZodNumber;
                end: z.ZodNumber;
            }, z.core.$strict>, z.ZodObject<{
                kind: z.ZodLiteral<"heading">;
                heading: z.ZodString;
                paragraph: z.ZodNumber;
            }, z.core.$strict>, z.ZodObject<{
                kind: z.ZodLiteral<"pointer">;
                pointer: z.ZodString;
            }, z.core.$strict>], "kind">;
            anchor: z.ZodOptional<z.ZodObject<{
                quote: z.ZodString;
                before: z.ZodString;
                after: z.ZodString;
                sectionPath: z.ZodOptional<z.ZodPipe<z.ZodCustom<unknown[], unknown[]>, z.ZodArray<z.ZodString>>>;
            }, z.core.$strict>>;
            jsonEncoding: z.ZodOptional<z.ZodLiteral<"source-bytes-v1">>;
        }, z.core.$strict>;
        fragmentDigest: z.ZodString;
        retained: z.ZodNonOptional<z.ZodOptional<z.ZodString>>;
        provenance: z.ZodObject<{
            item: z.ZodString;
            author: z.ZodString;
            at: z.ZodISODateTime;
        }, z.core.$strict>;
        origin: z.ZodOptional<z.ZodObject<{
            item: z.ZodString;
            citation: z.ZodString;
            author: z.ZodString;
            at: z.ZodISODateTime;
        }, z.core.$strict>>;
    }, z.core.$strict>>>;
    hash: z.ZodString;
}, z.core.$strict>;
/** Public transport contract inferred from the single runtime schema. */
export type CitationBundle = z.infer<typeof bundleSchema>;
/** Explicit, bounded source selection never defaults to every citation on an item. */
declare const selectionSchema: z.ZodObject<{
    item: z.ZodString;
    citations: z.ZodPipe<z.ZodCustom<unknown[], unknown[]>, z.ZodArray<z.ZodString>>;
}, z.core.$strict>;
/** Explicit portable artifact selection shared by SDK export and consent operations. */
export type BundleSelection = z.infer<typeof selectionSchema>;
/** Authorization names the exact native history generation, including edit/restore cycles. */
export declare const bundleAuthorizationSchema: z.ZodObject<{
    item: z.ZodString;
    revision: z.ZodString;
    authorized: z.ZodLiteral<true>;
}, z.core.$strict>;
/** Callers must explicitly authorize each current target before inspection or import. */
export type BundleAuthorization = z.infer<typeof bundleAuthorizationSchema>;
/** Sharing permission is independent of local retained-byte storage permission. */
declare const consentSchema: z.ZodObject<{
    item: z.ZodString;
    citations: z.ZodPipe<z.ZodCustom<unknown[], unknown[]>, z.ZodArray<z.ZodString>>;
    revision: z.ZodString;
    consent: z.ZodEnum<{
        granted: "granted";
        revoked: "revoked";
    }>;
}, z.core.$strict>;
/** SDK consent input shares its strict runtime shape with the CLI. */
export type BundleConsent = z.infer<typeof consentSchema>;
/** Finite bounded import receipts never include source fragments. */
export declare const bundleImportReceiptSchema: z.ZodObject<{
    item: z.ZodString;
    hash: z.ZodString;
    status: z.ZodEnum<{
        imported: "imported";
        skipped: "skipped";
        unchanged: "unchanged";
    }>;
    added: z.ZodNumber;
    existing: z.ZodNumber;
    preview: z.ZodBoolean;
    code: z.ZodOptional<z.ZodLiteral<"schema">>;
    remedy: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
/** Import outcomes distinguish a preserved foreign field from an unchanged owned target. */
export type BundleImportReceipt = z.infer<typeof bundleImportReceiptSchema>;
/** Validate all selected bytes before returning any fragment, metadata or mutation plan. */
export declare function validateBundle(input: unknown): CitationBundle;
/** Return a current native target generation without inferring consent or writing item history. */
export declare function bundleTarget(item: string, options: EvidenceOptions): Promise<{
    item: string;
    revision: string;
}>;
/** Grant or revoke onward sharing for explicit citations under the native item lease. */
export declare function setBundleConsent(input: BundleConsent, options: EvidenceOptions): Promise<{
    item: string;
    consent: BundleConsent['consent'];
    citations: number;
}>;
/** Export only selected retained artifacts after checking live sharing permission under the item lease. */
export declare function exportBundle(input: BundleSelection, options: EvidenceOptions): Promise<CitationBundle>;
/** Validate the entire bundle and authorization before preview or atomic single-target import. */
export declare function importBundle(input: unknown, authorization: BundleAuthorization, options: EvidenceOptions & {
    preview?: boolean;
}): Promise<BundleImportReceipt>;
/** Inspect validated metadata only after explicit target authorization; source bytes stay inert and private. */
export declare function inspectBundle(input: unknown, authorization: BundleAuthorization, options: EvidenceOptions & {
    budget?: number;
}): Promise<import("./types.ts").Packet<{
    citation: string;
    source: string;
    provider: string;
    revision: string;
    fragmentDigest: string;
    bytes: number;
}>>;
export {};
//# sourceMappingURL=bundles.d.ts.map