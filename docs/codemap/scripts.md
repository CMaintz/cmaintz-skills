---
sha: c571bf3155f5765ba192ad155777a191c6aee04b
slice: scripts
kind: domain
paths: [plugins/foundry/scripts]
---

## Purpose
The executable side of the foundry plugin: the scripts its skills, hooks and MCP server shell out to. They open and CI-watch PRs (`plugins/foundry/scripts/foundry-ship-pr`), summarise verb telemetry (`plugins/foundry/scripts/foundry-loop-report`), inventory a repo for the codemap skill (`plugins/foundry/scripts/codemap/census.mjs#census`), serve read-only MCP tools (`plugins/foundry/scripts/explain-mcp/server.mjs`) and run the advisory Jev routing layer (`plugins/foundry/scripts/jev/route.mjs`).

## Features
- Push the current branch, open a draft PR (or reuse the existing one) and start a background CI watch, with title and body read from files (`plugins/foundry/scripts/foundry-ship-pr#create_pr`, `plugins/foundry/scripts/foundry-ship-pr#existing_pr`). `--repo` is refused with exit 2; a rejected push exits 3 (`plugins/foundry/scripts/foundry-ship-pr`).
- Wait for a PR's checks on a given commit, print the verdict and optionally mark the draft ready on green (`plugins/foundry/scripts/foundry-pr-watch#wait_for_checks`, `plugins/foundry/scripts/foundry-pr-watch`). The poll interval comes from `FOUNDRY_PR_WATCH_POLL_SECONDS`, default 15 (`plugins/foundry/scripts/foundry-pr-watch`).
- One-shot, non-blocking check verdict for a PR, dumping the failed-step logs of each failing or cancelled run; exit 0 passed, 1 failed, 2 pending (`plugins/foundry/scripts/foundry-pr-report#checks_json`, `plugins/foundry/scripts/foundry-pr-report#dump_failures`).
- Summarise verb telemetry JSONL into per-verb runs, fails, pass-to-fail regressions and still-red verbs, as text or `--json`; the text report adds the time sink and smell trend (`plugins/foundry/scripts/foundry-loop-report#summarise`, `plugins/foundry/scripts/foundry-loop-report#smell_trend`, `plugins/foundry/scripts/foundry-loop-report#as_json`). The log path is the argument, else `FOUNDRY_TELEMETRY`, else `.foundry/telemetry.jsonl` (`plugins/foundry/scripts/foundry-loop-report#main`).
- Print a deterministic JSON census of a git repo: manifests, entrypoints, schemas, env vars, churn, co-change and a slice plan (`plugins/foundry/scripts/codemap/census.mjs#census`), via per-file-type detectors where the first matching detector handles a file (`plugins/foundry/scripts/codemap/census.mjs`, `plugins/foundry/scripts/codemap/detectors/`).
- An MCP stdio server with three read-only tools, `explain_rule`, `explain_failure` and `gate_status` (`plugins/foundry/scripts/explain-mcp/tools.mjs#registerTools`, `plugins/foundry/scripts/explain-mcp/tools.mjs#createServer`).
- Jev advisory routing: per-file review routing from a diff (`plugins/foundry/scripts/jev/review.mjs#routeFiles`), a feature pre-check that only short-circuits on a confident "no" (`plugins/foundry/scripts/jev/precheck.mjs#verdict`, `plugins/foundry/scripts/jev/precheck.mjs#enabled`), and a per-turn tool-call risk warning on stderr (`plugins/foundry/scripts/jev/toolcall.mjs#warningFor`). With no provider configured each one falls back to its non-Jev behaviour (`plugins/foundry/scripts/jev/vendor/jev-core/env.js#providerFromEnv`, `plugins/foundry/scripts/jev/review.mjs#routeFiles`).
- Re-vendor a published `@cmaintz/jev-core` version into `plugins/foundry/scripts/jev/vendor/jev-core` (`plugins/foundry/scripts/jev/vendor-jev-core.sh`).

## Owned entities
- `.foundry/pr-url` in the checkout root: the opened PR's URL, written on every run (`plugins/foundry/scripts/foundry-ship-pr`).
- `.foundry/pr-watch.log`: output of the detached CI watch, ending with `---PR-CI-WATCH-DONE--- exit <n>` (`plugins/foundry/scripts/foundry-ship-pr#watch_detached`).
- The census JSON shape (printed to stdout, not persisted), documented next to the script (`plugins/foundry/scripts/codemap/README.md`, `plugins/foundry/scripts/codemap/census.mjs#census`).
- The `--json` loop summary `{telemetry, verbs, red, thrash}`, or `{"telemetry": null}` for a missing log (`plugins/foundry/scripts/foundry-loop-report#as_json`, `plugins/foundry/scripts/foundry-loop-report#main`).
- The vendored jev-core tree and its generated `package.json` (`plugins/foundry/scripts/jev/vendor-jev-core.sh`).
- Jev routing defaults `DEFAULT_CONFIG` (review depth threshold 1.5, min confidence 0.6, tool-call warn 0.5, hold off) (`plugins/foundry/scripts/jev/route.mjs#DEFAULT_CONFIG`).

## Happy paths
### Ship a branch to a draft PR and watch its CI
1. Entrypoint: `foundry-ship-pr --body-file <path> [--title-file <path>] [--base <branch>]` (`plugins/foundry/scripts/foundry-ship-pr`). The guard hook names this script as the sanctioned path when it denies a bare `gh pr create` (`plugins/foundry/hooks/guard-pr-create.sh`).
2. `git push -u origin HEAD` on every run; a rejection exits 3 (`plugins/foundry/scripts/foundry-ship-pr`).
3. Looks up the branch's PR with `gh pr view`; if none, runs `gh pr create --draft --head <branch>` with the title from `--title-file` or HEAD's subject and the base from `--base` or the repo default branch (`plugins/foundry/scripts/foundry-ship-pr#existing_pr`, `plugins/foundry/scripts/foundry-ship-pr#create_pr`, `plugins/foundry/scripts/foundry-ship-pr#default_base`).
4. Writes the PR URL to `.foundry/pr-url` (`plugins/foundry/scripts/foundry-ship-pr`).
5. Builds the command `foundry-pr-watch <pr> --sha <pushed sha> --ready-on-green; echo sentinel` and runs it in a new Herdr pane when `HERDR_ENV=1` and the split succeeds, else as a `nohup` background process logging to `.foundry/pr-watch.log` (`plugins/foundry/scripts/foundry-ship-pr#watch_in_herdr_pane`, `plugins/foundry/scripts/foundry-ship-pr#watch_detached`).
6. In the watch: polls up to 20 times until the PR head equals the pushed sha and at least one check exists; exits 2 if the head never arrived or no checks registered (`plugins/foundry/scripts/foundry-pr-watch#wait_for_checks`).
7. Runs `gh pr checks --watch --interval 30`, then `foundry-pr-report`, which lists `bucket<TAB>name` per check and, on any fail or cancel bucket, prints `gh run view --log-failed` for each run id (`plugins/foundry/scripts/foundry-pr-watch`, `plugins/foundry/scripts/foundry-pr-report#dump_failures`).
8. Side effect: on exit 0 with `--ready-on-green`, `gh pr ready` marks the draft ready; the watch exits with the report's code (`plugins/foundry/scripts/foundry-pr-watch`).

### Census a repo for the codemap skill
1. Entrypoint: `node census.mjs [--since ...] [--threshold ...] [--min-shared ...]`, run directly (argv vs module realpath check); bad flags exit 2 (`plugins/foundry/scripts/codemap/census.mjs#invokedDirectly`, `plugins/foundry/scripts/codemap/census.mjs#parseArgs`). The codemap skill invokes it (`plugins/foundry/skills/codemap/SKILL.md`).
2. Resolves the work-tree top, lists tracked plus untracked-not-ignored files, and drops `linguist-vendored` files and `vendor/` or `third_party/` paths (`plugins/foundry/scripts/codemap/census.mjs#listFiles`, `plugins/foundry/scripts/codemap/census.mjs#ownFiles`, `plugins/foundry/scripts/codemap/repo.mjs#git`).
3. For each non-test file, the first matching detector reads it (files over 1 MB read as empty) and yields entrypoints and env var names (`plugins/foundry/scripts/codemap/census.mjs#census`, `plugins/foundry/scripts/codemap/census.mjs#read`, `plugins/foundry/scripts/codemap/detectors/script.mjs#shebangScript`, `plugins/foundry/scripts/codemap/detectors/runtime.mjs#hooksJson`, `plugins/foundry/scripts/codemap/detectors/js.mjs#js`, `plugins/foundry/scripts/codemap/detectors/dotnet.mjs#dotnet`).
4. Reads non-merge commits in the `--since` window (default `12 months ago`) restricted to existing files, then counts churn over every commit and coupled pairs over commits of at most 50 files (`plugins/foundry/scripts/codemap/history.mjs#commitsSince`, `plugins/foundry/scripts/codemap/history.mjs#countChurn`, `plugins/foundry/scripts/codemap/history.mjs#coupledPairs`).
5. Proposes slices: excludes tests/docs/infra, keys files to slice keys, regroups by repeated folder names, and union-merges keys coupled against the busier side (`plugins/foundry/scripts/codemap/history.mjs#planSlices`).
6. Output: pretty-printed JSON on stdout, sorted by code-unit order; nothing is written to disk (`plugins/foundry/scripts/codemap/census.mjs`, `plugins/foundry/scripts/codemap/repo.mjs#byText`).

### Answer `gate_status` from verb telemetry over MCP
1. Entrypoint: the plugin's `.mcp.json` starts `server.mjs`, which loads the MCP SDK and zod from the plugin root or `CLAUDE_PLUGIN_DATA` and connects a stdio transport (`plugins/foundry/.mcp.json`, `plugins/foundry/scripts/explain-mcp/server.mjs`, `plugins/foundry/scripts/explain-mcp/deps.mjs#loadDeps`).
2. Tools are registered read-only, each with an optional `repo` argument defaulting to `CLAUDE_PROJECT_DIR` or cwd (`plugins/foundry/scripts/explain-mcp/tools.mjs#registerTools`, `plugins/foundry/scripts/explain-mcp/tools.mjs#defaultContext`).
3. `gate_status` builds the repo's environment from `mise env --json` with the server's own `FOUNDRY_TELEMETRY` removed, falling back to the plain env when mise is absent (`plugins/foundry/scripts/explain-mcp/tools.mjs#gateStatus`, `plugins/foundry/scripts/explain-mcp/foundry.mjs#miseEnv`).
4. Runs `foundry-loop-report --json <telemetry>` under the first python able to import `json`, the path being that env's `FOUNDRY_TELEMETRY` or `<repo>/.foundry/telemetry.jsonl` (`plugins/foundry/scripts/explain-mcp/foundry.mjs#runLoopReport`, `plugins/foundry/scripts/explain-mcp/foundry.mjs#findPython`).
5. The report loads the JSONL (skipping unparseable lines), sorts rows by `ms`, tallies per verb and counts a regression when a fail follows a pass (`plugins/foundry/scripts/foundry-loop-report#load`, `plugins/foundry/scripts/foundry-loop-report#summarise`, `plugins/foundry/scripts/foundry-loop-report#tally`).
6. Output: the JSON summary as tool text, or a "No verb telemetry yet" message when `telemetry` is null (`plugins/foundry/scripts/foundry-loop-report#as_json`, `plugins/foundry/scripts/explain-mcp/tools.mjs#gateStatus`, `plugins/foundry/scripts/explain-mcp/tools.mjs#text`).

## Unknowns
- What writes the telemetry JSONL that `foundry-loop-report` reads? The script names `foundry-verb-wrap`, which is not in this repo (`plugins/foundry/scripts/foundry-loop-report`).
- Where does `foundry-explain`, used by `explain_rule` and `explain_failure`, come from? Only its PATH lookup and the error text naming `setup:foundry-scripts` and `FOUNDRY_SCRIPTS_REF` are here (`plugins/foundry/scripts/explain-mcp/foundry.mjs#explainScript`).
- `jev/review.mjs` and `jev/route.mjs` are headed as vendored from a canonical `CMaintz/foundry:scripts/jev/`; is that a separate repo, and how is drift between the two detected?
- Does anything consume the `.foundry/pr-url` file that `foundry-ship-pr` writes? No reader was found in this slice.
- Is `precheck.mjs ready` mode invoked by any skill, or only `satisfies`? Only the latter is shown as a command in `plugins/foundry/skills/feature/SKILL.md`.
