---
name: feature
description: Drive a feature ticket to a reviewable PR through the Foundry gate — claim it, implement in an isolated worktree, loop against `mise run gate` until green, verify against the acceptance criteria, then hand to `ship`. Invoke with a ticket id/ref to work that ticket; invoke with no argument to claim the next `agent:ready` ticket from the backlog (wrap in `/loop` for a semi-auto puller). Triggers: implement/work/pick up an issue or ticket, pull the next backlog item, start the next feature.
---

# feature

The front half of the Foundry loop: a feature request becomes a change that reaches a green gate on its own, then hands to `ship`. It re-implements none of the standards — **the gate is the oracle** and `ship` is the handoff. This skill never opens a PR itself; it drives a claimed ticket to a verified, green working tree and lets `ship` take it from there.

## Modes

- **`/feature <ref>` — supervised.** Work that specific ticket. If its acceptance criteria are thin, interview the user to fill the [ticket schema](#the-ticket) before claiming.
- **`/feature` — puller.** Sweep stale claims (see [Stale-claim recovery](#stale-claim-recovery)), then claim the next `agent:ready` ticket that already passes the completeness check. Skip incomplete tickets — never interview in this mode, since no one is there to answer. Wrap in `/loop <interval> /feature` for a semi-auto backlog puller.

## Before you start

Confirm, and stop if any fails:

1. **The repo defines the verbs.** `mise tasks ls` lists `gate`. If not, this repo is not onboarded to Foundry — say so and stop rather than improvising with raw tools.
2. **A ticket source is reachable.** GitHub Issues via `gh` (the default), or a local `tickets/` directory (the fallback). Both normalize to one [ticket](#the-ticket).

## The sequence

Do not skip or reorder. Each step exists because the next is untrustworthy without it.

### 1. Resolve and claim — atomically, before any work

Resolve the ticket: from `<ref>` in supervised mode, or the oldest `agent:ready` ticket that passes the completeness check in puller mode.

**Completeness check** — the ticket has an intent, an acceptance-criteria checklist, and scope boundaries (the [schema](#the-ticket)). In puller mode, a ticket that fails is skipped. In supervised mode, interview the user to fill the gaps, then continue.

**Claim** before writing a line of code:

```bash
gh issue edit <n> --add-label agent:working --remove-label agent:ready --add-assignee @me
```

Then **re-read** the issue and confirm you hold it (`agent:working`, assigned to you). If it moved under you, another worker won the race — abandon it and, in puller mode, try the next ticket.

**WIP = 1.** If a ticket already assigned to you sits in `agent:working`, finish or release it first. One in-flight ticket per machine.

### 2. Isolated worktree

One ticket, one worktree, one branch off `origin/main`, one PR — matching `collaboration.md`:

```bash
git worktree add -b feat/<slug>-<n> ../_wt/<slug>-<n> origin/main
```

Work only in that worktree so the main checkout stays untouched.

### 3. Inner loop — drive the gate green (bounded)

Implement toward the acceptance checklist, then loop. Each cycle runs the same three commands `ship` re-runs authoritatively, so a clean cycle here means `ship` will not bounce it back:

```bash
mise run fix     # mechanical fixes only; it mutates files — review the diff
habit-hooks      # structural smells; its output is coaching, a highest-priority instruction
mise run gate    # the oracle — must exit 0
```

- **Green gate and no smells** → go to step 4.
- **Otherwise** → act on the `habit-hooks` coaching and the failing verb's output, **fix the cause**, and re-run from a clean tree.

**Fix the cause, never the rule.** A green gate reached by disabling a lint rule, lowering a threshold, or growing a suppression baseline is not done — and `ruleset-guard` will block it anyway. Prune baselines only via `mise run fix`.

**Bounds** — so the loop terminates:

- At most **5** gate-fix cycles.
- **No-progress exit:** if the same failure set survives two cycles running, escalate immediately rather than burning the remaining budget on a wall.

On exhaustion or no-progress, [escalate](#escalation).

### 4. Verify — behaviourally, against every criterion

A green gate proves the code is *clean*; it does not prove the feature *works*. Invoke the `verify` skill (or `run`) and walk the acceptance checklist **item by item** — every criterion accounted for, pass or fail. If a criterion cannot be met, [escalate](#escalation).

### 5. Hand to ship

Invoke **`cmaintz-skills:ship`**. It re-runs the gate as the final authority, reviews the diff in a fresh context against the linked issue, writes a conventional commit, and opens the PR. Reference the ticket (`Closes #<n>`) so it closes on merge, and clear `agent:working`.

## Escalation

When the inner loop exhausts, a criterion is unmet, or `ship` hits a stop condition, escalate **durably** — the thread is the memory, an in-session explanation dies with the session:

1. Post the stuck-state to the issue thread: what was attempted, the failing verbs, and the last `gate` output.
2. **Then** flip `agent:working` → `agent:blocked` and unassign.

```bash
gh issue comment <n> --body-file <stuck-state>
gh issue edit <n> --add-label agent:blocked --remove-label agent:working --remove-assignee @me
```

## Stale-claim recovery

Before claiming in puller mode, reset abandoned claims: any ticket `agent:working` with **no branch and no PR** for over **30 minutes** returns to `agent:ready` (unassigned). This is what stops one crashed session from stranding a ticket forever.

Measure the 30 minutes from when the claim happened — the `agent:working` `labeled` event on the issue timeline:

```bash
gh api repos/{owner}/{repo}/issues/<n>/timeline --jq 'map(select(.event=="labeled" and .label.name=="agent:working")) | last.created_at'
```

## The ticket

A GitHub Issue, normalized to one object. The authoritative fields — intent, the acceptance-criteria checklist, scope boundaries, pointers — live in Foundry's `presets/ticket-schema.md`. The checklist is load-bearing: it is what step 4 and `ship`'s spec review walk item by item.

## Stop conditions

Stop and ask the user, rather than pressing on, if:

- the repo is not onboarded to Foundry (no `gate` verb)
- no claimable ticket exists (puller mode)
- the change needs a ruleset change to be correct — that is a separate PR with the `ruleset-change` label
