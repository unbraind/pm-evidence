import { defineExtension } from '@unbrained/pm-cli/sdk/authoring';
import { register } from './src/commands.js';
/** Cite, revalidate, traverse affected context and record explicit evidence reviews. */
export { cite, check, affected, review, show, replay } from './src/evidence.js';
/** Pure current-source fragment text through the same exact resolver used by checks; no retention or tracker access required. */
export { resolveFragmentText } from './src/selectors.js';
/** Portable retained artifacts, explicit consent and revision-bound single-target transfers. */
export { bundleSchema, bundleAuthorizationSchema, bundleImportReceiptSchema, BUNDLE_MAX_BYTES, BUNDLE_POLICY, bundleTarget, setBundleConsent, exportBundle, validateBundle, inspectBundle, importBundle } from './src/bundles.js';
/** Criterion revision bindings and read-only facts for lint/context adapters. */
export { bindCriterion, criterionFacts, criterionBindingSchema, criterionFactSchema } from './src/criteria.js';
/** Runtime-derived exact criterion revision and adapter contracts. */
export { criterionRefSchema } from './src/citation-schema.js';
/** Custom source readers share the built-in root, deadline and revision contract. */
export { fileAdapter, jsonAdapter } from './src/sources.js';
/** Typed refusals and deterministic output cost estimates for consumers. */
export { EvidenceError, tokens } from './src/core.js';
/** Activate evidence commands and registered item fields in the pm host. */
export default defineExtension({ name: 'pm-evidence', version: "2026.10.28", description: 'Exact source fragment freshness for agents', activate: register });
/** Runtime citation contracts shared by creation, verification and SDK consumers. */
export { citationSchema, selectorSchema, ancestrySchema, parseCitation, validateRecord, RecordValidationError } from './src/citation-schema.js';
//# sourceMappingURL=index.js.map