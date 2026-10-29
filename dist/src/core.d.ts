import type { Packet, VerificationReceipt } from './types.ts';
/** Stable refusal discriminants for SDK and compact row consumers. */
export declare const EVIDENCE_CODES: readonly ['invalid', 'budget', 'missing', 'ambiguous', 'unsupported', 'boundary', 'canceled', 'inaccessible', 'race', 'size', 'timeout', 'conflict', 'integrity', 'schema', 'sdk'];
/** Refusal types derive from the same runtime discriminants as stored check observations. */
export type EvidenceCode = typeof EVIDENCE_CODES[number];
/** Typed refusal with an actionable remedy and no source or absolute path diagnostics. */
export declare class EvidenceError extends Error {
    /** Capture only package-owned safe diagnostics. */
    readonly code: EvidenceCode;
    /** Safe recovery action for callers. */
    readonly remedy: string;
    /** Construct a safe typed refusal. */
    constructor(code: EvidenceCode, message: string, remedy: string);
}
/** Hash exact UTF-8 fragment or source bytes. */
export declare function digest(value: string): string;
/** Refuse invalid input without echoing untrusted operands. */
export declare function requireInput(condition: unknown, message: string): asserts condition;
/** Escape control characters so terminal source data cannot change renderer behavior. */
export declare function inert(text: string): string;
/** Bound the actual larger host JSON/TOON representation including its receipt. */
export declare function tokens(value: unknown): number;
/** Keep deterministic prefix rows and report every withheld result. */
export declare function packet<T>(rows: T[], scope: Packet<T>['scope'], budget?: number, sourceComplete?: boolean, verification?: VerificationReceipt): Packet<T>;
//# sourceMappingURL=core.d.ts.map