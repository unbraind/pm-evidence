/** Public origin/main tracker copied outside git; validation never modifies the measured snapshot. */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { certifyCompleteListResult, PmClient, splitAcceptanceCriteria } from '@unbrained/pm-cli/sdk';
import { bindCriterion, cite, criterionFacts } from '../index.ts';
import { digest } from '../src/core.ts';
import { hits } from '../src/selectors.ts';
import { copyPublicSnapshot, publicSnapshotInfo, freezeSnapshot, snapshotDigests } from './public-copy.ts';

const repository = process.argv[2]; assert.ok(repository, 'Pass a public fleet checkout');
const { identity, head } = publicSnapshotInfo(repository);
const root = await mkdtemp(join(tmpdir(), 'criterion-public-')); const previousPath = process.env.PATH; const previousCeiling = process.env.GIT_CEILING_DIRECTORIES;
try {
  const files = copyPublicSnapshot(repository, root, ['.agents/pm', 'README.md']);
  process.env.GIT_CEILING_DIRECTORIES = dirname(root); process.env.PATH = '';
  const workspace = join(root, '.agents', 'pm'); const client = new PmClient({ pmRoot: workspace, author: 'public-evaluation', noExtensions: true });
  const options = { workspace, root, author: 'public-evaluation', budget: 1000000 };
  const corpus = certifyCompleteListResult(await client.listAllComplete({ includeBody: true })).items;
  const items = corpus.filter(item => splitAcceptanceCriteria(item.acceptance_criteria).length > 0).slice(0, 20); assert.ok(items.length >= 5);
  const text = await readFile(join(root, 'README.md'), 'utf8'); const lines = text.split('\n'); const selected: number[] = [];
  for (const [index, line] of lines.entries()) if (line.length >= 30 && hits(text, line).length === 1 && (selected.length === 0 || index - selected[selected.length - 1] >= 5)) selected.push(index);
  assert.ok(selected.length >= items.length);
  for (const [index, item] of items.entries()) {
    const citation = await cite(item.id, 'README.md', { ...options, selector: { kind: 'lines', start: selected[index] + 1, end: selected[index] + 1 } });
    const row = (await criterionFacts([item.id], options)).rows.find(row => row.criterion === splitAcceptanceCriteria(item.acceptance_criteria)[0])!;
    await bindCriterion({ item: item.id, citation: citation.citation, criterion: { text: row.criterion, revision: row.revision! } }, options);
  }
  const before = await freezeSnapshot(root, files);
  const ids = items.map(item => item.id); const baseline = await criterionFacts(ids, options);
  const supported = baseline.rows.filter(row => row.support === 'current-source'); assert.equal(supported.length, items.length); assert.equal(baseline.receipt.verification?.sourceReads, 1);
  // Supply an edited snapshot through the supported adapter; the read-only source stays byte-identical.
  const changedLines = [...lines]; changedLines[selected[0]] += ' Revised public-evaluation fragment.'; const changed = changedLines.join('\n');
  const edited = await criterionFacts(ids, { ...options, adapters: [{ provider: 'file', read: async () => ({ text: changed, revision: digest(changed) }) }] });
  assert.equal(edited.rows.filter(row => row.support === 'lost-source').length, 1); assert.equal(edited.rows.filter(row => row.support === 'current-source').length, items.length - 1);
  const bounded = await criterionFacts(ids, { ...options, budget: 800 }); assert.ok(bounded.estimatedTokens <= 800);
  assert.deepEqual(await snapshotDigests(root, files), before);
  console.log(JSON.stringify({ repository: identity, head, trackerItems: corpus.length, selectedItems: items.length, boundCriteria: supported.length, enumeratedCriteria: baseline.rows.length, baselineCurrent: supported.length, afterFragmentEdit: { current: items.length - 1, lost: 1 }, readsPerInvocation: baseline.receipt.verification?.sourceReads, fullEstimatedTokens: baseline.estimatedTokens, bounded: { returned: bounded.receipt.returned, omitted: bounded.receipt.omitted, estimatedTokens: bounded.estimatedTokens }, readOnlyFilesVerified: files.length, noGit: true, gitExecutableUnavailable: true, truthAssessed: false }, null, 2));
} finally {
  process.env.PATH = previousPath;
  if (previousCeiling === undefined) delete process.env.GIT_CEILING_DIRECTORIES; else process.env.GIT_CEILING_DIRECTORIES = previousCeiling;
  await rm(root, { recursive: true, force: true });
}
