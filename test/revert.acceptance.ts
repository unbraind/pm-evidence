/** Function-only historical and guard reverts; development proof harness requires this Git repository. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { expectBehavioralFailure, withSourceCopy } from './revert-control.ts';

/** One immutable-target behavioral revert and its isolated positive regression. */
interface RevertCase { name: string; file: string; target: string; mutation: string; test: string; suite?: string; diagnostic?: string }
/** Extract a top-level function using the repository's column-zero closing-brace convention. */
function functionText(source: string, name: string): string {
  const generatorSignature = `function* ${name}(`;
  const signature = source.includes(generatorSignature) ? generatorSignature : `function ${name}(`; assert.equal(source.split(signature).length, 2);
  const declaration = source.indexOf(signature); const start = source.lastIndexOf('\n', declaration) + 1; const end = source.indexOf('\n}', declaration);
  assert.ok(end !== -1); return source.slice(start, end + 2);
}

const cases: RevertCase[] = [
  { name: 'anchor uniqueness', file: 'src/selectors.ts', target: "  if (occurrences.length > 1) throw new EvidenceError('ambiguous', 'Exact anchor occurs more than once', 'Review and explicitly re-anchor to a unique passage');", mutation: '', test: 'unchanged, outside edits, insertion, movement, duplicate anchors, internal edit and deleted file' },
  { name: 'two independent axes', file: 'src/evidence.ts', target: "row.freshness = row.currentDigest === row.oldDigest ? 'current' : 'changed';", mutation: "row.freshness = row.sourceChanged ? 'changed' : 'current';", test: 'unchanged, outside edits, insertion, movement, duplicate anchors, internal edit and deleted file' },
  { name: 'lock-held review fencing', file: 'src/store.ts', target: "      if (document.metadata.evidence_state !== raw) throw new Error('Target no longer carries upsert key evidence_state');", mutation: '', test: 'SDK item mutation precondition refuses stale evidence state' },
  { name: 'linear heading scan', file: 'src/selectors.ts', target: functionText(await readFile('src/selectors.ts', 'utf8'), 'headingLines'),
    mutation: `export function* headingLines(text: string): Generator<HeadingLine, void, void> {
  for (const match of text.matchAll(/^(#{1,6})[ \\t]+(.+?)[ \\t]*#*[ \\t]*\\r?$/gm)) yield { depth: match[1].length, title: match[2], start: match.index, end: match.index + match[0].length };
}`, test: 'ATX heading line scanning does not execute regular expressions', suite: 'test/heading-parity.test.ts', diagnostic: 'ATX heading lines must use the forward scanner' },
  { name: 'regex-free JSON span tokenization', file: 'src/json-spans.ts', target: functionText(await readFile('src/json-spans.ts', 'utf8'), 'parseSpans'),
    mutation: functionText(execFileSync('git', ['show', 'ec37a88b95f0c3aed6b483a7f805382f833961ee:src/json-spans.ts'], { encoding: 'utf8' }), 'parseSpans'),
    test: 'JSON span tokenization does not execute regular expressions', suite: 'test/json-spans-linear.test.ts', diagnostic: 'JSON span tokenization must use the forward scanner' },
  { name: 'heading ancestry offset bound', file: 'src/selectors.ts', target: '  for (const heading of headingLines(text, offset)) {',
    mutation: '  for (const heading of headingLines(text)) {',
    test: 'the offset bound keeps ancestry byte-identical to the unbounded scan for every offset kind', suite: 'test/heading-parity.test.ts' },
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
await withSourceCopy(async root => {
  for (const proof of process.argv.includes('--review') ? cases.slice(3) : cases) {
    const file = join(root, proof.file);
    const original = await readFile(file, 'utf8'); assert.equal(original.split(proof.target).length, 2);
    try {
      await writeFile(file, original.replace(proof.target, proof.mutation));
      const output = expectBehavioralFailure(join(root, proof.suite ?? 'test/evidence.test.ts'), `^${proof.test}$`);
      if (proof.diagnostic !== undefined) assert.ok(output.includes(proof.diagnostic), output);
      console.log(JSON.stringify({ guard: proof.name, negativeControl: 'fail 1', functionScopeOnly: true, sourceImports: true, originalSha256: createHash('sha256').update(original).digest('hex') }));
    } finally { await writeFile(file, original); assert.equal(await readFile(file, 'utf8'), original); }
  }
});
