---
name: repo-align
description: Run an incremental campaign to bring a repo up to the Foundry standard — consistent formatting and no unjustified structural smells — one small reviewable PR at a time. Use when the user wants to pay down code-quality debt across a codebase gradually, or asks to "align the repo", "grind down the smells", or run the refactoring campaign.
---

# repo-align

Bring a codebase up to the Foundry standard **incrementally — one small, reviewable
PR per slice** — until it is consistently formatted and free of unjustified
structural smells. Behaviour-preserving only (format + refactor, never a feature
change); every test stays green.

## Pick the target — don't grind at random

Run **`hotspot-rec`** (Ivett's skill) between slices and take its single
recommendation: it ranks files by churn × complexity × temporal coupling, so you
fix where maintenance cost actually lives, not wherever you happen to look. If
`hotspot-rec` isn't available, pick one bounded directory/module.

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

## The loop — one slice per PR

1. **Pick** — `hotspot-rec`, take its one recommendation (or a bounded dir).
2. **Format** — `mise run <pkg>:fix` (auto-fix + Spotless/ESLint). Review the diff.
3. **Clear smells** — run `habit-hooks`; fix the findings *properly* (find the
   missing abstraction — a class, a value object, a strategy — don't split at
   line 200 mechanically or extract a 5-parameter helper). Aim to zero out the
   file so it can leave the baseline.
4. **Shrink the baseline** — regenerate `snooze.json` so the cleaned file drops
   off. Never grow it; `ruleset-guard` blocks that without the label anyway.
5. **Verify** — `mise run <pkg>:gate` green from a clean tree; untouched tests
   pass identically.
6. **Ship** — `/ship`. Keep formatting-only PRs (`style:`) separate from
   refactor PRs (`refactor:`). Small — a reviewer should hold the whole diff in
   their head.

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
