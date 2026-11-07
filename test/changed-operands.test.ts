import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { test } from 'node:test';
import * as source from '../index.ts';
import * as built from '../dist/index.js';
import { assertChangedOperandContract } from './changed-operands-contract.ts';
import { environment, extension } from './helpers.ts';

for (const [name, api] of [['source', source], ['built', built]] as const) test(`changed operands are corpus-independent across ${name} SDK and native JSON/TOON`, async () => {
  await assertChangedOperandContract(api, {
    setup: async (_root, workspace) => extension(workspace),
    run: (root, workspace, args) => spawnSync(process.execPath, [join(import.meta.dirname, '../node_modules/.bin/pm'), 'evidence', ...args], { cwd: root, encoding: 'utf8', env: environment(root, workspace) }),
  });
});
