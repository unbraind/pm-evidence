/** Isolated behavioral proof: envelope-only validation violates the successful-write/read law. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { expectBehavioralFailure } from './revert-control.ts';
const path = 'src/store.ts'; const original = await readFile(path, 'utf8');
const reverted = original.replace('const validated = validateRecord(value, id);', 'const validated = envelope(JSON.stringify(value));').replace('      validateRecord(current.value, current.item.id);', '      envelope(JSON.stringify(current.value));');
assert.notEqual(reverted, original);
try {
  await writeFile(path, reverted);
  expectBehavioralFailure('test/record-law.test.ts', '^record law: 10000 reviews');
  console.log('Envelope-only commit and preflight: negative control fail 1; complete-record review bound required.');
} finally { await writeFile(path, original); assert.equal(await readFile(path, 'utf8'), original); }
