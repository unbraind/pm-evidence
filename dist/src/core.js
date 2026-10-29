import { createHash } from 'node:crypto';
import { createOutputOmissionReceipt, estimatePmOutputTokens } from '@unbrained/pm-cli/sdk';
import { encode } from '@toon-format/toon';
/** Stable refusal discriminants for SDK and compact row consumers. */
export const EVIDENCE_CODES = ['invalid', 'budget', 'missing', 'ambiguous', 'unsupported', 'boundary', 'canceled', 'inaccessible', 'race', 'size', 'timeout', 'conflict', 'integrity', 'schema', 'sdk'];
/** Typed refusal with an actionable remedy and no source or absolute path diagnostics. */
export class EvidenceError extends Error {
    /** Capture only package-owned safe diagnostics. */
    code;
    /** Safe recovery action for callers. */
    remedy;
    /** Construct a safe typed refusal. */
    constructor(code, message, remedy) { super(message); this.name = 'EvidenceError'; this.code = code; this.remedy = remedy; }
}
/** Hash exact UTF-8 fragment or source bytes. */
export function digest(value) { return createHash('sha256').update(value).digest('hex'); }
/** Refuse invalid input without echoing untrusted operands. */
export function requireInput(condition, message) { if (!condition)
    throw new EvidenceError('invalid', message, 'Use the documented selector, relative source and option bounds'); }
/** Escape control characters so terminal source data cannot change renderer behavior. */
export function inert(text) { return text.replace(/[\u0000-\u001f\u007f-\u009f]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`); }
/** Bound the actual larger host JSON/TOON representation including its receipt. */
export function tokens(value) { return estimatePmOutputTokens(Math.max(Buffer.byteLength(JSON.stringify(value, null, 2) + '\n'), Buffer.byteLength(encode(value) + '\n'))); }
/** Stabilize self-accounting so the token counter is included in the bound. */
function account(packet) { let count = tokens(packet); while (count !== packet.estimatedTokens) {
    packet.estimatedTokens = count;
    count = tokens(packet);
} return packet; }
/** Keep deterministic prefix rows and report every withheld result. */
export function packet(rows, scope, budget = 800, sourceComplete = true, verification) {
    requireInput(Number.isSafeInteger(budget) && budget >= 1 && budget <= 1_000_000, 'Budget must be an integer from 1 to 1000000');
    /** Translate SDK omission materiality into the stable package receipt without changing row counts. */
    const make = (selected) => {
        const omission = createOutputOmissionReceipt([{ name: 'rows', restore_with: 'Increase --budget' }], new Set(selected.length === rows.length ? ['rows'] : []));
        return account({ rows: selected, scope, receipt: { returned: selected.length, omitted: rows.length - selected.length, complete: !omission.has_omissions && sourceComplete, sourceComplete, estimator: 'ceil(utf8_bytes/4)', ...(verification === undefined ? {} : { verification }) }, estimatedTokens: 0 });
    };
    let result = make([]);
    if (result.estimatedTokens > budget)
        throw new EvidenceError('budget', 'Budget cannot hold the omission receipt', 'Increase --budget');
    for (const row of rows) {
        const next = make([...result.rows, row]);
        if (next.estimatedTokens > budget)
            break;
        result = next;
    }
    return result;
}
//# sourceMappingURL=core.js.map