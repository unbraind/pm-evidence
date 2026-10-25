/** Read-only compiled-package differential worker; runs with no git executable. */
import { readFile } from 'node:fs/promises';
import { PmClient, certifyCompleteListResult } from '@unbrained/pm-cli/sdk';
import { affected, check } from '../index.ts';
import { packet, tokens } from '../src/core.ts';

const workspace = process.argv[2];
const client = new PmClient({ pmRoot: workspace, noExtensions: true });
const items = certifyCompleteListResult(await client.listAllComplete({ includeBody: true })).items;
const options = { workspace, client, record: false, budget: 1000000 };
const outputs: unknown[] = [tokens(items), await check([], options), await affected(options)];
for (const rows of [[], items.slice(0, 12), items.slice(0, 12).map(item => ({ id: item.id, title: item.title }))]) {
  const scope = { items: items.length, citations: rows.length };
  const budgets = new Set([1, 60, 100, 800, 1000000]);
  for (let count = 0; count <= rows.length; count++) {
    const cost = packet(rows.slice(0, count), scope, 1000000).estimatedTokens;
    budgets.add(cost); budgets.add(cost - 1); budgets.add(cost + 1);
  }
  for (const budget of budgets) for (const sourceComplete of [true, false]) {
    try { outputs.push({ budget, sourceComplete, result: packet(rows, scope, budget, sourceComplete) }); }
    catch (error) { const failure = error as Error & { code: string; remedy: string }; outputs.push({ budget, sourceComplete, error: { code: failure.code, message: failure.message, remedy: failure.remedy } }); }
  }
}
// Require a real corpus rather than passing a vacuous empty tracker comparison.
if (items.length === 0 || (await readFile(workspace + '/settings.json', 'utf8')).length === 0) throw new Error('Need an initialized public tracker');
console.log(JSON.stringify({ items: items.length, comparisons: outputs.length, outputs }));
