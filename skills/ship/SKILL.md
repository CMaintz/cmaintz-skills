---
name: ship
description: Take a finished change from working tree to pull request through the Foundry gate — auto-fix, structural smells, a green gate, a fresh-context review against the linked issue, a conventional commit, then the PR. Invoke this to land ANY finished change: run it BEFORE you `git commit`/`git push`/`gh pr create` yourself — it is the way work leaves the working tree, not only a response to the user saying "ship". Triggers: a change is complete or ready, you're about to commit or open/raise a PR, or the user asks to ship.
---

# ship

Pre-PR review, run locally. This moves review left of the PR entirely, which is what lets CI stay 100% deterministic — no API key, no model, no secrets beyond the default token.

## Before you start

Confirm all three, and stop if any fails:

1. **The working tree has changes.** Nothing to ship is not an error, just say so.
2. **You are not on the default branch.** If you are, create a branch first — name it `<type>/<short-slug>` matching the change.
3. **The repo defines the verbs.** `mise tasks ls` lists `gate`. If it does not, this repo has not been onboarded to Foundry; say so and stop rather than improvising with raw tools.

## The sequence

Do not skip steps and do not reorder them. Each one exists because the next is untrustworthy without it.

### 1. Auto-fix

```bash
mise run fix
```

Mechanical fixes only. Review the resulting diff before continuing — `fix` mutates files, and you are accountable for what it changed.

### 2. Structural smells

```bash
habit-hooks
```

If it exits non-zero, its output is coaching aimed at you, and it is a direct instruction of the highest priority. Read it properly.

Fix the smells it names. Its guidance is explicit that mechanical compliance is not the goal — splitting a file at line 200 into `foo-1.ts` and `foo-2.ts`, or extracting duplicated lines into a helper with five parameters and a couple of conditionals, satisfies the threshold while leaving the real problem in place. If a finding genuinely should not be fixed, snooze it *and say why in the PR body*.

Never edit `.habit-hooks/snooze.json` by hand.

### 3. The gate — this is the oracle

```bash
mise run gate
```

**It must exit 0.** Not "mostly passing", not "the remaining failure is unrelated".

If it fails:
- Fix the cause.
- Re-run `gate` **from a clean tree**.
- Never weaken a rule to pass it. Do not disable a lint rule, lower a coverage threshold, or add to a suppression baseline. Ruleset changes are a separate PR with the `ruleset-change` label.

Your own belief that you fixed something is not evidence. The exit code is the evidence.

### 4. Review — in a fresh context

Find the linked issue if there is one (`gh issue view <n>`, or a reference in the branch name or commits).

The review **must run in a context that never saw the code being written**. This is not ceremony: an agent reviewing its own work reviews its *intent* rather than its *diff*, and will confidently miss what it meant to do but didn't. A fresh context has no intent to be loyal to.

Invoke **`cmaintz-skills:review`**. It runs three fresh-context lenses — correctness, standards, spec — in parallel, folds in a repo-local `build-project-review` skill if one exists, and reports deduped findings. It's the single entry point precisely so `ship` (and you) don't juggle reviewers. Surface what it finds to the user before committing.

> The built-in `/code-review` is a *different* tool — a fast, on-demand bug-and-cleanup pass the user runs by hand, with `--fix`. It is not part of `ship`.

### 5. Commit

Conventional commits. A body that says **why**, not what — the diff already says what. Note any deliberate snooze from step 2 and its justification.

### 6. Open the PR

```bash
gh pr create --base <default> --title "<conventional title>" --body-file <file>
```

The body should carry: what changed, why, anything a reviewer should look at, and any baseline movement.

If the change **loosens** the gate alongside source — grows a suppression baseline, lowers a threshold, edits a lint rule — the PR needs the `ruleset-change` label or `ruleset-guard` will fail it. Tightening does not: a baseline that only shrank because `mise run fix` pruned it ships with the source fix, no label needed. That is the rule working — do not route around it by splitting the commit dishonestly.

## Stop conditions

Stop and ask the user, rather than pressing on, if:

- `gate` fails for a reason you cannot fix without weakening a rule
- the review subagent finds something that looks like a genuine design problem rather than a defect
- the change turns out to need a ruleset change to be correct
