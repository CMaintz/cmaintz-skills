import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { miseEnv } from './foundry.mjs';

test('miseEnv resolves a template PATH built on HOME even when the server has no HOME', () => {
  const repo = mkdtempSync(join(tmpdir(), 'fx-mise-'));
  writeFileSync(join(repo, 'mise.toml'), '[env]\n_.path = ["{{env.HOME}}/foundry-scripts-probe"]\n');
  const noHome = { ...process.env };
  delete noHome.HOME;
  const env = miseEnv(repo, { ...noHome, MISE_TRUSTED_CONFIG_PATHS: repo });
  const path = env.PATH ?? env.Path;
  assert.ok(path.includes('foundry-scripts-probe'), path);
  const slashes = (p) => p.replaceAll('\\', '/');
  assert.ok(slashes(path).includes(slashes(homedir())), path);
});

test('miseEnv surfaces a mise refusal instead of reporting the catalog as missing', () => {
  // A config mise rejects (untrusted, or broken as here) must not read as "not provisioned".
  const repo = mkdtempSync(join(tmpdir(), 'fx-refused-'));
  writeFileSync(join(repo, 'mise.toml'), '[env\n');
  assert.throws(() => miseEnv(repo, { ...process.env, MISE_TRUSTED_CONFIG_PATHS: repo }), /mise env failed/);
});

test("miseEnv never answers for another checkout's telemetry", () => {
  const repo = mkdtempSync(join(tmpdir(), 'fx-tel-'));
  const env = miseEnv(repo, { ...process.env, FOUNDRY_TELEMETRY: '/elsewhere/.foundry/telemetry.jsonl' });
  assert.equal(env.FOUNDRY_TELEMETRY, undefined);
});
