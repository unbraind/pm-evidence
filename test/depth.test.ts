import assert from 'node:assert/strict';
import { test } from 'node:test';
import { testDepth, testTime } from './support/depth.ts';

test('quick depth retains a deterministic prefix with at least 25 cases; unset is full', () => {
  const previous = process.env.PM_TEST_DEPTH;
  try {
    delete process.env.PM_TEST_DEPTH;
    assert.equal(testDepth(500), 500);
    process.env.PM_TEST_DEPTH = 'quick';
    assert.equal(testDepth(500), 50);
    assert.equal(testDepth(100), 25);
    assert.equal(testDepth(20), 20);
  } finally {
    if (previous === undefined) delete process.env.PM_TEST_DEPTH;
    else process.env.PM_TEST_DEPTH = previous;
  }
});

test('harness watchdogs round up and reject invalid scale factors', () => {
  assert.equal(testTime(3, '1.1'), 4);
  assert.equal(testTime(300000, '3'), 900000);
  for (const scale of ['', '0', '-1', 'NaN', 'Infinity', '1000000000']) {
    assert.throws(() => testTime(300000, scale), /PM_TEST_TIME_SCALE/);
  }
});
