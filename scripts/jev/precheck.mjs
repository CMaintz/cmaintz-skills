#!/usr/bin/env node
// Feature-loop pre-check (advisory). Before an expensive LLM verify, ask Jev one cheap
// Noul: is the ticket ready to work, or does the current diff plausibly satisfy the
// acceptance criteria? Only a confident "no" short-circuits; anything uncertain falls
// through to the LLM verify. Fail-open: no key or any error => proceed.
//
//   node precheck.mjs ready     "<ticket text>"
//   node precheck.mjs satisfies "<acceptance criteria>" [baseRef]

import { execSync } from 'node:child_process';
import { providerFromEnv } from './client.mjs';

const LOW_BAR = 0.15; // below this probability it is a confident "no"

export function readyQuestion() {
  return {
    type: 'noul',
    instructions:
      'Is this ticket ready to implement: does it state a clear intent, acceptance criteria, and scope boundaries?',
  };
}

export function satisfiesQuestion() {
  return {
    type: 'noul',
    instructions: 'Does this diff plausibly satisfy the stated acceptance criteria (a rough pre-check, not a proof)?',
  };
}

/** A confident "no" (low probability) short-circuits; null or uncertain proceeds. */
export function verdict(noul, lowBar = LOW_BAR) {
  if (typeof noul !== 'number') return { proceed: true, probability: null, reason: 'no signal - proceed to verify' };
  const proceed = noul > lowBar;
  const shown = Math.round(noul * 100) / 100;
  return {
    proceed,
    probability: noul,
    reason: proceed ? `plausible (p=${shown}) - proceed to verify` : `confident no (p=${shown}) - fix before spending an LLM verify`,
  };
}

function noulOf(answers) {
  const answer = answers?.check;
  return answer && answer.type === 'noul' && typeof answer.noul === 'number' ? answer.noul : null;
}

async function main() {
  const [mode, text, baseRef = 'origin/main'] = process.argv.slice(2);
  const provider = providerFromEnv();
  if (!provider || (mode !== 'ready' && mode !== 'satisfies')) {
    return void process.stdout.write(`${JSON.stringify(verdict(null))}\n`);
  }
  const question = mode === 'ready' ? readyQuestion() : satisfiesQuestion();
  const state = mode === 'ready' ? { ticket: text } : { acceptance: text, diff: safeDiff(baseRef) };
  const { answers } = await provider.evaluate({ state, questions: { check: question } });
  process.stdout.write(`${JSON.stringify(verdict(noulOf(answers)))}\n`);
}

function safeDiff(baseRef) {
  try {
    return execSync(`git diff ${baseRef}...HEAD`, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).slice(0, 16000);
  } catch {
    return '';
  }
}

if (process.argv[1]?.endsWith('precheck.mjs')) {
  main().catch(() => process.stdout.write(`${JSON.stringify(verdict(null))}\n`));
}
