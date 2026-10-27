---
name: review
description: Review a diff, branch, or PR across correctness, standards, and spec lenses (plus a red-team lens at high effort), then try to refute every finding before reporting it. Scaled to the size of the change and tunable by effort (low|medium|high). One reviewer to invoke instead of juggling three. Use when the user asks to review changes, a PR, a branch, or "review since X". Accepts an optional effort argument (e.g. "review high").
---

# review

One reviewer that composes the three lenses worth having, so there is a single
thing to invoke and track. It takes the best of each separate reviewer —
correctness (built-in `/code-review`), Standards + Spec (`mattpocock-skills:code-review`),
project-specific taste (`build-project-review`) — and runs them as one pass. At
`high` effort a red-team lens attacks the change as well, and every finding has
to survive a fresh refuter before it is reported.

**Advisory only. It never blocks and never edits code.** The deterministic gate
(`mise run gate`) decides pass/fail; this decides what a human should look at.

## Two dials

The review scales on two independent axes so it fits a one-line fix and a
3000-line feature alike. Never fan a typo out to three lens agents; never review
a huge feature with just three. A tiny diff still costs two short sub-agents (the
lenses, then the refuter), three at `high`: cheap next to a missed bug.

**1. Breadth — set automatically by diff size.** Measure first with
`git diff --stat <base>...HEAD` (files touched, lines changed):

| Diff | Breadth |
|---|---|
| tiny (≲ 2 files / ≲ 50 lines) | one fresh sub-agent running all three lenses - three would be waste on a typo, but in-context is never enough: a one-line auth check is tiny and still high-stakes |
| medium (≲ 15 files / ≲ 500 lines) | the three lenses as three parallel fresh sub-agents |
| large (beyond that) | shard the diff by area (package/module), run the three lenses per shard in parallel, then a final synthesis pass to dedupe and rank across shards. Scale the agent count with the diff — three is a floor, not a ceiling. |

**2. Depth — set by the effort argument (`low` \| `medium` \| `high`, default
`medium`).** Controls the reporting threshold, not the breadth:

| Effort | Reports |
|---|---|
| low | blockers only — correctness bugs, spec violations. Terse. |
| medium | blockers + should-fix (design smells, missing tests), including any the refuter could not settle, marked unverified |
| high | the above + nits and suggestions; may surface uncertain findings for a human to judge. Adds the **Red-team** lens. |

State the chosen breadth and effort at the top of the report.

## Why fresh context

Each lens runs in a **sub-agent that sees only the diff and the context it needs —
never the conversation that wrote the code.** An agent reviewing its own work
reviews its *intent*, not its *diff*, and will confidently miss what it meant to
do but didn't. A fresh context has no intent to be loyal to. No breadth is exempt,
however small the diff.

## Procedure

1. **Range + size.** Resolve the base ref (branch, tag, commit, or merge-base
   with the default branch). Compute `git diff <base>...HEAD` and `--stat`; pick
   the breadth from the table above.

2. **Gather context** once, shared with every lens:
   - the linked issue / spec (`gh issue view`, or a reference in the branch/commits)
   - `AGENTS.md` and `CONTEXT.md` if present
   - the enforced configs (eslint, tsconfig, `.habit-hooks/`) — so the review
     doesn't re-litigate what tooling already enforces
   - if a repo-local `build-project-review` skill exists, load its criteria into
     the Standards lens
   - if `docs/codemap/INDEX.md` exists, the domain slices (`kind: domain`, not the
     lens files) whose citations cover the diff's files (the same file, or a file
     under a cited directory), for the Spec lens.
     Without it, skip this and do not suggest generating one

   **Optional Jev focus (advisory, opt-in).** If `JEV_API_KEY` is set and the
   breadth is medium or large, run
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/jev/review.mjs" <base>` for near-free per-file
   routing (`{file, review, lens, reason}`). Point the lenses first at the files it
   marks `review: true`, on the lens it names; still give the rest a baseline pass and
   log which were deprioritized. No key, or a small diff, reviews everything as before.
   This only reorders where to look first: Jev never removes a file from review and
   never decides pass/fail.

3. **Run the lenses at the chosen breadth.** Each lens, given only the diff plus
   the context above:
   - **Correctness** — bugs, wrong edge cases, unhandled errors, race conditions,
     resource leaks, off-by-ones, broken invariants.
   - **Standards** — the repo's own conventions: naming, module boundaries, the
     structural-smell vocabulary, plus any `build-project-review` criteria. Not
     generic style a linter already covers.
   - **Spec** — does the diff do what the issue asked? Missing requirements, and
     scope creep (things done that nobody asked for). Check it against the
     acceptance criteria and the Definition of Done, and name each DoD item the
     diff leaves unmet. A DoD item that lives outside the diff (a consumer told, a
     follow-up ticket filed) is listed as not checkable from the diff, not as
     unmet: `verify` owns it. A DoD of
     `None beyond the acceptance criteria.` adds nothing to check.
     With the codemap slices, raise a non-blocking `question:` for each slice
     whose cited files the diff touches but that the ticket never mentions: no
     Pointer overlaps the slice's citations or `paths:`, and the Scope boundaries
     don't name it. The change may be sprawling into a domain the ticket didn't
     plan for. Report it at every effort, since it is cheap to
     answer and the effort threshold would otherwise drop it at `low`.
   - **Red-team** (`high` effort only, always its own fresh sub-agent, even at
     tiny breadth, and one per shard at large breadth: the hostile stance must not share a context with the
     cooperative lenses). Assume the author is wrong and try to break the
     change: boundary and empty inputs, malformed or hostile input, a dependency
     failing or timing out, concurrent callers, the spec's edge cases, and any
     assumption the code makes but never checks. Every finding must name the
     concrete attack (this input or sequence, in this state, gives this wrong
     outcome). No concrete attack, no finding.

4. **Merge.** Dedupe overlaps across lenses. **Drop anything the deterministic
   gate already catches** (lint, types, tests, coverage). Assign severity, then
   apply the effort threshold: drop everything below it, except the Spec lens's
   codemap `question:` findings, which are reported at every effort.

5. **Refute.** Hand the surviving findings to one more fresh sub-agent, one that
   produced none of them (at large breadth, one refuter per shard, in parallel),
   whose job is to disprove each: read the real code
   paths, callers and tests, and look for the guard, invariant or caller that
   makes the reported failure impossible. It may run existing tests to check,
   but never edits files or updates snapshots. Each finding gets a verdict:
   - **refuted**, with the `file:line` evidence that makes it safe. Drop it.
   - **confirmed**: the failure scenario holds. Keep it.
   - **unsure**: keep it, marked unverified, at `medium` and `high`; drop it
     at `low`.

   A refutation needs cited evidence. "Probably handled somewhere" is not a
   refutation, and failing to find a reason the code is safe means the finding
   stands: a refuter that guesses kills real bugs. Skip this step when nothing
   survived the merge, and for the codemap `question:` findings, which are
   questions rather than claims.

6. **Report**, grouped by lens, most severe first, each as
   `file:line — what — why`. State the breadth and effort used. Say explicitly
   when a lens found nothing — silence is a result, not an omission. Give the
   count of findings the refute step dropped, so a short report is visibly
   filtered rather than thin.

## Rules

- **Review only, never edit.** To apply fixes: `/simplify` (quality) or
  `/code-review --fix` (bugs).
- **Don't do the gate's job.** If `mise run lint`/`typecheck`/`test` would catch
  it, don't report it.
- **Fewer, higher-confidence findings** beat an exhaustive list of nits (except
  at `high`, where surfacing the uncertain ones is the point).
- **If you can't see the spec, say so** - never invent acceptance criteria or DoD items.
