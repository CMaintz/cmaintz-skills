---
sha: c571bf3155f5765ba192ad155777a191c6aee04b
slice: skills
kind: domain
paths: [plugins/foundry/skills]
---

## Purpose
The Claude Code skills of the Foundry plugin: instruction files, invoked by name, that drive
work from an idea to a filed ticket, from a ticket to a green gate and a PR, and around it
(review, verify, CI watch, codemap, debt campaigns, secret triage, loop telemetry)
(`plugins/foundry/skills/`). Each skill is a `SKILL.md`; the only supporting file is the codemap
format contract (`plugins/foundry/skills/codemap/FORMAT.md`).

## Features
- `spec`: interviews the user, drafts a ticket to the schema (Intent, Acceptance criteria,
  Definition of Done, Scope boundaries, Pointers), and files it as an `agent:ready` issue; it
  never writes code or opens a PR (`plugins/foundry/skills/spec/SKILL.md`).
- `feature`: claims a ticket (by ref, or the next `agent:ready` one in puller mode), works it in
  an isolated worktree, loops `mise run fix` / `smells` / `gate` until green, runs `verify`, then
  hands to `ship` (`plugins/foundry/skills/feature/SKILL.md`).
- `ship`: takes a finished change through fix, smells, gate, `review` and `verify`, a
  conventional commit, then opens a draft PR and starts a CI watch via `foundry-ship-pr`
  (`plugins/foundry/skills/ship/SKILL.md`, `plugins/foundry/scripts/foundry-ship-pr`).
- `review`: advisory review in fresh sub-agents across correctness, standards and spec lenses
  (plus red-team at `high`), scaled by diff size and effort, with a refuter pass before
  reporting (`plugins/foundry/skills/review/SKILL.md`).
- `verify`: a fresh read-only sub-agent checks every acceptance criterion and Definition of
  Done item of the ticket and returns a pass / fail / can't-check table
  (`plugins/foundry/skills/verify/SKILL.md`).
- `pr-ci-watch`: watches a PR's checks without blocking the session, in a Herdr pane or a
  background task, via `foundry-pr-watch` (`plugins/foundry/skills/pr-ci-watch/SKILL.md`,
  `plugins/foundry/scripts/foundry-pr-watch`).
- `codemap`: builds or refreshes the cited, SHA-stamped map under `docs/codemap/` and hands it to
  `ship` as a docs PR (`plugins/foundry/skills/codemap/SKILL.md`,
  `plugins/foundry/skills/codemap/FORMAT.md`).
- `repo-align`: an incremental, behaviour-preserving campaign that claims a `hotspot-rec` target
  as an `align` issue and clears its smells one PR per slice
  (`plugins/foundry/skills/repo-align/SKILL.md`).
- `foundry-secret`: classifies a gitleaks finding and either allowlists a false positive in
  `.gitleaks.toml` or guides rotate-then-purge (`plugins/foundry/skills/foundry-secret/SKILL.md`).
- `loop-report`: summarises verb telemetry from `.foundry/telemetry.jsonl` (converging vs
  thrashing, time sinks, gate attempts), optionally adding `gh run list` outcomes
  (`plugins/foundry/skills/loop-report/SKILL.md`, `plugins/foundry/scripts/foundry-loop-report#main`);
  its `--json` summary backs the plugin MCP server's `gate_status` tool
  (`plugins/foundry/scripts/explain-mcp/tools.mjs`, `plugins/foundry/scripts/explain-mcp/foundry.mjs`).

## Owned entities
- Ticket issues: `spec` files them with label `agent:ready` and the owner as assignee, or writes
  `tickets/<slug>.md` when `gh` is unavailable (`plugins/foundry/skills/spec/SKILL.md`);
  `repo-align` creates `align: <path>` issues labelled `align,agent:working`
  (`plugins/foundry/skills/repo-align/SKILL.md`).
- Ticket state labels `agent:ready` -> `agent:working` -> `agent:blocked`, moved by `feature`'s
  claim, escalation and stale-claim recovery (2-hour window)
  (`plugins/foundry/skills/feature/SKILL.md`); `repo-align` reuses that claim and window
  (`plugins/foundry/skills/repo-align/SKILL.md`).
- Claim marker comments `claimed by feat/<slug>-<n> at ../_wt/<slug>-<n> session <nonce>`, and
  the nonce file `foundry-claim` in the worktree's git dir (`plugins/foundry/skills/feature/SKILL.md`).
- Worktrees `../_wt/<slug>-<n>` on branch `feat/<slug>-<n>` off `origin/main`, created by
  `feature` (`plugins/foundry/skills/feature/SKILL.md`) and removed by `ship` step 8 only when
  Foundry-made, unlocked, merged, pushed and clean (`plugins/foundry/skills/ship/SKILL.md`).
- Escalation comments carrying the stuck state on the issue thread
  (`plugins/foundry/skills/feature/SKILL.md`).
- Draft PRs, plus `.foundry/pr-url` and `.foundry/pr-watch.log`, written by `foundry-ship-pr`
  (`plugins/foundry/scripts/foundry-ship-pr#create_pr`,
  `plugins/foundry/scripts/foundry-ship-pr#watch_detached`); the watch marks the PR ready on
  green (`plugins/foundry/scripts/foundry-pr-watch`).
- Herdr monitor panes spawned by `pr-ci-watch`, which closes only the pane it created
  (`plugins/foundry/skills/pr-ci-watch/SKILL.md`).
- `docs/codemap/` files (INDEX, one per domain slice, three lenses), written only after
  verification and never committed by `codemap` itself (`plugins/foundry/skills/codemap/SKILL.md`,
  `plugins/foundry/skills/codemap/FORMAT.md`).
- Narrow path entries in `.gitleaks.toml`'s `[allowlist]` for confirmed false positives
  (`plugins/foundry/skills/foundry-secret/SKILL.md`).

## Happy paths

### Idea to ticket to PR (spec -> feature -> verify -> ship -> CI watch)
1. Entrypoint: `/spec` interviews the user, grounding pointers in `docs/codemap/` slices when an
   INDEX exists, drafts to the schema, self-checks pointer paths with `test -e`, and waits for
   explicit approval (`plugins/foundry/skills/spec/SKILL.md`).
2. `spec` runs `bash scripts/setup-labels.sh` (tolerating failure), then files the issue with
   `--label agent:ready --assignee @me --body-file <spec.md>` and prints the `/feature <n>`
   handoff (`plugins/foundry/skills/spec/SKILL.md`).
3. `/feature <n>` (or `/feature` as puller, after a stale-claim sweep) checks `mise tasks ls`
   lists `gate`, runs the completeness check, generates a nonce, flips `agent:ready` to
   `agent:working` and removes the assignee, posts the claim marker, and re-reads the latest
   marker via `gh api --paginate` to confirm it holds the ticket
   (`plugins/foundry/skills/feature/SKILL.md`).
4. `feature` sweeps merged worktrees with `ship`'s step 8 checks, then runs
   `git worktree add -b feat/<slug>-<n> ../_wt/<slug>-<n> origin/main`, records the nonce, and
   runs `mise trust`, `mise install` and the dependency install
   (`plugins/foundry/skills/feature/SKILL.md`, `plugins/foundry/skills/ship/SKILL.md`).
5. Inner loop, at most 5 cycles with a no-progress exit: `mise run fix`, `mise run smells` (or
   `habit-hooks` when `.habit-hooks/` exists and no `smells` task), `mise run gate`
   (`plugins/foundry/skills/feature/SKILL.md`). Before verify, an optional Jev pre-check
   `scripts/jev/precheck.mjs satisfies` runs only when `JEV_FEATURE_PRECHECK` is set and a Jev
   provider key resolves (`JEV_API_KEY`, or Cloudflare credentials)
   (`plugins/foundry/scripts/jev/precheck.mjs#enabled`,
   `plugins/foundry/scripts/jev/vendor/jev-core/env.js#providerFromEnv`,
   `plugins/foundry/scripts/jev/precheck.mjs#main`).
6. `feature` invokes `verify <n>`, which fetches the ticket with `gh issue view`, diffs against
   the base, and has a fresh sub-agent return one row per AC and DoD item
   (`plugins/foundry/skills/verify/SKILL.md`). On failure or exhaustion, `feature` comments the
   stuck state and flips to `agent:blocked` with the owner reassigned
   (`plugins/foundry/skills/feature/SKILL.md`).
7. `feature` re-reads the latest claim marker, then invokes `ship`
   (`plugins/foundry/skills/feature/SKILL.md`). `ship` re-runs fix, smells and gate, reads the
   full diff, invokes `review` and (unless already passed on this HEAD) `verify`, and writes a
   conventional commit with `Closes #<n>` (`plugins/foundry/skills/ship/SKILL.md`).
8. `ship` runs `foundry-ship-pr --body-file <file>`, which pushes with `git push -u origin HEAD`
   (exit 3 on rejection), opens or finds a draft PR, writes `.foundry/pr-url`, and starts
   `foundry-pr-watch --sha <sha> --ready-on-green` in a Herdr pane when `HERDR_ENV=1`, else
   detached to `.foundry/pr-watch.log` (`plugins/foundry/skills/ship/SKILL.md`,
   `plugins/foundry/scripts/foundry-ship-pr#create_pr`,
   `plugins/foundry/scripts/foundry-ship-pr#watch_in_herdr_pane`).
9. Side effects: the watch waits for the pushed commit's checks, prints `foundry-pr-report`'s
   verdict and failing-step logs, ends with `---PR-CI-WATCH-DONE--- exit <n>`, and runs
   `gh pr ready` on green (`plugins/foundry/scripts/foundry-pr-watch#wait_for_checks`,
   `plugins/foundry/scripts/foundry-pr-report#dump_failures`). `ship` collects that verdict as
   `pr-ci-watch` does and, on failure, fixes, commits and re-runs `foundry-ship-pr`
   (`plugins/foundry/skills/ship/SKILL.md`, `plugins/foundry/skills/pr-ci-watch/SKILL.md`).

### Codemap build and refresh
1. Entrypoint: `/codemap` (full) or `/codemap refresh`; requires a clean tree and a non-default
   branch (`plugins/foundry/skills/codemap/SKILL.md`).
2. Phase 1 runs `node scripts/codemap/census.mjs`, refines its `slicePlan`, and waits for the
   user to confirm the plan (`plugins/foundry/skills/codemap/SKILL.md`,
   `plugins/foundry/scripts/codemap/census.mjs#census`).
3. Phase 2 audits slices: one fresh sub-agent per domain slice plus three lens agents when there
   are more than 2 slices, else one agent; each returns markdown and writes nothing. Phase 3
   drafts `INDEX.md` under 150 lines (`plugins/foundry/skills/codemap/SKILL.md`).
4. Phase 4 has a fresh verifier check every citation resolves and spot-check at least 5 claims
   per file; refuted claims are fixed or moved to `## Unknowns`, then all files are written under
   `docs/codemap/` stamped with `git rev-parse HEAD` (`plugins/foundry/skills/codemap/SKILL.md`,
   `plugins/foundry/skills/codemap/FORMAT.md`).
5. Phase 5 invokes `ship` with only the `docs/codemap/` diff, titled `docs(codemap): ...`
   (`plugins/foundry/skills/codemap/SKILL.md`).
6. Refresh: per file, `git diff --name-status <sha> HEAD` maps changed paths to citations;
   nothing stale means write nothing and skip `ship`; otherwise only stale files are re-audited
   and restamped, and the INDEX is always restamped (`plugins/foundry/skills/codemap/SKILL.md`).
   `spec`, `feature` and `review` read the map when `docs/codemap/INDEX.md` exists
   (`plugins/foundry/skills/spec/SKILL.md`, `plugins/foundry/skills/feature/SKILL.md`,
   `plugins/foundry/skills/review/SKILL.md`).

### Review
1. Entrypoint: `review [low|medium|high]`, invoked directly or from `ship` step 4
   (`plugins/foundry/skills/review/SKILL.md`, `plugins/foundry/skills/ship/SKILL.md`).
2. Resolves the base and measures `git diff --stat <base>...HEAD` to pick breadth: tiny (one
   sub-agent, all lenses), medium (three parallel sub-agents), large (sharded per area plus a
   synthesis pass) (`plugins/foundry/skills/review/SKILL.md`).
3. Gathers shared context: the linked issue via `gh issue view`, `AGENTS.md` / `CONTEXT.md`,
   enforced configs, a repo-local `build-project-review` skill, and covering codemap domain
   slices; optionally routes files with `plugins/foundry/scripts/jev/review.mjs` when `JEV_API_KEY` is set and
   breadth is medium or large (`plugins/foundry/skills/review/SKILL.md`,
   `plugins/foundry/scripts/jev/review.mjs#routeFiles`).
4. Runs the correctness, standards and spec lenses (plus red-team at `high`, always in its own
   sub-agent), merges and drops gate-catchable findings, applies the effort threshold, then a
   fresh refuter marks each finding refuted, confirmed or unsure
   (`plugins/foundry/skills/review/SKILL.md`).
5. Side effect: a report grouped by lens with labelled findings and the refuted count; it never
   edits code or blocks (`plugins/foundry/skills/review/SKILL.md`).

## Unknowns
- `spec` runs `bash scripts/setup-labels.sh`, but no such file exists in this repo at this sha:
  is it expected in the target repo, and which labels does it create?
- The ticket schema is described as living in Foundry's `presets/tickets/ticket-schema.md` and
  `ISSUE_TEMPLATE/agent-feature.yml`, neither present here; where are they shipped from, and does
  `spec`'s `gh issue create` (no `--template`) actually go through that form?
- `repo-align` cites `presets/ticket-schema.md` while `spec` and `feature` cite
  `presets/tickets/ticket-schema.md`: which path is current?
- What creates the `align` label that `repo-align` requires?
- `feature` claims the ticket "clears `agent:working`" on handoff to `ship`, but neither `ship` nor
  `foundry-ship-pr` names a label removal step; who removes it?
- The `bootstrap` workflow `repo-align` uses to shrink `snooze.json`, and the `learn` and
  `hotspot-rec` skills it invokes, are not in this slice; where are they defined?
