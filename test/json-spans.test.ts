import assert from 'node:assert/strict';
import { test } from 'node:test';
import { jsonFragment } from '../src/json-spans.ts';

/** Test exact numeric/string/container bytes without a floating-point intermediary. */
test('lossless JSON spans preserve every selected lexeme and ignore only outside whitespace', () => {
  const source = ' \n{"n":9007199254740993,"list":[-0,1.00e+400,true,false,null,"a\\u0062"],"object": { "a/b": {"~":2} }} \t';
  assert.equal(jsonFragment(source, ['n']).text, '9007199254740993');
  for (const [index, expected] of ['-0', '1.00e+400', 'true', 'false', 'null', '"a\\u0062"'].entries()) assert.equal(jsonFragment(source, ['list', String(index)]).text, expected);
  assert.equal(jsonFragment(source, ['object']).text, '{ "a/b": {"~":2} }'); assert.equal(jsonFragment(source, ['object', 'a/b', '~']).text, '2');
  assert.equal(jsonFragment(' [ ] ', []).text, '[ ]'); assert.equal(jsonFragment(' {} ', []).text, '{}');
  assert.equal(jsonFragment('{"__proto__":1,"constructor":2}', ['__proto__']).text, '1');
  const escaped = JSON.stringify(String.fromCharCode(34, 92, 47, 8, 12, 10, 13, 9)); assert.equal(jsonFragment(escaped, []).text, escaped);
  assert.equal(jsonFragment('['.repeat(256) + '0' + ']'.repeat(256), []).text.length, 513);
});

/** Validate the complete source and reject duplicate decoded keys instead of selecting an arbitrary occurrence. */
test('lossless JSON spans reject invalid grammar, duplicate keys, missing tokens and excessive nesting', () => {
  for (const source of ['', '{', '[', '[1,]', '{"x":1,}', '{"x" 1}', '{"x":1 "y":2}', '01', '-01', '+1', 'NaN', 'Infinity', '1.', '1e', 'true false', '"bad\nstring"', '"\\x"', '{x:1}', '[1 2]', '\ufeff{}']) assert.throws(() => jsonFragment(source, []), /valid JSON/);
  assert.throws(() => jsonFragment('{"x":1,"\\u0078":2}', ['x']), /repeated decoded keys/);
  assert.throws(() => jsonFragment('['.repeat(257) + '0' + ']'.repeat(257), []), /nesting limit/);
  for (const [source, tokens] of [['null', ['x']], ['{}', ['x']], ['[1]', ['00']], ['[1]', ['length']]] as const) assert.throws(() => jsonFragment(source, tokens), /does not resolve/);
});
