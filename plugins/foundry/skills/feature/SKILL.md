---
name: feature
description: Drive a feature ticket to a reviewable PR through the Foundry gate — claim it, implement in an isolated worktree, loop against `mise run gate` until green, verify against the acceptance criteria, then hand to `ship`. Invoke with a ticket id/ref to work that ticket; invoke with no argument to claim the next `agent:ready` ticket from the backlog (wrap in `/loop` for a semi-auto puller). Triggers: implement/work/pick up an issue or ticket, pull the next backlog item, start the next feature.
---

# feature

The front half of the Foundry loop: a feature request becomes a change that reaches a green gate on its own, then hands to `ship`. It re-implements none of the standards — **the gate is the oracle** and `ship` is the handoff. This skill never opens a PR itself; it drives a claimed ticket to a verified, green working tree and lets `ship` take it from there.

## Modes

- **`/feature <ref>` - supervised.** Work that specific ticket. If its acceptance criteria are thin or it has no Definition of Done, interview the user to fill the [ticket schema](#the-ticket) before claiming.
- **`/feature` — puller.** Sweep stale claims (see [Stale-claim recovery](#stale-claim-recovery)), then claim the next `agent:ready` ticket that already passes the completeness check. Skip incomplete tickets — never interview in this mode, since no one is there to answer. Wrap in `/loop <interval> /feature` for a semi-auto backlog puller.

## Before you start

Confirm, and stop if any fails:

1. **The repo defines the verbs.** `mise tasks ls` lists `gate`. If not, this repo is not onboarded to Foundry — say so and stop rather than improvising with raw tools.
2. **A ticket source is reachable.** GitHub Issues via `gh` (the default), or a local `tickets/` directory (the fallback). Both normalize to one [ticket](#the-ticket).

## The sequence

Do not skip or reorder. Each step exists because the next is untrustworthy without it.

### 1. Resolve and claim — atomically, before any work

Resolve the ticket: from `<ref>` in supervised mode, or the oldest `agent:ready` ticket that passes the completeness check in puller mode.

**Completeness check** - the ticket has an intent, an acceptance-criteria checklist, a Definition of Done (a `- [ ]` checklist, or the sentinel `None beyond the acceptance criteria.`), and scope boundaries (the [schema](#the-ticket)). A missing or empty Definition of Done section fails the check: only the sentinel says "nothing extra". In puller mode, a ticket that fails is skipped. In supervised mode, interview the user to fill the gaps, then continue.

**Claim** before writing a line of code. Pick the slug first, since the claim marker names the branch and worktree that step 2 creates. The claim unassigns the owner: an assignee means the ticket waits on a human (filed by `spec`, or blocked), and a working ticket waits on no one.

```bash
gh issue edit <n> --add-label agent:working --remove-label agent:ready --remove-assignee @me
gh issue comment <n> --body "claimed by feat/<slug>-<n> at ../_wt/<slug>-<n>"
```

Then **re-read** the issue and confirm you hold it: `agent:working` and the latest claim marker is yours. Every session shares one GitHub identity, so only the marker tells two sessions apart. If it moved under you, or the latest marker names another worktree, another worker won the race - abandon it and, in puller mode, try the next ticket. The latest marker on a ticket:

```bash
gh api --paginate "repos/{owner}/{repo}/issues/<n>/comments" --jq '.[].body | select(startswith("claimed by "))' | tail -n 1
```

It pages through every comment, so the marker is found on a long thread too, and prints nothing when the ticket has no marker.

**WIP = 1 per session.** This session's worktree is the one it created in step 2, or entered to resume a ticket; a session with none holds nothing. Before claiming, list the `agent:working` tickets (`gh issue list --label agent:working --json number`) and read each one's latest marker. If one names this session's worktree, finish or release it first. A marker naming another worktree belongs to a sibling session, and a ticket with no marker belongs to no session; neither blocks this one. The limit is per session, not per machine, so parallel sessions in their own worktrees can each work a ticket while each still holds only one.

### 2. Isolated worktree

One ticket, one worktree, one branch off `origin/main`, one PR — matching `collaboration.md`:

```bash
git worktree add -b feat/<slug>-<n> ../_wt/<slug>-<n> origin/main
```

Before creating it, sweep finished worktrees: for each entry in `git worktree list` other than the main checkout, apply `ship`'s step 8 checks and remove the ones that pass. A PR usually merges after the session that opened it has ended, so this sweep is what actually frees the disk. Worktrees that fail a check (an open PR, no PR, uncommitted work) stay.

Work only in that worktree so the main checkout stays untouched. Pinned tools (mise tools, the habit-hooks venv, PMD) are installed once per machine and shared, but a new worktree has neither mise trust nor the project's own dependencies. Run `mise trust`, `mise install`, then the repo's dependency install (`npm ci` for Node); `mise install` does not create `node_modules`, and without it the TypeScript smell sensors report their tools as missing instead of checking anything.

**Read the codemap slices, when the repo has one.** If `docs/codemap/INDEX.md` exists, read every slice whose citations overlap the ticket's Pointers (the same file, a pointer under a cited directory, or a cited file under a pointer directory) before implementing, so the change follows the flows the map traced rather than rediscovering them. The citation grammar is in the `codemap` skill's `FORMAT.md`. For each slice read, check whether its cited files changed since its stamped `sha:`, the same way `codemap refresh` does:

```bash
git diff --name-status <sha> HEAD
```

If a cited file changed, or the `sha` is unreachable, warn that the slice may be stale and check its claims against the code before relying on them; the code wins where they disagree. Do not edit the codemap in this change: refreshing it is `codemap refresh`'s job, in its own PR. Without `docs/codemap/INDEX.md`, skip this and do not suggest generating one.

### 3. Inner loop — drive the gate green (bounded)

Implement toward the acceptance checklist and the Definition of Done, then loop. Each cycle runs the same three commands `ship` re-runs authoritatively, so a clean cycle here means `ship` will not bounce it back:

```bash
mise run fix     # mechanical fixes only; it mutates files — review the diff
mise run smells  # structural smells; its output is coaching, a highest-priority instruction
mise run gate    # the oracle — must exit 0
```

Run `mise run smells` when `mise tasks ls` lists a top-level `smells` task: it runs the habit-hooks version the repo pins, the same check `gate` runs. A bare `habit-hooks` runs whatever is first on `PATH`, which can be an older global install. `smells` is an auxiliary task, not a contract verb, so when the repo has none, run `habit-hooks` instead, under the rule below.

`habit-hooks` is opt-in per repo, by the same rule `hooks/habit-hooks-guard.sh` uses: a `.habit-hooks/` directory at the repo root or in an immediate subdirectory.

- **No `.habit-hooks/` anywhere** → skip `habit-hooks` and count it as no smells. Say so once, not every cycle.
- **`.habit-hooks/` present but `habit-hooks` is not on `PATH`** (or exits with "command not found") → stop with an error and [escalate](#escalation). Step 2's `mise install` already provisioned it, so it is genuinely broken, and a broken install must never pass as clean.

- **Green gate and no smells** → go to step 4.
- **Otherwise** → act on the `habit-hooks` coaching and the failing verb's output, **fix the cause**, and re-run from a clean tree.

**Fix the cause, never the rule.** A green gate reached by disabling a lint rule, lowering a threshold, or growing a suppression baseline is not done — and `ruleset-guard` will block it anyway. Prune baselines only via `mise run fix`.

**Bounds** — so the loop terminates:

- At most **5** gate-fix cycles.
- **No-progress exit:** if the same failure set survives two cycles running, escalate immediately rather than burning the remaining budget on a wall.

On exhaustion or no-progress, [escalate](#escalation).

### 4. Verify - against every criterion

A green gate proves the code is *clean*; it does not prove the feature *works*. Invoke **`foundry:verify <n>`**: a fresh-context subagent walks every acceptance criterion and Definition of Done item, including DoD items outside the diff, and returns each as pass, fail or can't check, with evidence.

Act only on that verdict: fix each failed item, re-run the step 3 loop, then verify again. If an item cannot be met, or can't be checked without a human, [escalate](#escalation).

**Optional Jev pre-check (advisory, opt-in, off by default).** Enabled only when `JEV_FEATURE_PRECHECK` is truthy (and `JEV_API_KEY` is set); otherwise the script no-ops and proceeds, so it is safe to call unconditionally. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/jev/precheck.mjs" satisfies "<acceptance criteria>" <base>`. A `proceed: false` (a confident "no") means the diff likely misses a criterion, so fix that before spending the full verify. Anything else (uncertain, disabled, or no key) proceeds to the verify below. This never replaces the verify; it only avoids spending one on an obvious miss. (The same script's `ready` mode can pre-screen a ticket's completeness in puller mode at step 1.) Enable with `export JEV_FEATURE_PRECHECK=1`, disable by unsetting it.

### 5. Hand to ship

First read the latest claim marker again. Two sessions can each post a marker and each see their own on the step 1 re-read, if the second posts after the first has looked; only the later marker owns the ticket. If the latest marker now names another worktree, stop: leave the ticket to that session and do not ship.

Invoke **`foundry:ship`**. It re-runs the gate as the final authority, reviews the diff in a fresh context against the linked issue, writes a conventional commit, and opens the PR. Reference the ticket (`Closes #<n>`) so it closes on merge, and clear `agent:working`.

## Escalation

When the inner loop exhausts, an acceptance criterion or DoD item is unmet, or `ship` hits a stop condition, escalate **durably** - the thread is the memory, an in-session explanation dies with the session:

1. Post the stuck-state to the issue thread: what was attempted, the failing verbs, and the last `gate` output.
2. **Then** flip `agent:working` → `agent:blocked` and assign it back to the owner, who has to unblock it.

```bash
gh issue comment <n> --body-file <stuck-state>
gh issue edit <n> --add-label agent:blocked --remove-label agent:working --add-assignee @me
```

## Stale-claim recovery

Before claiming in puller mode, reset abandoned claims: any `agent:working` ticket **inactive for over 2 hours** returns to `agent:ready` (assigned back to the owner, as `spec` filed it), and is **resumed** from its thread + any open PR — not restarted. This is what stops one dead session (a crash, or the human's usage running out) from stranding a ticket forever.

Key off **inactivity, not "has no branch/PR"** — a session that already opened a PR then died must still be recoverable. A dead session can't release its own claim, so recovery has to be passive and time-based, done by the next puller pass. Measure inactivity as the most recent of: the issue's last timeline event, its linked PR's last update, or the working branch's last commit — reclaim only if that is older than 2 hours:

```bash
gh issue view <n> --json updatedAt --jq .updatedAt   # plus the linked PR's updatedAt, if any
```

Reclaiming needs no claim marker: a dead session's ticket goes by the clock alone, whatever its marker says. The resuming session claims it through step 1 like any other ticket, posting a fresh marker that names its own worktree, so the latest marker always names the current owner. That comment is itself activity, so the inactivity clock restarts from the resume.

## The ticket

A GitHub Issue, normalized to one object. The authoritative fields - intent, the acceptance-criteria checklist, the Definition of Done, scope boundaries, pointers - live in Foundry's `presets/tickets/ticket-schema.md`. The two checklists are load-bearing: step 4 and `ship`'s spec review walk both item by item.

## Stop conditions

Stop and ask the user, rather than pressing on, if:

- the repo is not onboarded to Foundry (no `gate` verb)
- the repo has `.habit-hooks/` but the `habit-hooks` command is missing
- no claimable ticket exists (puller mode)
- the change needs a ruleset change to be correct — that is a separate PR with the `ruleset-change` label
