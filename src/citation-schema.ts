import { z } from 'zod';
import { EVIDENCE_CODES, EvidenceError } from './core.ts';
import { sourceIdentity } from './sources.ts';

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
/** ATX headings have at most six active ancestors; tabs and Unicode are literal source content. */
export const ancestrySchema = z.array(headingText).max(6);
/** Anchors retain exact selected and neighboring text from the same source snapshot. */
export const anchorSchema = z.strictObject({ quote: sourceText.min(1), before: sourceText, after: sourceText, sectionPath: ancestrySchema.optional() });
/** Source identities reuse the same containment operand policy as citation creation. */
const sourcePath = sourceText.min(1).refine(value => { try { sourceIdentity(value); return true; } catch { return false; } });
/** Source descriptors use the same selector and ancestry schemas as their producers. */
export const descriptorSchema = z.strictObject({ provider: sourceText.min(1), source: sourcePath, revision: z.string().regex(/^[a-f0-9]{64}$/), selector: selectorSchema, anchor: anchorSchema.optional(), jsonEncoding: z.literal('source-bytes-v1').optional() });
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
/** Runtime-derived independent resolution axis. */
export type Resolution = z.infer<typeof resolutionSchema>;
/** Runtime-derived exact fragment freshness axis. */
export type Freshness = z.infer<typeof freshnessSchema>;
/** Runtime-derived compact check observation. */
export type CheckRow = z.infer<typeof checkRowSchema>;
/** The sole citation shape; inferred types and every producer/consumer derive from this schema. */
export const citationSchema = z.strictObject({ id: z.string().regex(/^ev-[a-f0-9]{24}$/), descriptor: descriptorSchema, fragmentDigest: z.string().regex(/^[a-f0-9]{64}$/), retained: z.string().max(22_369_624).optional(), provenance: z.strictObject({ item: sourceText.min(1), author: sourceText.min(1), at: z.iso.datetime() }), reviews: z.array(observationSchema).max(10_000), lastCheck: checkRowSchema.optional(), lastCheckedAt: z.iso.datetime().optional() });
/** Citation lists produced by ordinary mutations are dense and have unique logical identities. */
export const citationListSchema = z.array(citationSchema).max(10_000).refine(values => new Set(values.map(value => value.id)).size === values.length);
/** Envelope validation is deliberately independent of individual citation validity. */
export const envelopeSchema = z.strictObject({ version: z.literal(1), revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), citations: z.custom<unknown[]>(value => Array.isArray(value) && Array.from({ length: value.length }, (_, index) => Object.hasOwn(value, index)).every(Boolean)).pipe(z.array(z.unknown()).max(10_000)) });
/** Strict state for cite/review; verification instead validates entries individually. */
export const stateSchema = envelopeSchema.extend({ citations: citationListSchema });
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

/** Normalize all schema diagnostics to safe package-owned refusals without operand contents. */
export function parseCitation(value: unknown, owner?: string): Citation {
  const parsed = citationSchema.safeParse(value);
  if (!parsed.success || (owner !== undefined && parsed.data.provenance.item !== owner)) throw new EvidenceError('schema', 'Citation metadata is malformed or belongs to another item', 'Inspect this citation and restore its producer schema; valid sibling citations are still checked');
  return parsed.data;
}
/** Decode only the owned envelope so a malformed entry cannot hide its valid siblings. */
export function envelope(raw: unknown): EvidenceEnvelope {
  if (raw === undefined) return { version: 1, revision: 0, citations: [] };
  try { return envelopeSchema.parse(JSON.parse(String(raw))); }
  catch { throw new EvidenceError('schema', 'Evidence field is malformed', 'Restore a valid registered evidence_state envelope through pm'); }
}

/** Validate caller selectors with the same schema used by durable citations. */
export function parseSelector(value: unknown): Selector {
  const parsed = selectorSchema.safeParse(value);
  if (!parsed.success) throw new EvidenceError('invalid', 'Invalid source selector', 'Choose a documented line range, literal heading or RFC 6901 pointer');
  return parsed.data;
}
