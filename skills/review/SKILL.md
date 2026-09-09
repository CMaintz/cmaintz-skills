---
name: review
description: Review a diff, branch, or PR across correctness, standards, and spec lenses — scaled to the size of the change and tunable by effort (low|medium|high). One reviewer to invoke instead of juggling three. Use when the user asks to review changes, a PR, a branch, or "review since X". Accepts an optional effort argument (e.g. "review high").
---

# review

One reviewer that composes the three lenses worth having, so there is a single
thing to invoke and track. It takes the best of each separate reviewer —
correctness (built-in `/code-review`), Standards + Spec (`mattpocock-skills:code-review`),
project-specific taste (`build-project-review`) — and runs them as one pass.

**Advisory only. It never blocks and never edits code.** The deterministic gate
(`mise run gate`) decides pass/fail; this decides what a human should look at.

## Two dials

The review scales on two independent axes so it fits a one-line fix and a
3000-line feature alike. Never review a typo with three sub-agents; never review
a huge feature with just three.

**1. Breadth — set automatically by diff size.** Measure first with
`git diff --stat <base>...HEAD` (files touched, lines changed):

| Diff | Breadth |
|---|---|
| tiny (≲ 2 files / ≲ 50 lines) | one in-context pass, no sub-agents — spawning three to review a typo is waste |
| medium (≲ 15 files / ≲ 500 lines) | the three lenses as three parallel fresh sub-agents |
| large (beyond that) | shard the diff by area (package/module), run the three lenses per shard in parallel, then a final synthesis pass to dedupe and rank across shards. Scale the agent count with the diff — three is a floor, not a ceiling. |

**2. Depth — set by the effort argument (`low` \| `medium` \| `high`, default
`medium`).** Controls the reporting threshold, not the breadth:

| Effort | Reports |
|---|---|
| low | blockers only — correctness bugs, spec violations. Terse. |
| medium | blockers + should-fix (design smells, missing tests) |
| high | the above + nits and suggestions; may surface uncertain findings for a human to judge |

State the chosen breadth and effort at the top of the report.

## Why fresh context

Each lens runs in a **sub-agent that sees only the diff and the context it needs —
never the conversation that wrote the code.** An agent reviewing its own work
reviews its *intent*, not its *diff*, and will confidently miss what it meant to
do but didn't. A fresh context has no intent to be loyal to. (At tiny breadth the
single pass still applies this: review the diff, not your memory of writing it.)

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

3. **Run the lenses at the chosen breadth.** Each lens, given only the diff plus
   the context above:
   - **Correctness** — bugs, wrong edge cases, unhandled errors, race conditions,
     resource leaks, off-by-ones, broken invariants.
   - **Standards** — the repo's own conventions: naming, module boundaries, the
     structural-smell vocabulary, plus any `build-project-review` criteria. Not
     generic style a linter already covers.
   - **Spec** — does the diff do what the issue asked? Missing requirements, and
     scope creep (things done that nobody asked for).

4. **Merge.** Dedupe overlaps across lenses. **Drop anything the deterministic
   gate already catches** (lint, types, tests, coverage). Assign severity, then
   apply the effort threshold — drop everything below it.

5. **Report**, grouped by lens, most severe first, each as
   `file:line — what — why`. State the breadth and effort used. Say explicitly
   when a lens found nothing — silence is a result, not an omission.

## Rules

- **Review only, never edit.** To apply fixes: `/simplify` (quality) or
  `/code-review --fix` (bugs).
- **Don't do the gate's job.** If `mise run lint`/`typecheck`/`test` would catch
  it, don't report it.
- **Fewer, higher-confidence findings** beat an exhaustive list of nits (except
  at `high`, where surfacing the uncertain ones is the point).
- **If you can't see the spec, say so** — never invent acceptance criteria.
