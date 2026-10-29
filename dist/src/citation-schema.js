import { z } from 'zod';
import { EVIDENCE_CODES, EvidenceError } from './core.js';
import { sourceIdentity } from './sources.js';
/** Source-derived text preserves exact Unicode, whitespace and control bytes without normalization. */
const sourceText = z.string().max(16_777_216);
/** Selected headings and source ancestry share exactly the same literal-text contract. */
const headingText = sourceText.min(1);
/** Positive bounded structural coordinates accepted by both selection and stored metadata. */
const position = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
/** Single structural selector schema; pointer spelling remains exact RFC 6901 data. */
export const selectorSchema = z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('lines'), start: position, end: position }).refine(value => value.end >= value.start),
    z.strictObject({ kind: z.literal('heading'), heading: headingText, paragraph: position }),
    z.strictObject({ kind: z.literal('pointer'), pointer: z.string().max(33_554_944).refine(value => (value === '' || value.startsWith('/')) && !/~(?:[^01]|$)/.test(value)) }),
]);
/** Refuse oversized or sparse collections before parsing or allocating their element copies. */
export function boundedArray(element, maximum) {
    return z.custom(Array.isArray, { abort: true }).superRefine((values, context) => {
        if (values.length > maximum)
            context.addIssue({ code: 'too_big', origin: 'array', maximum, inclusive: true });
        else if (Array.from({ length: values.length }, (_, index) => Object.hasOwn(values, index)).some(present => !present))
            context.addIssue({ code: 'custom' });
    }).pipe(z.array(element).max(maximum));
}
/** ATX headings have at most six active ancestors; tabs and Unicode are literal source content. */
export const ancestrySchema = boundedArray(headingText, 6);
/** Anchors retain exact selected and neighboring text from the same source snapshot. */
export const anchorSchema = z.strictObject({ quote: sourceText.min(1), before: sourceText, after: sourceText, sectionPath: ancestrySchema.optional() });
/** Source identities reuse the same containment operand policy as citation creation. */
const sourcePath = sourceText.min(1).refine(value => { try {
    sourceIdentity(value);
    return true;
}
catch {
    return false;
} });
/** Source descriptors use the same selector and ancestry schemas as their producers. */
export const descriptorSchema = z.strictObject({ provider: sourceText.min(1), source: sourcePath, revision: z.string().regex(/^[a-f0-9]{64}$/), selector: selectorSchema, anchor: anchorSchema.optional(), jsonEncoding: z.literal('source-bytes-v1').optional() });
/** Public fragment reads share the exact text and descriptor contracts used by citation producers. */
export const fragmentRequestSchema = z.strictObject({ text: sourceText, descriptor: descriptorSchema });
/** Review dispositions are package observations, independent of tracker lifecycle statuses. */
const dispositionSchema = z.enum(['still-valid', 're-anchored', 'superseded', 'invalid']);
/** Native package observation shape shared by review writes and citation reads. */
export const observationSchema = z.strictObject({ id: sourceText.min(1), author: sourceText.min(1), at: z.iso.datetime(), disposition: dispositionSchema, reason: z.string().min(1).max(1000), replacement: sourceText.optional() });
/** Independent availability and freshness axes shared with compact check producers. */
const resolutionSchema = z.enum(['resolved', 'missing', 'inaccessible', 'ambiguous', 'unsupported']);
/** Exact-byte freshness does not classify semantic truth. */
const freshnessSchema = z.enum(['current', 'changed', 'unknown']);
/** Compact observation shape, including per-citation refusal positions. */
export const checkRowSchema = z.strictObject({ item: sourceText, citation: sourceText, resolution: resolutionSchema, freshness: freshnessSchema, currentResolution: resolutionSchema, oldDigest: sourceText, currentDigest: sourceText.nullable(), sourceChanged: z.boolean().nullable(), currentRevision: sourceText.nullable(), replay: z.boolean(), diff: z.strictObject({ type: z.literal('source-data'), old: z.array(sourceText).optional(), current: z.array(sourceText) }).optional(), code: z.enum(EVIDENCE_CODES).optional(), remedy: sourceText.optional(), citationIndex: position.optional() });
/** Exact SDK criterion text and its verified history generation, never an ordinal. */
export const criterionRefSchema = z.strictObject({ text: z.string().min(1).max(65_536), revision: z.string().regex(/^[a-f0-9]{64}$/) });
/** A citation may support several exact revisions; duplicates carry no extra evidence. */
const criterionRefs = boundedArray(criterionRefSchema, 64).refine(values => new Set(values.map(value => JSON.stringify(value))).size === values.length);
/** Original identity survives transport; importing never grants onward sharing consent. */
export const citationOriginSchema = z.strictObject({ item: sourceText.min(1), citation: z.string().regex(/^ev-[a-f0-9]{24}$/), author: sourceText.min(1), at: z.iso.datetime() });
/** The sole citation shape; inferred types and every producer/consumer derive from this schema. */
export const citationSchema = z.strictObject({ id: z.string().regex(/^ev-[a-f0-9]{24}$/), descriptor: descriptorSchema, fragmentDigest: z.string().regex(/^[a-f0-9]{64}$/), retained: z.string().max(22_369_624).optional(), provenance: z.strictObject({ item: sourceText.min(1), author: sourceText.min(1), at: z.iso.datetime() }), reviews: boundedArray(observationSchema, 10_000), criteria: criterionRefs.optional(), lastCheck: checkRowSchema.optional(), lastCheckedAt: z.iso.datetime().optional(), exportConsent: z.enum(['granted', 'revoked']).optional(), origin: citationOriginSchema.optional() });
/** Citation lists produced by ordinary mutations are dense and have unique logical identities. */
export const citationListSchema = boundedArray(citationSchema, 10_000).refine(values => new Set(values.map(value => value.id)).size === values.length);
/** Envelope validation is deliberately independent of individual citation validity. */
export const envelopeSchema = z.strictObject({ version: z.literal(1), revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), citations: boundedArray(z.unknown(), 10_000) });
/** Strict state for cite/review; verification instead validates entries individually. */
export const stateSchema = envelopeSchema.extend({ citations: citationListSchema });
/** A safe structured schema constraint refusal; operands are summarized, never echoed. */
export class RecordValidationError extends EvidenceError {
    /** Schema-owned field location and constraint kind. */
    field;
    /** Numeric bound or schema rule that the complete record must satisfy. */
    limit;
    /** Observed collection/string length, number, or operand type. */
    observed;
    /** Preserve actionable diagnostics without exposing source text. */
    constructor(field, limit, observed) {
        super('schema', `Record constraint at ${field}: limit=${limit}; observed=${observed}`, 'Reduce the reported field to its schema limit or restore a valid value, then retry against the current revision');
        this.field = field;
        this.limit = limit;
        this.observed = observed;
    }
}
/** Validate complete durable state on both sides of every native conditional commit. */
export function validateRecord(value, owner) {
    const parsed = stateSchema.safeParse(value);
    if (parsed.success) {
        for (const [index, citation] of parsed.data.citations.entries())
            if (owner !== undefined && citation.provenance.item !== owner)
                throw new RecordValidationError(`citations.${index}.provenance.item`, 'owning item', citation.provenance.item.length);
        return parsed.data;
    }
    const issue = parsed.error.issues[0];
    let operand = value;
    for (const key of issue.path)
        operand = Reflect.get(Object(operand), key);
    const observed = typeof operand === 'string' || Array.isArray(operand) ? operand.length : typeof operand === 'number' && Number.isFinite(operand) ? operand : typeof operand;
    const limit = issue.code === 'too_big' ? issue.maximum : issue.code === 'too_small' ? issue.minimum : issue.code === 'invalid_value' ? issue.values.map(String).join('|') : issue.code === 'invalid_format' ? issue.format : issue.code === 'invalid_type' ? issue.expected : issue.code;
    throw new RecordValidationError(issue.path.join('.'), String(limit), observed);
}
/** Citation readers use the full record validator, retaining per-entry failure isolation. */
export function parseCitation(value, owner) {
    return validateRecord({ version: 1, revision: 0, citations: [value] }, owner).citations[0];
}
/** Decode only the owned envelope so a malformed entry cannot hide its valid siblings. */
export function envelope(raw) {
    if (raw === undefined)
        return { version: 1, revision: 0, citations: [] };
    try {
        return envelopeSchema.parse(JSON.parse(String(raw)));
    }
    catch {
        throw new EvidenceError('schema', 'Evidence field is malformed', 'Restore a valid registered evidence_state envelope through pm');
    }
}
/** Validate caller selectors with the same schema used by durable citations. */
export function parseSelector(value) {
    const parsed = selectorSchema.safeParse(value);
    if (!parsed.success)
        throw new EvidenceError('invalid', 'Invalid source selector', 'Choose a documented line range, literal heading or RFC 6901 pointer');
    return parsed.data;
}
//# sourceMappingURL=citation-schema.js.map