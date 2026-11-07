import { test } from 'node:test';
import * as source from '../index.ts';
import * as built from '../dist/index.js';
import { assertCitationReuseContract } from './citation-reuse-contract.ts';
import { nativeContractCli } from './helpers.ts';

for (const [name, api] of [['source', source], ['built', built]] as const) test(`citation reuse isolates owners and providers and preserves alias order through ${name}`, async () => {
  await assertCitationReuseContract(api, nativeContractCli);
});
