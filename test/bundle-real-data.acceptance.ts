/** Measure selected retained public artifacts while the copied source tracker remains read-only. */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { certifyCompleteListResult, PmClient } from '@unbrained/pm-cli/sdk';
import { bundleTarget, cite, exportBundle, importBundle, inspectBundle, replay, setBundleConsent } from '../index.ts';
import type { Citation } from '../index.ts';
import { copyPublicSnapshot, publicSnapshotInfo, freezeSnapshot, snapshotDigests } from './public-copy.ts';

const repository = process.argv[2]; assert.ok(repository, 'Pass a public fleet checkout');
const source = publicSnapshotInfo(repository); const root = await mkdtemp(join(tmpdir(), 'bundle-public-'));
const previousPath = process.env.PATH; const previousCeiling = process.env.GIT_CEILING_DIRECTORIES;
try {
  const snapshot = join(root, 'snapshot'); await mkdir(snapshot);
  const files = copyPublicSnapshot(repository, snapshot, ['.agents/pm', 'README.md']);
  const before = await freezeSnapshot(snapshot, files);
  process.env.GIT_CEILING_DIRECTORIES = dirname(root); process.env.PATH = '';
  const reader = new PmClient({ pmRoot: join(snapshot, '.agents', 'pm'), noExtensions: true });
  const corpus = certifyCompleteListResult(await reader.listAllComplete({ includeBody: true })).items;
  const selected = corpus.slice(0, 6); assert.equal(selected.length, 6);
  const sender = new PmClient({ pmRoot: join(root, 'sender'), author: 'public-evaluation', noExtensions: true });
  await sender.init('bundle-public', { defaults: true, agentGuidance: 'skip', mergeFence: false });
  await sender.create({ id: 'bundle-public-source', type: 'Decision', title: 'Public evidence selection', unset: ['parent', 'assignee', 'sprint', 'release'] });
  const options = { workspace: join(root, 'sender'), root: snapshot, author: 'public-evaluation' }; const citations: string[] = []; const fragments: string[] = [];
  for (const item of selected) {
    const path = files.find(file => file.endsWith(`/${item.id}.toon`)); assert.ok(path);
    const text = await readFile(join(snapshot, path), 'utf8'); const lines = text.split('\n');
    const index = lines.findIndex(line => line.startsWith('title:')); assert.ok(index >= 0);
    fragments.push(lines[index]); citations.push((await cite('bundle-public-source', path, { ...options, retain: true, selector: { kind: 'lines', start: index + 1, end: index + 1 } })).citation);
  }
  await setBundleConsent({ ...await bundleTarget('bundle-public-source', options), citations, consent: 'granted' }, options);
  const bundle = await exportBundle({ item: 'bundle-public-source', citations: citations.slice(0, 5) }, options);
  assert.equal(bundle.entries.length, 5); assert.ok(!bundle.entries.some(entry => entry.id === citations[5]));
  const recipientOptions = { workspace: join(root, 'recipient'), author: 'public-evaluation' };
  const recipient = new PmClient({ pmRoot: recipientOptions.workspace, author: 'public-evaluation', noExtensions: true });
  await recipient.init('bundle-recipient', { defaults: true, agentGuidance: 'skip', mergeFence: false });
  await recipient.create({ id: 'bundle-recipient-decision', type: 'Decision', title: 'Public evidence replay', unset: ['parent', 'assignee', 'sprint', 'release'] });
  const authorization = { ...await bundleTarget('bundle-recipient-decision', recipientOptions), authorized: true as const };
  const inspection = await inspectBundle(bundle, authorization, { ...recipientOptions, budget: 800 });
  const imported = await importBundle(bundle, authorization, recipientOptions); assert.equal(imported.added, 5);
  const saved = (await recipient.get(authorization.item, { full: true })).item;
  const entries = (JSON.parse(String(saved.evidence_state)) as { citations: Citation[] }).citations;
  assert.deepEqual(entries.map(replay), fragments.slice(0, 5));
  const retry = await importBundle(bundle, { ...await bundleTarget(authorization.item, recipientOptions), authorized: true }, recipientOptions); assert.equal(retry.status, 'unchanged');
  const tampered = structuredClone(bundle); tampered.entries[4].retained = Buffer.from('tampered').toString('base64');
  await assert.rejects(importBundle(tampered, { ...await bundleTarget(authorization.item, recipientOptions), authorized: true }, recipientOptions), { code: 'integrity' });
  await setBundleConsent({ ...await bundleTarget('bundle-public-source', options), citations: [citations[0]], consent: 'revoked' }, options);
  await assert.rejects(exportBundle({ item: 'bundle-public-source', citations: [citations[0]] }, options), { code: 'boundary' });
  assert.deepEqual(await snapshotDigests(snapshot, files), before);
  console.log(JSON.stringify({ ...source, trackerItems: corpus.length, sourceFilesVerified: files.length, citedArtifacts: citations.length, exportedArtifacts: bundle.entries.length, unselectedArtifactsExcluded: 1, bundleBytes: Buffer.byteLength(JSON.stringify(bundle)), retainedBytes: entries.reduce((sum, entry) => sum + Buffer.byteLength(replay(entry)), 0), sourceFreeReplays: entries.length, imported: imported.added, retryAdded: retry.added, tamperRefusals: 1, revokedExportRefusals: 1, inspection: { returned: inspection.receipt.returned, omitted: inspection.receipt.omitted, estimatedTokens: inspection.estimatedTokens }, sourceUnchanged: true, noGit: true, gitExecutableUnavailable: true }, null, 2));
} finally {
  if (previousPath === undefined) delete process.env.PATH; else process.env.PATH = previousPath;
  if (previousCeiling === undefined) delete process.env.GIT_CEILING_DIRECTORIES; else process.env.GIT_CEILING_DIRECTORIES = previousCeiling;
  await rm(root, { recursive: true, force: true });
}
