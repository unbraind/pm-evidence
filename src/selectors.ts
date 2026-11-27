import { digest, EvidenceError, requireInput } from './core.ts';
import { parseSelector, ancestrySchema, anchorSchema, fragmentRequestSchema } from './citation-schema.ts';
import { jsonFragment } from './json-spans.ts';
import type { Anchor, Descriptor, Selector } from './types.ts';

/** A selected byte-preserving substring and its offsets within the UTF-8 decoded text. */
export interface Fragment { text: string; start: number; end: number }
/** Resolve exact current bytes with the production selector, independently of retained historical replay; performs no I/O or writes. */
export function resolveFragmentText(text: string, descriptor: Descriptor): string {
  const parsed = fragmentRequestSchema.safeParse({ text, descriptor });
  if (!parsed.success) throw new EvidenceError('invalid', 'Invalid fragment request', 'Supply a bounded source string and a producer-valid citation descriptor');
  return resolveFragment(parsed.data.text, parsed.data.descriptor).text;
}
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
/** One ATX heading line: opening hash depth, exact literal title and the whole matched span. */
export interface HeadingLine { depth: number; title: string; start: number; end: number }
/** JavaScript multiline anchors treat LF, CR, LS and PS alike when splitting lines. */
function isLineTerminator(char: string): boolean { return char === '\n' || char === '\r' || char === '\u2028' || char === '\u2029'; }
/** Parse one line exactly as the retired ATX regex did, in a single non-backtracking scan. */
function parseHeadingLine(text: string, start: number, end: number, matchEnd: number): HeadingLine | null {
  let depth = 0;
  while (depth < 7 && start + depth < end && text[start + depth] === '#') depth++;
  if (depth === 0 || depth === 7) return null;
  let width = depth;
  while (start + width < end && (text[start + width] === ' ' || text[start + width] === '\t')) width++;
  if (width === depth) return null;
  const content = start + width;
  if (content === end) return width === depth + 1 ? null : { depth, title: text.slice(end - 1, end), start, end: matchEnd };
  let scan = end - 1;
  while (scan >= content && (text[scan] === ' ' || text[scan] === '\t')) scan--;
  while (scan >= content && text[scan] === '#') scan--;
  while (scan >= content && (text[scan] === ' ' || text[scan] === '\t')) scan--;
  const tail = Math.max(scan + 1, content + 1);
  return { depth, title: text.slice(content, tail), start, end: matchEnd };
}
/** Yield every ATX heading starting before the exclusive end bound, in reading order, one linear pass per line, hostile input included; consumers that reduce to a bounded working set never materialize the whole list. */
export function* headingLines(text: string, end = text.length): Generator<HeadingLine, void, void> {
  const limit = Number.isNaN(end) ? text.length : Math.max(0, Math.min(end, text.length));
  const length = text.length;
  let start = 0;
  while (start < limit) {
    let lineEnd = start;
    while (lineEnd < length && !isLineTerminator(text[lineEnd])) lineEnd++;
    const matchEnd = lineEnd < length && text[lineEnd] === '\r' && (lineEnd + 1 === length || isLineTerminator(text[lineEnd + 1])) ? lineEnd + 1 : lineEnd;
    const heading = parseHeadingLine(text, start, lineEnd, matchEnd);
    if (heading !== null) yield heading;
    if (lineEnd === length) break;
    start = lineEnd + 1;
  }
}
/** Select an ATX heading's paragraph; duplicate headings cannot establish identity. */
function paragraph(text: string, selector: Extract<Selector, { kind: 'heading' }>): Fragment {
  const headings = [...headingLines(text)];
  const matches = headings.filter(entry => entry.title === selector.heading);
  if (matches.length !== 1) throw new EvidenceError(matches.length === 0 ? 'missing' : 'ambiguous', 'Heading is absent or repeated', 'Select a unique ATX heading');
  const heading = matches[0]; const start = heading.end;
  const next = headings.find(entry => entry.start > heading.start && entry.depth <= heading.depth);
  const section = text.slice(start, next?.start);
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
/** Determine the full ATX heading ancestry at the cited passage, scanning only lines before the offset, including repeated parent titles. */
export function sectionPath(text: string, offset: number): string[] {
  const stack: { depth: number; title: string }[] = [];
  for (const heading of headingLines(text, offset)) {
    while (stack.length > 0 && stack.at(-1)!.depth >= heading.depth) stack.pop();
    stack.push({ depth: heading.depth, title: heading.title });
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
