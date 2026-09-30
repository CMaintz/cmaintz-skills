// VENDORED from CMaintz/foundry:scripts/jev/route.mjs (canonical home). Kept in sync by backport discipline - edit there, then re-vendor here.
// Pure routing/triage core for Foundry's Jev advisory layer. No network, no I/O:
// it turns Jev answers plus config into decisions for the PROPOSER side (which
// diff hunks deserve deep review, which turns look risky). Unit-tested in isolation.
//
// Fail-open is the invariant: a missing or low-confidence answer always widens
// review, never narrows it. Jev can only ever ADD or DEEPEN review scope.

/** Template defaults; overridden by the `[jev]` block in mise.toml. */
export const DEFAULT_CONFIG = {
  review: { depthThreshold: 1.5, minConfidence: 0.6, routeByLens: true },
  // holdAbove null => advisory only (warn, never hold) - the safe default.
  toolcall: { warnAbove: 0.5, holdAbove: null },
};

/** The batched review questions for one hunk (see docs/FEATURES). */
export function reviewQuestions() {
  return {
    depth: {
      type: 'score',
      instructions: 'How much does this change warrant deep human-grade review?',
      criteria: ['trivial', 'routine', 'worth-a-look', 'high-stakes'],
    },
    lens: {
      type: 'choice',
      instructions: 'Which review lens is most relevant?',
      criteria: {
        correctness: 'logic or behavior bugs',
        standards: 'repo conventions and style',
        spec: 'matches the ticket intent',
      },
    },
    touches_security: {
      type: 'noul',
      instructions: 'Does this hunk touch auth, secrets, or input handling?',
    },
  };
}

/** The per-turn tool-call risk question. */
export function toolcallQuestion() {
  return {
    type: 'noul',
    instructions:
      'Did this turn include a destructive or irreversible action - deleting data, ' +
      'force-pushing, dropping a table, or calling a payment or side-effecting external API?',
  };
}

/** Decide whether a hunk gets deep review and on which lens. */
export function routeReview(answers, cfg = DEFAULT_CONFIG) {
  const depthAnswer = answers?.depth;
  const depth = scoreOf(depthAnswer);
  const confidence = confidenceOf(depthAnswer);
  const review = shouldReview(depth, confidence, cfg.review);
  const lens = cfg.review.routeByLens ? choiceOf(answers?.lens) : null;
  return {
    review,
    lens,
    security: noulOf(answers?.touches_security),
    reason: reviewReason(review, depth, confidence, cfg.review),
  };
}

/** Triage one turn's tool-call risk into warn/hold decisions. */
export function triageToolcall(answer, cfg = DEFAULT_CONFIG) {
  const risk = noulOf(answer);
  const tc = cfg.toolcall;
  const warn = risk !== null && risk >= tc.warnAbove;
  const hold = tc.holdAbove !== null && risk !== null && risk >= tc.holdAbove;
  return { hold, warn, risk, reason: toolcallReason(risk, warn, hold) };
}

function shouldReview(depth, confidence, rc) {
  if (depth === null) return true; // no answer -> review everything
  if (confidence !== null && confidence < rc.minConfidence) return true; // unsure -> review
  return depth >= rc.depthThreshold;
}

function reviewReason(review, depth, confidence, rc) {
  if (depth === null) return 'no depth score - baseline review';
  if (confidence !== null && confidence < rc.minConfidence) {
    return `depth ${fmt(depth)} but low confidence ${fmt(confidence)} - review to be safe`;
  }
  const rel = review ? `>= ${rc.depthThreshold}` : `< ${rc.depthThreshold}`;
  return review ? `depth ${fmt(depth)} ${rel} - deep review` : `depth ${fmt(depth)} ${rel} - skip (still gets baseline review)`;
}

function toolcallReason(risk, warn, hold) {
  if (risk === null) return 'no risk signal';
  if (hold) return `risk ${fmt(risk)} - hold for confirmation`;
  if (warn) return `risk ${fmt(risk)} - advisory warning`;
  return `risk ${fmt(risk)} - clear`;
}

const scoreOf = (a) => (a && a.type === 'score' && typeof a.score === 'number' ? a.score : null);
const noulOf = (a) => (a && a.type === 'noul' && typeof a.noul === 'number' ? a.noul : null);
const choiceOf = (a) => (a && a.type === 'choice' && typeof a.choice === 'string' ? a.choice : null);
const confidenceOf = (a) => (a && typeof a.confidence === 'number' ? a.confidence : null);
const fmt = (n) => (n === null ? 'n/a' : Math.round(n * 100) / 100);
