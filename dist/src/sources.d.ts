import type { FileHandle } from 'node:fs/promises';
import type { EvidenceOptions, ReadContext, SourceAdapter, SourceSnapshot } from './types.ts';
/** Reject source identities that could escape or disclose the selected source root. */
export declare function sourceIdentity(source: string): string;
/** Optional filesystem lifecycle barriers for deterministic real-source race acceptance tests. */
export interface SourceReadBarriers {
    afterCanonical?: () => Promise<void>;
    afterPathStat?: () => Promise<void>;
}
/** Verify the kernel descriptor target and identity instead of trusting a mutable pathname. */
export declare function verifyDescriptor(handle: FileHandle, root: string, platform?: NodeJS.Platform, afterTarget?: () => Promise<void>): Promise<void>;
/** Coherent, bounded local UTF-8 snapshot; changed metadata or identity refuses the read. */
export declare function readFileSnapshot(source: string, context: ReadContext, afterDiscovery?: () => Promise<void>, barriers?: SourceReadBarriers): Promise<SourceSnapshot>;
/** Built-in file adapter accepts only guarded local snapshots. */
export declare const fileAdapter: SourceAdapter;
/** JSON uses the same guarded bytes and separate pointer selection. */
export declare const jsonAdapter: SourceAdapter;
/** Apply cancellation, size and deadline limits even to caller-provided adapters. */
export declare function snapshot(provider: string, source: string, options: EvidenceOptions): Promise<SourceSnapshot>;
//# sourceMappingURL=sources.d.ts.map