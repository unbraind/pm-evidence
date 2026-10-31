import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PmClient } from '@unbrained/pm-cli/sdk';
import { cite, parseCitation, resolveFragmentText, EvidenceError, type Descriptor } from '../index.ts';

test('500 seeded source sequences preserve exact public SDK fragments, producer descriptors and native SDK state', async t => {
  const root = await mkdtemp(join(tmpdir(), 'evidence-fragment-sdk-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = join(root, '.agents', 'pm'); await mkdir(workspace, { recursive: true });
  const client = new PmClient({ cwd: root, pmRoot: workspace, noExtensions: true, author: 'fragment-test' });
  await client.init('fragment', { defaults: true, agentGuidance: 'skip', mergeFence: false });
  const { item } = await client.create({ type: 'Task', title: 'Exact source model', description: ' Native\r\nbytes ', unset: ['parent', 'assignee', 'sprint', 'release', 'goal', 'objective'] });
  const options = { root, workspace, client, author: 'fragment-test' };
  await writeFile(join(root, 'data.json'), '{"a/b":{"~":[0,"seed"]},"__proto__":{"value":true}}');
  for (const pointer of ['/a~1b/~0/0', '/a~1b/~0/1', '/__proto__/value', '']) await cite(item.id, 'data.json', { ...options, selector: { kind: 'pointer', pointer } });
  await writeFile(join(root, 'lines.md'), 'before\nseed\nafter');
  await cite(item.id, 'lines.md', { ...options, selector: { kind: 'lines', start: 2, end: 2 } });
  await writeFile(join(root, 'heading.md'), '## Heading\n\nseed');
  await cite(item.id, 'heading.md', { ...options, selector: { kind: 'heading', heading: 'Heading', paragraph: 1 } });
  const before = (await client.get(item.id, { full: true })).item;
  const citations = (JSON.parse(String(before.evidence_state)) as { citations: unknown[] }).citations.map(value => parseCitation(value, item.id));
  let seed = 0x53ace91;
  /** Reproducible integer choices never normalize or parse expected source bytes. */
  const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
  const numbers = ['0', '9007199254740993', '1e309', '-0', '2.500e-03', '-9007199254740995'];
  const strings = ['"literal\\ntext"', '"\\u0041"', '"escaped\\\\slash"', '" spaced "'];
  const history: Array<{ source: string; number: string; string: string; prototype: string; passage: string }> = [];
  const previousPath = process.env.PATH, previousCeiling = process.env.GIT_CEILING_DIRECTORIES;
  process.env.PATH = root; process.env.GIT_CEILING_DIRECTORIES = tmpdir();
  t.after(() => { if (previousPath === undefined) delete process.env.PATH; else process.env.PATH = previousPath; if (previousCeiling === undefined) delete process.env.GIT_CEILING_DIRECTORIES; else process.env.GIT_CEILING_DIRECTORIES = previousCeiling; });
  let operations = 0;
  for (let sequence = 0; sequence < 500; sequence++) {
    for (let step = 0, length = 2 + next() % 5; step < length; step++) {
      const number = numbers[next() % numbers.length], string = strings[next() % strings.length], prototype = next() % 2 ? 'true' : 'false';
      const newline = next() % 2 ? '\r\n' : '\n', space = next() % 2 ? '  ' : '\t';
      const created = { source: `{${newline}${space}"a/b":{"~":[${number}, ${string}]},${newline}"__proto__":{"value":${prototype}}${newline}}`, number, string, prototype, passage: ` value-${next()} \t` };
      const model = history.length && next() % 3 === 0 ? history[next() % history.length] : created; history.push(created);
      const expected = [model.number, model.string, model.prototype, model.source, model.passage, model.passage];
      for (const [index, citation] of citations.entries()) {
        const source = index < 4 ? model.source : index === 4 ? `before\n${model.passage}\nafter` : `## Heading\n\n${model.passage}`;
        const text = resolveFragmentText(source, citation.descriptor);
        assert.equal(text, expected[index]); assert.equal(JSON.parse(JSON.stringify(text)), expected[index]);
        assert.deepEqual(Buffer.from(text), Buffer.from(expected[index]));
      }
      operations++;
    }
    assert.deepEqual((await client.get(item.id, { full: true })).item, before);
  }
  console.log(JSON.stringify({ seed: '53ace91', sequences: 500, operations, selectors: 6, sdkStatePreserved: true, gitAvailable: false }));
});

test('public fragment boundary refuses malformed descriptors and extreme inputs with safe typed remedies', () => {
  const descriptor: Descriptor = { provider: 'json', source: 'data.json', revision: 'a'.repeat(64), selector: { kind: 'pointer', pointer: '/__proto__' }, jsonEncoding: 'source-bytes-v1' };
  assert.equal(resolveFragmentText('{"__proto__":1e309}', descriptor), '1e309');
  for (const text of [null, [], {}, Infinity, 'x'.repeat(16_777_217)]) assert.throws(() => resolveFragmentText(text as string, descriptor), error => error instanceof EvidenceError && error.code === 'invalid' && error.remedy.length > 10);
  for (const value of [null, {}, { ...descriptor, extra: true }, { ...descriptor, selector: { kind: 'pointer', pointer: '/~2' } }, ...[NaN, Infinity, -Infinity, -1, 0, 0.5].map(start => ({ ...descriptor, selector: { kind: 'lines', start, end: start } }))]) assert.throws(() => resolveFragmentText('{}', value as Descriptor), error => error instanceof EvidenceError && error.code === 'invalid');
  assert.throws(() => resolveFragmentText('{}', descriptor), error => error instanceof EvidenceError && error.code === 'missing');
});
