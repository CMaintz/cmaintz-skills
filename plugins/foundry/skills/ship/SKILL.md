---
name: ship
description: Take a finished change from working tree to pull request through the Foundry gate - auto-fix, structural smells, a green gate, a fresh-context review and verify against the linked issue, a conventional commit, then the PR. Invoke this to land ANY finished change: run it BEFORE you `git commit`/`git push`/`gh pr create` yourself - it is the way work leaves the working tree, not only a response to the user saying "ship". Triggers: a change is complete or ready, you're about to commit or open/raise a PR, or the user asks to ship.
---

# ship

Pre-PR review, run locally. This moves review left of the PR entirely, which is what lets CI stay 100% deterministic - no API key, no model, no secrets beyond the default token.

## Before you start

Confirm all three, and stop if any fails:

1. **The working tree has changes.** Nothing to ship is not an error, just say so.
2. **You are not on the default branch.** If you are, create a branch first - name it `<type>/<short-slug>` matching the change.
3. **The repo defines the verbs.** `mise tasks ls` lists `gate`. If it does not, this repo has not been onboarded to Foundry; say so and stop rather than improvising with raw tools.

## The sequence

Do not skip steps and do not reorder them. Each one exists because the next is untrustworthy without it.

### 1. Auto-fix

```bash
mise run fix
```

Mechanical fixes only. Review the resulting diff before continuing - `fix` mutates files, and you are accountable for what it changed.

### 2. Structural smells

```bash
mise run smells
```

Run `mise run smells` when `mise tasks ls` lists a top-level `smells` task: it runs the habit-hooks version the repo pins, the same check `gate` runs. A bare `habit-hooks` runs whatever is first on `PATH`, which can be an older global install. `smells` is an auxiliary task, not a contract verb, so when the repo has none, run `habit-hooks` instead, under the rule below.

`habit-hooks` is opt-in per repo, by the same rule `hooks/habit-hooks-guard.sh` uses: a `.habit-hooks/` directory at the repo root or in an immediate subdirectory. With none, skip this step, count it as no smells, and say so once. With one but no `habit-hooks` command on `PATH`, stop with an error instead of skipping: a broken install must never pass as clean.

If it exits non-zero, its output is coaching aimed at you, and it is a direct instruction of the highest priority. Read it properly.

Every smell is either ENFORCED or SUGGESTED in habit-hooks' catalogue (a repo's config can override either). Only an ENFORCED finding exits non-zero, so a run that prints findings and exits 0 named only SUGGESTED ones, such as `non-essential-comment`, `duplicated-code` or `explicit-any`.

Fix the ENFORCED smells it names. Judge each SUGGESTED one instead of obeying it: fix it when it is right, and when it is wrong, leave it and say why in the PR body. Never delete a comment that says why (an intent, a constraint, a workaround) to quiet `non-essential-comment`; delete only comments that restate the code. Its guidance is explicit that mechanical compliance is not the goal - splitting a file at line 200 into `foo-1.ts` and `foo-2.ts`, or extracting duplicated lines into a helper with five parameters and a couple of conditionals, satisfies the threshold while leaving the real problem in place. If a finding genuinely should not be fixed, snooze it *and say why in the PR body*.

Never edit `.habit-hooks/snooze.json` by hand.

### 3. The gate - this is the oracle

```bash
mise run gate
```

**It must exit 0.** Not "mostly passing", not "the remaining failure is unrelated".

If it fails:
- Fix the cause.
- Re-run `gate` **from a clean tree**.
- Never weaken a rule to pass it. Do not disable a lint rule, lower a coverage threshold, or add to a suppression baseline. Ruleset changes are a separate PR with the `ruleset-change` label.

Your own belief that you fixed something is not evidence. The exit code is the evidence.

### 4. Review - in a fresh context

First read the full diff yourself, committed and uncommitted (`git diff $(git merge-base <default> HEAD)`, plus `git status --short` for untracked files): it should hold this change and nothing else. Remove unrelated edits, debug leftovers, and stray files, and hold every comment you added to "why, not what" (no history or session context in comments, no commented-out code, no `TODO` without an issue link). If this changed anything, re-run step 3.

Find the linked issue if there is one (`gh issue view <n>`, or a reference in the branch name or commits).

The review **must run in a context that never saw the code being written**. This is not ceremony: an agent reviewing its own work reviews its *intent* rather than its *diff*, and will confidently miss what it meant to do but didn't. A fresh context has no intent to be loyal to.

Invoke **`foundry:review`**. It runs three lenses (correctness, standards, spec) in fresh-context sub-agents scaled to the diff size, folds in a repo-local `build-project-review` skill if one exists, and reports deduped findings that survived a fresh refuter's attempt to disprove them. It's the single entry point precisely so `ship` (and you) don't juggle reviewers. Surface what it finds to the user before committing.

**Then verify, when there is a linked issue.** Invoke **`foundry:verify <n>`** to walk its acceptance criteria and Definition of Done, including DoD items the diff can't show, unless verify already passed in this session on this same change (the same HEAD and no edits since), as it has when `feature` hands over. Like review it is advisory: surface every fail and can't-check to the user before committing, and put its table in the PR body so the reviewer sees each DoD item's state. With no linked issue, skip it.

> The built-in `/code-review` is a *different* tool - a fast, on-demand bug-and-cleanup pass the user runs by hand, with `--fix`. It is not part of `ship`.

### 5. Commit

Conventional commits: an imperative subject of 72 chars max saying what changed, and a body that says **why**, not what - the diff already says what. Skip the body when the why is obvious. Footer `Closes #<n>`, plus `BREAKING CHANGE:` when it applies. Note any deliberate snooze from step 2 and its justification.

### 6. Open the PR and watch CI - in one non-blocking step

Write the PR body to a file first, and keep it short: the problem and why, a few bullets on approach, what a reviewer should look at closely, anything deliberately left out (including `TODO`s), any baseline movement, the reason for any snooze from step 2, and the `verify` table from step 4. No file lists, no testing essays. It goes in a **file**, never on the command line, because the `guard-pr-create.sh` hook denies a raw `gh pr create` (so no agent skips steps 1-5) and prose that mentions `gh pr create` would otherwise trip it.

The sanctioned path is **`foundry-ship-pr`**: it pushes the branch, opens the PR ready for review (never a draft, and a reused draft is marked ready), then starts the `pr-ci-watch` watcher (`foundry-pr-watch`) in the background. It runs `gh pr create` as a subprocess, which the hook never sees, so it is the one way through. Run it from the worktree whose branch you are shipping, as an ordinary (foreground) Bash call: it returns as soon as the PR is open, because the watch is already off the critical path. There is no `--repo`: the repo is the one the checkout's `origin` points at, linked worktrees included.

```bash
"${CLAUDE_PLUGIN_ROOT}/scripts/foundry-ship-pr" --body-file <file> [--title-file <file>] [--base <branch>]
```

It prints the PR URL (also written to `.foundry/pr-url`) and where the watch runs: a sibling Herdr pane when `HERDR_ENV=1`, else a detached process logging to `.foundry/pr-watch.log`. Exit 0 means the PR is open and the watch started; 3 means the push itself was rejected, so rebase or fix the branch rather than looking for CI logs.

If the change **loosens** the gate alongside source (grows a suppression baseline, lowers a threshold, edits a lint rule) the PR needs the `ruleset-change` label or `ruleset-guard` will fail it. Tightening does not: a baseline that only shrank because `mise run fix` pruned it ships with the source fix, no label needed. That is the rule working - do not route around it by splitting the commit dishonestly.

### 7. Act on the verdict - do NOT assume green

A green local `gate` is necessary, not sufficient. CI runs checks your six-verb gate does **not**: the smells-vs-baseline job, secret scan, SAST (semgrep/CodeQL), dependency review. So when the watch finishes, you **must act on its result** - "I pushed, so it's green" is exactly how a red PR gets left behind.

Collect the verdict the way **`foundry:pr-ci-watch`** does: keep working, and check between other steps for the `---PR-CI-WATCH-DONE--- exit <n>` line (0 passed, 1 a check failed, 2 nothing to judge). In Herdr, read the pane the script named (`herdr pane read <pane> --source recent-unwrapped --lines 200`) and close it once you are done with it. Outside Herdr, have the session woken when it lands by starting a background Bash task (`run_in_background: true`, generous timeout) that waits on the log:

```bash
until grep -q -- '---PR-CI-WATCH-DONE---' .foundry/pr-watch.log; do sleep 15; done; cat .foundry/pr-watch.log
```

On failure, take the failing-step logs above the sentinel and run the observe->fix->verify loop: fix the real cause, commit, and re-run `foundry-ship-pr` (idempotent - it pushes the new commit, finds the existing PR and starts a fresh watch of that commit's checks). Genuinely baseline-only bot PRs are the only ones that legitimately skip the watch.

When review comments arrive, answer every thread: fix it and reply with the commit, or explain why not. Leave resolving to the reviewer.

### 8. Clean up the worktree once merged

A worktree holds its own dependencies (a Node one is about 0.5GB of `node_modules`), so remove it when its work has landed. Remove only a worktree that passes every check below, and report each one skipped with the check it failed:

- **Foundry made it:** its path is `../_wt/<slug>-<n>` beside the main checkout, on branch `feat/<slug>-<n>`, as `feature` step 2 creates them. Any other worktree belongs to the user or another tool (Claude Code's `.claude/worktrees/`), and its ignored files, such as `.env` or a local database, would go with it.
- **Not locked:** its entry in `git worktree list --porcelain` has no `locked` line. A lock is the owner saying "keep this".
- **Merged, nothing unpushed, nothing uncommitted:**

```bash
gh pr view <branch> --json state,headRefOid   # state is MERGED
git -C <worktree> rev-parse HEAD              # equals that headRefOid
git -C <worktree> status --porcelain          # prints nothing
```

Then remove it, and delete the branch only once the worktree is gone:

```bash
git worktree remove <worktree> && git branch -D <branch>
```

Never add `--force` and never fall back to `rm -rf`: without them git refuses a dirty or locked worktree instead of deleting it. If the removal fails (on Windows, usually a dev server, IDE or other shell holding files open), leave the worktree and its branch and report it as skipped with git's message. `-D`, not `-d`, because a squash-merged branch is not an ancestor of `main`.

When ship ends the PR is usually still awaiting review, so leave the worktree; `feature` sweeps merged ones at the start of its next run. If a check fails, leave the worktree and say which.

## Stop conditions

Stop and ask the user, rather than pressing on, if:

- `gate` fails for a reason you cannot fix without weakening a rule
- the repo has `.habit-hooks/` but the `habit-hooks` command is missing
- the review subagent finds something that looks like a genuine design problem rather than a defect
- the change turns out to need a ruleset change to be correct
