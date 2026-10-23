import assert from 'node:assert/strict';
import { test } from 'node:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Store } from '../src/store.ts';
import { cite } from '../index.ts';
import type { EvidenceState } from '../src/types.ts';
import { tracker } from './helpers.ts';

/** Drive real SDK conflicts by committing a competing revision immediately before every attempted write. */
class CompetingStore extends Store {
  /** Every failure comes from the actual SDK precondition, without SDK mocks. */
  override async commit(id: string, raw: unknown, value: EvidenceState, observation: string, expectedUpdatedAt?: string): Promise<void> {
    const competitor = new Store(this.options); const current = await competitor.get(id); current.value.revision++;
    await competitor.commit(id, current.raw, current.value, 'competing writer', current.item.updated_at);
    await super.commit(id, raw, value, observation, expectedUpdatedAt);
  }
}
/** Route one attempted write to an absent native identity to exercise SDK failure normalization. */
class AbsentStore extends Store {
  /** The SDK still performs the real mutation and refuses its absent target. */
  override async commit(_id: string, raw: unknown, value: EvidenceState, observation: string, expectedUpdatedAt?: string): Promise<void> { await super.commit('absent', raw, value, observation, expectedUpdatedAt); }
}

test('schema incompatibility, default attribution, expected revisions and bounded real conflict retries', async t => {
  const f = await tracker(t); await writeFile(join(f.root, 'doc.md'), 'claim');
  await cite(f.item, 'doc.md', { workspace: f.workspace, root: f.root, selector: { kind: 'lines', start: 1, end: 1 } });
  const store = new Store(f.options); const revision = (await store.get(f.item)).value.revision;
  assert.equal(await store.mutate(f.item, () => undefined, revision), undefined);
  await assert.rejects(new AbsentStore(f.options).mutate(f.item, () => ({ value: true, observation: 'absent target' })), /SDK evidence mutation failed/);
  await assert.rejects(new CompetingStore(f.options).mutate(f.item, () => ({ value: true, observation: 'stale revision attempt' })), /exhausted retries/);
  assert.equal((await store.get(f.item)).value.citations.length, 1);
  await f.client.schemaRemoveField('evidence_state'); await f.client.schemaAddField('evidence_state', { type: 'number' });
  await assert.rejects(store.register(), /incompatible/);
});
