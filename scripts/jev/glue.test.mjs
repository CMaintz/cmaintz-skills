import assert from 'node:assert/strict';
import { test } from 'node:test';
import { enabled, verdict } from './precheck.mjs';
import { warningFor } from './toolcall.mjs';

test('precheck verdict proceeds on null or plausible, stops only on a confident no', () => {
  assert.equal(verdict(null).proceed, true);
  assert.equal(verdict(0.9).proceed, true);
  assert.equal(verdict(0.05).proceed, false);
  assert.match(verdict(0.05).reason, /confident no/);
});

test('toolcall warns only above the warn threshold, and never on a missing signal', () => {
  assert.ok(warningFor({ type: 'noul', noul: 0.8 }) !== null);
  assert.equal(warningFor({ type: 'noul', noul: 0.2 }), null);
  assert.equal(warningFor(undefined), null);
});

test('feature pre-check is off by default and opts in on a truthy flag', () => {
  assert.equal(enabled({}), false);
  assert.equal(enabled({ JEV_FEATURE_PRECHECK: 'false' }), false);
  assert.equal(enabled({ JEV_FEATURE_PRECHECK: '1' }), true);
  assert.equal(enabled({ JEV_FEATURE_PRECHECK: 'on' }), true);
});
