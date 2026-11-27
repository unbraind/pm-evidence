import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { anchor, headingLines, select, sectionPath } from '../src/selectors.ts';

/** The retired ATX heading regex, kept as the byte-exact parity oracle for the linear parser. */
const retiredHeadingRegex = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*\r?$/gm;
/** Curated normal, edge, CommonMark and line-terminator heading documents. */
const parityCorpus: readonly string[] = [
  '# Title', '## Subtitle', '### Deep ###', '###### Six ######', '####### Not a heading', '###### Six #',
  '#NoSpace', '#5 bolt', '#hashtag', ' # indented', '\t# tabbed', '#', '##', '# ', '#  ', '#   ', '#\t', '#\t\t',
  '# Title #', '# Title#', '# Title ##  ', '# #', '# ##', '# ###', '# #####', '# a # b # c', '#  # trailing #',
  '# foo ## ##', '# `code` #', '# foo bar ###', '# foo ### ', '# foo\t#\t', '# foo #!', '# foo#!', '# x# ', '# x #x',
  '#\tTabbed\tTitle\t#\t', '# trailing spaces   ', '# \u00a0nbsp', '# \ud83d\ude00 emoji', '# ünïcödé',
  '# 1 # 2 # 3', '# #### #####', '###### x#', '#\t#\t', '#\u2028#', '#\r#', '# ###\t  \t', '# ####\r',
  '# Title\r', '# Title\r\nBody', '# Title\rBody', '# CRLF\r\rTail', '# LS\u2028Body', '# PS\u2029Body', '# x \r\n# y\r\n',
  '# x        y', '#     ###y', '# \t\t##y',
  'a\n# Mid\ndoc\n\r\n', '# One\n# Two\n## Three\n# Four\n', '', '\n', '\r\n', 'no headings at all'
];
/** Build one deterministic random document whose lines mix hashes, whitespace and embedded line terminators. */
function randomDocument(random: () => number, lineCount: number, maxWidth: number, joiners: readonly string[]): string {
  const alphabet = ['#', ' ', '\t', 'a', '#', ' ', '#', '\n', '\r', '\u2028', 'x'];
  const lines: string[] = [];
  for (let line = 0; line < lineCount; line++) {
    let text = '';
    const width = Math.floor(random() * maxWidth);
    for (let index = 0; index < width; index++) text += alphabet[Math.floor(random() * alphabet.length)];
    lines.push(text);
  }
  return lines.join(joiners[Math.floor(random() * joiners.length)]);
}
/** Read the retired regex's depth, title and span tuples from one document. */
function retiredHeadings(text: string): { depth: number; title: string; start: number; end: number }[] {
  return [...text.matchAll(retiredHeadingRegex)].map(match => ({ depth: match[1].length, title: match[2], start: match.index, end: match.index + match[0].length }));
}
/** Deterministic small-step PRNG so the differential corpus is identical on every run. */
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => { state = (state * 1103515245 + 12345) % 2147483648; return state / 2147483648; };
}

test('linear heading parser matches the retired regex byte-for-byte on normal, edge and CommonMark lines', () => {
  for (const text of parityCorpus) assert.deepEqual([...headingLines(text)], retiredHeadings(text), JSON.stringify(text));
});

test('randomized documents keep the linear parser byte-identical to the retired regex', () => {
  const random = seededRandom(20261127);
  for (let round = 0; round < 400; round++) {
    const document = randomDocument(random, 6, 24, ['\n', '\r\n', '\u2028']);
    assert.deepEqual([...headingLines(document)], retiredHeadings(document), JSON.stringify(document));
  }
});

test('hostile heading lines resolve within a fixed budget instead of backtracking polynomially', () => {
  const spaceRunTitle = 'x' + ' '.repeat(50_000) + 'y';
  const spaceRun = '# ' + spaceRunTitle;
  const hashRun = '# ' + ' '.repeat(25_000) + '#'.repeat(24_999) + 'y';
  const document = 'Before.\n\n# Policy\n\nClaim.\n\n' + spaceRun + '\n\n## Child\n\nNested.\n\n' + hashRun + '\n\n# Tail\n\nLast.\n';
  const began = process.hrtime.bigint();
  const parsedRun = [...headingLines(spaceRun)];
  assert.equal(parsedRun.length, 1);
  assert.equal(parsedRun[0].title, spaceRunTitle);
  assert.equal([...headingLines(hashRun)].length, 1);
  const fragment = select(document, { kind: 'heading', heading: 'Policy', paragraph: 1 });
  assert.equal(fragment.text, 'Claim.');
  assert.deepEqual(sectionPath(document, fragment.start), ['Policy']);
  const nested = select(document, { kind: 'heading', heading: 'Child', paragraph: 1 });
  assert.equal(nested.text, 'Nested.');
  assert.deepEqual(sectionPath(document, nested.start), [spaceRunTitle, 'Child']);
  assert.equal(select('# Policy\r\n\r\nFirst.\r\n', { kind: 'heading', heading: 'Policy', paragraph: 1 }).text, 'First.\r');
  const elapsedMs = Number(process.hrtime.bigint() - began) / 1e6;
  assert.ok(elapsedMs < 2500, `hostile heading resolution took ${elapsedMs.toFixed(1)}ms`);
});

test('hostile heading line scan stays under the regression budget', () => {
  const hostile = '# x' + ' '.repeat(800) + 'y';
  const began = process.hrtime.bigint();
  assert.equal([...headingLines(hostile)].length, 1);
  const elapsedMs = Number(process.hrtime.bigint() - began) / 1e6;
  assert.ok(elapsedMs < 100, `hostile heading line scan took ${elapsedMs.toFixed(1)}ms`);
});

test('the retired regex demonstrably exceeds the same budget on the hostile line', () => {
  assert.equal([...headingLines('# x' + ' '.repeat(3200) + 'y')].length, 1);
  const probe = spawnSync(process.execPath, ['-e', "const rx=/^(#{1,6})[ \\t]+(.+?)[ \\t]*#*[ \\t]*\\r?$/gm; const line='# x'+' '.repeat(3200)+'y'; void [...line.matchAll(rx)].length;"], { timeout: 400 });
  assert.equal(probe.signal, 'SIGTERM', 'the retired regex finished the hostile line within the budget');
});

/** The retired unbounded ancestry scan, kept as an independent equivalence oracle for the offset bound. */
function retiredSectionPath(text: string, offset: number): string[] {
  const headings = [...headingLines(text)].filter(heading => !(heading.start >= offset));
  return headings.filter((heading, index) => headings.slice(index + 1).every(later => later.depth > heading.depth)).map(entry => entry.title);
}

test('the offset bound keeps ancestry byte-identical to the unbounded scan for every offset kind', () => {
  const random = seededRandom(861127 + 7);
  for (let round = 0; round < 300; round++) {
    const document = randomDocument(random, 8, 20, ['\n', '\r\n']);
    for (const offset of [0, 1, 2.5, -3, document.length / 2, document.length - 1, document.length, document.length + 5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      assert.deepEqual(sectionPath(document, offset), retiredSectionPath(document, offset), JSON.stringify([document, offset]));
    }
  }
});

test('the heading list bound returns exactly the headings starting before it', () => {
  const random = seededRandom(20261127 + 5);
  for (let round = 0; round < 300; round++) {
    const document = randomDocument(random, 8, 20, ['\n', '\u2028']);
    const full = [...headingLines(document)];
    for (const bound of [-3, 0, 1, 2.5, document.length / 2, document.length - 1, document.length, document.length + 9]) {
      assert.deepEqual([...headingLines(document, bound)], full.filter(entry => entry.start < bound), JSON.stringify([document, bound]));
    }
  }
});

test('ancestry scans stop at the requested offset instead of the whole document', () => {
  const shortPrefix = '# Root\n\nBody.\n';
  const document = shortPrefix + '# h\n'.repeat(4_000_000);
  const began = process.hrtime.bigint();
  const fragment = select(shortPrefix, { kind: 'heading', heading: 'Root', paragraph: 1 });
  assert.equal(fragment.text, 'Body.');
  assert.deepEqual(sectionPath(document, fragment.start), ['Root']);
  const witness = anchor(document, fragment, true);
  assert.deepEqual(witness.sectionPath, ['Root']);
  const elapsedMs = Number(process.hrtime.bigint() - began) / 1e6;
  assert.ok(elapsedMs < 100, `short-prefix setup and bounded ancestry scan took ${elapsedMs.toFixed(1)}ms`);
});

test('ancestry resolution stays within a bounded heap over millions of headings', () => {
  const probeSource = [
    `const { sectionPath } = await import(${JSON.stringify(new URL('../src/selectors.ts', import.meta.url).href)});`,
    `const document = '# h\\n'.repeat(4_000_000) + '# Root\\n\\nBody.\\n';`,
    "const offset = document.indexOf('Body.');",
    "const path = sectionPath(document, offset);",
    "if (JSON.stringify(path) !== JSON.stringify(['Root'])) process.exit(3);",
    "console.log('bounded');",
  ].join('\n');
  const probe = spawnSync(process.execPath, ['--max-old-space-size=256', '--input-type=module', '-e', probeSource], { encoding: 'utf8', timeout: 120000 });
  assert.equal(probe.status, 0, `ancestry probe failed: ${probe.status} ${String(probe.stderr).slice(0, 200)}`);
  assert.match(probe.stdout, /bounded/);
});
