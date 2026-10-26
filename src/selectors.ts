import { digest, EvidenceError, requireInput } from './core.ts';
import { parseSelector, ancestrySchema, anchorSchema } from './citation-schema.ts';
import { jsonFragment } from './json-spans.ts';
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
  const tokens = (path === '' ? [] : path.slice(1).split('/')).map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'));
  return jsonFragment(text, tokens);
}
/** Select an ATX heading's paragraph; duplicate headings cannot establish identity. */
function paragraph(text: string, selector: Extract<Selector, { kind: 'heading' }>): Fragment {
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
  selector = parseSelector(selector);
  if (selector.kind === 'pointer') return pointer(text, selector.pointer);
  if (selector.kind === 'heading') return paragraph(text, selector);
  const lines = text.split('\n'); if (lines.at(-1) === '') lines.pop();
  if (selector.end > lines.length) throw new EvidenceError('missing', 'Line range exceeds the source', 'Choose lines present in the source');
  const start = lines.slice(0, selector.start - 1).join('\n').length + (selector.start === 1 ? 0 : 1);
  const fragment = lines.slice(selector.start - 1, selector.end).join('\n');
  requireInput(fragment.length > 0, 'An anchor cannot cite an empty fragment');
  return { text: fragment, start, end: start + fragment.length };
}
/** Determine the full ATX heading ancestry at the cited passage, including repeated parent titles. */
export function sectionPath(text: string, offset: number): string[] {
  const stack: { depth: number; title: string }[] = [];
  for (const heading of text.matchAll(/^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*\r?$/gm)) {
    if (heading.index >= offset) break;
    while (stack.length > 0 && stack.at(-1)!.depth >= heading[1].length) stack.pop();
    stack.push({ depth: heading[1].length, title: heading[2] });
  }
  return ancestrySchema.parse(stack.map(entry => entry.title));
}
/** Retain exact quote, neighboring characters and Markdown ancestry for conservative relocation. */
export function anchor(text: string, fragment: Fragment, heading = false): Anchor { return anchorSchema.parse({ quote: fragment.text, before: text.slice(Math.max(0, fragment.start - 24), fragment.start), after: text.slice(fragment.end, fragment.end + 24), ...(heading ? { sectionPath: sectionPath(text, fragment.start) } : {}) }); }
/** Require matching immediate surroundings and section identity at every candidate passage. */
function passageContext(text: string, descriptor: Descriptor, start: number, end: number): void {
  const witness = descriptor.anchor!;
  const before = witness.before === '' ? start === 0 : text.slice(Math.max(0, start - witness.before.length), start) === witness.before;
  const after = witness.after === '' ? end === text.length : text.slice(end, end + witness.after.length) === witness.after;
  let section = true;
  if (witness.sectionPath !== undefined) section = JSON.stringify(sectionPath(text, start)) === JSON.stringify(witness.sectionPath);
  else if (descriptor.selector.kind === 'heading') section = digest(text) === descriptor.revision;
  if (!before || !after || !section) throw new EvidenceError('ambiguous', 'Passage surroundings or Markdown section identity changed', 'Review and explicitly re-anchor the intended passage; quote text alone is insufficient');
}
/** Relocate only a unique exact quote or unique exact surrounding boundaries. */
export function resolveFragment(text: string, descriptor: Descriptor): Fragment {
  if (descriptor.selector.kind === 'pointer') {
    if (descriptor.jsonEncoding !== 'source-bytes-v1' && digest(text) !== descriptor.revision) throw new EvidenceError('ambiguous', 'Legacy JSON citation lacks a lossless value encoding', 'Explicitly re-anchor the JSON pointer to record exact source bytes');
    return select(text, descriptor.selector);
  }
  const witness = descriptor.anchor;
  requireInput(witness !== undefined, 'Text citation has no anchor');
  const occurrences = hits(text, witness.quote);
  if (occurrences.length > 1) throw new EvidenceError('ambiguous', 'Exact anchor occurs more than once', 'Review and explicitly re-anchor to a unique passage');
  if (occurrences.length === 1) { const start = occurrences[0]; const end = start + witness.quote.length; passageContext(text, descriptor, start, end); return { text: witness.quote, start, end }; }
  const before = hits(text, witness.before); const after = hits(text, witness.after);
  if (before.length > 1 || after.length > 1) throw new EvidenceError('ambiguous', 'Anchor boundaries are repeated', 'Review a unique source passage');
  const start = witness.before === '' ? 0 : before.length === 1 ? before[0] + witness.before.length : -1;
  const end = witness.after === '' ? text.length : after.length === 1 ? after[0] : -1;
  if (start < 0 || end < start) throw new EvidenceError('missing', 'Exact anchor and boundaries no longer resolve', 'Review the current source and explicitly re-anchor');
  passageContext(text, descriptor, start, end);
  return { text: text.slice(start, end), start, end };
}
