import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getHistoryPath, mutateItem, PmClient, readHistoryEntries, readSettings } from '@unbrained/pm-cli/sdk';
import { decodeToon } from '@unbrained/pm-cli/sdk/testing';
import type * as Evidence from '../index.ts';
import { corpora, type assertChangedOperandContract } from './changed-operands-contract.ts';

/** Independent legacy producer fingerprint, used only to construct valid synthetic birth records. */
function identity(prefix: string, ...parts: unknown[]): string { return `${prefix}-${createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 24)}`; }
/** Exercise public identity, alias ordering and ownership guards without exposing the private matcher. */
export async function assertCitationReuseContract(api: Pick<typeof Evidence, 'cite' | 'review' | 'show' | 'bundleTarget' | 'setBundleConsent' | 'exportBundle' | 'importBundle'>, cli: Parameters<typeof assertChangedOperandContract>[1], compactControl = false): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'citation-reuse-')); const workspace = join(root, '.agents/pm');
  try {
    const client = new PmClient({ pmRoot: workspace, noExtensions: true, author: 'fixture' });
    const initialization = { mergeFence: false, defaults: true, agentGuidance: 'skip' as const };
    await client.init('evidence-test', initialization);
    const owners = ['evidence-test-decision', 'evidence-test-peer']; const providers = ['file', 'opaque', 'other-opaque'];
    for (const id of owners) await client.create({ id, type: 'Decision', title: 'Synthetic identity owner' });
    await cli.setup(root, workspace);
    const fixture = JSON.parse(await readFile(new URL('./fixtures/custom-provider-legacy-citation.json', import.meta.url), 'utf8')) as { unretained: Evidence.Citation };
    const text = 'sample.txt:old'; await writeFile(join(root, 'sample.txt'), text); const reads: string[] = [];
    const adapters = providers.map(provider => ({ provider, read: async () => { reads.push(provider); return { text, revision: createHash('sha256').update(text).digest('hex') }; } }));
    const options = { workspace, root, author: 'fixture', adapters, client };
    /** Read native state directly so observations cannot hide cross-owner writes. */
    const state = async (item: string) => JSON.parse(String((await client.get(item, { full: true })).item.evidence_state)) as ReturnType<typeof Evidence.validateRecord>;
    /** Include native history in every no-op and foreign-owner preservation assertion. */
    const image = async (item: string) => ({ raw: (await client.get(item, { full: true })).item.evidence_state, history: await readHistoryEntries(getHistoryPath(workspace, item), item) });
    const canonical = new Map<string, Evidence.Citation[]>(); const allIds = new Set<string>();
    for (const owner of owners) {
      for (const provider of providers) {
        const created = await api.cite(owner, 'sample.txt', { ...options, provider, retain: true, selector: { kind: 'lines', start: 1, end: 1 } });
        assert.ok(!allIds.has(created.citation), 'Fresh citation IDs must distinguish both item and provider'); allIds.add(created.citation);
      }
      canonical.set(owner, (await state(owner)).citations);
    }
    assert.equal(allIds.size, 6);
    const settings = await readSettings(workspace); const reason = 'Persisted alias order contract';
    /** Keep two genuine aliases per provider, with the declared first-match or exact-match review already present. */
    const seed = async (owner: string, order: number[], exact: boolean, reverseFile: boolean) => {
      const aliases = providers.flatMap(provider => ['./sample.txt', '././sample.txt'].map(source => {
        const entry = structuredClone(fixture.unretained); entry.descriptor = { ...entry.descriptor, provider, source }; entry.provenance.item = owner;
        entry.id = identity('ev', owner, entry.descriptor, entry.fragmentDigest); return entry;
      }));
      if (owner === owners[0]) assert.equal(aliases[2].id, fixture.unretained.id, 'The released fixture must retain its original identity');
      const arranged = [aliases[reverseFile ? 1 : 0], ...order.map(index => aliases[index + 2]), aliases[reverseFile ? 0 : 1]];
      const expected = providers.map(provider => {
        const original = aliases.find(entry => entry.descriptor.provider === provider && entry.descriptor.source === '././sample.txt')!;
        const replacement = (exact ? canonical.get(owner)! : arranged).find(entry => entry.descriptor.provider === provider)!;
        const observation = identity('review', owner, original.id, 'fixture', 're-anchored', reason, replacement.id);
        original.reviews = [{ id: observation, author: 'fixture', at: original.provenance.at, disposition: 're-anchored', reason, replacement: replacement.id }];
        return { provider, original: original.id, replacement: replacement.id, observation };
      });
      const citations = [...arranged, ...(exact ? structuredClone(canonical.get(owner)!) : [])];
      await mutateItem({ pmRoot: workspace, settings, id: owner, author: 'fixture', op: 'update', mutate: document => { document.metadata.evidence_state = JSON.stringify({ version: 1, revision: 3, citations }); return { changedFields: ['evidence_state'] }; } });
      return expected;
    };
    const orders = corpora([0, 1, 2, 3]).filter(order => order.length === 4);
    const testedOrders = compactControl ? orders.slice(0, 1) : orders;
    const cases = [...testedOrders.map((order, index) => ({ order, exact: false, reverseFile: index % 2 === 1 })), ...[false, true].map(reverseFile => ({ order: orders[reverseFile ? 23 : 0], exact: true, reverseFile }))];
    for (const [generation, scenario] of cases.entries()) {
      const choices = new Map<string, Awaited<ReturnType<typeof seed>>>();
      for (const owner of owners) choices.set(owner, await seed(owner, scenario.order, scenario.exact, scenario.reverseFile));
      for (const owner of owners) {
        const peer = owners.find(item => item !== owner)!; const untouched = await image(peer);
        const before = await image(owner);
        for (const selected of choices.get(owner)!) {
          const cited = await api.cite(owner, './././sample.txt', { ...options, provider: selected.provider, selector: { kind: 'lines', start: 1, end: 1 } });
          assert.equal(cited.item, owner); assert.equal(cited.citation, selected.replacement, 'Reuse must select the exact ID or first persisted alias of the same provider');
          const reviewed = await api.review(owner, { ...options, citation: selected.original, disposition: 're-anchored', reason });
          assert.equal(reviewed.replacement, selected.replacement); assert.equal(reviewed.observation, selected.observation);
        }
        assert.deepEqual(await image(owner), before); assert.deepEqual(await image(peer), untouched);
        if (generation === 0) for (const selected of choices.get(owner)!) {
          const prior = await state(owner);
          /** A repeated retained-byte upgrade must become a native no-op. */
          const retain = () => api.cite(owner, 'sample.txt', { ...options, provider: selected.provider, retain: true, selector: { kind: 'lines', start: 1, end: 1 } });
          await retain();
          assert.deepEqual(await state(owner), { ...prior, revision: prior.revision + 1, citations: prior.citations.map(entry => entry.id === selected.replacement ? { ...entry, retained: Buffer.from(text).toString('base64') } : entry) });
          assert.deepEqual(await image(peer), untouched);
          const stable = await image(owner);
          await retain();
          assert.deepEqual(await image(owner), stable);
        }
        if (!compactControl && (generation === 1 || scenario.exact)) for (const format of [[], ['--json']]) {
          const selected = choices.get(owner)![0];
          for (const command of [
            ['cite', owner, 'sample.txt', '--lines', '1-1', '--root', root],
            ['review', owner, '--citation', selected.original, '--disposition', 're-anchored', '--reason', reason, '--root', root],
          ]) {
            const result = cli.run(root, workspace, [...command, ...format]); assert.equal(result.status, 0, result.stdout + result.stderr);
            const receipt = (format.length === 0 ? decodeToon(result.stdout) : JSON.parse(result.stdout)) as { item: string; citation: string; replacement?: string };
            assert.equal(receipt.item, owner); assert.equal(receipt.replacement ?? receipt.citation, selected.replacement);
          }
          assert.deepEqual(await image(owner), before); assert.deepEqual(await image(peer), untouched);
        }
      }
    }
    const source = owners[0]; const sourceIds = canonical.get(source)!.map(entry => entry.id);
    await api.setBundleConsent({ ...await api.bundleTarget(source, options), citations: sourceIds, consent: 'granted' }, options);
    const bundle = await api.exportBundle({ item: source, citations: sourceIds }, options); const recipients = ['evidence-test-import-a', 'evidence-test-import-b']; const importedIds = new Set(allIds);
    for (const target of recipients) {
      await client.create({ id: target, type: 'Decision', title: 'Authorized identity recipient' });
      const auth = { ...await api.bundleTarget(target, options), authorized: true as const }; const before = await image(target);
      const preview = await api.importBundle(bundle, auth, { ...options, preview: true }).catch(() => assert.fail('Authorized preview must preserve item and provider identity')); assert.equal(preview.added, 3); assert.deepEqual(await image(target), before);
      const applied = await api.importBundle(bundle, auth, options).catch(() => assert.fail('Authorized import must preserve item and provider identity'));
      assert.equal(applied.added, 3);
      for (const entry of (await state(target)).citations) {
        assert.equal(entry.provenance.item, target); assert.ok(!importedIds.has(entry.id), 'Imported IDs must distinguish target owners and providers'); importedIds.add(entry.id);
        assert.equal((await api.cite(target, 'sample.txt', { ...options, provider: entry.descriptor.provider, selector: { kind: 'lines', start: 1, end: 1 } })).citation, entry.id);
      }
      const stable = await image(target);
      assert.equal((await api.importBundle(bundle, { ...await api.bundleTarget(target, options), authorized: true }, options)).status, 'unchanged'); assert.deepEqual(await image(target), stable);
    }
    assert.equal(importedIds.size, 12);
    await seed(source, orders[0], false, false);
    const foreign = (await state(owners[1])).citations.find(entry => entry.descriptor.provider === 'opaque' && entry.descriptor.source === './sample.txt')!;
    await mutateItem({ pmRoot: workspace, settings, id: source, author: 'fixture', op: 'update', mutate: document => { const value = JSON.parse(String(document.metadata.evidence_state)) as ReturnType<typeof Evidence.validateRecord>; value.citations.unshift(foreign); document.metadata.evidence_state = JSON.stringify(value); return { changedFields: ['evidence_state'] }; } });
    const foreignBefore = await image(source); const peerBefore = await image(owners[1]); reads.length = 0;
    await assert.rejects(api.cite(source, 'sample.txt', { ...options, provider: 'opaque', selector: { kind: 'lines', start: 1, end: 1 } }), { code: 'schema' });
    await assert.rejects(api.show(source, options), { code: 'schema' }); assert.deepEqual(reads, []);
    if (!compactControl) for (const format of [[], ['--json']]) { const result = cli.run(root, workspace, ['show', source, ...format]); assert.equal(result.status, 2); assert.match(result.stderr, /evidence schema:/); }
    assert.deepEqual(await image(source), foreignBefore); assert.deepEqual(await image(owners[1]), peerBefore);
    console.log(compactControl ? 'Citation identity control: SDK guard witnesses' : 'Citation reuse contract: 2 owners, 3 colliding providers, 24 alias orders, exact precedence, retention, bundle rebinding, foreign refusal and native JSON/TOON');
  } finally { await rm(root, { recursive: true, force: true }); }
}
