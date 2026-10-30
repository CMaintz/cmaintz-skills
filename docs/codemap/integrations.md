---
sha: c571bf3155f5765ba192ad155777a191c6aee04b
slice: integrations
kind: lens
---

# Integrations

Everything is outbound: the plugin shells out to CLIs or makes HTTPS calls. The only
inbound surfaces are Claude Code itself, which invokes the hooks with JSON on stdin
(`plugins/foundry/hooks/hooks.json`) and starts the stdio MCP server
(`plugins/foundry/.mcp.json`), and git, which runs the two optional git hooks.

## Claude Code (host)

- **Hooks** - PreToolUse, PostToolUse, Stop, UserPromptSubmit and SessionStart commands,
  each run through `bash`/`sh` with `${CLAUDE_PLUGIN_ROOT}`
  (`plugins/foundry/hooks/hooks.json`). Exit 2 blocks and feeds stderr back to the agent
  (`plugins/foundry/hooks/guard-pr-create.sh`, `plugins/foundry/hooks/habit-hooks-guard.sh`).
- **MCP server** - `node ${CLAUDE_PLUGIN_ROOT}/scripts/explain-mcp/server.mjs` over stdio,
  with `CLAUDE_PLUGIN_DATA` passed through (`plugins/foundry/.mcp.json`). It registers
  `explain_rule`, `explain_failure` and `gate_status`, all annotated read-only
  (`plugins/foundry/scripts/explain-mcp/tools.mjs#registerTools`). The default repo is
  `CLAUDE_PROJECT_DIR`, else the process cwd
  (`plugins/foundry/scripts/explain-mcp/tools.mjs#defaultContext`).
- **Env read**: `CLAUDE_PLUGIN_ROOT` (`plugins/foundry/hooks/mcp-deps.sh`,
  `plugins/foundry/hooks/jev-toolcall-triage.sh`), `CLAUDE_PLUGIN_DATA`
  (`plugins/foundry/hooks/mcp-deps.sh`,
  `plugins/foundry/scripts/explain-mcp/deps.mjs#loadDeps`), `CLAUDE_PROJECT_DIR`
  (`plugins/foundry/scripts/explain-mcp/tools.mjs#defaultContext`).

## GitHub, via the `gh` CLI

- **PR creation and push** - `git push -u origin HEAD`, then `gh pr view`, `gh repo view`
  (default branch), `gh pr create --head --base --title --body-file` and `gh pr ready` for a
  reused draft
  (`plugins/foundry/scripts/foundry-ship-pr#create_pr`,
  `plugins/foundry/scripts/foundry-ship-pr#default_base`,
  `plugins/foundry/scripts/foundry-ship-pr#existing_pr`). `--repo` is refused; the repo
  comes from the checkout's `origin` (`plugins/foundry/scripts/foundry-ship-pr`).
- **CI watch** - polls `gh pr view --json headRefOid` and `gh pr checks --json name` up to
  20 times at `FOUNDRY_PR_WATCH_POLL_SECONDS` (default 15) until the PR head is the
  pushed SHA and checks exist (`plugins/foundry/scripts/foundry-pr-watch#wait_for_checks`),
  then `gh pr checks --watch --interval 30` and, on green with `--ready-on-green`,
  `gh pr ready` (`plugins/foundry/scripts/foundry-pr-watch`).
- **CI verdict** - `gh pr checks --json name,bucket,link` and, for failing runs,
  `gh run view --log-failed` (`plugins/foundry/scripts/foundry-pr-report#checks_json`,
  `plugins/foundry/scripts/foundry-pr-report#dump_failures`).
- **Issues and labels** - the skills drive `gh issue create|edit|comment|list|view` and
  `gh api .../issues/<n>/comments` for ticket claims, escalation and filing
  (`plugins/foundry/skills/feature/SKILL.md`, `plugins/foundry/skills/spec/SKILL.md`,
  `plugins/foundry/skills/repo-align/SKILL.md`), and `gh issue view` / `gh pr diff` /
  `gh pr view --json closingIssuesReferences` for review context
  (`plugins/foundry/skills/review/SKILL.md`, `plugins/foundry/skills/verify/SKILL.md`).
  `loop-report` optionally reads `gh run list` (`plugins/foundry/skills/loop-report/SKILL.md`).
- **Guards** on agent `gh` use: a raw `gh pr create` is denied
  (`plugins/foundry/hooks/guard-pr-create.sh`); applying or defining the
  `ruleset-change`/`suppression` labels via `gh pr|issue edit|create`, `gh label
  create|edit` or a writing `gh api` call is denied
  (`plugins/foundry/hooks/guard-governance-labels.sh`).

## git

- Repo inventory and history for the census: `git ls-files`, `git check-attr
  linguist-vendored`, `git log` (`plugins/foundry/scripts/codemap/repo.mjs#git`,
  `plugins/foundry/scripts/codemap/census.mjs#listFiles`,
  `plugins/foundry/scripts/codemap/census.mjs#ownFiles`,
  `plugins/foundry/scripts/codemap/history.mjs#commitsSince`).
- Changed-file detection against `origin/main` in the Stop hooks
  (`plugins/foundry/hooks/typecheck-stop.sh`, `plugins/foundry/hooks/format-java-stop.sh`)
  and diffs sent to Jev (`plugins/foundry/scripts/jev/review.mjs`,
  `plugins/foundry/scripts/jev/precheck.mjs`, `plugins/foundry/scripts/jev/toolcall.mjs#safeDiff`).
- Git hooks: `plugins/foundry/hooks/pre-commit` formats and re-stages staged files with
  prettier, skipped when `CI` is set; `plugins/foundry/hooks/pre-push` runs `mise run gate`.
  Neither is installed by the plugin (`README.md`).

## mise

- `mise run gate` from the pre-push hook (`plugins/foundry/hooks/pre-push`) and `mise run
  typecheck` from the Stop hook when a top-level `typecheck` task exists
  (`plugins/foundry/hooks/typecheck-stop.sh`).
- `mise exec` to read the pinned `HABIT_HOOKS_PLUGIN`/`HABIT_HOOKS_VERSION` from a
  package's `mise.toml` (`plugins/foundry/hooks/habit-hooks-guard.sh#hh_for`).
- `mise env --json` to build the repo's environment for the MCP tools, with the server's
  own `FOUNDRY_TELEMETRY` removed and `HOME` defaulted
  (`plugins/foundry/scripts/explain-mcp/foundry.mjs#miseEnv`).

## Foundry (sibling repo)

- **`foundry-explain`** - found on the repo's mise PATH (provisioned by Foundry's
  `setup:foundry-scripts`) and run with a Python that can import `tomllib`
  (`plugins/foundry/scripts/explain-mcp/foundry.mjs#explainScript`,
  `plugins/foundry/scripts/explain-mcp/foundry.mjs#findPython`,
  `plugins/foundry/scripts/explain-mcp/foundry.mjs#runExplain`).
- **`foundry-verb-wrap`** produces the telemetry this plugin reads
  (`plugins/foundry/skills/loop-report/SKILL.md`).
- **Vendored code**: `plugins/foundry/scripts/jev/route.mjs` and
  `plugins/foundry/scripts/jev/review.mjs` are vendored from Foundry's `scripts/jev/`;
  `CONTRACT.md` is copied verbatim between the two repos.
- **Renovate preset** `local>CMaintz/foundry//presets/renovate` (`renovate.json`).

## habit-hooks

- Run as `habit-hooks --branch` in each opted-in package at Stop; the binary is the
  version pinned in the package's mise env under `~/.local/opt/<plugin>-<version>/` (an
  unusable pin skips the package with a warning), and only an unpinned package uses
  `habit-hooks` on PATH (with `~/.local/bin` and standalone PMD bins prepended); a
  non-zero exit blocks the stop (`plugins/foundry/hooks/habit-hooks-guard.sh#hh_for`,
  `plugins/foundry/hooks/habit-hooks-guard.sh`).
- `habit-sensors` and `habit-snooze` regenerate `snooze.json` in Foundry's `bootstrap`
  workflow (`plugins/foundry/skills/repo-align/SKILL.md`).

## Jev (TypeSafe System One) over HTTPS

- **Client**: vendored `@cmaintz/jev-core`, re-exported by
  `plugins/foundry/scripts/jev/client.mjs`. `providerFromEnv` returns `null` without a
  key, so every caller fails open
  (`plugins/foundry/scripts/jev/vendor/jev-core/env.js#providerFromEnv`).
- **TypeSafe backend** (default): `POST {baseUrl}/systemone`, base
  `https://api.typesafe.ai/v1`, bearer `JEV_API_KEY`, model default `jev-latest`
  (`plugins/foundry/scripts/jev/vendor/jev-core/typesafe.js#TypeSafeProvider`).
- **Cloudflare Workers AI backend**: `POST
  https://api.cloudflare.com/client/v4/accounts/<id>/ai/run`, model default
  `typesafe/jev` (`plugins/foundry/scripts/jev/vendor/jev-core/cloudflare.js#CloudflareProvider`).
- **HTTP**: `fetch` POST of JSON with a per-attempt timeout (default 30s) and up to 4
  attempts with exponential backoff on HTTP 429 and 529 only
  (`plugins/foundry/scripts/jev/vendor/jev-core/http.js#postJson`,
  `plugins/foundry/scripts/jev/vendor/jev-core/http.js#fetchOnce`,
  `plugins/foundry/scripts/jev/vendor/jev-core/errors.js#JevHttpError`).
- **Env**: `JEV_PROVIDER`, `JEV_API_KEY`, `JEV_MODEL`, `CLOUDFLARE_ACCOUNT_ID`,
  `CLOUDFLARE_API_TOKEN`, `TYPESAFE_AI_BASE_URL`, `JEV_TIMEOUT_MS`
  (`plugins/foundry/scripts/jev/vendor/jev-core/env.js#providerFromEnv`).
- **Callers**: the Stop-hook triage, gated on `JEV_TOOLCALL_TRIAGE` truthy, `JEV_API_KEY`
  set and `node` present, and warn-only
  (`plugins/foundry/hooks/jev-toolcall-triage.sh`,
  `plugins/foundry/scripts/jev/toolcall.mjs#warningFor`); review routing, skipped at or
  below `JEV_REVIEW_MIN_FILES` (`plugins/foundry/scripts/jev/review.mjs#routeFiles`); the
  feature pre-check, gated on `JEV_FEATURE_PRECHECK`
  (`plugins/foundry/scripts/jev/precheck.mjs#enabled`).

## Leash

- `leash snapshot|hook|session` on UserPromptSubmit, Stop and SessionStart, payload on
  stdin, output passed through; a no-op unless `LEASH_ENABLED` is truthy and `leash` is on
  PATH; always exits 0 (`plugins/foundry/hooks/leash.sh`, `plugins/foundry/hooks/hooks.json`).

## Herdr (terminal multiplexer)

- When `HERDR_ENV=1`, `foundry-ship-pr` runs the CI watch in a new pane via `herdr pane
  split --current --direction right --no-focus` and `herdr pane run`, falling back to a
  detached `nohup` process on failure
  (`plugins/foundry/scripts/foundry-ship-pr#watch_in_herdr_pane`,
  `plugins/foundry/scripts/foundry-ship-pr#watch_detached`). The `pr-ci-watch` skill also
  uses `herdr pane read|process-info|close` and refers to `HERDR_PANE_ID`
  (`plugins/foundry/skills/pr-ci-watch/SKILL.md`).

## npm registry

- `npm ci --omit=dev` into `${CLAUDE_PLUGIN_DATA}` at SessionStart when the SDK is not
  beside the plugin (`plugins/foundry/hooks/mcp-deps.sh`); `npm ci --prefix
  plugins/foundry` in the `setup:mcp-deps` task (`mise.toml`).
- `npm pack @cmaintz/jev-core@<version>` when re-vendoring
  (`plugins/foundry/scripts/jev/vendor-jev-core.sh`).

## Local formatters and build tools (consumer repos)

- prettier when a Prettier config resolves, else (no prettier installed) `eslint --fix`, from the
  nearest `node_modules/.bin` on each edit (`plugins/foundry/hooks/auto-format.sh#run_tool`,
  `plugins/foundry/hooks/auto-format.sh`); prettier on staged files at commit
  (`plugins/foundry/hooks/pre-commit`).
- `./gradlew spotlessApply` at Stop when the build mentions Spotless and a `.java` file
  changed (`plugins/foundry/hooks/format-java-stop.sh`).
- `python3`/`python` to run `foundry-loop-report` and `foundry-explain`
  (`plugins/foundry/scripts/explain-mcp/foundry.mjs#findPython`).

## Other Claude Code plugins

- `README.md` names companion plugins installed alongside: mattpocock/skills,
  devill/ivetts-skills (`learn`, `build-project-review`, `hotspot-rec`) and habit-hooks.
- `review` loads a repo-local skill built by `build-project-review` into its standards
  lens when one exists (`plugins/foundry/skills/review/SKILL.md`); `repo-align` picks
  targets from `hotspot-rec` (`plugins/foundry/skills/repo-align/SKILL.md`).

## raw.githubusercontent.com

- `README.md` documents fetching the git hooks with `curl` from
  raw.githubusercontent.com as an alternative to copying them; no code does this.

## Secret scanning

- `gitleaks dir --no-banner --redact .` in the `audit` task (`mise.toml`); the
  `foundry-secret` skill triages findings (`plugins/foundry/skills/foundry-secret/SKILL.md`).

## Unknowns

- Which external endpoints and key files does the `leash` CLI use? `leash.sh` only says
  Leash finds its own key (env, `.env`, `~/.leash/.env`).
- How is `gh` authenticated in practice? No code in this repo reads `GH_TOKEN` or
  `GITHUB_TOKEN`, so it presumably relies on the user's `gh auth login`.
- Is the Cloudflare backend used anywhere in practice, given no caller in this repo sets
  `JEV_PROVIDER`?
- The `pr-ci-watch` skill parses the Herdr split result as `.result.pane.pane_id` with
  `jq`, while `foundry-ship-pr` greps for any `pane_id`; is the Herdr JSON shape the same
  in both cases?
