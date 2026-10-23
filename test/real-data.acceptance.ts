/** Read-only public repository evaluation; only the disposable no-git copy is mutated. */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { PmClient, certifyCompleteListResult } from '@unbrained/pm-cli/sdk';
import { cite, check, affected, tokens } from '../index.ts';
import { select } from '../src/selectors.ts';
import { readFileSnapshot } from '../src/sources.ts';
import type { SourceAdapter } from '../index.ts';

const repository = process.argv[2]; assert.ok(repository, 'Pass the public repository checkout');
const root = await mkdtemp(join(tmpdir(), 'evidence-real-')); const savedPath = process.env.PATH; const started = performance.now();
try {
  const head = execFileSync('git', ['rev-parse', 'origin/main'], { cwd: repository, encoding: 'utf8' }).trim();
  const archive = execFileSync('git', ['archive', 'origin/main', '.agents/pm', 'README.md', 'docs/'], { cwd: repository, maxBuffer: 64 * 1024 * 1024 });
  execFileSync('tar', ['-x', '-C', root], { input: archive });
  assert.notEqual(spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: root, env: { ...process.env, GIT_CEILING_DIRECTORIES: dirname(root) } }).status, 0);
  const sources = execFileSync('git', ['ls-tree', '-r', '--name-only', 'origin/main', 'README.md', 'docs/'], { cwd: repository, encoding: 'utf8' }).trim().split('\n').filter(name => name.endsWith('.md')).slice(0, 10);
  let reads = 0; const adapter: SourceAdapter = { provider: 'file', read: async (source, context) => { reads++; return readFileSnapshot(source, context); } };
  const workspace = join(root, '.agents', 'pm'); const options = { workspace, root, author: 'evidence-evaluation', adapters: [adapter] };
  const client = new PmClient({ pmRoot: workspace, author: options.author, noExtensions: true });
  const items = certifyCompleteListResult(await client.listAllComplete({ includeBody: false })).items.slice(0, 20); assert.equal(items.length, 20);
  process.env.PATH = '';
  const originals = new Map<string, string>(); const fragments: { source: string; quote: string; item: string }[] = [];
  for (const source of sources) {
    const text = await readFile(join(root, source), 'utf8'); originals.set(source, text);
    let count = 0;
    for (const match of text.matchAll(/(?:^|\n\n)([A-Z][^\n]*(?:\n(?!\n)[^\n]+)*)/g)) {
      const quote = match[1]; if (quote.length < 45 || quote.includes('```') || quote.includes('|') || quote.startsWith('NOTE')) continue;
      const start = text.slice(0, match.index + match[0].indexOf(quote)).split('\n').length;
      const end = start + quote.split('\n').length - 1;
      if (select(text, { kind: 'lines', start, end }).text !== quote) continue;
      try { await cite(items[fragments.length].id, source, { ...options, selector: { kind: 'lines', start, end }, retain: true }); }
      catch { continue; }
      fragments.push({ source, quote, item: items[fragments.length].id }); count++; if (count === 2) break;
    }
    assert.equal(count, 2, `Need two unique prose fragments in ${source}`);
  }
  assert.equal(fragments.length, 20);
  const baseline = await check(items.map(item => item.id), { ...options, record: false, budget: 100000 }); assert.equal(baseline.rows.filter(row => row.freshness === 'current').length, 20);
  const [inserted, edited, moved, duplicated, deleted] = sources;
  await writeFile(join(root, inserted), 'Inserted evaluation preface.\n\n' + originals.get(inserted)!);
  const edit = fragments.find(entry => entry.source === edited)!; await writeFile(join(root, edited), originals.get(edited)!.replace(edit.quote, edit.quote.replace(/\w/, 'Z')));
  const move = fragments.find(entry => entry.source === moved)!; await writeFile(join(root, moved), originals.get(moved)!.replace(move.quote, '') + '\n\n' + move.quote + '\n');
  const duplicate = fragments.find(entry => entry.source === duplicated)!; await writeFile(join(root, duplicated), originals.get(duplicated)! + '\n\n' + duplicate.quote + '\n');
  await rm(join(root, deleted));
  const changed = await check(items.map(item => item.id), { ...options, record: false, budget: 100000 });
  const bounded = await check(items.map(item => item.id), { ...options, record: false, budget: 800 });
  const impact = await affected({ ...options, budget: 100000 });
  const statuses: Record<string, number> = {}; for (const row of changed.rows) { const key = `${row.resolution}/${row.freshness}`; statuses[key] = (statuses[key] ?? 0) + 1; }
  let wholeBytes = 0; for (const source of sources.filter(source => source !== deleted)) wholeBytes += Buffer.byteLength(await readFile(join(root, source), 'utf8'));
  console.log(JSON.stringify({ repository: 'unbraind/pm-changelog', head, citations: fragments.length, documents: sources.length, baseline: { 'resolved/current': 20 }, statuses, ambiguous: changed.rows.filter(row => row.resolution === 'ambiguous').map(row => ({ item: row.item, citation: row.citation })), comparison: { estimator: 'ceil(utf8_bytes/4), not a tokenizer', fullCheckTokens: tokens(changed), wholeDocumentsTokens: Math.ceil(wholeBytes / 4), wholeDocumentsBytes: wholeBytes, boundedCheckTokens: tokens(bounded), boundedReturned: bounded.receipt.returned, boundedOmitted: bounded.receipt.omitted }, calls: { cite: 20, check: 3, affected: 1, discovery: 1, sourceReads: reads }, affected: { returned: impact.receipt.returned, omitted: impact.receipt.omitted, complete: impact.receipt.complete }, elapsedMs: Math.round(performance.now() - started), noGit: true, scratchRemoved: true }, null, 2));
} finally { process.env.PATH = savedPath; await rm(root, { recursive: true, force: true }); }
