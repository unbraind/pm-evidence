/** Read-only verification of a public fleet snapshot copied outside git; originals are never written. */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { certifyCompleteListResult, PmClient } from '@unbrained/pm-cli/sdk';
import { check, cite, tokens } from '../index.ts';
import { digest } from '../src/core.ts';
import { hits } from '../src/selectors.ts';
import { readFileSnapshot } from '../src/sources.ts';
import { extension } from './helpers.ts';
import { copyPublicSnapshot } from './public-copy.ts';
import type { Packet, CheckRow, SourceAdapter } from '../index.ts';

const repository = process.argv[2]; assert.ok(repository, 'Pass a public fleet checkout');
const identity = execFileSync('git', ['config', '--get', 'remote.origin.url'], { cwd: repository, encoding: 'utf8' }).trim().match(/unbraind\/(pm-[\w-]+)/)?.[0];
assert.ok(identity); assert.equal(JSON.parse(execFileSync('gh', ['repo', 'view', identity, '--json', 'isPrivate'], { encoding: 'utf8' })).isPrivate, false);
const head = execFileSync('git', ['rev-parse', 'origin/main'], { cwd: repository, encoding: 'utf8' }).trim();
const root = await mkdtemp(join(tmpdir(), 'evidence-coalesced-real-')); const started = performance.now(); const previousPath = process.env.PATH;
try {
  copyPublicSnapshot(repository, root, ['.agents/pm', 'README.md']);
  const files = execFileSync('git', ['ls-tree', '-r', '--name-only', 'origin/main', '.agents/pm', 'README.md'], { cwd: repository, encoding: 'utf8' }).trim().split('\n');
  const workspace = join(root, '.agents', 'pm'); const client = new PmClient({ pmRoot: workspace, author: 'public-evaluation', noExtensions: true });
  const items = certifyCompleteListResult(await client.listAllComplete({ includeBody: true })).items;
  const text = await readFile(join(root, 'README.md'), 'utf8'); const lines = text.split('\n');
  const eligible = lines.flatMap((line, index) => line.length >= 30 && hits(text, line).length === 1 ? [index + 1] : []).slice(0, 50); assert.equal(eligible.length, 50);
  process.env.PATH = '';
  for (let index = 0; index < eligible.length; index++) await cite(items[index % Math.min(5, items.length)].id, 'README.md', { workspace, root, author: 'public-evaluation', selector: { kind: 'lines', start: eligible[index], end: eligible[index] } });
  await extension(workspace);
  const before = await Promise.all(files.map(async file => digest(await readFile(join(root, file), 'utf8'))));
  for (const file of files) await chmod(join(root, file), 0o444);
  let reads = 0; const adapter: SourceAdapter = { provider: 'file', read: (source, context) => { reads++; return readFileSnapshot(source, context); } };
  const options = { workspace, root, adapters: [adapter], record: false, budget: 1000000 };
  const result = await check([], options); assert.equal(result.rows.length, 50); assert.ok(result.rows.every(row => row.freshness === 'current' && row.currentRevision === digest(text)));
  assert.equal(result.receipt.verification?.sourceReads, 1); assert.equal(reads, 1);
  const bounded = await check([], { ...options, budget: 800 }); assert.equal(reads, 2); assert.equal(bounded.receipt.complete, false);
  const cliResults = [];
  for (const format of [[], ['--json']]) {
    const cli = spawnSync(process.execPath, [resolve(import.meta.dirname, '../node_modules/.bin/pm'), 'evidence', 'check', '--root', '.', '--read-only', '--budget', '800', ...format], { cwd: root, env: { ...process.env, PM_PATH: workspace, PM_AUTHOR: 'public-evaluation', GIT_CEILING_DIRECTORIES: dirname(root) }, encoding: 'utf8' });
    assert.equal(cli.status, 0, cli.stderr); assert.ok(Math.ceil(Buffer.byteLength(cli.stdout) / 4) <= 800);
    if (format.length > 0) { const packet = JSON.parse(cli.stdout) as Packet<CheckRow>; assert.equal(packet.receipt.verification?.sourceReads, 1); }
    cliResults.push({ format: format.length === 0 ? 'toon' : 'json', bytes: Buffer.byteLength(cli.stdout), estimatedTokens: Math.ceil(Buffer.byteLength(cli.stdout) / 4) });
  }
  assert.deepEqual(await Promise.all(files.map(async file => digest(await readFile(join(root, file), 'utf8')))), before);
  console.log(JSON.stringify({ repository: identity, head, trackerItems: items.length, citingItems: Math.min(5, items.length), citations: 50, documents: 1, sourceBytes: Buffer.byteLength(text), full: { current: result.rows.length, sourceReads: result.receipt.verification?.sourceReads, previousPerCitationReads: 50, estimatedTokens: tokens(result), complete: result.receipt.complete }, bounded: { sourceReads: bounded.receipt.verification?.sourceReads, returned: bounded.receipt.returned, omitted: bounded.receipt.omitted, estimatedTokens: bounded.estimatedTokens }, cli: cliResults, readonlyFilesUnchanged: files.length, noGit: true, gitExecutableUnavailable: true, elapsedMs: Math.round(performance.now() - started) }, null, 2));
} finally { process.env.PATH = previousPath; await rm(root, { recursive: true, force: true }); }
