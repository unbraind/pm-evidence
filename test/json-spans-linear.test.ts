import assert from 'node:assert/strict';
import { test } from 'node:test';
import { jsonFragment } from '../src/json-spans.ts';

/** The retired sticky string token, kept as the acceptance oracle for the linear scanner. */
const retiredStringToken = /"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[\da-fA-F]{4}))*"/y;
/** Deterministic small-step PRNG so the differential corpus is identical on every run. */
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => { state = (state * 1103515245 + 12345) % 2147483648; return state / 2147483648; };
}

test('the string scanner agrees with the retired sticky token on random hostile bodies', () => {
  const random = seededRandom(861127);
  const pieces = ['"', '\\', '/', 'b', 'f', 'n', 'r', 't', 'u', '0', '9', 'a', 'F', 'x', 'z', '\u0001', '\u001f', ' ', '\u2028', '\ud83d', 'e'];
  for (let round = 0; round < 2000; round++) {
    let body = '"';
    const width = Math.floor(random() * 12);
    for (let index = 0; index < width; index++) body += pieces[Math.floor(random() * pieces.length)];
    body += '"';
    retiredStringToken.lastIndex = 0;
    const match = retiredStringToken.exec(body);
    const accepted = match !== null && retiredStringToken.lastIndex === body.length;
    if (accepted) assert.equal(jsonFragment(body, []).text, body);
    else assert.throws(() => jsonFragment(body, []), /valid JSON/);
  }
});

/** Measure one warm run in milliseconds, discarding a cold invocation. */
function measureMs(run: () => void): number { run(); const began = process.hrtime.bigint(); run(); return Number(process.hrtime.bigint() - began) / 1e6; }
/** A plain linear character scan of the same bytes, used to normalize scan budgets against runner load. */
function baselineScan(text: string): number { let count = 0; for (let index = 0; index < text.length; index++) if (text.charCodeAt(index) === 34) count++; return count; }

test('the internal-whitespace scan stays near the linear machine baseline', () => {
  const spaced = '{ ' + ' '.repeat(2_000_000) + '"a"' + ' '.repeat(2_000_000) + ': 1 }';
  const scanMs = measureMs(() => assert.equal(jsonFragment(spaced, ['a']).text, '1'));
  const baselineMs = measureMs(() => baselineScan(spaced));
  assert.ok(scanMs < 5 * baselineMs, `whitespace scan took ${scanMs.toFixed(1)}ms against a ${baselineMs.toFixed(1)}ms linear baseline`);
});

test('hostile JSON documents stay within the linear smoke budget', () => {
  const budget = (label: string, run: () => void, limitMs: number): void => {
    const elapsedMs = measureMs(run);
    assert.ok(elapsedMs < limitMs, `hostile ${label} scan took ${elapsedMs.toFixed(1)}ms`);
  };
  const escaped = '{ "k": "' + '\\u0041'.repeat(131_000) + '" }';
  const numbered = '[' + '9'.repeat(1_000_000) + ']';
  budget('escaped-string', () => assert.equal(jsonFragment(escaped, ['k']).text, '"' + '\\u0041'.repeat(131_000) + '"'), 1000);
  budget('digit-run', () => assert.equal(jsonFragment(numbered, []).text.length, 1_000_002), 800);
});

test('truncated literals refuse exactly where the retired alternation did', () => {
  for (const source of ['tru', 'nul', 'fals', 'trx', 'nUll', 'true1', 'nulx']) assert.throws(() => jsonFragment(source, []), /valid JSON/);
});

test('JSON span tokenization does not execute regular expressions', t => {
  const lexemes = ['null', 'true', 'false', '0', '-0', '9007199254740993', '1.00e+400', '-4.2E-7', '""', String.raw`"A\u0042\n\/"`, '[]', '{}'];
  for (const gap of ['', ' ', '\r\n\t', ' \t'.repeat(16)]) {
    const prefix = `${gap}{${gap}"\\u006b"${gap}:${gap}[${gap}`;
    const separator = `,${gap}`;
    const source = `${prefix}${lexemes.join(separator)}${gap}]${gap}}${gap}`;
    const fragments: ReturnType<typeof jsonFragment>[] = [];

    // Observe only the production call. The parity oracle and assertions may use regexes.
    const exec = t.mock.method(RegExp.prototype, 'exec');
    try {
      for (const index of lexemes.keys()) fragments.push(jsonFragment(source, ['k', String(index)]));
    } finally {
      exec.mock.restore();
    }

    assert.equal(exec.mock.callCount(), 0, 'JSON span tokenization must use the forward scanner');
    let start = prefix.length;
    for (const [index, text] of lexemes.entries()) {
      const end = start + text.length;
      assert.deepEqual(fragments[index], { text, start, end });
      start = end + separator.length;
    }
  }
});
