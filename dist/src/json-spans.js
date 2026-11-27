import { EvidenceError } from './core.js';
/** Refuse malformed or excessively deep JSON without echoing source bytes. */
function invalidJson() { throw new EvidenceError('unsupported', 'Source is not valid JSON within the nesting limit', 'Use valid JSON with at most 256 nested containers'); }
/** Whitespace permitted by the JSON grammar, compared by code unit. */
function isJsonSpaceCode(code) { return code === 32 || code === 9 || code === 13 || code === 10; }
/** Decimal digits accepted in every JSON number position. */
function isDigit(code) { return code >= 48 && code <= 57; }
/** Hexadecimal digits accepted inside one \u escape. */
function isHex(code) { return isDigit(code) || (code >= 97 && code <= 102) || (code >= 65 && code <= 70); }
/** One JSON grammar escape character following a backslash, excluding \u. */
function isSimpleEscape(code) { return code === 34 || code === 92 || code === 47 || code === 98 || code === 102 || code === 110 || code === 114 || code === 116; }
/** Validate the complete document while retaining the exact span of every value, in one linear scan per byte. */
function parseSpans(text) {
    const length = text.length;
    let cursor = 0;
    /** Skip only whitespace permitted by the JSON grammar. */
    function whitespace() { let index = cursor; while (isJsonSpaceCode(text.charCodeAt(index)))
        index++; cursor = index; }
    /** Scan one grammar string linearly; its raw bytes are already valid input to JSON.parse key decoding. */
    function stringToken() {
        let index = cursor + 1;
        for (;;) {
            if (index >= length)
                invalidJson();
            const code = text.charCodeAt(index);
            if (code === 34) {
                const raw = text.slice(cursor, index + 1);
                cursor = index + 1;
                return raw;
            }
            if (code === 92) {
                const escape = text.charCodeAt(index + 1);
                if (escape === 117) {
                    if (index + 6 > length || !isHex(text.charCodeAt(index + 2)) || !isHex(text.charCodeAt(index + 3)) || !isHex(text.charCodeAt(index + 4)) || !isHex(text.charCodeAt(index + 5)))
                        invalidJson();
                    index += 6;
                    continue;
                }
                if (!isSimpleEscape(escape))
                    invalidJson();
                index += 2;
                continue;
            }
            if (code < 32)
                invalidJson();
            index++;
        }
    }
    /** Consume one literal word or refuse exactly where the retired alternation did. */
    function literal(word) {
        for (let index = 0; index < word.length; index++)
            if (text.charCodeAt(cursor + index) !== word.charCodeAt(index))
                invalidJson();
        cursor += word.length;
    }
    /** Scan one number lexeme without converting it to floating point or backtracking. */
    function numberToken() {
        if (text.charCodeAt(cursor) === 45)
            cursor++;
        const lead = text.charCodeAt(cursor);
        if (lead === 48)
            cursor++;
        else if (lead >= 49 && lead <= 57) {
            do
                cursor++;
            while (isDigit(text.charCodeAt(cursor)));
        }
        else
            invalidJson();
        if (text.charCodeAt(cursor) === 46) {
            cursor++;
            if (!isDigit(text.charCodeAt(cursor)))
                invalidJson();
            do
                cursor++;
            while (isDigit(text.charCodeAt(cursor)));
        }
        const exponent = text.charCodeAt(cursor);
        if (exponent === 101 || exponent === 69) {
            cursor++;
            if (text.charCodeAt(cursor) === 43 || text.charCodeAt(cursor) === 45)
                cursor++;
            if (!isDigit(text.charCodeAt(cursor)))
                invalidJson();
            do
                cursor++;
            while (isDigit(text.charCodeAt(cursor)));
        }
    }
    /** Consume one grammar scalar token: string, literal or number lexeme. */
    function scalarToken() {
        const opening = text[cursor];
        if (opening === '"') {
            stringToken();
            return;
        }
        if (opening === 'n') {
            literal('null');
            return;
        }
        if (opening === 't') {
            literal('true');
            return;
        }
        if (opening === 'f') {
            literal('false');
            return;
        }
        numberToken();
    }
    /** Parse a bounded value and index container members by decoded JSON pointer tokens. */
    function value(depth) {
        whitespace();
        const start = cursor;
        const opening = text[cursor];
        if (opening !== '{' && opening !== '[') {
            scalarToken();
            return { start, end: cursor };
        }
        if (depth >= 256)
            invalidJson();
        const members = new Map();
        const closing = opening === '{' ? '}' : ']';
        cursor++;
        whitespace();
        if (text[cursor] !== closing) {
            for (;;) {
                let key;
                if (opening === '{') {
                    if (text[cursor] !== '"')
                        invalidJson();
                    key = JSON.parse(stringToken());
                    whitespace();
                    if (text[cursor++] !== ':')
                        invalidJson();
                    if (members.has(key))
                        throw new EvidenceError('ambiguous', 'JSON object contains repeated decoded keys', 'Use unique object keys before citing a JSON pointer');
                }
                else
                    key = String(members.size);
                members.set(key, value(depth + 1));
                whitespace();
                if (text[cursor] === closing)
                    break;
                if (text[cursor++] !== ',')
                    invalidJson();
                whitespace();
            }
        }
        cursor++;
        return { start, end: cursor, members };
    }
    const root = value(0);
    whitespace();
    if (cursor !== length)
        invalidJson();
    return root;
}
/** Resolve RFC 6901 to exact JSON value bytes, preserving number lexemes and internal whitespace. */
export function jsonFragment(text, tokens) {
    let selected = parseSpans(text);
    for (const key of tokens) {
        const next = selected.members?.get(key);
        if (next === undefined)
            throw new EvidenceError('missing', 'JSON pointer does not resolve', 'Select an existing RFC 6901 pointer');
        selected = next;
    }
    return { text: text.slice(selected.start, selected.end), start: selected.start, end: selected.end };
}
//# sourceMappingURL=json-spans.js.map