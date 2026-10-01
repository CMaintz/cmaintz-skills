import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verdict } from './precheck.mjs';

test('precheck verdict proceeds on null or plausible, stops only on a confident no', () => {
  assert.equal(verdict(null).proceed, true);
  assert.equal(verdict(0.9).proceed, true);
  assert.equal(verdict(0.05).proceed, false);
  assert.match(verdict(0.05).reason, /confident no/);
});
