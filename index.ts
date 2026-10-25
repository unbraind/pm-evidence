import { defineExtension } from '@unbrained/pm-cli/sdk/authoring';
import { register } from './src/commands.ts';
/** Cite, revalidate, traverse affected context and record explicit evidence reviews. */
export { cite, check, affected, review, show, replay } from './src/evidence.ts';
/** Custom source readers share the built-in root, deadline and revision contract. */
export { fileAdapter, jsonAdapter } from './src/sources.ts';
/** Typed refusals and deterministic output cost estimates for consumers. */
export { EvidenceError, tokens } from './src/core.ts';
/** Stable SDK refusal discriminants shared with citation check rows. */
export type { EvidenceCode } from './src/core.ts';
/** Public source, selector, record, receipt and caller option contracts. */
export type { SourceAdapter, SourceSnapshot, ReadContext, Descriptor, Selector, Citation, EvidenceOptions, CiteOptions, CheckOptions, AffectedOptions, ReviewOptions, CheckRow, Packet, Impact, Resolution, Freshness, Disposition, VerificationReceipt } from './src/types.ts';
/** Activate evidence commands and registered item fields in the pm host. */
export default defineExtension({ name: 'pm-evidence', version: '2026.10.23', description: 'Exact source fragment freshness for agents', activate: register });
