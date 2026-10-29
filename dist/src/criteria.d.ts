import { z } from 'zod';
import type { CheckOptions, Packet } from './types.ts';
/** One strict request schema, shared by SDK binding and the CLI. */
export declare const criterionBindingSchema: z.ZodObject<{
    item: z.ZodString;
    citation: z.ZodString;
    criterion: z.ZodObject<{
        text: z.ZodString;
        revision: z.ZodString;
    }, z.core.$strict>;
}, z.core.$strict>;
/** Binding requests name the expected criterion generation, rather than guessing after an edit. */
export type CriterionBinding = z.infer<typeof criterionBindingSchema>;
/** Source support is a byte-level fact; none of these states asserts criterion truth. */
export declare const criterionFactSchema: z.ZodObject<{
    item: z.ZodString;
    criterion: z.ZodString;
    revision: z.ZodNullable<z.ZodString>;
    boundRevision: z.ZodNullable<z.ZodString>;
    citation: z.ZodNullable<z.ZodString>;
    support: z.ZodEnum<{
        "ambiguous-criterion": "ambiguous-criterion";
        "criterion-changed": "criterion-changed";
        "current-source": "current-source";
        "lost-source": "lost-source";
        unbound: "unbound";
        unknown: "unknown";
    }>;
    resolution: z.ZodNullable<z.ZodEnum<{
        ambiguous: "ambiguous";
        inaccessible: "inaccessible";
        missing: "missing";
        resolved: "resolved";
        unsupported: "unsupported";
    }>>;
    freshness: z.ZodNullable<z.ZodEnum<{
        changed: "changed";
        current: "current";
        unknown: "unknown";
    }>>;
    truthAssessed: z.ZodLiteral<false>;
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
/** Portable adapter row for witness validators and context packers. */
export type CriterionFact = z.infer<typeof criterionFactSchema>;
/** Persist an exact binding through native revision CAS; retries inspect fresh SDK state. */
export declare function bindCriterion(input: CriterionBinding, options: CheckOptions): Promise<CriterionBinding>;
/** Read-only criterion-to-citation adapter; no witness judgment, packing or status inference. */
export declare function criterionFacts(items: readonly string[], options: CheckOptions): Promise<Packet<CriterionFact>>;
//# sourceMappingURL=criteria.d.ts.map