---
name: review
description: Review a diff, branch, or PR across three lenses — correctness, standards, and spec — as parallel fresh-context sub-agents, then report deduped findings. One reviewer to invoke instead of juggling three. Use when the user asks to review changes, a PR, a branch, or "review since X".
---

# review

One reviewer that composes the three lenses worth having, so there is a single
thing to invoke and track. It takes the best of each separate reviewer —
correctness (built-in `/code-review`), Standards + Spec (`mattpocock-skills:code-review`),
project-specific taste (`build-project-review`) — and runs them as one pass.

**Advisory only. It never blocks and never edits code.** The deterministic gate
(`mise run gate`) decides pass/fail; this decides what a human should look at.

## Why fresh context

Each lens runs in a **sub-agent that sees only the diff and the context it needs —
never the conversation that wrote the code.** An agent reviewing its own work
reviews its *intent*, not its *diff*, and will confidently miss what it meant to
do but didn't. A fresh context has no intent to be loyal to.

## Procedure

1. **Establish the range.** A base ref (branch, tag, commit, or merge-base) and
   `HEAD`. Default to the merge-base with the default branch. Compute
   `git diff <base>...HEAD`.

2. **Gather context** (do this once, share it with the lenses):
   - the linked issue / spec (`gh issue view`, or a reference in the branch/commits)
   - `AGENTS.md` and `CONTEXT.md` if present
   - the enforced configs (eslint, tsconfig, `.habit-hooks/`) — so the review
     doesn't re-litigate what tooling already enforces
   - if a repo-local skill from `build-project-review` exists, load its criteria
     into the Standards lens

3. **Spawn three lenses in parallel**, each a sub-agent given only the diff plus
   the context above:
   - **Correctness** — bugs, wrong edge cases, unhandled errors, race conditions,
     resource leaks, off-by-ones, broken invariants.
   - **Standards** — the repo's own conventions: naming, module boundaries, the
     structural-smell vocabulary, plus any `build-project-review` criteria. Not
     generic style a linter already covers.
   - **Spec** — does the diff do what the issue asked? Flag missing requirements
     and scope creep (things done that nobody asked for).

4. **Merge.** Dedupe findings that overlap across lenses. **Drop anything the
   deterministic gate already catches** (lint, types, tests, coverage) — saying
   it here is noise. Assign severity: blocker / should-fix / nit.

5. **Report**, grouped by lens, most severe first, each finding as
   `file:line — what — why`. State explicitly when a lens found nothing — silence
   is a result, not an omission.

## Rules

- **Review only, never edit.** To apply fixes, the user runs `/simplify` (quality)
  or `/code-review --fix` (bugs).
- **Don't do the gate's job.** If `mise run lint`/`typecheck`/`test` would catch
  it, don't report it.
- **Fewer, higher-confidence findings** beat an exhaustive list of nits.
- **If you can't see the spec, say so** — never invent acceptance criteria.
