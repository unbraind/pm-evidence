import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Enumerate the entire compiled graph, including declarations, maps and otherwise unreachable files. */
export function artifactInventory(root: string, directory = 'dist'): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) for (const [name, bytes] of artifactInventory(root, path)) files.set(name, bytes);
    else files.set(path, readFileSync(join(root, path)));
  }
  return files;
}

/** Read artifacts from an immutable Git tree, never from locally generated or ignored files. */
export function committedArtifacts(repository: string, head: string, env: NodeJS.ProcessEnv): Map<string, Buffer> {
  const paths = execFileSync('git', ['ls-tree', '-r', '--name-only', head, '--', 'dist/'], { cwd: repository, env, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  return new Map(paths.map(path => [path, execFileSync('git', ['show', `${head}:${path}`], { cwd: repository, env, maxBuffer: 16 * 1024 * 1024 })]));
}

/** Require identical file sets and bytes so no runtime, declaration or map can escape drift checks. */
export function assertArtifactGraph(expected: ReadonlyMap<string, Buffer>, observed: ReadonlyMap<string, Buffer>, label: string): void {
  assert.ok(expected.size > 0, 'The clean compiler output must not be empty');
  assert.deepEqual([...observed.keys()].sort(), [...expected.keys()].sort(), `${label}: compiled file inventory differs`);
  for (const [path, bytes] of expected) assert.deepEqual(observed.get(path), bytes, `${label}: ${path} differs from the clean compiler output`);
}
