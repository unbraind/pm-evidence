import assert from 'node:assert/strict';
import { test } from 'node:test';
import { select, anchor, resolveFragment, hits } from '../src/selectors.ts';
import { digest, inert, packet, tokens } from '../src/core.ts';
import { sourceIdentity, snapshot } from '../src/sources.ts';
import { state, citationById } from '../src/store.ts';
import type { Descriptor, Selector } from '../src/types.ts';

/** Construct an exact synthetic line descriptor for independent selector tests. */
function descriptor(text: string, start = 1, end = 1): Descriptor { const selector = { kind: 'lines', start, end } as const; return { provider: 'file', source: 'doc.md', revision: digest(text), selector, anchor: anchor(text, select(text, selector)) }; }

test('selector boundaries, duplicate quotes, exact context recovery and strict failures', () => {
  assert.deepEqual(hits('aaaa', 'aa'), [0, 1, 2]); assert.deepEqual(hits('text', ''), []);
  for (const selector of [{ kind: 'lines', start: 0, end: 1 }, { kind: 'lines', start: 2, end: 1 }, { kind: 'lines', start: 1.5, end: 2 }] as Selector[]) assert.throws(() => select('hello', selector));
  assert.throws(() => select('\n', { kind: 'lines', start: 1, end: 1 })); assert.throws(() => select('one\n', { kind: 'lines', start: 1, end: 2 }));
  const full = descriptor('old'); assert.equal(resolveFragment('new', full).text, 'new');
  const middle = descriptor('before\nold\nafter', 2, 2); assert.equal(resolveFragment('before\nnew\nafter', middle).text, 'new');
  assert.throws(() => resolveFragment('other', middle), /no longer resolve/);
  assert.throws(() => resolveFragment('before\nnew\nafterbefore\nnew\nafter', middle), /repeated/);
  assert.throws(() => resolveFragment('oldold', full), /more than once/);
  assert.throws(() => resolveFragment('old', { ...full, anchor: undefined }), /no anchor/);
  assert.equal(resolveFragment('old after', descriptor('old\nafter')).text, 'old');
  const tail = descriptor('before\nold', 2, 2); assert.equal(resolveFragment('before\nnew', tail).text, 'new');
  assert.throws(() => resolveFragment('afterbefore', { ...middle, anchor: { quote: 'gone', before: 'before', after: 'after' } }));
});

test('heading selector refuses absent, repeated, empty and missing paragraphs', () => {
  const heading = { kind: 'heading', heading: 'Policy', paragraph: 1 } as const;
  assert.equal(select('# Policy\n\nFirst.\n\n# Next\n\nOther.', heading).text, 'First.');
  assert.equal(select('# Policy\n\nFirst.\n\nSecond.', { ...heading, paragraph: 2 }).text, 'Second.');
  assert.throws(() => select('# Other\n\nFirst.', heading)); assert.throws(() => select('# Policy\n\nFirst.\n\n# Policy\n\nSecond.', heading));
  assert.throws(() => select('# Policy\n', heading)); assert.throws(() => select('# Policy\n\nFirst.', { ...heading, paragraph: 0 }));
  assert.equal(select('# Policy\n\nMulti\nline.\n', heading).text, 'Multi\nline.');
});

test('JSON pointer root, arrays, invalid syntax, escapes and own properties', () => {
  const pointer = (value: string, path: string) => select(value, { kind: 'pointer', pointer: path }).text;
  assert.equal(pointer('{"x":1}', ''), '{"x":1}'); assert.equal(pointer('{"a/b":{"~":2}}', '/a~1b/~0'), '2');
  assert.equal(pointer('[false,null]', '/1'), 'null');
  for (const path of ['a', '/~2', '/~']) assert.throws(() => pointer('{}', path));
  for (const [source, path] of [['invalid',''], ['{}','/missing'], ['null','/x'], ['[1]','/00'], ['[1]','/length'], ['{}','/__proto__'], ['1','/x']]) assert.throws(() => pointer(source, path));
  assert.equal(resolveFragment('{"x":3}', { provider: 'json', source: 'x.json', revision: 'old', selector: { kind: 'pointer', pointer: '/x' } }).text, '3');
});

test('packet measures all host bytes, bounds omission receipt and rejects malformed state', () => {
  assert.equal(inert('safe'), 'safe'); assert.equal(inert('\u001b'), '\\u001b');
  assert.throws(() => packet([], { items: 0, citations: 0 }, 1)); assert.throws(() => packet([], { items: 0, citations: 0 }, NaN));
  const result = packet(['long'.repeat(300), 'short'], { items: 1, citations: 2 }, 120); assert.equal(result.receipt.omitted, 2); assert.equal(result.estimatedTokens, tokens(result));
  assert.equal(packet([], { items: 0, citations: 0 }).receipt.complete, true);
  for (const raw of ['{}', 'null', '{', '{"version":1,"revision":0,"citations":[{}]}']) assert.throws(() => state(raw));
  assert.deepEqual(state(undefined), { version: 1, revision: 0, citations: [] }); assert.throws(() => citationById([], 'none'));
  assert.equal(sourceIdentity('./doc.md'), 'doc.md'); assert.throws(() => sourceIdentity(''));
});

test('adapter deadlines, abort, size bounds and digest revision mismatches refuse safely', async () => {
  const workspace = 'unused';
  await assert.rejects(snapshot('file', 'source', { workspace, maxBytes: 0 }));
  await assert.rejects(snapshot('file', 'source', { workspace, timeoutMs: 0 }));
  await assert.rejects(snapshot('custom', 'source', { workspace, adapters: [{ provider: 'custom', read: async () => ({ text: 'text', revision: 'wrong' }) }] }));
  await assert.rejects(snapshot('custom', 'source', { workspace, maxBytes: 1, adapters: [{ provider: 'custom', read: async () => ({ text: 'long', revision: digest('long') }) }] }));
  const valid = await snapshot('custom', 'source', { workspace, adapters: [{ provider: 'custom', read: async () => ({ text: 'text', revision: digest('text') }) }] }); assert.equal(valid.text, 'text');
  await assert.rejects(snapshot('custom', 'source', { workspace, timeoutMs: 5, adapters: [{ provider: 'custom', read: async () => new Promise(() => {}) }] }), /deadline/);
  await assert.rejects(snapshot('file', 'source', { workspace, signal: AbortSignal.abort() }), /coherently/);
});

test('adapter failures do not expose raw exception values or native diagnostics', async () => {
  for (const error of [null, new Error('unavailable'), 'unavailable', { code: 'EACCES' }, { code: 'ENOTDIR' }]) {
    await assert.rejects(snapshot('custom', 'source', { workspace: 'unused', adapters: [{ provider: 'custom', read: async () => { throw error; } }] }));
  }
});
