---
sha: c571bf3155f5765ba192ad155777a191c6aee04b
slice: runtime
kind: lens
---

# Runtime

The repo is a Claude Code plugin marketplace. Nothing is deployed as a service: the
deliverable is the `plugins/foundry/` directory, which Claude Code caches and runs as
hooks, skills, scripts and a stdio MCP server inside a user's session.

## Install and load

- **Marketplace manifest**: `.claude-plugin/marketplace.json` names the marketplace
  `cmaintz` and lists one plugin, `foundry`, with `source` `./plugins/foundry`. Users
  install it with `/plugin marketplace add CMaintz/cmaintz-skills` and `/plugin install
  foundry@cmaintz`; only `plugins/foundry/` is installed (`README.md`).
- **Plugin manifest**: there is no `plugins/foundry/.claude-plugin/plugin.json`; the
  plugin's metadata comes from its marketplace entry, and its components from the
  conventional `skills/`, `hooks/hooks.json` and `.mcp.json` locations
  (`.claude-plugin/marketplace.json`, `README.md`).
- **Skills**: one directory per skill under `plugins/foundry/skills/`, each a `SKILL.md`
  with `name` and `description` frontmatter (`plugins/foundry/skills/ship/SKILL.md`),
  namespaced as `foundry:<skill>` (`README.md`).
- **Hooks**: registered from `plugins/foundry/hooks/hooks.json`:
  - PreToolUse `Edit|Write|MultiEdit|Bash`: `guard-generated-files.sh` (10s).
  - PreToolUse `Bash`: `guard-pr-create.sh`, `guard-governance-labels.sh` (10s each).
  - PostToolUse `Edit|Write|MultiEdit`: `auto-format.sh` (30s).
  - Stop: `habit-hooks-guard.sh`, `typecheck-stop.sh`, `format-java-stop.sh` (120s each),
    `jev-toolcall-triage.sh` (60s), `leash.sh hook` (90s).
  - UserPromptSubmit: `leash.sh snapshot` (30s).
  - SessionStart: `leash.sh session` (30s), `mcp-deps.sh` via `sh` (300s).
- **MCP server**: `plugins/foundry/.mcp.json` starts `node
  ${CLAUDE_PLUGIN_ROOT}/scripts/explain-mcp/server.mjs` with `CLAUDE_PLUGIN_DATA` in its
  env. The server loads the SDK from the plugin root or `CLAUDE_PLUGIN_DATA`
  (`plugins/foundry/scripts/explain-mcp/deps.mjs#loadDeps`) and connects a stdio
  transport (`plugins/foundry/scripts/explain-mcp/server.mjs`). On Windows `node` must
  resolve to an `.exe` (`README.md`).
- **MCP dependencies**: `plugins/foundry/package.json` and its lockfile pin
  `@modelcontextprotocol/sdk` and `zod`. When they are not beside the plugin,
  `plugins/foundry/hooks/mcp-deps.sh` runs `npm ci --omit=dev` into `CLAUDE_PLUGIN_DATA`
  at SessionStart, again whenever `package.json` changes, and never blocks.
- **Jev client**: vendored under `plugins/foundry/scripts/jev/vendor/jev-core/`, marked
  `linguist-vendored` (`.gitattributes`), refreshed by
  `plugins/foundry/scripts/jev/vendor-jev-core.sh`, so the Jev scripts need no npm install
  (`plugins/foundry/scripts/jev/client.mjs`).
- **Git hooks**: `plugins/foundry/hooks/pre-commit` and `plugins/foundry/hooks/pre-push`
  are copied into a target repo's `.git/hooks/` by hand or via `core.hooksPath`; the
  plugin does not install them (`README.md`).

## Executables shipped in the plugin

- `plugins/foundry/scripts/foundry-ship-pr` (bash): push, open draft PR, start CI watch;
  exits 0, 2 on usage error, 3 on rejected push.
- `plugins/foundry/scripts/foundry-pr-watch` (bash): wait for the pushed SHA's checks,
  report, optionally mark ready; exits 0, 1 or 2.
- `plugins/foundry/scripts/foundry-pr-report` (bash): one-shot CI verdict; exits 0, 1 or 2.
- `plugins/foundry/scripts/foundry-loop-report` (Python 3): telemetry summary, table or
  `--json` (`plugins/foundry/scripts/foundry-loop-report#main`).
- `plugins/foundry/scripts/codemap/census.mjs` (Node 22, no deps): repo census as JSON
  (`plugins/foundry/scripts/codemap/census.mjs#census`).
- `plugins/foundry/scripts/jev/review.mjs`, `plugins/foundry/scripts/jev/precheck.mjs`,
  `plugins/foundry/scripts/jev/toolcall.mjs` (Node): advisory Jev calls that exit 0 on error.

## Configuration and env vars

| Var | Read by | Effect |
| --- | --- | --- |
| `CLAUDE_PLUGIN_ROOT` | `plugins/foundry/hooks/hooks.json`, `plugins/foundry/hooks/mcp-deps.sh`, `plugins/foundry/hooks/jev-toolcall-triage.sh` | plugin install dir |
| `CLAUDE_PLUGIN_DATA` | `plugins/foundry/hooks/mcp-deps.sh`, `plugins/foundry/scripts/explain-mcp/deps.mjs` | persistent npm install dir |
| `CLAUDE_PROJECT_DIR` | `plugins/foundry/scripts/explain-mcp/tools.mjs` | default repo for MCP tools |
| `FOUNDRY_TELEMETRY` | `plugins/foundry/scripts/foundry-loop-report`, `plugins/foundry/scripts/explain-mcp/foundry.mjs` | telemetry path |
| `FOUNDRY_PR_WATCH_POLL_SECONDS` | `plugins/foundry/scripts/foundry-pr-watch` | poll interval, default 15 |
| `HERDR_ENV` | `plugins/foundry/scripts/foundry-ship-pr` | `1` runs the watch in a Herdr pane |
| `LEASH_ENABLED` | `plugins/foundry/hooks/leash.sh` | truthy enables Leash hooks |
| `JEV_TOOLCALL_TRIAGE` | `plugins/foundry/hooks/jev-toolcall-triage.sh` | truthy enables Stop triage |
| `JEV_FEATURE_PRECHECK` | `plugins/foundry/scripts/jev/precheck.mjs` | truthy enables pre-check |
| `JEV_REVIEW_MIN_FILES` | `plugins/foundry/scripts/jev/review.mjs` | skip Jev at or below N files |
| `JEV_API_KEY` and other `JEV_*`, `CLOUDFLARE_*`, `TYPESAFE_AI_BASE_URL` | `plugins/foundry/scripts/jev/vendor/jev-core/env.js` | Jev provider |
| `CI` | `plugins/foundry/hooks/pre-commit` | set means skip formatting |

The table rows cite the files that read each var; per-symbol detail is in
`plugins/foundry/scripts/explain-mcp/tools.mjs#defaultContext`,
`plugins/foundry/scripts/explain-mcp/foundry.mjs#runLoopReport` and
`plugins/foundry/scripts/jev/vendor/jev-core/env.js#providerFromEnv`.

## Development tasks (`mise.toml`)

- **Tools pinned**: node 22.23.4, shellcheck 0.11.0, gitleaks 8.30.1, python 3.12.15.
- **`fix`**: `true` (no formatter configured).
- **`lint`**: shellcheck over every non-JSON file in `plugins/foundry/hooks/`, the three
  bash scripts in `plugins/foundry/scripts/`, non-vendored `*.sh` under
  `plugins/foundry/scripts/`, and `tests/*.sh`.
- **`typecheck`**: `true` (plain `.mjs`, no checker).
- **`setup:mcp-deps`**: `npm ci --prefix plugins/foundry` unless the SDK is already there.
- **`test`** (depends on `setup:mcp-deps`): `node --test` over
  `plugins/foundry/scripts/**/*.test.mjs`, then each shell test in `tests/`
  (`tests/pre-commit.test.sh`, `tests/auto-format.test.sh`,
  `tests/habit-hooks-guard.test.sh`, `tests/foundry-ship-pr.test.sh`,
  `tests/mcp-deps.test.sh`, `tests/foundry-loop-report.test.sh`,
  `tests/guard-governance-labels.test.sh`, `tests/foundry-pr-watch.test.sh`).
- **`audit`**: `gitleaks dir --no-banner --redact .` over the working tree.
- **`gate`**: sequential `lint`, `typecheck`, `test`, `audit`, the composite named the
  only authority in `CONTRACT.md`.

## CI

- `.github/workflows/gate.yml` (workflow `gate`): on push to `main` and on every pull
  request, with `contents: read`, one `ubuntu-latest` job that checks out
  (`actions/checkout` pinned by SHA), installs mise 2026.9.18 via `jdx/mise-action`
  (pinned by SHA), and runs `mise run gate`.
- Dependency updates: Renovate, extending the Foundry preset (`renovate.json`).

## Release

- The plugin carries `version` `1.0.0` in `plugins/foundry/package.json`, which the MCP
  server reports (`plugins/foundry/scripts/explain-mcp/tools.mjs#createServer`); git tags
  `v1` and `v1.0.0` exist. `CONTRACT.md` requires a coordinated major bump of both repos
  for breaking verb changes. No release workflow or publishing step exists in the repo.

## Unknowns

- How do plugin users pick up a new version: is it by Claude Code refreshing the
  marketplace from `main`, or by the tags? Nothing in the repo moves the `v1` tag.
- Is the omission of a `plugin.json` (and any `version` field the cache path
  `~/.claude/plugins/cache/cmaintz/foundry/<version>/` in `README.md` relies on)
  intentional, and where does that `<version>` come from?
- The CI workflow pins mise but the tool versions come from `mise.toml`; does anything
  check that `jdx/mise-action` installs them (no explicit `mise install` step)?
