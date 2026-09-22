---
name: loop-report
description: Make the agent loop legible — read Foundry's verb telemetry to show where the gate spends time, whether the loop is converging or thrashing (a verb that passed then failed again), and how many gate attempts a change took; optionally fold in CI outcomes via `gh run`. Use when the user asks why the loop is slow or stuck, whether it's converging, where time goes, or to review a session's gate history. Read-only; no model decides pass/fail.
---

# loop-report

Foundry's verbs emit one JSONL line per run (via `foundry-verb-wrap`) to
`.foundry/telemetry.jsonl` — see `designs/loop-telemetry.md` in foundry. This skill
turns that log into an answer: is the loop converging, where does the wall-clock go,
did a fix break something that was passing?

It is **read-only and deterministic** — it reports what happened; it never decides
whether work is done (that's the gate).

## Steps

### 1. Summarise the local telemetry

The deterministic summariser is vendored at `scripts/foundry-loop-report` (foundry-init
installs it). Run it:

```bash
python scripts/foundry-loop-report            # defaults to .foundry/telemetry.jsonl
# or a specific log:  python scripts/foundry-loop-report path/to/telemetry.jsonl
```

If it says there's no telemetry, the repo either hasn't run the gate since the wrapper
was wired in, or isn't on Foundry — say which, don't invent numbers.

### 2. Read the signal, don't just echo it

- **Thrash** (`regressed after passing`) is the important one: a verb went green then
  red again, which means fixing one thing likely broke another. Per `agent-loop.md`,
  that's the "stop and look before another round" signal — surface it plainly and, if
  you have the context, point at the likely culprit.
- **Time sink** — the verb eating most wall-clock. If it's `test`, changed-scope
  (`FOUNDRY_SINCE`) on the fast placements is the lever (see `changed-scope-gate.md`).
- **Gate attempts / latest** — how many rounds this took, and whether the tree is
  currently green.

### 3. (Optional) fold in CI outcomes

The local log covers local runs. For CI (no repo instrumentation, no minutes spent on
a dashboard), mine the API:

```bash
gh run list --branch "$(git branch --show-current)" --json name,conclusion,createdAt,updatedAt,event --limit 20
```

Use it to spot a job that fails often or runs long. Durations are `updatedAt -
createdAt`; call out the tall pole rather than dumping the table.

## Report back

A few sentences, not a data dump: is it converging or thrashing, what's slow, how many
attempts — and the one next action that follows (e.g. "test regressed twice — the last
fix likely broke an earlier one; diff the two green points before another gate run").

## Notes

- Smell-trend convergence (is the structural-smell count monotonically falling?) needs
  the habit-hooks Stop hook to emit counts — a planned follow-on. Until then thrash is
  derived from verb pass→fail regressions only; say so if asked for smell trends.
- `.foundry/` is gitignored — this is local observability, never a committed baseline.
