import { z } from 'zod';
import { EvidenceError } from './core.ts';
/** Single structural selector schema; pointer spelling remains exact RFC 6901 data. */
export declare const selectorSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
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
/** Refuse oversized or sparse collections before parsing or allocating their element copies. */
export declare function boundedArray<T extends z.ZodType>(element: T, maximum: number): z.ZodPipe<z.ZodCustom<unknown[], unknown[]>, z.ZodArray<T>>;
/** ATX headings have at most six active ancestors; tabs and Unicode are literal source content. */
export declare const ancestrySchema: z.ZodPipe<z.ZodCustom<unknown[], unknown[]>, z.ZodArray<z.ZodString>>;
/** Anchors retain exact selected and neighboring text from the same source snapshot. */
export declare const anchorSchema: z.ZodObject<{
    quote: z.ZodString;
    before: z.ZodString;
    after: z.ZodString;
    sectionPath: z.ZodOptional<z.ZodPipe<z.ZodCustom<unknown[], unknown[]>, z.ZodArray<z.ZodString>>>;
}, z.core.$strict>;
/** Source descriptors use the same selector and ancestry schemas as their producers. */
export declare const descriptorSchema: z.ZodObject<{
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
/** Public fragment reads share the exact text and descriptor contracts used by citation producers. */
export declare const fragmentRequestSchema: z.ZodObject<{
    text: z.ZodString;
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
}, z.core.$strict>;
/** Review dispositions are package observations, independent of tracker lifecycle statuses. */
declare const dispositionSchema: z.ZodEnum<{
    invalid: "invalid";
    "re-anchored": "re-anchored";
    "still-valid": "still-valid";
    superseded: "superseded";
}>;
/** Native package observation shape shared by review writes and citation reads. */
export declare const observationSchema: z.ZodObject<{
    id: z.ZodString;
    author: z.ZodString;
    at: z.ZodISODateTime;
    disposition: z.ZodEnum<{
        invalid: "invalid";
        "re-anchored": "re-anchored";
        "still-valid": "still-valid";
        superseded: "superseded";
    }>;
    reason: z.ZodString;
    replacement: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
/** Independent availability and freshness axes shared with compact check producers. */
declare const resolutionSchema: z.ZodEnum<{
    ambiguous: "ambiguous";
    inaccessible: "inaccessible";
    missing: "missing";
    resolved: "resolved";
    unsupported: "unsupported";
}>;
/** Exact-byte freshness does not classify semantic truth. */
declare const freshnessSchema: z.ZodEnum<{
    changed: "changed";
    current: "current";
    unknown: "unknown";
}>;
/** Compact observation shape, including per-citation refusal positions. */
export declare const checkRowSchema: z.ZodObject<{
    item: z.ZodString;
    citation: z.ZodString;
    resolution: z.ZodEnum<{
        ambiguous: "ambiguous";
        inaccessible: "inaccessible";
        missing: "missing";
        resolved: "resolved";
        unsupported: "unsupported";
    }>;
    freshness: z.ZodEnum<{
        changed: "changed";
        current: "current";
        unknown: "unknown";
    }>;
    currentResolution: z.ZodEnum<{
        ambiguous: "ambiguous";
        inaccessible: "inaccessible";
        missing: "missing";
        resolved: "resolved";
        unsupported: "unsupported";
    }>;
    oldDigest: z.ZodString;
    currentDigest: z.ZodNullable<z.ZodString>;
    sourceChanged: z.ZodNullable<z.ZodBoolean>;
    currentRevision: z.ZodNullable<z.ZodString>;
    replay: z.ZodBoolean;
    diff: z.ZodOptional<z.ZodObject<{
        type: z.ZodLiteral<"source-data">;
        old: z.ZodOptional<z.ZodArray<z.ZodString>>;
        current: z.ZodArray<z.ZodString>;
    }, z.core.$strict>>;
    code: z.ZodOptional<z.ZodEnum<{
        ambiguous: "ambiguous";
        boundary: "boundary";
        budget: "budget";
        canceled: "canceled";
        conflict: "conflict";
        inaccessible: "inaccessible";
        integrity: "integrity";
        invalid: "invalid";
        missing: "missing";
        race: "race";
        schema: "schema";
        sdk: "sdk";
        size: "size";
        timeout: "timeout";
        unsupported: "unsupported";
    }>>;
    remedy: z.ZodOptional<z.ZodString>;
    citationIndex: z.ZodOptional<z.ZodNumber>;
}, z.core.$strict>;
/** Runtime-derived independent resolution axis. */
export type Resolution = z.infer<typeof resolutionSchema>;
/** Runtime-derived exact fragment freshness axis. */
export type Freshness = z.infer<typeof freshnessSchema>;
/** Runtime-derived compact check observation. */
export type CheckRow = z.infer<typeof checkRowSchema>;
/** Exact SDK criterion text and its verified history generation, never an ordinal. */
export declare const criterionRefSchema: z.ZodObject<{
    text: z.ZodString;
    revision: z.ZodString;
}, z.core.$strict>;
/** Runtime-derived binding identity shared by every binding producer and consumer. */
export type CriterionRef = z.infer<typeof criterionRefSchema>;
/** Original identity survives transport; importing never grants onward sharing consent. */
export declare const citationOriginSchema: z.ZodObject<{
    item: z.ZodString;
    citation: z.ZodString;
    author: z.ZodString;
    at: z.ZodISODateTime;
}, z.core.$strict>;
/** The sole citation shape; inferred types and every producer/consumer derive from this schema. */
export declare const citationSchema: z.ZodObject<{
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
    retained: z.ZodOptional<z.ZodString>;
    provenance: z.ZodObject<{
        item: z.ZodString;
        author: z.ZodString;
        at: z.ZodISODateTime;
    }, z.core.$strict>;
    reviews: z.ZodPipe<z.ZodCustom<unknown[], unknown[]>, z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        author: z.ZodString;
        at: z.ZodISODateTime;
        disposition: z.ZodEnum<{
            invalid: "invalid";
            "re-anchored": "re-anchored";
            "still-valid": "still-valid";
            superseded: "superseded";
        }>;
        reason: z.ZodString;
        replacement: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>>;
    criteria: z.ZodOptional<z.ZodPipe<z.ZodCustom<unknown[], unknown[]>, z.ZodArray<z.ZodObject<{
        text: z.ZodString;
        revision: z.ZodString;
    }, z.core.$strict>>>>;
    lastCheck: z.ZodOptional<z.ZodObject<{
        item: z.ZodString;
        citation: z.ZodString;
        resolution: z.ZodEnum<{
            ambiguous: "ambiguous";
            inaccessible: "inaccessible";
            missing: "missing";
            resolved: "resolved";
            unsupported: "unsupported";
        }>;
        freshness: z.ZodEnum<{
            changed: "changed";
            current: "current";
            unknown: "unknown";
        }>;
        currentResolution: z.ZodEnum<{
            ambiguous: "ambiguous";
            inaccessible: "inaccessible";
            missing: "missing";
            resolved: "resolved";
            unsupported: "unsupported";
        }>;
        oldDigest: z.ZodString;
        currentDigest: z.ZodNullable<z.ZodString>;
        sourceChanged: z.ZodNullable<z.ZodBoolean>;
        currentRevision: z.ZodNullable<z.ZodString>;
        replay: z.ZodBoolean;
        diff: z.ZodOptional<z.ZodObject<{
            type: z.ZodLiteral<"source-data">;
            old: z.ZodOptional<z.ZodArray<z.ZodString>>;
            current: z.ZodArray<z.ZodString>;
        }, z.core.$strict>>;
        code: z.ZodOptional<z.ZodEnum<{
            ambiguous: "ambiguous";
            boundary: "boundary";
            budget: "budget";
            canceled: "canceled";
            conflict: "conflict";
            inaccessible: "inaccessible";
            integrity: "integrity";
            invalid: "invalid";
            missing: "missing";
            race: "race";
            schema: "schema";
            sdk: "sdk";
            size: "size";
            timeout: "timeout";
            unsupported: "unsupported";
        }>>;
        remedy: z.ZodOptional<z.ZodString>;
        citationIndex: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>>;
    lastCheckedAt: z.ZodOptional<z.ZodISODateTime>;
    exportConsent: z.ZodOptional<z.ZodEnum<{
        granted: "granted";
        revoked: "revoked";
    }>>;
    origin: z.ZodOptional<z.ZodObject<{
        item: z.ZodString;
        citation: z.ZodString;
        author: z.ZodString;
        at: z.ZodISODateTime;
    }, z.core.$strict>>;
}, z.core.$strict>;
/** Citation lists produced by ordinary mutations are dense and have unique logical identities. */
export declare const citationListSchema: z.ZodPipe<z.ZodCustom<unknown[], unknown[]>, z.ZodArray<z.ZodObject<{
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
    retained: z.ZodOptional<z.ZodString>;
    provenance: z.ZodObject<{
        item: z.ZodString;
        author: z.ZodString;
        at: z.ZodISODateTime;
    }, z.core.$strict>;
    reviews: z.ZodPipe<z.ZodCustom<unknown[], unknown[]>, z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        author: z.ZodString;
        at: z.ZodISODateTime;
        disposition: z.ZodEnum<{
            invalid: "invalid";
            "re-anchored": "re-anchored";
            "still-valid": "still-valid";
            superseded: "superseded";
        }>;
        reason: z.ZodString;
        replacement: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>>;
    criteria: z.ZodOptional<z.ZodPipe<z.ZodCustom<unknown[], unknown[]>, z.ZodArray<z.ZodObject<{
        text: z.ZodString;
        revision: z.ZodString;
    }, z.core.$strict>>>>;
    lastCheck: z.ZodOptional<z.ZodObject<{
        item: z.ZodString;
        citation: z.ZodString;
        resolution: z.ZodEnum<{
            ambiguous: "ambiguous";
            inaccessible: "inaccessible";
            missing: "missing";
            resolved: "resolved";
            unsupported: "unsupported";
        }>;
        freshness: z.ZodEnum<{
            changed: "changed";
            current: "current";
            unknown: "unknown";
        }>;
        currentResolution: z.ZodEnum<{
            ambiguous: "ambiguous";
            inaccessible: "inaccessible";
            missing: "missing";
            resolved: "resolved";
            unsupported: "unsupported";
        }>;
        oldDigest: z.ZodString;
        currentDigest: z.ZodNullable<z.ZodString>;
        sourceChanged: z.ZodNullable<z.ZodBoolean>;
        currentRevision: z.ZodNullable<z.ZodString>;
        replay: z.ZodBoolean;
        diff: z.ZodOptional<z.ZodObject<{
            type: z.ZodLiteral<"source-data">;
            old: z.ZodOptional<z.ZodArray<z.ZodString>>;
            current: z.ZodArray<z.ZodString>;
        }, z.core.$strict>>;
        code: z.ZodOptional<z.ZodEnum<{
            ambiguous: "ambiguous";
            boundary: "boundary";
            budget: "budget";
            canceled: "canceled";
            conflict: "conflict";
            inaccessible: "inaccessible";
            integrity: "integrity";
            invalid: "invalid";
            missing: "missing";
            race: "race";
            schema: "schema";
            sdk: "sdk";
            size: "size";
            timeout: "timeout";
            unsupported: "unsupported";
        }>>;
        remedy: z.ZodOptional<z.ZodString>;
        citationIndex: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>>;
    lastCheckedAt: z.ZodOptional<z.ZodISODateTime>;
    exportConsent: z.ZodOptional<z.ZodEnum<{
        granted: "granted";
        revoked: "revoked";
    }>>;
    origin: z.ZodOptional<z.ZodObject<{
        item: z.ZodString;
        citation: z.ZodString;
        author: z.ZodString;
        at: z.ZodISODateTime;
    }, z.core.$strict>>;
}, z.core.$strict>>>;
/** Envelope validation is deliberately independent of individual citation validity. */
export declare const envelopeSchema: z.ZodObject<{
    version: z.ZodLiteral<1>;
    revision: z.ZodNumber;
    citations: z.ZodPipe<z.ZodCustom<unknown[], unknown[]>, z.ZodArray<z.ZodUnknown>>;
}, z.core.$strict>;
/** Strict state for cite/review; verification instead validates entries individually. */
export declare const stateSchema: z.ZodObject<{
    version: z.ZodLiteral<1>;
    revision: z.ZodNumber;
    citations: z.ZodPipe<z.ZodCustom<unknown[], unknown[]>, z.ZodArray<z.ZodObject<{
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
        retained: z.ZodOptional<z.ZodString>;
        provenance: z.ZodObject<{
            item: z.ZodString;
            author: z.ZodString;
            at: z.ZodISODateTime;
        }, z.core.$strict>;
        reviews: z.ZodPipe<z.ZodCustom<unknown[], unknown[]>, z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            author: z.ZodString;
            at: z.ZodISODateTime;
            disposition: z.ZodEnum<{
                invalid: "invalid";
                "re-anchored": "re-anchored";
                "still-valid": "still-valid";
                superseded: "superseded";
            }>;
            reason: z.ZodString;
            replacement: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>>;
        criteria: z.ZodOptional<z.ZodPipe<z.ZodCustom<unknown[], unknown[]>, z.ZodArray<z.ZodObject<{
            text: z.ZodString;
            revision: z.ZodString;
        }, z.core.$strict>>>>;
        lastCheck: z.ZodOptional<z.ZodObject<{
            item: z.ZodString;
            citation: z.ZodString;
            resolution: z.ZodEnum<{
                ambiguous: "ambiguous";
                inaccessible: "inaccessible";
                missing: "missing";
                resolved: "resolved";
                unsupported: "unsupported";
            }>;
            freshness: z.ZodEnum<{
                changed: "changed";
                current: "current";
                unknown: "unknown";
            }>;
            currentResolution: z.ZodEnum<{
                ambiguous: "ambiguous";
                inaccessible: "inaccessible";
                missing: "missing";
                resolved: "resolved";
                unsupported: "unsupported";
            }>;
            oldDigest: z.ZodString;
            currentDigest: z.ZodNullable<z.ZodString>;
            sourceChanged: z.ZodNullable<z.ZodBoolean>;
            currentRevision: z.ZodNullable<z.ZodString>;
            replay: z.ZodBoolean;
            diff: z.ZodOptional<z.ZodObject<{
                type: z.ZodLiteral<"source-data">;
                old: z.ZodOptional<z.ZodArray<z.ZodString>>;
                current: z.ZodArray<z.ZodString>;
            }, z.core.$strict>>;
            code: z.ZodOptional<z.ZodEnum<{
                ambiguous: "ambiguous";
                boundary: "boundary";
                budget: "budget";
                canceled: "canceled";
                conflict: "conflict";
                inaccessible: "inaccessible";
                integrity: "integrity";
                invalid: "invalid";
                missing: "missing";
                race: "race";
                schema: "schema";
                sdk: "sdk";
                size: "size";
                timeout: "timeout";
                unsupported: "unsupported";
            }>>;
            remedy: z.ZodOptional<z.ZodString>;
            citationIndex: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>>;
        lastCheckedAt: z.ZodOptional<z.ZodISODateTime>;
        exportConsent: z.ZodOptional<z.ZodEnum<{
            granted: "granted";
            revoked: "revoked";
        }>>;
        origin: z.ZodOptional<z.ZodObject<{
            item: z.ZodString;
            citation: z.ZodString;
            author: z.ZodString;
            at: z.ZodISODateTime;
        }, z.core.$strict>>;
    }, z.core.$strict>>>;
}, z.core.$strict>;
/** Runtime-derived selector type, with no second manually maintained shape. */
export type Selector = z.infer<typeof selectorSchema>;
/** Runtime-derived source ancestry and fragment anchor type. */
export type Anchor = z.infer<typeof anchorSchema>;
/** Runtime-derived provider/source descriptor type. */
export type Descriptor = z.infer<typeof descriptorSchema>;
/** Runtime-derived review disposition type. */
export type Disposition = z.infer<typeof dispositionSchema>;
/** Runtime-derived review observation type. */
export type Observation = z.infer<typeof observationSchema>;
/** Runtime-derived durable citation type. */
export type Citation = z.infer<typeof citationSchema>;
/** Runtime-derived owned evidence state type. */
export type EvidenceState = z.infer<typeof stateSchema>;
/** Envelope retaining malformed entries without interpreting or deleting them. */
export type EvidenceEnvelope = z.infer<typeof envelopeSchema>;
/** A safe structured schema constraint refusal; operands are summarized, never echoed. */
export declare class RecordValidationError extends EvidenceError {
    /** Schema-owned field location and constraint kind. */
    readonly field: string;
    /** Numeric bound or schema rule that the complete record must satisfy. */
    readonly limit: number | string;
    /** Observed collection/string length, number, or operand type. */
    readonly observed: number | string;
    /** Preserve actionable diagnostics without exposing source text. */
    constructor(field: string, limit: number | string, observed: number | string);
}
/** Validate complete durable state on both sides of every native conditional commit. */
export declare function validateRecord(value: unknown, owner?: string): EvidenceState;
/** Citation readers use the full record validator, retaining per-entry failure isolation. */
export declare function parseCitation(value: unknown, owner?: string): Citation;
/** Decode only the owned envelope so a malformed entry cannot hide its valid siblings. */
export declare function envelope(raw: unknown): EvidenceEnvelope;
/** Validate caller selectors with the same schema used by durable citations. */
export declare function parseSelector(value: unknown): Selector;
export {};
//# sourceMappingURL=citation-schema.d.ts.map