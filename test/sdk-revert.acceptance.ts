/** Separate structural delegation proofs from the behavioral history-integrity negative control. */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';

const baseline = execFileSync('git', ['show', 'origin/main:src/core.ts'], { encoding: 'utf8' });
const core = await readFile('src/core.ts', 'utf8');
const store = await readFile('src/store.ts', 'utf8');
const tokenFunction = /^export function tokens\([^\n]+/m;
const packetFunction = /export function packet<T>[\s\S]*?\n}/;
const cases = [
  { name: 'token estimator', kind: 'structural delegation', file: 'src/core.ts', original: core, changed: core.replace(tokenFunction, baseline.match(tokenFunction)![0]), pattern: '^adoption delegates estimator' },
  { name: 'omission receipt', kind: 'structural delegation', file: 'src/core.ts', original: core, changed: core.replace(packetFunction, baseline.match(packetFunction)![0]), pattern: '^adoption delegates estimator' },
  { name: 'uncached history verification', kind: 'behavioral integrity', file: 'src/store.ts', original: store, changed: store.replace(/    const verification =[^\n]+\n    if \(!verification.ok\)[^\n]+\n/, ''), pattern: '^history corruption after priming' },
];
for (const proof of cases) {
  assert.notEqual(proof.original, proof.changed);
  try {
    await writeFile(proof.file, proof.changed);
    const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', '--test-name-pattern', proof.pattern, 'test/sdk-adoption.test.ts'], { encoding: 'utf8', timeout: 120000 });
    assert.deepEqual({ error: result.error, exit: result.status }, { error: undefined, exit: 1 }, result.stdout + result.stderr);
    assert.ok(result.stdout.includes('# fail 1'), 'The isolated negative control must report exactly one failure');
    console.log(JSON.stringify({ replacement: proof.name, proof: proof.kind, negativeControl: 'fail 1', sourceImports: true }));
  } finally { await writeFile(proof.file, proof.original); assert.equal(await readFile(proof.file, 'utf8'), proof.original); }
}
