import { EvidenceError } from './core.ts';

/** A validated JSON value span; numbers remain unparsed source lexemes. */
interface JsonSpan { start: number; end: number; members?: Map<string, JsonSpan> }
/** Refuse malformed or excessively deep JSON without echoing source bytes. */
function invalidJson(): never { throw new EvidenceError('unsupported', 'Source is not valid JSON within the nesting limit', 'Use valid JSON with at most 256 nested containers'); }
/** Validate the complete document while retaining the exact span of every value. */
function parseSpans(text: string): JsonSpan {
  let cursor = 0;
  /** Skip only whitespace permitted by the JSON grammar. */
  function whitespace(): void { while (/[ \t\r\n]/.test(text[cursor] ?? 'x')) cursor++; }
  /** Consume one grammar token without converting number lexemes to floating point. */
  function token(pattern: RegExp): string { pattern.lastIndex = cursor; const match = pattern.exec(text); if (match === null) invalidJson(); cursor = pattern.lastIndex; return match[0]; }
  /** Decode object member names only; selected string values retain their raw bytes. */
  function stringToken(): string { return token(/"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[\da-fA-F]{4}))*"/y); }
  /** Parse a bounded value and index container members by decoded JSON pointer tokens. */
  function value(depth: number): JsonSpan {
    whitespace(); const start = cursor; const opening = text[cursor];
    if (opening !== '{' && opening !== '[') {
      if (opening === '"') stringToken();
      else token(/(?:null|true|false|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/y);
      return { start, end: cursor };
    }
    if (depth >= 256) invalidJson();
    const members = new Map<string, JsonSpan>(); const closing = opening === '{' ? '}' : ']'; cursor++; whitespace();
    if (text[cursor] !== closing) {
      for (;;) {
        let key: string;
        if (opening === '{') {
          key = JSON.parse(stringToken()) as string; whitespace();
          if (text[cursor++] !== ':') invalidJson();
          if (members.has(key)) throw new EvidenceError('ambiguous', 'JSON object contains repeated decoded keys', 'Use unique object keys before citing a JSON pointer');
        } else key = String(members.size);
        members.set(key, value(depth + 1)); whitespace();
        if (text[cursor] === closing) break;
        if (text[cursor++] !== ',') invalidJson();
        whitespace();
      }
    }
    cursor++; return { start, end: cursor, members };
  }
  const root = value(0); whitespace(); if (cursor !== text.length) invalidJson(); return root;
}
/** Resolve RFC 6901 to exact JSON value bytes, preserving number lexemes and internal whitespace. */
export function jsonFragment(text: string, tokens: readonly string[]): { text: string; start: number; end: number } {
  let selected = parseSpans(text);
  for (const key of tokens) {
    const next = selected.members?.get(key);
    if (next === undefined) throw new EvidenceError('missing', 'JSON pointer does not resolve', 'Select an existing RFC 6901 pointer');
    selected = next;
  }
  return { text: text.slice(selected.start, selected.end), start: selected.start, end: selected.end };
}
