import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getHistoryPath, mutateItem, PmClient, readHistoryEntries, readSettings } from '@unbrained/pm-cli/sdk';
import { decodeToon, encodeToon } from '@unbrained/pm-cli/sdk/testing';
import type * as Evidence from '../index.ts';

/** Exercise native JSON and TOON command dispatch against the same gitless corpus. */
interface ContractCli {
  /** Activate the installed extension in this disposable tracker. */
  setup(root: string, workspace: string): Promise<void>;
  /** Invoke the actual native host without a git executable. */
  run(root: string, workspace: string, args: string[]): { status: number | null; stdout: string; stderr: string };
}
/** Enumerate every ordered subset of four provider/legacy records, including an empty corpus. */
function corpora(values: number[]): number[][] { return [[], ...values.flatMap(value => corpora(values.filter(other => other !== value)).map(rest => [value, ...rest]))]; }
/** One adversarial contract reused by source, compiled SDK, npm and Bun packed/Git consumers. */
export async function assertChangedOperandContract(api: Pick<typeof Evidence, 'cite' | 'affected'>, cli: ContractCli): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'changed-operands-')); const workspace = join(root, '.agents/pm'); const item = 'evidence-test-decision';
  try {
    const initialization = { defaults: true, agentGuidance: 'skip' as const, mergeFence: false };
    const client = new PmClient({ pmRoot: workspace, author: 'fixture', noExtensions: true });
    await client.init('evidence-test', initialization);
    await client.create({ id: item, type: 'Decision', title: 'Synthetic changed-source corpus' });
    await cli.setup(root, workspace);
    let version = 'old'; const reads: string[] = [];
    const adapters = ['file', 'json', 'opaque'].map(provider => ({ provider, read: async (source: string) => {
      reads.push(provider + ':' + source); const text = provider === 'json' ? JSON.stringify({ claim: version }) : source + ':' + version;
      return { text, revision: createHash('sha256').update(text).digest('hex') };
    } }));
    const options = { workspace, root, author: 'fixture', client, adapters, budget: 100000 };
    for (const [provider, source] of [['file', 'doc.txt'], ['json', 'data.json'], ['opaque', './C:x']]) await api.cite(item, source, { ...options, provider, selector: provider === 'json' ? { kind: 'pointer', pointer: '/claim' } : { kind: 'lines', start: 1, end: 1 } });
    const baseline = JSON.parse(String((await client.get(item, { full: true })).item.evidence_state)) as ReturnType<typeof Evidence.validateRecord>;
    const legacy = JSON.parse(await readFile(new URL('./fixtures/custom-provider-legacy-citation.json', import.meta.url), 'utf8')) as { unretained: Evidence.Citation };
    const citations = [...baseline.citations, legacy.unretained]; version = 'new';
    const settings = await readSettings(workspace);
    await writeFile(join(root, 'doc.txt'), 'doc.txt:new');
    for (const [generation, order] of corpora([0, 1, 2, 3]).sort((left, right) => right.length - left.length).entries()) {
      await mutateItem({ pmRoot: workspace, settings, id: item, op: 'update', author: 'fixture', mutate: document => {
        document.metadata.evidence_state = JSON.stringify({ ...baseline, citations: order.map(index => citations[index]) });
        return { changedFields: ['evidence_state'] };
      } });
      const before = await readHistoryEntries(getHistoryPath(workspace, item), item);
      reads.length = 0;
      const operand = './'.repeat(1 + generation % 7) + 'C:x';
      const selected = await api.affected({ ...options, changed: ['doc.txt', 'data.json', 'sample.txt', operand] }).catch(() => assert.fail('Accepted custom-only operands must work for every corpus and citation order'));
      assert.deepEqual(selected.rows.map(row => row.citation).sort(), order.map(index => citations[index].id).sort());
      assert.deepEqual(selected.scope.customOnlyChanged, [operand]); assert.equal(selected.receipt.complete, true);
      assert.equal(selected.receipt.verification?.sourceReads, order.length);
      assert.ok(selected.rows.every(row => row.freshness === 'changed'));
      for (const rendered of [JSON.parse(JSON.stringify(selected)), decodeToon(encodeToon(selected))] as Evidence.Packet<Evidence.Impact>[]) assert.deepEqual(rendered.scope.customOnlyChanged, [operand]);
      for (const invalid of ['nested/../doc.txt', '../escape', '/absolute', 'C:x', 'bad\\path']) {
        reads.length = 0;
        await assert.rejects(api.affected({ ...options, changed: ['doc.txt', invalid] }), { code: 'invalid' });
        assert.deepEqual(reads, [], 'Every invalid operand must refuse before any source adapter runs');
      }
      reads.length = 0;
      const builtin = await api.affected({ ...options, adapters: adapters.slice(0, 2), changed: ['nested/../doc.txt'] }).catch(() => assert.fail('Built-in-only operands must not depend on unavailable custom records'));
      assert.deepEqual(builtin.rows.map(row => row.citation), order.includes(0) ? [citations[0].id] : []);
      assert.deepEqual(builtin.scope.builtinOnlyChanged, ['nested/../doc.txt']);
      assert.deepEqual(reads, order.includes(0) ? ['file:doc.txt'] : []);
      for (const configured of [undefined, [], adapters.slice(0, 2)]) {
        reads.length = 0;
        await assert.rejects(api.affected({ ...options, adapters: configured, changed: ['./C:x'] }), { code: 'invalid' });
        assert.deepEqual(reads, []);
      }
      const empty = await api.affected({ ...options, changed: [] }); assert.equal(empty.rows.length, 0);
      assert.deepEqual(await readHistoryEntries(getHistoryPath(workspace, item), item), before, 'All success/refusal paths preserve native history');
      if (order.length === 0 || order.join(',') === '0,1,2,3') for (const format of [[], ['--json']]) {
        const args = ['affected', '--changed', 'nested/../doc.txt', '--root', root, ...format];
        const output = cli.run(root, workspace, args); assert.equal(output.status, 0, output.stderr);
        const decoded = (format.length === 0 ? decodeToon(output.stdout) : JSON.parse(output.stdout)) as Evidence.Packet<Evidence.Impact>;
        assert.deepEqual(decoded.scope.builtinOnlyChanged, ['nested/../doc.txt']);
        for (const invalid of ['./C:x', '../escape']) {
          const refused = cli.run(root, workspace, ['affected', '--changed', invalid, '--root', root, ...format]);
          assert.equal(refused.status, 2); assert.match(refused.stderr, /evidence invalid:/);
        }
        assert.deepEqual(await readHistoryEntries(getHistoryPath(workspace, item), item), before);
      }
    }
    await assert.rejects(api.affected({ ...options, workspace: join(root, 'missing-tracker'), client: undefined, changed: ['doc.txt', 'nested/../doc.txt'] }), { code: 'invalid' });
    console.log('Changed-source contract: 65 ordered corpora; provider domains, legacy records, JSON/TOON, early refusals and immutable native history');
  } finally { await rm(root, { recursive: true, force: true }); }
}
