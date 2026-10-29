---
sha: c571bf3155f5765ba192ad155777a191c6aee04b
slice: index
kind: index
---

# cmaintz-skills codemap

A Claude Code plugin marketplace (`.claude-plugin/marketplace.json`) whose one plugin, `foundry`,
gives an agent the Foundry loop: skills that take work from an idea to a ticket to a gated PR
(`plugins/foundry/skills/`), hooks that enforce the loop inside a session
(`plugins/foundry/hooks/hooks.json`), and the scripts both of them shell out to
(`plugins/foundry/scripts/`).

## Domains

| Slice | File | Purpose |
| --- | --- | --- |
| skills | [skills.md](skills.md) | The `SKILL.md` instructions: spec, feature, verify, ship, review, pr-ci-watch, codemap, repo-align, foundry-secret, loop-report |
| hooks | [hooks.md](hooks.md) | Claude Code hooks that deny tool calls, format edits and gate Stop, plus opt-in git pre-commit and pre-push hooks |
| scripts | [scripts.md](scripts.md) | Executables: PR create and CI watch, telemetry report, codemap census, the read-only MCP server, the Jev routing layer |

Lenses: [data-model.md](data-model.md) (files, labels and formats the plugin reads and writes),
[integrations.md](integrations.md) (GitHub, git, mise, habit-hooks, Jev, Herdr and other external
systems), [runtime.md](runtime.md) (install and load, env vars, mise tasks, CI, release).

## Key cross-domain flows

### Idea to merged-ready PR
skills -> scripts. Detail in [skills.md](skills.md).
1. `plugins/foundry/skills/spec/SKILL.md` files a ticket, which `plugins/foundry/skills/feature/SKILL.md` claims and drives to a green gate in a worktree, checked against its criteria by `plugins/foundry/skills/verify/SKILL.md`.
2. `plugins/foundry/skills/ship/SKILL.md` re-runs the gate, invokes `plugins/foundry/skills/review/SKILL.md`, commits, and runs `plugins/foundry/scripts/foundry-ship-pr`.
3. `plugins/foundry/scripts/foundry-ship-pr#create_pr` opens a draft PR and `plugins/foundry/scripts/foundry-ship-pr#watch_detached` (or `plugins/foundry/scripts/foundry-ship-pr#watch_in_herdr_pane`) starts `plugins/foundry/scripts/foundry-pr-watch`, which waits for the pushed commit's checks (`plugins/foundry/scripts/foundry-pr-watch#wait_for_checks`), prints `plugins/foundry/scripts/foundry-pr-report` and marks the PR ready on green.

### A raw PR create is redirected to ship
hooks -> scripts. Detail in [hooks.md](hooks.md).
1. `plugins/foundry/hooks/guard-pr-create.sh` runs on every Bash PreToolUse (`plugins/foundry/hooks/hooks.json`), denies a `gh pr create` with exit 2 and names `plugins/foundry/scripts/foundry-ship-pr` as the sanctioned path, which runs `gh` as a subprocess the hook never sees.

### Stop is gated on structural smells
hooks -> integrations. Detail in [hooks.md](hooks.md).
1. `plugins/foundry/hooks/habit-hooks-guard.sh` runs at Stop, picks the pinned habit-hooks per package (`plugins/foundry/hooks/habit-hooks-guard.sh#hh_for`) and blocks the stop with exit 2 when any package reports smells.

### Codemap build
skills -> scripts. Detail in [scripts.md](scripts.md).
1. `plugins/foundry/skills/codemap/SKILL.md` runs `plugins/foundry/scripts/codemap/census.mjs#census`, which lists files, runs the detectors and proposes slices from history (`plugins/foundry/scripts/codemap/history.mjs#planSlices`), then fans out agents and writes `docs/codemap/` in the format of `plugins/foundry/skills/codemap/FORMAT.md`.

### Gate status over MCP
runtime -> scripts. Detail in [scripts.md](scripts.md).
1. `plugins/foundry/.mcp.json` starts `plugins/foundry/scripts/explain-mcp/server.mjs`; its `gate_status` tool (`plugins/foundry/scripts/explain-mcp/tools.mjs#gateStatus`) runs `plugins/foundry/scripts/foundry-loop-report` over the repo's verb telemetry (`plugins/foundry/scripts/explain-mcp/foundry.mjs#runLoopReport`).

## Where things live

- Entrypoints: hook registrations `plugins/foundry/hooks/hooks.json`, MCP server `plugins/foundry/.mcp.json`, skills `plugins/foundry/skills/`, executables `plugins/foundry/scripts/`.
- Data model: no database; state is files under `.foundry/`, baselines in consumer repos and GitHub labels. See [data-model.md](data-model.md).
- Config: `mise.toml` (tools and the fix, lint, test, audit and gate tasks), `plugins/foundry/package.json` (MCP dependencies). See [runtime.md](runtime.md).
- Tests: shell tests in `tests/`, node tests next to the code (`plugins/foundry/scripts/explain-mcp/server.test.mjs`).
- CI: `.github/workflows/gate.yml`.

## Known unknowns

- What writes the verb telemetry `foundry-loop-report` reads? `foundry-verb-wrap` is not in this repo ([scripts.md](scripts.md), [data-model.md](data-model.md)).
- `spec` runs `scripts/setup-labels.sh`, which is not in this repo; which labels does it create, and where does it live ([skills.md](skills.md))?
- Who clears `agent:working` after `ship` opens the PR ([skills.md](skills.md))?
- How does Claude Code find `plugins/foundry/hooks/hooks.json` and the plugin version with no plugin manifest ([hooks.md](hooks.md), [runtime.md](runtime.md))?
- Where is the ticket schema shipped from, and which of its two cited paths is current ([skills.md](skills.md))?
