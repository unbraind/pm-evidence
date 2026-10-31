import { defineExtension } from '@unbrained/pm-cli/sdk/authoring';
import { register } from './src/commands.ts';
/** Cite, revalidate, traverse affected context and record explicit evidence reviews. */
export { cite, check, affected, review, show, replay } from './src/evidence.ts';
/** Pure current-source fragment text through the same exact resolver used by checks; no retention or tracker access required. */
export { resolveFragmentText } from './src/selectors.ts';
/** Portable retained artifacts, explicit consent and revision-bound single-target transfers. */
export { bundleSchema, bundleAuthorizationSchema, bundleImportReceiptSchema, BUNDLE_MAX_BYTES, BUNDLE_POLICY, bundleTarget, setBundleConsent, exportBundle, validateBundle, inspectBundle, importBundle } from './src/bundles.ts';
export type { CitationBundle, BundleSelection, BundleAuthorization, BundleConsent, BundleImportReceipt } from './src/bundles.ts';
/** Criterion revision bindings and read-only facts for lint/context adapters. */
export { bindCriterion, criterionFacts, criterionBindingSchema, criterionFactSchema } from './src/criteria.ts';
/** Runtime-derived exact criterion revision and adapter contracts. */
export { criterionRefSchema } from './src/citation-schema.ts';
export type { CriterionRef } from './src/citation-schema.ts';
export type { CriterionBinding, CriterionFact } from './src/criteria.ts';
/** Custom source readers share the built-in root, deadline and revision contract. */
export { fileAdapter, jsonAdapter } from './src/sources.ts';
/** Typed refusals and deterministic output cost estimates for consumers. */
export { EvidenceError, tokens } from './src/core.ts';
/** Stable SDK refusal discriminants shared with citation check rows. */
export type { EvidenceCode } from './src/core.ts';
/** Public source, selector, record, receipt and caller option contracts. */
export type { SourceAdapter, SourceSnapshot, ReadContext, Descriptor, Selector, Citation, EvidenceOptions, CiteOptions, CheckOptions, AffectedOptions, ReviewOptions, CheckRow, Packet, Impact, Resolution, Freshness, Disposition, VerificationReceipt } from './src/types.ts';
/** Activate evidence commands and registered item fields in the pm host. */
export default defineExtension({ name: 'pm-evidence', version: "2026.10.31", description: 'Exact source fragment freshness for agents', activate: register });

/** Runtime citation contracts shared by creation, verification and SDK consumers. */
export { citationSchema, selectorSchema, ancestrySchema, parseCitation, validateRecord, RecordValidationError } from './src/citation-schema.ts';
