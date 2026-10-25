import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { encode } from '@toon-format/toon';
import { applyReadOutputDimensions, estimatePmOutputTokens, listMutationEvents } from '@unbrained/pm-cli/sdk';
import { packet, tokens } from '../src/core.ts';
import { cite, review } from '../index.ts';
import { tracker } from './helpers.ts';

test('SDK token accounting measures both renderings with their final newline', () => {
  for (const value of [null, '', 'é😀\n', { rows: ['界'.repeat(100)], nested: { quoted: '"\\\n' } }, Array.from({ length: 20 }, (_, i) => ({ i, text: 'claim' }))]) {
    const bytes = Math.max(Buffer.byteLength(JSON.stringify(value, null, 2) + '\n'), Buffer.byteLength(encode(value) + '\n'));
    assert.equal(tokens(value), estimatePmOutputTokens(bytes));
  }
});

test('SDK omissions preserve exact prefix rows, boundary budgets and independent source completeness', () => {
  const rows = ['é😀'.repeat(20), '界'.repeat(200), 'small']; const scope = { items: 3, citations: 3 };
  const one = packet(rows.slice(0, 1), scope, 5000).estimatedTokens;
  assert.deepEqual(packet(rows, scope, one).rows, rows.slice(0, 1));
  assert.equal(packet(rows, scope, one - 1).rows.length, 0);
  for (const sourceComplete of [true, false]) for (const budget of [one, 5000]) {
    const result = packet(rows, scope, budget, sourceComplete);
    assert.equal(result.receipt.complete, sourceComplete && result.rows.length === rows.length);
    assert.equal(result.receipt.omitted, rows.length - result.rows.length);
    assert.equal(result.receipt.sourceComplete, sourceComplete);
    assert.equal(result.estimatedTokens, tokens(result)); assert.ok(result.estimatedTokens <= budget);
    assert.deepEqual(result.rows, rows.slice(0, result.rows.length));
  }
  assert.equal(packet([], scope).receipt.complete, true);
});

test('standalone evidence API calls have no registered SDK projection surface', () => {
  const result = { rows: ['x'.repeat(1000)] };
  for (const command of ['evidence check', 'extension:evidence']) assert.equal(applyReadOutputDimensions(command, { outputBudget: 1 }, result), result);
});

test('adoption delegates estimator and omission materiality to the real SDK', async () => {
  const source = await readFile(new URL('../src/core.ts', import.meta.url), 'utf8');
  assert.match(source, /return estimatePmOutputTokens\(/);
  assert.match(source, /const omission = createOutputOmissionReceipt\(/);
  assert.match(source, /complete: !omission\.has_omissions && sourceComplete/);
});

test('history corruption after priming the SDK event cache still refuses evidence writes', async t => {
  const f = await tracker(t); await writeFile(join(f.root, 'doc.md'), 'claim');
  const citation = await cite(f.item, 'doc.md', { ...f.options, selector: { kind: 'lines', start: 1, end: 1 } });
  await listMutationEvents({ pmRoot: f.workspace });
  const history = join(f.workspace, 'history', `${f.item}.jsonl`);
  const entries = (await readFile(history, 'utf8')).trimEnd().split('\n');
  const entry = JSON.parse(entries[0]) as Record<string, unknown>; entry.record_hash = '0'.repeat(64); entries[0] = JSON.stringify(entry);
  await writeFile(history, entries.join('\n') + '\n');
  const beforeHistory = await readFile(history, 'utf8');
  const item = (await f.client.get(f.item, { full: true })).item;
  await assert.rejects(review(f.item, { ...f.options, client: f.client, citation: citation.citation, disposition: 'invalid', reason: 'Synthetic integrity regression' }), /SDK evidence mutation failed|history|integrity/i);
  assert.equal(await readFile(history, 'utf8'), beforeHistory);
  assert.deepEqual((await f.client.get(f.item, { full: true })).item, item);
});
