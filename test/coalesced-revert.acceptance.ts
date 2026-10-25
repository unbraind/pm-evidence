/** Behavior-only negative controls; restore every touched source byte in finally. Requires development git. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { expectBehavioralFailure } from './revert-control.ts';

/** Match one function or class method using the source's column-aligned closing brace. */
function body(source: string, name: string, method = false): string {
  const signature = `${name}(?:<[^>]+>)?\\(`;
  const pattern = method ? new RegExp(`  async ${signature}[^\\n]*[\\s\\S]*?\\n  }`) : new RegExp(`export (?:async )?function ${signature}[^\\n]*[\\s\\S]*?\\n}`);
  const match = source.match(pattern); assert.ok(match, name); return match[0];
}
const cases = [
  { file: 'src/evidence.ts', name: 'check', suite: 'test/coalesced.test.ts', test: '^fifty citations across items' },
  { file: 'src/sources.ts', name: 'snapshot', suite: 'test/coalesced.test.ts', test: '^external cancellation interrupts' },
  { file: 'src/core.ts', name: 'packet', suite: 'test/coalesced.test.ts', test: '^fifty citations across items' },
  { file: 'src/store.ts', name: 'mutate', method: true, suite: 'test/coalesced-races.test.ts', test: '^replayed envelopes with the same numeric revision' },
  { file: 'src/store.ts', name: 'commit', method: true, suite: 'test/coalesced-races.test.ts', test: '^idempotency keys bind identical evidence payloads' },
  { file: 'src/evidence.ts', name: 'check', lateCapture: true, suite: 'test/coalesced-races.test.ts', test: '^target envelope is captured before source awaits' },
];
for (const proof of cases) {
  const original = await readFile(proof.file, 'utf8'); const baseline = execFileSync('git', ['show', `origin/main:${proof.file}`], { encoding: 'utf8' });
  const current = body(original, proof.name, proof.method);
  const replacement = proof.lateCapture === true ? current.replace('raw, rows: itemRows', 'raw: item.evidence_state, rows: itemRows') : body(baseline, proof.name, proof.method);
  const changed = original.replace(current, replacement); assert.notEqual(changed, original);
  try {
    await writeFile(proof.file, changed);
    expectBehavioralFailure(proof.suite, proof.test);
    console.log(JSON.stringify({ function: proof.name, guard: proof.lateCapture === true ? 'pre-await target envelope' : 'whole function baseline', negativeControl: 'fail 1', behaviorOnly: true, sourceImports: true }));
  } finally { await writeFile(proof.file, original); assert.equal(await readFile(proof.file, 'utf8'), original); }
}
