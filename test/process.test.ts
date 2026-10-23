import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { cite, show } from '../index.ts';
import { tracker, environment } from './helpers.ts';

/** Resolve real child completion without serializing simultaneous reviewer processes. */
function reviewer(root: string, workspace: string, item: string, citation: string, author: string): Promise<void> {
  return new Promise((resolve, reject) => { const child = spawn(process.execPath, [join(import.meta.dirname, 'reviewer.ts'), workspace, item, citation, author], { env: environment(root, workspace), stdio: ['ignore', 'ignore', 'pipe'] }); let error = ''; child.stderr.on('data', chunk => { error += String(chunk); }); child.on('error', reject); child.on('close', code => { if (code === 0) resolve(); else reject(new Error(error)); }); });
}

test('independent gitless reviewer processes retain distinct observations and deduplicate retries', async t => {
  const f = await tracker(t); await writeFile(join(f.root, 'doc.md'), 'claim');
  const receipt = await cite(f.item, 'doc.md', { ...f.options, selector: { kind: 'lines', start: 1, end: 1 } });
  await Promise.all(['first', 'first', 'second'].map(author => reviewer(f.root, f.workspace, f.item, receipt.citation, author)));
  assert.equal((await show(f.item, f.options)).citations[0].reviews.length, 2);
});
