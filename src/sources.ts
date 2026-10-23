import { constants } from 'node:fs';
import { open, readlink, realpath, stat } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { EvidenceError, digest, requireInput } from './core.ts';
import type { EvidenceOptions, ReadContext, SourceAdapter, SourceSnapshot } from './types.ts';

/** Reject source identities that could escape or disclose the selected source root. */
export function sourceIdentity(source: string): string {
  requireInput(source.length > 0 && !isAbsolute(source) && !source.includes('\\') && !source.split('/').includes('..') && !/[\u0000-\u001f\u007f-\u009f]/.test(source) && !/^[a-z]:/i.test(source), 'Source must be a root-relative path without traversal');
  return source.replace(/^\.\//, '');
}
/** Require a canonical path to stay inside the caller's canonical root. */
function inside(root: string, path: string): void { const rel = relative(root, path); if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new EvidenceError('boundary', 'Source escapes the selected root', 'Choose a source inside --root and remove escaping symlinks'); }
/** Optional filesystem lifecycle barriers for deterministic real-source race acceptance tests. */
export interface SourceReadBarriers { afterCanonical?: () => Promise<void>; afterPathStat?: () => Promise<void> }
/** Verify the kernel descriptor target and identity instead of trusting a mutable pathname. */
export async function verifyDescriptor(handle: FileHandle, root: string, platform = process.platform, afterTarget?: () => Promise<void>): Promise<void> {
  if (platform !== 'linux') throw new EvidenceError('unsupported', 'Descriptor containment verification requires Linux procfs', 'Use Linux with accessible procfs or a trusted adapter with equivalent descriptor guarantees');
  let target: string;
  try { target = await readlink(`/proc/self/fd/${handle.fd}`); }
  catch { throw new EvidenceError('unsupported', 'Descriptor containment verification is unavailable', 'Make Linux procfs descriptor links accessible; path-only reads are not enabled'); }
  await afterTarget?.();
  inside(root, target);
  const canonical = await realpath(target); inside(root, canonical);
  const opened = await handle.stat({ bigint: true }); const located = await stat(canonical, { bigint: true });
  if ((['dev', 'ino'] as const).some(key => opened[key] !== located[key])) throw new EvidenceError('race', 'Descriptor target identity changed', 'Retry after source paths and directory writers are stable');
}
/** Coherent, bounded local UTF-8 snapshot; changed metadata or identity refuses the read. */
export async function readFileSnapshot(source: string, context: ReadContext, afterDiscovery?: () => Promise<void>, barriers: SourceReadBarriers = {}): Promise<SourceSnapshot> {
  const root = await realpath(context.root); const path = resolve(root, sourceIdentity(source)); inside(root, path);
  const canonical = await realpath(path); inside(root, canonical);
  await barriers.afterCanonical?.();
  const discovered = await stat(canonical, { bigint: true });
  if (!discovered.isFile() || (discovered.mode & 0o444n) === 0n) throw new EvidenceError('inaccessible', 'Source is not a readable regular file', 'Restore read permissions or select a regular file');
  if (discovered.size > BigInt(context.maxBytes)) throw new EvidenceError('size', 'Source exceeds the size cap', 'Select a smaller source or explicitly increase maxBytes');
  await afterDiscovery?.();
  context.signal.throwIfAborted();
  const handle = await open(canonical, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    await verifyDescriptor(handle, root);
    const bytes = Buffer.alloc(context.maxBytes + 1); let used = 0;
    while (used < bytes.length) { context.signal.throwIfAborted(); const read = await handle.read(bytes, used, bytes.length - used, used); if (read.bytesRead === 0) break; used += read.bytesRead; }
    if (used > context.maxBytes) throw new EvidenceError('size', 'Source grew beyond the size cap', 'Retry with a stable smaller source');
    const after = await handle.stat({ bigint: true }); const current = await stat(path, { bigint: true });
    await barriers.afterPathStat?.();
    if (['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].some(key => discovered[key as 'ino'] !== after[key as 'ino'] || after[key as 'ino'] !== current[key as 'ino'])) throw new EvidenceError('race', 'Source changed during discovery or read', 'Retry after the source writer finishes');
    inside(root, await realpath(path));
    await verifyDescriptor(handle, root);
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, used));
    return { text, revision: digest(text) };
  } finally { await handle.close(); }
}
/** Built-in file adapter accepts only guarded local snapshots. */
export const fileAdapter: SourceAdapter = { provider: 'file', read: readFileSnapshot };
/** JSON uses the same guarded bytes and separate pointer selection. */
export const jsonAdapter: SourceAdapter = { provider: 'json', read: readFileSnapshot };
/** Apply cancellation, size and deadline limits even to caller-provided adapters. */
export async function snapshot(provider: string, source: string, options: EvidenceOptions): Promise<SourceSnapshot> {
  const adapter = [...(options.adapters ?? []), fileAdapter, jsonAdapter].find(entry => entry.provider === provider);
  if (adapter === undefined) throw new EvidenceError('unsupported', 'Source provider is unavailable', 'Supply the typed adapter that owns this provider');
  const maxBytes = options.maxBytes ?? 1_048_576; const timeoutMs = options.timeoutMs ?? 5000;
  requireInput(Number.isSafeInteger(maxBytes) && maxBytes > 0 && maxBytes <= 16_777_216 && Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 60_000, 'Invalid source size or deadline bounds');
  const controller = new AbortController(); const signal = options.signal === undefined ? controller.signal : AbortSignal.any([controller.signal, options.signal]);
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { controller.abort(); reject(new EvidenceError('timeout', 'Source read deadline exceeded', 'Retry with an available bounded source')); }, timeoutMs); });
  const read = async (): Promise<SourceSnapshot> => {
    signal.throwIfAborted();
    const result = await Promise.race([adapter.read(sourceIdentity(source), { root: options.root ?? '.', maxBytes, signal }), timeout]);
    signal.throwIfAborted();
    requireInput(Buffer.byteLength(result.text) <= maxBytes && result.revision === digest(result.text), 'Adapter must return one size-bounded content digest revision');
    return result;
  };
  return read().catch(error => { throw sourceError(error); }).finally(() => { clearTimeout(timer); });
}

/** Normalize arbitrary adapter failures without disclosing source paths or exception content. */
function sourceError(error: unknown): EvidenceError {
  if (error instanceof EvidenceError) return error;
  const missing = typeof error === 'object' && error !== null && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR');
  return new EvidenceError(missing ? 'missing' : 'inaccessible', missing ? 'Source is missing' : 'Source cannot be read coherently', 'Restore the source, permissions or adapter, then retry');
}
