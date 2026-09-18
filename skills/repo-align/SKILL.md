---
name: repo-align
description: Run an incremental campaign to bring a repo up to the Foundry standard — consistent formatting and no unjustified structural smells — one small reviewable PR at a time. Use when the user wants to pay down code-quality debt across a codebase gradually, or asks to "align the repo", "grind down the smells", or run the refactoring campaign.
---

# repo-align

Bring a codebase up to the Foundry standard **incrementally — one small, reviewable
PR per slice** — until it is consistently formatted and free of unjustified
structural smells. Behaviour-preserving only (format + refactor, never a feature
change); every test stays green.

## Multi-session coordination — claim a target as a GitHub ticket

Concurrent align sessions run in **separate worktrees** (each cuts its own branch
off `origin/main` — foundry's `collaboration.md`), so anything under `.foundry/` is
**per-worktree and invisible to the others**: a local ledger *or a lock file*
cannot coordinate them. The one substrate every session shares is the **GitHub
repo**, so the claim lives there — the same atomic ticket protocol the `/feature`
driver uses (foundry `presets/ticket-schema.md`; create the `align` / `agent:ready`
/ `agent:working` / `agent:blocked` labels once per repo).

The claimed unit is a **bounded target** — one file or module (see *Loop a bounded
target to done*), one issue labelled `align`. Before touching code:

1. **Read the report.** Run `hotspot-rec` in your worktree (regenerate freely — it's
   read-only; not sharing it costs a re-run, never correctness).
2. **Claim an existing ticket, atomically.** `gh issue list --label align --state open`.
   Take the highest-ranked hotspot whose ticket is **`agent:ready`** and claim it:
   `gh issue edit <n> --add-label agent:working --remove-label agent:ready --add-assignee @me`.
   Then **re-read the issue and confirm you hold it** — if it's already `agent:working`
   under someone else, you lost the race: skip it and take the next. Never touch a
   target already `agent:working`.
3. **No ticket for your target? Create then confirm.** `gh issue create --label
   "align,agent:working" --assignee @me --title "align: <path>"`, body: acceptance =
   "`mise run <pkg>:gate` green from a clean tree **and** `<path>` drops from
   `snooze.json` on prune"; scope = "behaviour-preserving, this target only". Then
   **re-list** `--label align`: if two open tickets now name the same target (a
   create race), the **lower issue number wins** — close yours as a duplicate and
   pick another target.
4. **WIP = 1** per session. A target `agent:working` with no branch/PR for 30 min
   resets to `agent:ready` (ticket-schema's stale recovery). On a genuine block,
   post the reason to the issue thread, then label `agent:blocked` — the thread
   outlives the session; an in-context explanation dies with it.

`/ship` links each slice's PR to the issue; the target is done when it's clean and
the issue closes. **No GitHub remote?** Run align sessions **one at a time** — the
local-md ticket fallback isn't shared across worktrees either, so real concurrency
needs the GitHub transport.

## Pick the target — don't grind at random

Run **`hotspot-rec`** (Ivett's skill) between slices and take its single
recommendation: it ranks files by churn × complexity × temporal coupling, so you
fix where maintenance cost actually lives, not wherever you happen to look. If
`hotspot-rec` isn't available, pick one bounded directory/module. **Respect the
coordination protocol above** — reuse a < 1h-old report and claim your slice first.

## The snooze baseline is WHOLE-FILE granular

Critical constraint (habit-hooks' Java/PMD sensor): `snooze.json` is a flat list
of **file paths**, not individual findings. Consequences:

- To **drop a file from the baseline** you must clear **every** smell in it — a
  file with 17 findings across 4 smell types is a big-bang refactor, not a small
  PR. Pick files you can fully clean in one sitting.
- **Touching a snoozed file resurfaces all its smells** in that PR (snooze-until-
  changed). So editing a smelly file for an unrelated one-line change drags its
  whole backlog into your diff. Either clean it fully or expect the noise.
- Prefer slices that are one file, or a cluster small enough to zero out together.

## Tests are not in scope

Test files are excluded from structural-smell scanning (`.habit-hooks/config.toml`
`files = ["!**/src/test/**"]`) — long mock-heavy test methods are normal. Don't
target tests for smell reduction; if a test is genuinely unreadable that's a
separate readability task, not this campaign.

## Big files and god classes don't fit one PR — decouple the milestone

`hotspot-rec` will point you *straight at* god classes (high churn × high
complexity is their definition), and whole-file snooze is all-or-nothing — so the
worst files are exactly the ones you can't clean in a single small PR. Don't try.
Split the two things the skill otherwise fuses:

- **Improving the code stays incremental** — one extracted collaborator per PR (a
  value object, a strategy, a sub-service). Each is behaviour-preserving, tests
  green, and small enough to review.
- **Shrinking the baseline is a milestone, not a per-PR step.** It happens only on
  the *final* PR that clears the file's last smell. Until then the file rides in
  `snooze.json` unchanged — that's fine: the baseline never grows and each PR still
  makes the class better. Never hand-edit the baseline to "credit" partial progress;
  it's all-or-nothing per file.

So a god class is its own mini-campaign: N small extraction PRs, then one that
zeroes it out and drops it from the baseline (via `bootstrap`). The one-small-PR
rule below applies to each extraction step, not to "clear the whole file."

## The loop — one slice per PR

1. **Pick + claim** — run `hotspot-rec`, then **claim a target ticket** on GitHub
   (see *Multi-session coordination*) — its top target whose ticket you can claim,
   or a bounded dir. For a god class, fan out **sub-agents** to read the candidate
   collaborators in parallel and report back the seam — don't investigate serially.
2. **Format** — `mise run <pkg>:fix` (auto-fix + Spotless/ESLint). Review the diff.
3. **Clear smells** — run `habit-hooks`; fix the findings *properly*. The target
   is **functions that do one thing** (single level of abstraction, one reason to
   change — SRP): the `high-complexity` / `oversized-function` / `too-many-parameters`
   smells are the machine-checkable shadows of a function doing *too many* things.
   Fix by finding the missing abstraction (a class, a value object, a strategy, a
   named pipeline step) — never by splitting at line 200 mechanically or extracting
   a 5-parameter helper (if the helper needs five parameters, the seam is wrong).
   Refactor toward cohesion, not away from a line count. See foundry's
   `presets/code-standards.md`. Aim to zero out the file so it can leave the baseline.
4. **Shrink the baseline — don't hand-edit `snooze.json`.** It's tool-generated;
   regenerate it with `habit-sensors --all | habit-snooze --prune` (drops files
   that no longer have findings). This needs `--all`, which blows the Windows
   command-line limit — so it runs on Linux via the `bootstrap` workflow, not your
   machine. Flow: land the fix PR (which does *not* touch `snooze.json`), then run
   `bootstrap` to open the baseline-shrink PR. Hand-removing a path only "works" if
   the file is 100% clean — one residual smell and `Structural smells` CI re-reports
   it. Never grow the baseline; `ruleset-guard` blocks that without the label anyway.
5. **Verify** — `mise run <pkg>:gate` green from a clean tree; untouched tests
   pass identically.
6. **Adversarially review — a *fresh* sub-agent tries to refute the fix.** The
   failure mode here is a *lazy fix* that clears the smell without improving the
   code. Spawn a sub-agent whose job is to **reject**, checking: is this a genuine
   cohesion improvement, or a threshold-dodge (a mechanical split, a helper with 5+
   parameters, logic shuffled into a new file to duck a line count)? Was a baseline
   grown or a check weakened (`ruleset-guard` territory)? Did behaviour change (a
   test's expectations moved)? If it can't defend the slice as *genuinely one
   thing*, loop back to step 3 — don't ship. The gate proves the code compiles and
   passes; this proves it's actually *better*.
7. **Ship** — `/ship`. Keep formatting-only PRs (`style:`) separate from
   refactor PRs (`refactor:`). Small — a reviewer should hold the whole diff in
   their head.

## Loop a bounded target to done — not the whole baseline

Zeroing the *entire* baseline in one run is a never-ending grind and not the goal.
Instead, **pick a bounded target up front** — one file, one module, or a small set
of related slices (a "surface") — and loop it to completion:

Repeat the loop — pick → fix → verify → review → ship → prune — until one of:

- **Target clean** — every file in the chosen target has dropped from `snooze.json`
  and `mise run <pkg>:gate` is green from a clean tree. That target is *done*: close
  its `align` issue and stop there; let the human decide whether to start another
  (don't roll straight into the rest of the repo).
- **No safe slice left in the target** — what remains is a god class whose seam
  needs a human call. Surface it; don't force a bad seam.
- **A guardrail trips** — a fix can't be made behaviour-preserving, or the
  adversarial review keeps rejecting the same slice. Stop and surface it; never
  lower the bar to make progress.

The loop condition is **deterministic, never the model's say-so**: a slice is done
only when the gate is green *and* its file drops from the baseline on prune. Keep
the main thread as the orchestrator — fan out analyser sub-agents (step 1) and the
refuting reviewer (step 6); it decides and integrates. That division is what keeps
a long run from drifting into lazy, self-approved fixes. Scoping to a bounded target
keeps each run reviewable and gives a clear finish line.

## Close the loop — `learn`

At session end, run **`learn`**: route any recurring fix to the layer that
*enforces* it (a deterministic check > AGENTS.md rule > new skill > memory), so
the same class of smell can't come back. A campaign that doesn't feed the gate
just moves debt around.

## Guardrails

- **Never** weaken a rule to pass it (disable a check, lower a threshold, grow a
  baseline). That's a separate, labelled decision.
- **Stop** if a "refactor" changes a test's expectations — that's a behaviour
  change; surface it rather than editing the test to match.
- One slice per PR. If the message needs an "and", it's two PRs.
