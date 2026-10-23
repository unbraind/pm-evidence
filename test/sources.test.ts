import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chmod, mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readFileSnapshot, snapshot } from '../src/sources.ts';
import { checkCitation, cite } from '../src/evidence.ts';
import { Store } from '../src/store.ts';
import { digest } from '../src/core.ts';
import { tracker } from './helpers.ts';

/** Read actual source bytes with an explicit race barrier between discovery and open. */
test('source discovery/read race binds one coherent revision or refuses with no fragment', async t => {
  const f = await tracker(t); const file = join(f.root, 'race.txt'); await writeFile(file, 'old');
  const context = { root: f.root, maxBytes: 100, signal: new AbortController().signal };
  await assert.rejects(readFileSnapshot('race.txt', context, async () => { await writeFile(file, 'new'); }), /changed during/);
  const coherent = await readFileSnapshot('race.txt', context); assert.equal(coherent.revision, digest('new')); assert.equal(coherent.text, 'new');
  await assert.rejects(readFileSnapshot('race.txt', context, async () => { await rename(file, join(f.root, 'old.txt')); await writeFile(file, 'replacement'); }), /changed during/);
  await writeFile(file, 'x'); await assert.rejects(readFileSnapshot('race.txt', { ...context, maxBytes: 2 }, async () => { await writeFile(file, 'growth'); }), /grew beyond/);
  await writeFile(file, 'source'); await assert.rejects(readFileSnapshot('race.txt', { ...context, signal: AbortSignal.abort() }));
  await writeFile(file, Buffer.from([0xff])); await assert.rejects(snapshot('file', 'race.txt', f.options), /coherently/);
  await writeFile(file, '\ufeffretained BOM'); assert.equal((await snapshot('file', 'race.txt', f.options)).text, '\ufeffretained BOM');
  await assert.rejects(snapshot('file', 'child/file.txt', { ...f.options, root: file }), /missing/);
  await chmod(file, 0); await assert.rejects(snapshot('file', 'race.txt', f.options), /regular file/); await chmod(file, 0o600);
  await mkdir(join(f.root, 'folder')); await assert.rejects(snapshot('file', 'folder', f.options));
});

test('historical revision failure and unsupported providers keep resolution separate', async t => {
  const f = await tracker(t); await writeFile(join(f.root, 'doc.md'), 'claim');
  await cite(f.item, 'doc.md', { ...f.options, selector: { kind: 'lines', start: 1, end: 1 } });
  const saved = (await new Store(f.options).get(f.item)).value.citations[0];
  const unsupported = await checkCitation({ ...saved, descriptor: { ...saved.descriptor, provider: 'unavailable' } }, f.options);
  assert.equal(unsupported.resolution, 'unsupported'); assert.equal(unsupported.freshness, 'unknown');
  await writeFile(join(f.root, 'doc.md'), 'changed'); const historical = await checkCitation(saved, { ...f.options, revision: 'cited', diff: true });
  assert.equal(historical.resolution, 'missing'); assert.equal(historical.freshness, 'changed');
  assert.equal(historical.diff?.old, undefined);
  await assert.rejects(cite(f.item, 'doc.md', { ...f.options, provider: 'json', selector: { kind: 'lines', start: 1, end: 1 } }));
});
