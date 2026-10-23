import { EvidenceError, requireInput } from './core.ts';
import type { Anchor, Descriptor, Selector } from './types.ts';

/** A selected byte-preserving substring and its offsets within the UTF-8 decoded text. */
export interface Fragment { text: string; start: number; end: number }
/** Report every exact occurrence, including overlaps; never accept a fuzzy match. */
export function hits(text: string, quote: string): number[] {
  if (quote.length === 0) return [];
  const found: number[] = []; let cursor = text.indexOf(quote);
  while (cursor !== -1) { found.push(cursor); cursor = text.indexOf(quote, cursor + 1); }
  return found;
}
/** Read RFC 6901 tokens strictly, retaining array and own-property semantics. */
function pointer(text: string, path: string): Fragment {
  requireInput(path === '' || path.startsWith('/'), 'JSON pointer must be empty or start with slash');
  requireInput(!/~(?:[^01]|$)/.test(path), 'JSON pointer has an invalid escape');
  let value: unknown;
  try { value = JSON.parse(text) as unknown; } catch { throw new EvidenceError('unsupported', 'Source is not valid JSON', 'Repair the JSON source before citing it'); }
  for (const part of path === '' ? [] : path.slice(1).split('/')) {
    const key = part.replace(/~1/g, '/').replace(/~0/g, '~');
    if (typeof value !== 'object' || value === null || !Object.hasOwn(value, key) || (Array.isArray(value) && !/^(0|[1-9]\d*)$/.test(key))) throw new EvidenceError('missing', 'JSON pointer does not resolve', 'Select an existing RFC 6901 pointer');
    value = (value as Record<string, unknown>)[key];
  }
  return { text: JSON.stringify(value), start: 0, end: 0 };
}
/** Select an ATX heading's paragraph; duplicate headings cannot establish identity. */
function paragraph(text: string, selector: Extract<Selector, { kind: 'heading' }>): Fragment {
  requireInput(selector.heading.length > 0 && !/[\u0000-\u001f\u007f-\u009f]/.test(selector.heading) && Number.isSafeInteger(selector.paragraph) && selector.paragraph > 0, 'Heading and positive paragraph number are required');
  const headings = [...text.matchAll(/^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*\r?$/gm)];
  const matches = headings.filter(entry => entry[2] === selector.heading);
  if (matches.length !== 1) throw new EvidenceError(matches.length === 0 ? 'missing' : 'ambiguous', 'Heading is absent or repeated', 'Select a unique ATX heading');
  const heading = matches[0]; const start = heading.index + heading[0].length;
  const next = headings.find(entry => entry.index > heading.index && entry[1].length <= heading[1].length);
  const section = text.slice(start, next?.index);
  const paragraphs = [...section.matchAll(/\S[^\n]*(?:\n(?![ \t]*\r?$)[^\n]+)*/gm)].filter(entry => !entry[0].startsWith('#'));
  const selected = paragraphs[selector.paragraph - 1];
  if (selected === undefined) throw new EvidenceError('missing', 'Paragraph does not resolve', 'Choose an existing paragraph in the heading section');
  const offset = start + selected.index;
  return { text: selected[0], start: offset, end: offset + selected[0].length };
}
/** Resolve the caller's initial structural selector without whole-document output. */
export function select(text: string, selector: Selector): Fragment {
  if (selector.kind === 'pointer') return pointer(text, selector.pointer);
  if (selector.kind === 'heading') return paragraph(text, selector);
  requireInput(selector.kind === 'lines' && Number.isSafeInteger(selector.start) && Number.isSafeInteger(selector.end) && selector.start >= 1 && selector.end >= selector.start, 'Line range must be positive and ordered');
  const lines = text.split('\n'); if (lines.at(-1) === '') lines.pop();
  if (selector.end > lines.length) throw new EvidenceError('missing', 'Line range exceeds the source', 'Choose lines present in the source');
  const start = lines.slice(0, selector.start - 1).join('\n').length + (selector.start === 1 ? 0 : 1);
  const fragment = lines.slice(selector.start - 1, selector.end).join('\n');
  requireInput(fragment.length > 0, 'An anchor cannot cite an empty fragment');
  return { text: fragment, start, end: start + fragment.length };
}
/** Retain exact quote plus neighboring characters for conservative changed-region recovery. */
export function anchor(text: string, fragment: Fragment): Anchor { return { quote: fragment.text, before: text.slice(Math.max(0, fragment.start - 24), fragment.start), after: text.slice(fragment.end, fragment.end + 24) }; }
/** Relocate only a unique exact quote or unique exact surrounding boundaries. */
export function resolveFragment(text: string, descriptor: Descriptor): Fragment {
  if (descriptor.selector.kind === 'pointer') return select(text, descriptor.selector);
  const witness = descriptor.anchor;
  requireInput(witness !== undefined, 'Text citation has no anchor');
  const occurrences = hits(text, witness.quote);
  if (occurrences.length > 1) throw new EvidenceError('ambiguous', 'Exact anchor occurs more than once', 'Review and explicitly re-anchor to a unique passage');
  if (occurrences.length === 1) return { text: witness.quote, start: occurrences[0], end: occurrences[0] + witness.quote.length };
  const before = hits(text, witness.before); const after = hits(text, witness.after);
  if (before.length > 1 || after.length > 1) throw new EvidenceError('ambiguous', 'Anchor boundaries are repeated', 'Review a unique source passage');
  const start = witness.before === '' ? 0 : before.length === 1 ? before[0] + witness.before.length : -1;
  const end = witness.after === '' ? text.length : after.length === 1 ? after[0] : -1;
  if (start < 0 || end < start) throw new EvidenceError('missing', 'Exact anchor and boundaries no longer resolve', 'Review the current source and explicitly re-anchor');
  return { text: text.slice(start, end), start, end };
}
