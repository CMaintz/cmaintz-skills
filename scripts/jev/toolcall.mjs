#!/usr/bin/env node
// Per-turn tool-call risk triage (called by the Stop hook). Reads the Stop payload,
// asks Jev whether the turn included a destructive or irreversible action, and WARNS
// ONLY - advisory, never blocks (spec v0.3: warn never hold). Fail-open: no key or any
// error => silent exit 0.

import { execSync } from 'node:child_process';
import { providerFromEnv } from './client.mjs';
import { toolcallQuestion, triageToolcall } from './route.mjs';

/** Warning text for a risky turn, or null when nothing to say. */
export function warningFor(answer) {
  const { warn, reason } = triageToolcall(answer);
  if (!warn) return null;
  return `jev-toolcall: ${reason}. Double-check this turn did nothing destructive or irreversible before finishing.`;
}

function toolNames(payload) {
  try {
    return (JSON.parse(payload).tool_uses ?? []).map((use) => use.tool_name);
  } catch {
    return [];
  }
}

function safeDiff() {
  try {
    return execSync('git diff --name-status HEAD', { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }).slice(0, 8000);
  } catch {
    return '';
  }
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  const provider = providerFromEnv();
  if (!provider) return;
  const payload = await readStdin();
  const state = { tools: toolNames(payload), changes: safeDiff() };
  const { answers } = await provider.evaluate({ state, questions: { risk: toolcallQuestion() } });
  const warning = warningFor(answers.risk);
  if (warning) process.stderr.write(`${warning}\n`);
}

if (process.argv[1]?.endsWith('toolcall.mjs')) {
  main()
    .catch(() => {})
    .finally(() => process.exit(0));
}
