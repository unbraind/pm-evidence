import { criterionFacts, cite } from '../index.ts';
import { commitItemMutations } from '@unbrained/pm-cli/sdk';
import { digest } from '../src/core.ts';
import type { CriterionBinding } from '../index.ts';
import { tracker } from './helpers.ts';
import type { TestContext } from 'node:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Bind one existing citation to a unique revision discovered through the public adapter. */
export async function binding(f: Awaited<ReturnType<typeof tracker>>, citation: string, text: string): Promise<CriterionBinding> {
  const row = (await criterionFacts([f.item], { ...f.options, budget: 30000 })).rows.find(row => row.criterion === text && row.revision !== null)!;
  return { item: f.item, citation, criterion: { text, revision: row.revision! } };
}

/** Seed deliberately foreign records through the genuine registered SDK mutation surface. */
export async function writeEvidence(f: Awaited<ReturnType<typeof tracker>>, raw: string): Promise<void> {
  const item = (await f.client.get(f.item, { full: true })).item;
  await commitItemMutations({ pmRoot: f.workspace, author: 'fixture', transactionId: `fixture-${digest(JSON.stringify([item.updated_at, raw]))}`, mutations: [{ op: 'update', id: f.item, match: { key: 'updated_at', value: item.updated_at }, options: { evidenceState: raw } }] });
}

/** A genuine criterion, source and citation keep concurrency fixtures consistent. */
export async function criterionTracker(t: TestContext, text = 'Outcome') {
  const f = await tracker(t);
  await f.client.update(f.item, { acceptanceCriteria: text });
  await writeFile(join(f.root, 'doc.md'), 'Exact claim');
  const citation = await cite(f.item, 'doc.md', { ...f.options, selector: { kind: 'lines', start: 1, end: 1 } });
  return { ...f, citation, request: await binding(f, citation.citation, text) };
}
