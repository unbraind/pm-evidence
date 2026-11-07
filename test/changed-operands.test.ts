import { test } from 'node:test';
import * as source from '../index.ts';
import * as built from '../dist/index.js';
import { assertChangedOperandContract } from './changed-operands-contract.ts';
import { nativeContractCli } from './helpers.ts';

for (const [name, api] of [['source', source], ['built', built]] as const) test(`changed operands are corpus-independent across ${name} SDK and native JSON/TOON`, async () => {
  await assertChangedOperandContract(api, nativeContractCli);
});
