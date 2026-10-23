import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, open, readFile, rename, symlink, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { affected, check, cite, review } from '../index.ts';
import { digest } from '../src/core.ts';
import { Store } from '../src/store.ts';
import { readFileSnapshot, verifyDescriptor } from '../src/sources.ts';
import { tracker } from './helpers.ts';
import type { SourceAdapter } from '../src/types.ts';

/** Assert that a surviving quote never hides changed evidence or suppresses affected context. */
test('review: unrelated surviving quote cannot replace the cited passage', async t => {
  const f = await tracker(t); const file = join(f.root, 'policy.md');
  await writeFile(file, 'Policy context before the claim.\nAllow access.\nPolicy context after the claim.');
  await cite(f.item, 'policy.md', { ...f.options, selector: { kind: 'lines', start: 2, end: 2 } });
  await writeFile(file, 'Policy context before the claim.\nDeny access.\nPolicy context after the claim.\n\nExample: Allow access.');
  const report = await check([f.item], { ...f.options, record: false });
  assert.equal(report.rows[0].resolution, 'ambiguous'); assert.equal(report.rows[0].freshness, 'unknown');
  assert.ok((await affected(f.options)).rows.some(row => row.item === f.item));
});

/** Parent heading identity must be preserved even when immediate quote surroundings are unchanged. */
test('review: heading ancestry is required in addition to quote and nearby context', async t => {
  const f = await tracker(t); const file = join(f.root, 'policy.md');
  const source = '# Trusted policy\n\n' + 'Section introduction with unchanged words. '.repeat(4) + '\n\n## Access\n\nAllow access.\n\nClosing context remains unchanged.';
  await writeFile(file, source); const cited = await cite(f.item, 'policy.md', { ...f.options, selector: { kind: 'heading', heading: 'Access', paragraph: 1 } });
  const reviewed = await review(f.item, { ...f.options, citation: cited.citation, disposition: 're-anchored', reason: 'Preserve heading scope after re-anchoring' });
  const replacement = (await new Store(f.options).get(f.item)).value.citations.find(entry => entry.id === reviewed.replacement)!;
  assert.deepEqual(replacement.descriptor.anchor?.sectionPath, ['Trusted policy', 'Access']);
  await review(f.item, { ...f.options, citation: replacement.id, disposition: 're-anchored', reason: 'Retain inherited heading scope' });
  await writeFile(file, source.replace('# Trusted policy', '# Untrusted examples'));
  const result = await check([f.item], { ...f.options, record: false, budget: 3000 }); assert.equal(result.rows.length, 2); assert.ok(result.rows.every(row => row.resolution === 'ambiguous'));
  assert.ok((await affected(f.options)).rows.some(row => row.item === f.item));
});

/** JSON value identity must distinguish integers beyond the IEEE-754 exact range. */
test('review: distinct large JSON integers retain different value digests', async t => {
  const f = await tracker(t); const file = join(f.root, 'config.json');
  await writeFile(file, '{"n":9007199254740992}'); await cite(f.item, 'config.json', { ...f.options, selector: { kind: 'pointer', pointer: '/n' }, retain: true });
  await writeFile(file, '{"n":9007199254740993}');
  const report = await check([f.item], { ...f.options, record: false, diff: true });
  assert.equal(report.rows[0].freshness, 'changed'); assert.equal(report.rows[0].currentDigest, digest('9007199254740993'));
  assert.deepEqual(report.rows[0].diff?.current, ['9007199254740993']);
  assert.ok((await affected(f.options)).rows.some(row => row.item === f.item));
});

/** Reproduce the canonicalization/parent-swap/post-stat-restore attack with actual filesystem operations. */
test('review: opened descriptor containment rejects parent symlink swap and restore', async t => {
  const f = await tracker(t); const root = join(f.root, 'sources'); const parent = join(root, 'parent'); const parked = join(root, 'parked'); const outside = join(f.root, 'outside');
  await mkdir(parent, { recursive: true }); await mkdir(outside); await writeFile(join(parent, 'policy.md'), 'Allow access.'); await writeFile(join(outside, 'policy.md'), 'Allow access.');
  await cite(f.item, 'parent/policy.md', { ...f.options, root, selector: { kind: 'lines', start: 1, end: 1 } });
  let swapped = false;
  /** Restore the real directory after post-read stat, or after a fail-closed descriptor refusal. */
  async function restore(): Promise<void> { if (swapped) { swapped = false; await unlink(parent); await rename(parked, parent); } }
  const adapter: SourceAdapter = { provider: 'file', read: async (source, context) => {
    try { return await readFileSnapshot(source, context, undefined, { afterCanonical: async () => { await rename(parent, parked); await symlink(outside, parent); swapped = true; }, afterPathStat: restore }); }
    finally { await restore(); }
  } };
  const report = await check([f.item], { ...f.options, root, adapters: [adapter], record: false });
  assert.equal(report.rows[0].resolution, 'inaccessible'); assert.equal(report.rows[0].freshness, 'unknown'); assert.equal(report.rows[0].currentDigest, null);
  assert.ok((await affected({ ...f.options, root, adapters: [adapter] })).rows.some(row => row.item === f.item));
  assert.equal(await readFile(join(parent, 'policy.md'), 'utf8'), 'Allow access.');
});

/** Unsupported platforms and unavailable descriptor links have no silent path-only fallback. */
test('descriptor verification fails closed when unavailable and rejects inode replacement', async t => {
  const f = await tracker(t); const file = join(f.root, 'file.txt'); await writeFile(file, 'original'); const handle = await open(file, 'r');
  try {
    await assert.rejects(verifyDescriptor(handle, f.root, 'darwin'), /requires Linux/);
    await assert.rejects(verifyDescriptor(handle, f.root, 'linux', async () => { await rename(file, join(f.root, 'parked.txt')); await writeFile(file, 'replacement'); }), /identity changed/);
  } finally { await handle.close(); }
  await assert.rejects(verifyDescriptor(handle, f.root), /verification is unavailable/);
});

/** Records made with older lossy JSON or heading metadata require explicit re-review after source changes. */
test('legacy citation metadata never silently adopts changed JSON or heading sources', async t => {
  const f = await tracker(t); const json = join(f.root, 'legacy.json'); await writeFile(json, '{"n":9007199254740993}');
  await cite(f.item, 'legacy.json', { ...f.options, selector: { kind: 'pointer', pointer: '/n' } });
  const heading = '# Parent\n\n' + 'Unchanged paragraph before heading. '.repeat(3) + '\n\n## Access\n\nAllow access.\n\nClosing context.';
  await writeFile(join(f.root, 'heading.md'), heading); await cite(f.item, 'heading.md', { ...f.options, selector: { kind: 'heading', heading: 'Access', paragraph: 1 } });
  await new Store(f.options).mutate(f.item, value => { delete value.citations[0].descriptor.jsonEncoding; value.citations[0].fragmentDigest = digest('9007199254740992'); delete value.citations[1].descriptor.anchor!.sectionPath; return { value: true, observation: 'Synthetic legacy citation fixture' }; });
  assert.equal((await check([f.item], { ...f.options, record: false, budget: 3000 })).rows[1].freshness, 'current');
  await writeFile(json, '{"n":9007199254740992}'); await writeFile(join(f.root, 'heading.md'), heading + '\nOutside addition');
  const report = await check([f.item], { ...f.options, record: false, budget: 3000 }); assert.ok(report.rows.every(row => row.resolution === 'ambiguous' && row.freshness === 'unknown'));
});

/** Descriptor containment is verified again after reading, even if a new in-root file replaces the pathname. */
test('post-read descriptor relocation cannot hide behind a restored in-root pathname', async t => {
  const f = await tracker(t); const root = join(f.root, 'selected'); await mkdir(root); const file = join(root, 'policy.md'); await writeFile(file, 'Allow access.');
  await assert.rejects(readFileSnapshot('policy.md', { root, maxBytes: 100, signal: new AbortController().signal }, undefined, { afterPathStat: async () => { await rename(file, join(f.root, 'relocated.md')); await writeFile(file, 'Allow access.'); } }), /escapes the selected root/);
  assert.equal(await readFile(file, 'utf8'), 'Allow access.');
});
