#!/usr/bin/env node
// VENDORED from CMaintz/foundry:scripts/jev/review.mjs (canonical home). Kept in sync by backport discipline - edit there, then re-vendor here.
// v0.1 review pre-filter (runnable). Asks Jev, per changed file, whether it warrants
// deep review and on which lens, then prints routing JSON the review skill consumes.
//
// Advisory and fail-open: no key, or a diff at/under the min-files gate, routes every
// file to review (current behavior) - Jev only ever narrows spend, never the safety net.
//
//   node scripts/jev/review.mjs [baseRef]     # baseRef defaults to origin/main
//   JEV_REVIEW_MIN_FILES=8 node scripts/jev/review.mjs   # skip Jev on small diffs

import { execSync } from 'node:child_process';
import { providerFromEnv } from './client.mjs';
import { reviewQuestions, routeReview } from './route.mjs';

/** Route each changed file: ask Jev per file, or review-all when Jev is unavailable. */
export async function routeFiles(provider, files, minFiles = 0) {
  if (!provider || files.length <= minFiles) {
    const reason = provider ? `at or below the ${minFiles}-file gate` : 'no JEV_API_KEY (review all)';
    return files.map((f) => ({ file: f.file, review: true, lens: null, reason }));
  }
  const routed = [];
  for (const { file, patch } of files) {
    const { answers } = await provider.evaluate({ state: { file, diff: patch }, questions: reviewQuestions() });
    routed.push({ file, ...routeReview(answers) });
  }
  return routed;
}

/** Split `git diff` text into one patch per file (skips deletions to /dev/null). */
export function parseDiff(text) {
  const out = [];
  let current = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('diff --git')) {
      if (current) out.push({ file: current.file, patch: current.lines.join('\n') });
      current = { file: fileFromHeader(line), lines: [line] };
    } else if (current) {
      if (line.startsWith('+++ ')) current.file = plusPath(line) ?? current.file;
      current.lines.push(line);
    }
  }
  if (current) out.push({ file: current.file, patch: current.lines.join('\n') });
  return out.filter((d) => d.file !== '/dev/null');
}

function fileFromHeader(line) {
  const match = /^diff --git a\/.+ b\/(.+)$/.exec(line);
  return match?.[1] ?? 'unknown';
}

function plusPath(line) {
  const path = line.slice(4).trim();
  if (path === '/dev/null') return '/dev/null';
  return path.startsWith('b/') ? path.slice(2) : path;
}

async function main() {
  const baseRef = process.argv[2] ?? 'origin/main';
  const diff = execSync(`git diff ${baseRef}`, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const minFiles = Number(process.env.JEV_REVIEW_MIN_FILES ?? '0');
  const routed = await routeFiles(providerFromEnv(), parseDiff(diff), minFiles);
  process.stdout.write(`${JSON.stringify(routed, null, 2)}\n`);
}

// Run only as a CLI, not when imported by tests.
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('review.mjs')) {
  main().catch((err) => {
    process.stderr.write(`jev-review: ${err?.message ?? err}\n`);
    process.exit(0); // advisory: never break the caller
  });
}
