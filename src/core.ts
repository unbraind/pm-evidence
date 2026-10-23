import { createHash } from 'node:crypto';
import { encode } from '@toon-format/toon';
import type { Packet } from './types.ts';

/** Typed refusal with an actionable remedy and no source or absolute path diagnostics. */
export class EvidenceError extends Error {
  /** Capture only package-owned safe diagnostics. */
  readonly code: string;
  /** Safe recovery action for callers. */
  readonly remedy: string;
  /** Construct a safe typed refusal. */
  constructor(code: string, message: string, remedy: string) { super(message); this.name = 'EvidenceError'; this.code = code; this.remedy = remedy; }
}
/** Hash exact UTF-8 fragment or source bytes. */
export function digest(value: string): string { return createHash('sha256').update(value).digest('hex'); }
/** Refuse invalid input without echoing untrusted operands. */
export function requireInput(condition: unknown, message: string): asserts condition { if (!condition) throw new EvidenceError('invalid', message, 'Use the documented selector, relative source and option bounds'); }
/** Escape control characters so terminal source data cannot change renderer behavior. */
export function inert(text: string): string { return text.replace(/[\u0000-\u001f\u007f-\u009f]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`); }
/** Bound the actual larger host JSON/TOON representation including its receipt. */
export function tokens(value: unknown): number { return Math.ceil(Math.max(Buffer.byteLength(JSON.stringify(value, null, 2) + '\n'), Buffer.byteLength(encode(value) + '\n')) / 4); }
/** Stabilize self-accounting so the token counter is included in the bound. */
function account<T>(packet: Packet<T>): Packet<T> { let count = tokens(packet); while (count !== packet.estimatedTokens) { packet.estimatedTokens = count; count = tokens(packet); } return packet; }
/** Keep deterministic prefix rows and report every withheld result. */
export function packet<T>(rows: T[], scope: Packet<T>['scope'], budget = 800, sourceComplete = true): Packet<T> {
  requireInput(Number.isSafeInteger(budget) && budget >= 1 && budget <= 1_000_000, 'Budget must be an integer from 1 to 1000000');
  const make = (selected: T[]): Packet<T> => account({ rows: selected, scope, receipt: { returned: selected.length, omitted: rows.length - selected.length, complete: selected.length === rows.length && sourceComplete, sourceComplete, estimator: 'ceil(utf8_bytes/4)' }, estimatedTokens: 0 });
  let result = make([]);
  if (result.estimatedTokens > budget) throw new EvidenceError('budget', 'Budget cannot hold the omission receipt', 'Increase --budget');
  for (const row of rows) { const next = make([...result.rows, row]); if (next.estimatedTokens > budget) break; result = next; }
  return result;
}
