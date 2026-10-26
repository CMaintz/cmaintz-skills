# cmaintz-skills

The agent half of [Foundry](https://github.com/CMaintz/foundry): a Claude Code plugin whose skills and hooks drive an agent from an idea to a reviewed pull request, and keep it honest against a deterministic gate on the way.

![The cmaintz-skills loop: /foundry:spec turns an idea into a ticket, /foundry:feature claims it, mise run gate loops until green, /foundry:ship reviews and commits, a draft PR is watched in CI, and /learn routes the lessons. /foundry:codemap gives spec, feature and review a cited map of the repo. Hooks format, check smells and types, and force PRs through ship on every turn.](docs/readme-visual.png)

## The method

An agent is fast and confident, and neither makes it right. These skills and hooks rest on a few beliefs about how to get trustworthy work out of one anyway.

**Deterministic is the oracle; probabilistic only proposes.** The model writes the patch; `mise run gate` decides whether it stands. No skill here ever takes the agent's word that something works, and the advisory Jev layer only ever suggests where to look.

**Place each rule in the strongest layer that can hold it.** A habit you have to *remember* isn't a habit. Prose in `CLAUDE.md` is advisory and fades as the context fills up; a hook is enforcement. So the order of preference is a hook, then `AGENTS.md`, then a skill, then memory:

| Layer | Mechanism | Character |
|---|---|---|
| Reflex | hooks (habit-hooks, pre-commit) | involuntary, fires on its own |
| Standing context | `AGENTS.md`, `CONTEXT.md` | ambient, shared vocabulary |
| Practice | skills | invoked, procedural, uses judgement |
| Memory | auto-memory | recalled when relevant, last resort |

**The ticket is the real prompt.** An agent's output is capped by its input. `spec` turns an idea into a ticket with testable acceptance criteria and a Definition of Done, drafted with you and filed only once you've approved it. The criteria are the contract `feature` works to, and they work best as executable Given-When-Then scenarios.

**Ground the agent in the code as it is.** A cited, verified codemap gives `spec`, `feature` and `review` the same picture of the repo, so pointers are real and edge cases come from actual flows.

**Green is not correct.** A green gate means clean code, not finished work. `feature` checks every acceptance criterion and Definition of Done item, and `review` holds the diff to them in a fresh context that doesn't share the author's. Reviewers advise; only the gate blocks.

**One path to main.** Every change leaves through `ship`, and a hook denies the shortcut, so no PR skips the gate or the review.

**The flywheel.** After a session, `learn` routes each lesson to the strongest layer that can hold it. A mistake made once becomes a hook or a rule the next session can't skip.

The full write-up behind the method: [Agentic Engineering: Harnesses and Workflows for Teams](https://github.com/CMaintz/foundry/blob/main/docs/agentic-engineering/README.md).

**How the two repos fit:** [Foundry](https://github.com/CMaintz/foundry) is the shared, deterministic gate: six `mise` verbs (`fix`, `lint`, `typecheck`, `test`, `audit`, `gate`) and the CI workflows that run them, one rule set placed in-loop, pre-push and in CI. This repo is what an agent does with that gate: skills for the procedure, hooks for the reflexes. The seam between them is [CONTRACT.md](./CONTRACT.md), copied verbatim into both.

## Install

```
/plugin marketplace add CMaintz/cmaintz-skills
/plugin install foundry@cmaintz
```

The skills are namespaced by the plugin (`/foundry:ship`, `/foundry:spec`, ...), and the Claude Code hooks register themselves from [hooks/hooks.json](./plugins/foundry/hooks/hooks.json). A repo needs Foundry's verbs (`mise run gate`) for the loop to work.

Only `plugins/foundry/` is installed; the rest of the repo (CI, docs, `mise.toml`) is for developing the plugin. Paths below are relative to `plugins/foundry/`.

## The loop

1. **`codemap`** maps the repo once, and refreshes only the slices that went stale.
2. **`spec`** turns an idea into a testable ticket and files it as `agent:ready`.
3. **`feature`** claims it, works it in its own worktree and loops on `mise run gate` until green.
4. **`ship`** re-gates, reviews in a fresh context, commits and opens a draft PR.
5. **CI** is watched without blocking; a red run is fixed and re-pushed, and the PR goes ready once green.
6. **`learn`** (from [ivetts-skills](https://github.com/devill/ivetts-skills)) turns what went wrong into a hook, a rule or a skill, so the next loop starts better.

The hooks run underneath every step.

## Skills

- `spec`: turns a rough idea into a testable spec through a short back-and-forth: acceptance criteria plus a Definition of Done kept separate from them. It rejects DoD items that only restate gate or `ship` checks, and won't file until you explicitly approve the full ticket. With a codemap, its pointers come from the owning slices and must exist in the tree.
- `feature`: claims a ready ticket, reads the codemap slices it touches, implements it in its own worktree, loops against `mise run gate` (at most 5 cycles, then `agent:blocked`), walks every acceptance criterion and DoD item, and hands off to `ship`. Run it on one ticket (`/foundry:feature <ref>`) or as a backlog puller (`/loop /foundry:feature`).
- `ship`: the one way a change leaves the working tree. Auto-fix, structural smells, a green gate, a fresh-context review against the linked issue, a conventional commit, then a draft PR through `foundry-ship-pr`, which watches CI and marks the PR ready once green. Review happens before the PR exists, which also keeps API keys out of CI.
- `review`: one reviewer instead of three. Correctness, standards and spec lenses in parallel fresh sub-agents, scaled to the size of the change. The spec lens checks the diff against the acceptance criteria and the DoD, and asks about edits in codemap slices the ticket didn't mention.
- `codemap`: `/foundry:codemap` writes a committed, cited, SHA-stamped map of the repo (`docs/codemap/`) from a deterministic census, with a verifier spot-checking claims against the code. `/foundry:codemap refresh` re-audits only the slices whose cited files changed. It describes, never judges, and hands its output to `ship` as a docs PR. Foundry's advisory `mise run codemap:check` fails when a citation no longer resolves and reports how many commits each slice is behind.
- `pr-ci-watch`: loops a PR's CI result back without blocking. Watches the checks in a Herdr pane (or a background task outside Herdr) while the agent keeps working, and on failure fixes, pushes and re-watches.
- `loop-report`: reads Foundry's verb telemetry to show where the gate spends time and whether the loop is converging or thrashing. Read-only.
- `repo-align`: pays down formatting and structural-smell debt across a repo, one small PR at a time.
- `foundry-secret`: triages a gitleaks finding: allowlist a confirmed false positive, or rotate-then-purge a real leak.

The plugin also ships the scripts the skills call: `foundry-ship-pr` (the sanctioned PR path), `foundry-pr-report` (one-shot CI verdict with failing-step logs), `foundry-loop-report` (telemetry summary) and `codemap/census.mjs` (the deterministic census `codemap` starts from).

## Hooks

All portable `sh` run through `bash`, so they work on Linux, macOS and Windows git-bash alike. Each one is a silent no-op where it doesn't apply, so they're safe to install globally.

| Hook | When | What it does |
|---|---|---|
| `auto-format.sh` | after each edit | formats the one file just written with the project's own `prettier` (or `eslint --fix`). Sub-second, so the gate's format check almost never fails. |
| `habit-hooks-guard.sh` | on stop | runs the repo's pinned [habit-hooks](https://github.com/habit-hooks/habit-hooks) smell check before the agent declares done, in repos with a `.habit-hooks/` directory. A Stop hook because it takes seconds, not milliseconds. |
| `typecheck-stop.sh` | on stop | runs `mise run typecheck` once per turn when source changed, and coaches with the errors. |
| `format-java-stop.sh` | on stop | runs `./gradlew spotlessApply` once per turn when `.java` files changed and the build uses Spotless. Gradle is too slow to run per edit. |
| `guard-generated-files.sh` | before an edit or shell command | blocks hand-editing generated baselines (`snooze.json`, `eslint-suppressions.json`) and points at the command that regenerates them. |
| `guard-pr-create.sh` | before a Bash call | denies a bare `gh pr create`, so no PR skips `ship`. The sanction is the `foundry-ship-pr` script itself, which runs the create as a subprocess the hook never sees. |
| `guard-governance-labels.sh` | before a Bash call | denies an agent applying, aliasing or redefining the `ruleset-change` and `suppression` labels (`--add-label`/`--label` on `gh pr`/`gh issue`, `gh api` label writes, `gh label create`/`edit`). They are a human's sign-off; every other label passes. |
| `jev-toolcall-triage.sh` | on stop | opt-in (`JEV_TOOLCALL_TRIAGE=1`): asks Jev whether the turn looked destructive and prints a warning. Never blocks. |
| `leash.sh` | prompt, stop, session start | opt-in (`LEASH_ENABLED`): the Foundry adapter for [Leash](https://github.com/CMaintz/leash), which checks each turn's diff against the un-lintable rules in `CLAUDE.md`/`AGENTS.md`. Advisory. |
| `pre-push` | `git push` | a plain git hook: runs `mise run gate` and aborts the push if it fails, so a human gets the same gate as the agent. |
| `pre-commit` | `git commit` | a plain git hook: formats staged files with the repo's own `prettier` and re-stages them. |

The two git hooks aren't installed by the plugin. Copy them in with `cp hooks/pre-push .git/hooks/pre-push && chmod +x .git/hooks/pre-push` (same for `pre-commit`), or version them via `core.hooksPath`; skip once with `--no-verify`.

## The advisory Jev layer

`scripts/jev/` puts [Jev](https://typesafe.ai) (TypeSafe System One) on the **proposer** side of Foundry: cheap judgements about where to spend expensive LLM effort, never about pass/fail. It's opt-in and fail-open: set `JEV_API_KEY` to turn it on, and with no key everything behaves as before.

- **Review focus** (`review`): `scripts/jev/review.mjs` ranks which changed files deserve the deepest look. It reorders, never drops.
- **Feature pre-check** (`feature`, off unless `JEV_FEATURE_PRECHECK=1`): `scripts/jev/precheck.mjs` gives a quick "ticket ready?" / "diff plausibly done?" before the expensive verify. Only a confident "no" short-circuits.
- **Tool-call triage** (the `jev-toolcall-triage.sh` hook above).

Jev is around 68% accurate, so it never decides anything in `mise run gate` or CI: the gate runs these scripts' own unit tests, never Jev itself. `client.mjs` and `route.mjs` are vendored from [foundry's `scripts/jev/`](https://github.com/CMaintz/foundry/tree/main/scripts/jev), the canonical home.

## Standing on shoulders

This repo is deliberately thin, because most of the practice layer has already been written by people who did it better. Install these alongside it:

| Source | Licence | What it gives you |
|---|---|---|
| [mattpocock/skills](https://github.com/mattpocock/skills) | MIT | Breadth of practice: `tdd`, `diagnosing-bugs`, `research`, `code-review`, `codebase-design`, `domain-modeling`, `to-spec`, `to-tickets`, `triage` |
| [devill/ivetts-skills](https://github.com/devill/ivetts-skills) | MIT | The flywheel: `learn`, `build-project-review`, `hotspot-rec` |
| [habit-hooks](https://github.com/habit-hooks/habit-hooks) | see repo | The reflex layer, and the tool-independent smell vocabulary this whole design borrows |

They're installed as plugins rather than copied in, so upstream fixes flow through automatically and the credit stays where it belongs.

## Reviewing: one entry point

Install those plugins and you end up with several things called some flavour of "code review". Rather than juggle them, `/foundry:review` is the one you call. It runs three fresh-context lenses itself and folds in the others:

| Piece | Role | How `review` uses it |
|---|---|---|
| `/foundry:review` | the one you invoke: correctness, standards and spec in parallel fresh sub-agents | n/a |
| a repo-local skill from `build-project-review` | encodes *this* project's maintainers' preferences | loaded into the standards lens if present |
| `mattpocock-skills:code-review` | the standards + spec shape `review` is modelled on | reference only, not called |
| built-in `/code-review` | a fast on-demand bug and cleanup pass, with `--fix` | stays your manual tool |

`ship` calls `review` in step 4. Everything is namespaced as `plugin:skill`, so nothing clashes.

## Developing

This repo is gated by its own Foundry verbs ([mise.toml](./mise.toml)): `mise run gate` runs shellcheck, the Node and hook tests, and a gitleaks scan, locally and in CI.

## Licence

MIT. The skills listed above are separate works under their own licences and aren't redistributed here.
