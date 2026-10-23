/** Behavioral guard reverts for a new package with no prior implementation to restore. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const cases = [
  { name: 'anchor uniqueness', file: 'src/selectors.ts', target: "  if (occurrences.length > 1) throw new EvidenceError('ambiguous', 'Exact anchor occurs more than once', 'Review and explicitly re-anchor to a unique passage');\n  if (occurrences.length === 1)", mutation: '  if (occurrences.length >= 1)', test: 'unchanged, outside edits, insertion, movement, duplicate anchors, internal edit and deleted file' },
  { name: 'two independent axes', file: 'src/evidence.ts', target: "row.freshness = row.currentDigest === row.oldDigest ? 'current' : 'changed';", mutation: "row.freshness = row.sourceChanged ? 'changed' : 'current';", test: 'unchanged, outside edits, insertion, movement, duplicate anchors, internal edit and deleted file' },
  { name: 'lock-held review fencing', file: 'src/store.ts', target: ", match: raw === undefined ? { key: 'updated_at', value: expectedUpdatedAt } : { key: 'evidence_state', value: raw }", mutation: '', test: 'SDK item mutation precondition refuses stale evidence state' },
];
for (const proof of cases) {
  const original = await readFile(proof.file, 'utf8'); assert.equal(original.split(proof.target).length, 2);
  try {
    await writeFile(proof.file, original.replace(proof.target, proof.mutation));
    const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', '--test-name-pattern', `^${proof.test}$`, 'test/evidence.test.ts'], { encoding: 'utf8', timeout: 120000 });
    assert.equal(result.error, undefined); assert.equal(result.status, 1, result.stdout + result.stderr); assert.match(result.stdout, /# fail 1/);
    console.log(JSON.stringify({ guard: proof.name, negativeControl: 'fail 1', functionScopeOnly: true, sourceImports: true, originalSha256: createHash('sha256').update(original).digest('hex') }));
  } finally { await writeFile(proof.file, original); assert.equal(await readFile(proof.file, 'utf8'), original); }
}
