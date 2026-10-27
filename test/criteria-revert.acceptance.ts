/** Function-only behavioral controls distinguish selective support, generations and native CAS. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { expectBehavioralFailure } from './revert-control.ts';

const path = 'src/criteria.ts'; const original = await readFile(path, 'utf8');
const storePath = 'src/store.ts'; const store = await readFile(storePath, 'utf8');
const cases = [
  { name: 'binding producer removed', file: path, source: original, reverted: original.replace(/export async function bindCriterion[\s\S]*?\n}/, 'export async function bindCriterion(input: CriterionBinding, options: CheckOptions): Promise<CriterionBinding> { return input; }'), suite: 'test/criteria.test.ts', pattern: '^criterion edits and isolated' },
  { name: 'generation reduced to content identity', file: path, source: original, reverted: original.replace('digest(JSON.stringify([item.id, index, entry.record_hash, entry.after_hash, criterion, count]))', 'digest(criterion)'), suite: 'test/criteria.test.ts', pattern: '^criterion edits and isolated' },
  { name: 'support reduced to resolution alone', file: path, source: original, reverted: original.replace(/  const support = current !== undefined[^\n]+/, "  const support = row.resolution === 'resolved' ? 'current-source' : 'lost-source';"), suite: 'test/criteria.test.ts', pattern: '^criterion edits and isolated' },
  { name: 'locked criterion precondition removed', file: storePath, source: store, reverted: store.replace('      await guard?.(document.metadata);', ''), suite: 'test/criteria-races.test.ts', pattern: '^binding revalidates criterion edits' },
  { name: 'exact-state CAS replaced with timestamp-only CAS', file: storePath, source: store, reverted: store.replace('document.metadata.evidence_state !== raw', 'document.metadata.updated_at !== _expectedUpdatedAt'), suite: 'test/clock-races.test.ts', pattern: '^fixed-clock state safety:' },
  { name: 'criterion fact freshness reduced to timestamp and envelope', file: path, source: original, reverted: original.replace('latest.evidence_state !== item.evidence_state || JSON.stringify(latestCriteria) !== JSON.stringify(current)', 'latest.updated_at !== item.updated_at || latest.evidence_state !== item.evidence_state'), suite: 'test/clock-races.test.ts', pattern: '^fixed-clock criterion edits' },
];
for (const proof of cases) {
  assert.notEqual(proof.reverted, proof.source);
  try { await writeFile(proof.file, proof.reverted); expectBehavioralFailure(proof.suite, proof.pattern); console.log(`${proof.name}: isolated behavioral negative control fail 1`); }
  finally { await writeFile(proof.file, proof.source); assert.equal(await readFile(proof.file, 'utf8'), proof.source); }
}
