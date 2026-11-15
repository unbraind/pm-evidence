/** Deep CI retains both complete release gates; PR CI invokes npm once. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('quick npm and deep npm/Bun release gates remain wired', () => {
  const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  assert.match(ci, /^\s+run: npm run release:check$/mu);
  assert.doesNotMatch(ci, /^\s+run: bun run release:check$/mu);
  const deep = readFileSync(new URL('../.github/workflows/ci-deep.yml', import.meta.url), 'utf8');
  assert.match(deep, /^\s+run: npm run release:check$/mu);
  assert.match(deep, /^\s+run: bun run release:check$/mu);
});
