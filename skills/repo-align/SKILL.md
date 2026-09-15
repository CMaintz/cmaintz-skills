---
name: repo-align
description: Run an incremental campaign to bring a repo up to the Foundry standard — consistent formatting and no unjustified structural smells — one small reviewable PR at a time. Use when the user wants to pay down code-quality debt across a codebase gradually, or asks to "align the repo", "grind down the smells", or run the refactoring campaign.
---

# repo-align

Bring a codebase up to the Foundry standard **incrementally — one small, reviewable
PR per slice** — until it is consistently formatted and free of unjustified
structural smells. Behaviour-preserving only (format + refactor, never a feature
change); every test stays green.

## Multi-session coordination — one shared report, claimed slices

Several sessions run this campaign against the same working copy at once. The
hotspot analysis is **expensive** (git-history forensics + deep code reading), so
don't let each session regenerate it, and don't let two sessions grind the same
file. Coordinate through two scratch files under `.foundry/` (gitignored — session
state, never committed; add `.foundry/` to `.gitignore` if it isn't there):

- `.foundry/hotspots.html` — the shared rendered `hotspot-rec` report.
- `.foundry/align-claims.md` — the claims ledger (a markdown table).

Your session key is **your branch name** (you cut your own branch off `origin/main`
— see foundry's `collaboration.md`). The protocol, every time you start a slice:

1. **Read the ledger.** Open `.foundry/align-claims.md` if it exists — it shows
   which slices other sessions have claimed and their status.
2. **Reuse a fresh report; regenerate only a stale one.** If `.foundry/hotspots.html`
   exists and is **< 1 hour old** (`find .foundry/hotspots.html -mmin -60 -print`
   prints it), use it **as-is** — the ranking barely moves in an hour and the
   analysis isn't worth re-running. Otherwise (missing or ≥ 1h) regenerate it with
   `hotspot-rec` writing to `.foundry/hotspots.html`, and **preserve** any
   `in_progress` rows already in the ledger.
3. **Claim before you cut.** Take the top recommendation **not already claimed
   `in_progress`**, and append your row to the ledger — this is your lock:

   ```
   | Slice / target | Files or dir | Claimed by (branch) | Status | Since |
   |---|---|---|---|---|
   | DocumentGenerator god class | backend/.../DocumentGenerator.java | refactor/docgen-strategy | in_progress | 2026-09-15 |
   ```
4. **Release when done.** When your slice ships, set your row's Status to `done`.
5. **Tidy up only if you're last out.** After marking `done`: if **no** row is
   still `in_progress`, the report is fully consumed — delete `.foundry/hotspots.html`
   and clear the ledger so the next session starts from a fresh analysis. If **any**
   row is still `in_progress`, leave both files alone — another session is mid-slice
   and relying on them.

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

1. **Pick** — reuse-or-regen the shared report and **claim your slice** (see
   *Multi-session coordination*); take `hotspot-rec`'s one unclaimed recommendation
   (or a bounded dir). For a god class, fan out **sub-agents** to read the candidate
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

## Run until acceptable — don't stop after one slice

repo-align is a *campaign*, not a single PR. Repeat the loop — pick → fix → verify
→ review → ship → prune — until one of these is true:

- **Baseline clear** — `snooze.json` is empty/gone for the package(s) you're
  aligning and `mise run <pkg>:gate` is green from a clean tree. That's *done*.
- **No safe slice left** — every remaining entry is a god class mid-campaign whose
  seam needs a human call. Surface the shortlist; don't force a bad seam.
- **A guardrail trips** — a fix can't be made behaviour-preserving, or the
  adversarial review keeps rejecting the same slice. Stop and surface it; never
  lower the bar to make progress.

The loop condition is **deterministic, never the model's say-so**: a slice is done
only when the gate is green *and* its file drops from the baseline on prune. Keep
the main thread as the orchestrator — fan out analyser sub-agents (step 1) and the
refuting reviewer (step 6); it decides and integrates. That division is what keeps
a long autonomous run from drifting into lazy, self-approved fixes.

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
