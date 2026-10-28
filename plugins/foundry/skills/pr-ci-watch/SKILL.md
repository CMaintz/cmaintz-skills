---
name: pr-ci-watch
description: Loop a PR's CI result back to a working agent WITHOUT blocking it. Run the PR's checks watch as a hidden Claude Code background task while the main agent keeps coding, then read the verdict and, on failure, fix, push and re-watch until green. Use right after you open or push to a PR and want CI watched in the background instead of blocking the whole session on `gh pr checks --watch`; it is the non-blocking form of ship's watch-CI step. Judges the pushed commit's checks with `foundry-pr-watch`. Never opens a Herdr pane. Triggers: watch a PR's CI, get CI results without waiting, background or non-blocking CI watch, keep working while checks run.
---

# pr-ci-watch

Get a PR's CI result looped back to you **without blocking the turn**. `gh pr checks
--watch` is the right signal but it is a wall: run it inline and the agent sits idle for
the length of the slowest job. This skill runs that watch as a hidden background task, so
the main agent keeps working and only comes back to the result when CI has actually
finished.

It is the non-blocking form of `ship`'s step 7 ("watch CI, do not assume green"). The
observe->fix->verify loop is the same; only the waiting is moved off the critical path.
`foundry-ship-pr` already starts this same watch (with `--ready-on-green`, so its draft PR
turns ready on green) when it opens or updates a PR, so after a ship you only collect that
verdict. Use this skill for a push that did not go through `foundry-ship-pr`.

**Never open a Herdr pane for a watch**, even inside Herdr: a pane per PR clutters the
user's workspace, and the user does not want them. The watch is always hidden.

The watch core is **`foundry-pr-watch`** (ships with this plugin, at
`${CLAUDE_PLUGIN_ROOT}/scripts/`): it waits until the PR's head is the commit you just
pushed and that commit has checks, watches them, then runs `foundry-pr-report` for a
pass/fail summary plus the failing-step logs. Never watch with a bare `gh pr checks
--watch` right after a push: GitHub still shows the previous commit's finished checks for a
while, so it returns the old verdict.

## Resolve the PR

Default to the current branch's PR; take an explicit number if the caller gave one.

```bash
pr="${1:-$(gh pr view --json number -q .number)}"
```

If there is no PR for the branch, say so and stop. There is nothing to watch.

## Run the watch as a background task

Run the watch as a **Claude Code background command** (the Bash tool with
`run_in_background: true`). A background command re-invokes the session when it exits, so
the agent keeps working and is handed the result on completion rather than polling for it.
CI can run for many minutes, so set a generous timeout (well above the default) so the
watch is not killed before CI finishes.

Run it from the worktree whose HEAD you pushed (it judges HEAD's checks; pass `--sha` for
another commit):

```bash
"${CLAUDE_PLUGIN_ROOT}/scripts/foundry-pr-watch" "$pr"
```

When it returns, its exit code is the verdict: 0 green, 1 a check failed (the failing logs
are in its output), 2 nothing to judge (it says why: the head never reached your commit, or
no checks registered).

## On failure: fix, push, re-watch

If CI failed:

1. Get the failing logs from the watch's output (`foundry-pr-report` prints them).
2. Fix the real cause. Never weaken a rule to pass a check.
3. Commit and push.
4. Start a fresh background watch for the new run.

Repeat until the checks are green.

## Notes

- A green local gate is necessary but not sufficient, which is the whole reason to watch
  CI: CI runs jobs the six-verb gate does not (smells-vs-baseline, secret scan, SAST,
  dependency review). This skill is how you close that gap without blocking.
- The watch and verdict live in `foundry-pr-watch` and `foundry-pr-report`, not in bespoke
  parsing here, so the pass/fail logic stays in reusable Foundry primitives.
