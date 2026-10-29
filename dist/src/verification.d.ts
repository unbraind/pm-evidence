import type { AffectedOptions, SourceSnapshot, VerificationReceipt } from './types.ts';
/** One strict boundary schema shared by SDK verification and CLI dispatch, with no coercion. */
export declare function verificationInput(items: readonly string[], options: AffectedOptions): void;
/** Legacy internal list entrypoint delegates to the exact producer schema. */
export declare function verificationCitations(citations: unknown): void;
/** Share successes and refusals for exactly one invocation and one caller-selected authority. */
export declare class Verification {
    /** Snapshot promises own copied immutable data, never adapter-owned mutable objects. */
    readonly reads: Map<string, Promise<SourceSnapshot>>;
    /** Always included before output budgeting; no source text appears here. */
    readonly receipt: VerificationReceipt;
    /** Frozen caller configuration prevents mid-check changes of source authority. */
    readonly options: AffectedOptions;
    /** Total bytes retained by successful source reads. */
    private bytes;
    /** Capture one invocation's adapters and limits; callers validate at their public boundary. */
    constructor(options: AffectedOptions);
    /** Cancellation is sticky even when the signal fires after the final read. */
    canceled(): boolean;
    /** Resolve every selector against the same provider/source bytes, including across cited revisions. */
    read(provider: string, source: string): Promise<SourceSnapshot>;
    /** Count guarded snapshot attempts, copying successful reads before an adapter can mutate them. */
    private load;
    /** Verify all emitted counters before returning a successful packet. */
    finish(): VerificationReceipt;
}
//# sourceMappingURL=verification.d.ts.map