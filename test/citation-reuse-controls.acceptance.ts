/** Tests-only coverage additions need mutation witnesses, not invented runtime behavior changes. */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { withSourceCopy } from './revert-control.ts';

await withSourceCopy(async (root, repository) => {
  await fs.cp(join(repository, 'tsconfig.json'), join(root, 'tsconfig.json'));
  const context = { cwd: root, encoding: 'utf8' as const, timeout: 360000, env: { PATH: process.env.PATH } };
  /** Every counterexample executes rebuilt distribution code. */
  const compile = () => execFileSync(process.execPath, [join(repository, 'node_modules/typescript/bin/tsc'), '--project', 'tsconfig.json'], context);
  for (const [label, module, from, to] of [
    ['producer owner', 'evidence', 'JSON.stringify([item, descriptor, fragmentDigest])', "JSON.stringify(['shared-owner', descriptor, fragmentDigest])"],
    ['producer provider', 'evidence', 'JSON.stringify([item, descriptor, fragmentDigest])', "JSON.stringify([item, { ...descriptor, provider: 'shared-provider' }, fragmentDigest])"],
    ['compatibility provider', 'evidence', 'JSON.stringify({ ...entry.descriptor, source:', "JSON.stringify({ ...entry.descriptor, provider: 'shared-provider', source:"],
    ['persisted alias order', 'evidence', '?? citations.find(', '?? citations.findLast('],
    ['store owner admission', 'store', 'validateRecord(envelope(raw), owner)', 'validateRecord(envelope(raw))'],
    ['import target owner', 'bundles', 'JSON.stringify([item, entry.descriptor, entry.fragmentDigest])', "JSON.stringify(['shared-owner', entry.descriptor, entry.fragmentDigest])"],
    ['import provider', 'bundles', 'JSON.stringify([item, entry.descriptor, entry.fragmentDigest])', "JSON.stringify([item, { ...entry.descriptor, provider: 'shared-provider' }, entry.fragmentDigest])"],
  ]) {
    const file = join(root, 'src', module + '.ts'); const fixed = await fs.readFile(file, 'utf8');
    assert.equal(fixed.split(from).length, 2, label);
    try {
      await fs.writeFile(file, fixed.replace(from, to)); compile();
      const trial = spawnSync(process.execPath, ['--test', '--test-concurrency=1', '--test-reporter=tap', 'test/citation-reuse-control.worker.ts'], context);
      assert.ifError(trial.error); assert.equal(trial.status, 1, label + trial.stdout + trial.stderr);
      assert.match(trial.stdout, /# fail 1\b/); assert.match(trial.stdout, /AssertionError/);
      console.log(`${label}: one compiled-API behavioral regression fails`);
    } finally { await fs.writeFile(file, fixed); compile(); }
  }
  const restored = spawnSync(process.execPath, ['--test', '--test-concurrency=2', '--test-reporter=tap', 'test/citation-reuse.test.ts'], context);
  assert.ifError(restored.error); assert.equal(restored.status, 0, restored.stdout + restored.stderr); assert.match(restored.stdout, /# pass 2\b/);
  console.log('All functions restored: source and built contracts pass the full alias-order matrix and native JSON/TOON checks');
});
