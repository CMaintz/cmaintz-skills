# CONTRACT — the verb interface

**This file is the seam between `foundry` and `cmaintz-skills`. It is copied verbatim into both repos and must stay identical.** If it ever needs to differ between them, the two-repo split was the wrong call and they should be merged.

---

## The contract

Every repo, regardless of language, exposes these six verbs:

| Verb | Contract | Mutates files? |
|---|---|---|
| `mise run fix` | Apply every mechanically safe fix. Never makes a judgement call. | **yes** |
| `mise run lint` | Report style violations and structural smells. | no |
| `mise run typecheck` | Static type analysis. | no |
| `mise run test` | Run tests, enforce the coverage floor. | no |
| `mise run audit` | Dependency vulnerabilities, secrets, SAST. | no |
| `mise run gate` | `lint` → `typecheck` → `test` → `audit`, in that order. **The oracle.** | no |

A repo with no meaningful work for a verb still defines it as a no-op that exits 0. Absence is not permitted — a caller must never have to ask whether a verb exists.

## Rules for callers

**Callers invoke verbs, never tools.** A skill says `mise run lint`. It never says `eslint`, `phpcs`, or `ruff`. This is the whole reason a single skill library can serve a Kotlin repo and a React repo.

**`gate` is the only authority.** No caller may conclude that work is finished on the strength of its own reasoning, a partial verb run, or a model's summary of what it fixed. Green `gate`, from a clean tree, or it is not done.

**`gate` is sequenced, not parallel.** In `mise`, `depends` resolves prerequisites in parallel with no ordering guarantee. `gate` therefore uses a sequential `run` array. Do not "simplify" it into `depends`.

## Rules for repos

**Pin everything.** Toolchain versions in `[tools]`. CI actions by commit SHA. The version of any tool an action installs on your behalf — pinning the action alone is not enough.

**Accepted debt lives in a baseline file that may only shrink.** `eslint-suppressions.json`, `.habit-hooks/snooze.json`, coverage thresholds. These are committed. They are never hand-edited, never regenerated wholesale to make a build pass, and never deleted.

**Never weaken a rule to pass it.** Disabling a lint rule, lowering a threshold, or growing a suppression baseline is a deliberate decision that gets its own pull request. CI enforces this: a PR touching both the ruleset and production source fails `ruleset-guard` unless a human applies the `ruleset-change` label.

## Placements

The same verbs run in three places. Divergence between them is a bug in the setup, never a fact to work around.

| Placement | Trigger | Verb | Budget |
|---|---|---|---|
| In-loop | agent `Stop` hook | `habit-hooks` | < 30s warm |
| Pre-push | `/ship` | `gate` | < 60s |
| CI | pull request | `gate` | < 5 min |

## Versioning

Changes to the six verb names, their contracts, or the rules above are **breaking**. Bump the major version of both repos together and update this file in both. Everything else — adding a stack, a preset, a skill — is additive.
