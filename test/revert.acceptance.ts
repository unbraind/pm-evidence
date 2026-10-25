/** Function-only historical and guard reverts; development proof harness requires this Git repository. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { expectBehavioralFailure } from './revert-control.ts';

/** One immutable-target behavioral revert and its isolated positive regression. */
interface RevertCase { name: string; file: string; target: string; mutation: string; test: string; suite?: string }
/** Extract a top-level function using the repository's column-zero closing-brace convention. */
function functionText(source: string, name: string): string {
  const signature = `function ${name}(`; assert.equal(source.split(signature).length, 2);
  const declaration = source.indexOf(signature); const start = source.lastIndexOf('\n', declaration) + 1; const end = source.indexOf('\n}', declaration);
  assert.ok(end !== -1); return source.slice(start, end + 2);
}

const cases: RevertCase[] = [
  { name: 'anchor uniqueness', file: 'src/selectors.ts', target: "  if (occurrences.length > 1) throw new EvidenceError('ambiguous', 'Exact anchor occurs more than once', 'Review and explicitly re-anchor to a unique passage');", mutation: '', test: 'unchanged, outside edits, insertion, movement, duplicate anchors, internal edit and deleted file' },
  { name: 'two independent axes', file: 'src/evidence.ts', target: "row.freshness = row.currentDigest === row.oldDigest ? 'current' : 'changed';", mutation: "row.freshness = row.sourceChanged ? 'changed' : 'current';", test: 'unchanged, outside edits, insertion, movement, duplicate anchors, internal edit and deleted file' },
  { name: 'lock-held review fencing', file: 'src/store.ts', target: ", match: raw === undefined ? { key: 'updated_at', value: expectedUpdatedAt } : { key: 'evidence_state', value: raw }", mutation: '', test: 'SDK item mutation precondition refuses stale evidence state' },
];
for (const [name, file, functionName, testName] of [
  ['passage identity', 'src/selectors.ts', 'resolveFragment', 'review: unrelated surviving quote cannot replace the cited passage'],
  ['inherited heading scope', 'src/evidence.ts', 'reanchor', 'review: heading ancestry is required in addition to quote and nearby context'],
  ['lossless JSON values', 'src/selectors.ts', 'pointer', 'review: distinct large JSON integers retain different value digests'],
  ['descriptor containment', 'src/sources.ts', 'verifyDescriptor', 'review: opened descriptor containment rejects parent symlink swap and restore'],
]) {
  const target = functionText(await readFile(file, 'utf8'), functionName);
  const mutation = functionName === 'verifyDescriptor' ? target.slice(0, target.indexOf('{')) + '{}' : functionText(execFileSync('git', ['show', `b6ef9b5:${file}`], { encoding: 'utf8' }), functionName);
  cases.push({ name, file, target, mutation, test: testName, suite: 'test/review-regressions.test.ts' });
}
for (const proof of process.argv.includes('--review') ? cases.slice(3) : cases) {
  const original = await readFile(proof.file, 'utf8'); assert.equal(original.split(proof.target).length, 2);
  try {
    await writeFile(proof.file, original.replace(proof.target, proof.mutation));
    expectBehavioralFailure(proof.suite ?? 'test/evidence.test.ts', `^${proof.test}$`);
    console.log(JSON.stringify({ guard: proof.name, negativeControl: 'fail 1', functionScopeOnly: true, sourceImports: true, originalSha256: createHash('sha256').update(original).digest('hex') }));
  } finally { await writeFile(proof.file, original); assert.equal(await readFile(proof.file, 'utf8'), original); }
}
