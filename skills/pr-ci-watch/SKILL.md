---
name: pr-ci-watch
description: Loop a PR's CI result back to a working agent WITHOUT blocking it. Spawn a Herdr monitor pane that watches the PR's checks while the main agent keeps coding, then read the verdict and, on failure, fix, push and re-watch until green. Use right after you open or push to a PR and want CI watched in the background instead of blocking the whole session on `gh pr checks --watch`; it is the non-blocking form of ship's watch-CI step. Prefers `foundry-pr-report` for the verdict when present, and falls back to a Claude Code background task when not running inside Herdr. Triggers: watch a PR's CI, get CI results without waiting, background or non-blocking CI watch, keep working while checks run.
---

# pr-ci-watch

Get a PR's CI result looped back to you **without blocking the turn**. `gh pr checks
--watch` is the right signal but it is a wall: run it inline and the agent sits idle for
the length of the slowest job. This skill puts that watch in a sibling Herdr pane, so the
main agent keeps working and only comes back to the result when CI has actually finished.

It is the non-blocking form of `ship`'s step 7 ("watch CI, do not assume green"). The
observe->fix->verify loop is the same; only the waiting is moved off the critical path.

Two reusable pieces sit underneath it, and the skill degrades gracefully when either is
missing:

- **`foundry-pr-report`** (Foundry primitive) is the preferred verdict core: it prints a
  pass/fail summary plus the failing-step logs, so the pane ends holding everything you
  need. Absent, the skill uses `gh pr checks` for the verdict and `gh run view
  --log-failed` for the logs.
- **Herdr** is the thin non-blocking wrapper. Absent (`HERDR_ENV` unset), the skill falls
  back to a Claude Code background task, which still gets you the result without blocking,
  just without a visible pane.

## Resolve the PR

Default to the current branch's PR; take an explicit number if the caller gave one.

```bash
pr="${1:-$(gh pr view --json number -q .number)}"
```

If there is no PR for the branch, say so and stop. There is nothing to watch.

## Guard: are you inside Herdr?

```bash
test "${HERDR_ENV:-}" = 1
```

- **Not inside Herdr** (the test is false): take the fallback path below. Say plainly that
  the live monitor-pane path needs Herdr and that you are using a background task instead.
- **Inside Herdr**: take the monitor-pane path.

## Fallback path (no Herdr): a background task

Run the watch as a **Claude Code background command** (the Bash tool with
`run_in_background: true`). A background command re-invokes the session when it exits, so
the agent keeps working and is handed the result on completion rather than polling for it.
CI can run for many minutes, so set a generous timeout (well above the default) so the
watch is not killed before CI finishes.

```bash
gh pr checks "$pr" --watch --interval 30
```

When it returns: if it failed, read the failing logs with `gh run view --log-failed`, fix
the cause in the working tree, commit, push, and start a fresh background watch. Repeat
until the checks pass.

## Monitor-pane path (inside Herdr)

### 1. Build the watch command

Prefer `foundry-pr-report` when it is on `PATH` or vendored at `./scripts/`. An end
sentinel is appended so completion is detectable by reading the pane (see step 4).

```bash
if command -v foundry-pr-report >/dev/null 2>&1 || test -x ./scripts/foundry-pr-report; then
  watch_cmd="gh pr checks $pr --watch --interval 30; echo '---REPORT---'; foundry-pr-report $pr; echo '---PR-CI-WATCH-DONE---'"
else
  watch_cmd="gh pr checks $pr --watch --interval 30; echo '---PR-CI-WATCH-DONE---'"
fi
```

### 2. Spawn a non-blocking sibling pane

Split to the right, keep the user's focus (`--no-focus`), and read the new pane id out of
the JSON result. Do not guess the id.

```bash
split=$(herdr pane split --current --direction right --cwd "$PWD" --no-focus)
pane=$(printf '%s' "$split" | jq -r '.result.pane.pane_id')
```

### 3. Start the watch in that pane

`herdr pane run` sends the command and Enter atomically, then returns immediately. The main
pane is never blocked.

```bash
herdr pane run "$pane" "$watch_cmd"
```

### 4. Keep working, then collect the result

Go back to your actual task. Do **not** block on the pane. Check on it occasionally between
other steps, never in a tight wait:

```bash
herdr pane process-info --pane "$pane"
herdr pane read "$pane" --source recent-unwrapped --lines 200
```

Completion signal: the watch is finished once the pane output contains the
`---PR-CI-WATCH-DONE---` sentinel. Treat that sentinel as authoritative, because on some
platforms (Windows git-bash) `process-info` reports only the shell as the foreground
process even while the watch runs; use `process-info` as a secondary hint on Linux and
macOS, where the live `gh` process does show up.

Read the verdict from the pane text: the lines after `---REPORT---` when `foundry-pr-report`
ran, otherwise the final `gh pr checks` table.

### 5. On failure: fix, push, re-watch

If CI failed:

1. Get the failing logs. They are already in the pane when `foundry-pr-report` ran; if not,
   run `gh run view --log-failed` in the main pane.
2. Fix the real cause in the main pane. Never weaken a rule to pass a check.
3. Commit and push.
4. Spawn a **fresh** monitor pane (back to step 2) for the new run.

Repeat until the checks are green.

### 6. Clean up

Close the monitor pane once CI is green and you are done with it:

```bash
herdr pane close "$pane"
```

Only ever close a pane **you** created (the `$pane` from step 2). Never close
`$HERDR_PANE_ID`, which is the caller's own pane.

## Notes

- `$HERDR_PANE_ID` is the caller's pane; the id you spawn in step 2 is a different pane,
  and it is the only one this skill may close.
- A green local gate is necessary but not sufficient, which is the whole reason to watch
  CI: CI runs jobs the six-verb gate does not (smells-vs-baseline, secret scan, SAST,
  dependency review). This skill is how you close that gap without blocking.
- The verdict core is deliberately `foundry-pr-report`, not bespoke parsing here, so the
  pass/fail logic stays in one reusable Foundry primitive and Herdr stays a thin wrapper.
