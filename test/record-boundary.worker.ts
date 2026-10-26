/** Run one large accepted schema boundary with a bounded-lifetime real SDK process. */
import { test } from 'node:test';
import { Store } from '../src/store.ts';
import { citedTracker } from './helpers.ts';
import { apply, assertReadable, full } from './record-boundaries.ts';
import type { Boundary } from './record-boundaries.ts';

test('isolated accepted boundary survives native SDK readback show and check', async t => {
  const boundary = JSON.parse(process.argv[2]) as Boundary;
  const f = await citedTracker(t); const store = new Store(f.options); const current = await store.get(f.item); const value = full(current.value.citations[0]); apply(value, boundary);
  await store.commit(f.item, current.raw, value, 'Isolated accepted schema boundary', current.item.updated_at);
  await assertReadable(f, value);
});
