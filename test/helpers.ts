import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { TestContext } from 'node:test';
import { PmClient } from '@unbrained/pm-cli/sdk';

/** Every fixture is a real SDK tracker outside git, with disposable synthetic sources. */
export async function tracker(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'evidence-test-')); t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = join(root, '.agents', 'pm');
  const client = new PmClient({ pmRoot: workspace, author: 'fixture', noExtensions: true });
  await client.init('evidence-test', { defaults: true, agentGuidance: 'skip', mergeFence: false });
  await client.create({ id: 'evidence-test-decision', type: 'Decision', title: 'Synthetic evidence decision' });
  const item = 'evidence-test-decision'; const options = { workspace, root, author: 'fixture' };
  return { root, workspace, client, item, options };
}
/** Install native host discovery without changing the package's own tracker. */
export async function extension(workspace: string) {
  const dir = join(workspace, 'extensions', 'pm-evidence'); await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'manifest.json'), JSON.stringify({ name: 'pm-evidence', version: '2026.10.23', entry: 'entry.js', capabilities: ['commands', 'schema'] }));
  await writeFile(join(dir, 'entry.js'), `export { default } from ${JSON.stringify(new URL('../index.ts', import.meta.url).href)};\n`);
}
/** Run a genuine gitless CLI with ancestor git discovery fenced. */
export function environment(root: string, workspace: string) { return { ...process.env, PM_PATH: workspace, PM_AUTHOR: 'fixture', GIT_CEILING_DIRECTORIES: dirname(root), PATH: root }; }
