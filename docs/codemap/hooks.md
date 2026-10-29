---
sha: c571bf3155f5765ba192ad155777a191c6aee04b
slice: hooks
kind: domain
paths: [plugins/foundry/hooks]
---

## Purpose
The Foundry plugin's in-loop enforcement: Claude Code hooks registered in `plugins/foundry/hooks/hooks.json` that deny certain tool calls, format edited files, and coach or gate the agent at Stop, plus two opt-in git hooks (`plugins/foundry/hooks/pre-commit`, `plugins/foundry/hooks/pre-push`) that format staged files and run the gate before a push.

## Features
- PreToolUse on Edit|Write|MultiEdit|Bash runs `plugins/foundry/hooks/guard-generated-files.sh`, which exits 2 when a file-path tool targets `snooze.json` or `eslint-suppressions.json` (`plugins/foundry/hooks/guard-generated-files.sh#deny_snooze`, `plugins/foundry/hooks/guard-generated-files.sh#deny_eslint`), or when a Bash command writes one through a redirect, `tee`/`cp`/`mv`/`install`/`rsync`, `sed -i`, `--in-place` or `of=` (`plugins/foundry/hooks/guard-generated-files.sh#writes`). Reads and mere mentions of the file pass.
- PreToolUse on Bash runs `plugins/foundry/hooks/guard-pr-create.sh`, which denies a `gh pr create` command and points at `plugins/foundry/scripts/foundry-ship-pr` as the sanctioned path.
- PreToolUse on Bash runs `plugins/foundry/hooks/guard-governance-labels.sh`, which denies applying, aliasing or redefining the `ruleset-change` and `suppression` labels via `--add-label`/`--label`/`-l` on `gh pr|issue edit|create`, `gh label create|edit`, or a writing `gh api` call on labels. It evaluates each `;`, `&` or `|` separated segment on its own.
- PostToolUse on Edit|Write|MultiEdit runs `plugins/foundry/hooks/auto-format.sh`, which formats the single edited file with the nearest `node_modules/.bin` prettier, or eslint `--fix` when prettier is absent (`plugins/foundry/hooks/auto-format.sh#run_tool`).
- Stop runs `plugins/foundry/hooks/habit-hooks-guard.sh`, which runs `habit-hooks --branch` in the repo root and each immediate subdirectory that has a `.habit-hooks/` directory, and exits 2 with the findings plus a fix-toward legend when any package fails.
- Stop runs `plugins/foundry/hooks/typecheck-stop.sh`, which runs `mise run typecheck` when `mise.toml` defines a top-level `typecheck` task, there is no `./gradlew`, and changed files include a source extension (ts, tsx, js, jsx, java, kt, kts, cs, py, php). It exits 2 on a type error and exits 0 on output matching infrastructure failures (`no task`, `command not found`, and similar).
- Stop runs `plugins/foundry/hooks/format-java-stop.sh`, which runs `./gradlew spotlessApply` silently when a Gradle build mentions `spotless` and changed files include `.java`. It never blocks.
- Stop runs `plugins/foundry/hooks/jev-toolcall-triage.sh`, which pipes the hook payload to `plugins/foundry/scripts/jev/toolcall.mjs` when `JEV_TOOLCALL_TRIAGE` is `1|true|yes|on`, `JEV_API_KEY` is set and `node` is on PATH. It always exits 0.
- UserPromptSubmit, Stop and SessionStart run `plugins/foundry/hooks/leash.sh` with `snapshot`, `hook` and `session` respectively. When `LEASH_ENABLED` is truthy and `leash` is on PATH it pipes the payload to `leash <subcommand>` and passes its stdout through, always exiting 0.
- SessionStart runs `plugins/foundry/hooks/mcp-deps.sh`, which installs the dependencies in `plugins/foundry/package.json` with `npm ci --omit=dev` into `CLAUDE_PLUGIN_DATA` unless `@modelcontextprotocol/sdk` is already in `CLAUDE_PLUGIN_ROOT/node_modules` or `.installed.json` matches `package.json`.
- Git pre-commit (installed by hand per its header) formats each staged ACMR file with `node_modules/.bin/prettier` and re-adds it, skipping files with unstaged changes and skipping each file whose Prettier config does not resolve (with a one-time hint); it no-ops when `CI` is set (`plugins/foundry/hooks/pre-commit`).
- Git pre-push (installed by hand per its header) runs `mise run gate` when `mise` and `mise.toml` exist and aborts the push with exit 1 on failure (`plugins/foundry/hooks/pre-push`).
- The Stop hooks that read the payload return early when `stop_hook_active` is true (`plugins/foundry/hooks/habit-hooks-guard.sh`, `plugins/foundry/hooks/typecheck-stop.sh`, `plugins/foundry/hooks/format-java-stop.sh`, `plugins/foundry/hooks/jev-toolcall-triage.sh`); `plugins/foundry/hooks/leash.sh` deliberately has no such guard.
- Each Stop and Leash hook `cd`s to the payload's `cwd`, converted with `cygpath -u` where available (`plugins/foundry/hooks/habit-hooks-guard.sh`, `plugins/foundry/hooks/leash.sh`).

## Owned entities
- `$CLAUDE_PLUGIN_DATA/.installed.json`: a copy of the `package.json` the installed dependency tree was built from, written only after `npm ci` succeeds; used as the reinstall marker (`plugins/foundry/hooks/mcp-deps.sh`).
- The `.claude/worktrees/` line appended to the repo's `<git-common-dir>/info/exclude` when that directory exists and is not ignored (`plugins/foundry/hooks/habit-hooks-guard.sh`).

## Happy paths
### A raw `gh pr create` from the agent is denied
1. Entrypoint: Claude Code fires PreToolUse for a Bash call; the `Bash` matcher runs `guard-pr-create.sh` with a 10s timeout (`plugins/foundry/hooks/hooks.json`).
2. The script reads the JSON payload from stdin, extracts `tool_name` with sed, and exits 0 for anything but `Bash` (`plugins/foundry/hooks/guard-pr-create.sh`).
3. It extracts only the `command` string (not the description) with an ERE sed, and folds JSON `\n`, `\r`, `\t` escapes to spaces so a later line in a multi-line command is still word-bounded (`plugins/foundry/hooks/guard-pr-create.sh`).
4. It matches `gh pr create` as consecutive whole words, allowing a chain or env/flag prefix before and rejecting `createx`; no match exits 0 (`plugins/foundry/hooks/guard-pr-create.sh`).
5. Side effect: it resolves the absolute path of `plugins/foundry/scripts/foundry-ship-pr`, prints a message to stderr directing the agent to `/foundry:ship` or that script, and exits 2 (`plugins/foundry/hooks/guard-pr-create.sh`).

### An edited file is auto-formatted
1. Entrypoint: PostToolUse after Edit, Write or MultiEdit runs `auto-format.sh` with a 30s timeout (`plugins/foundry/hooks/hooks.json`).
2. The script extracts `file_path` from the payload, unescapes backslashes, and on Windows derives a POSIX path for tests and a `C:/` path for node tools via `cygpath`; a missing file exits 0 (`plugins/foundry/hooks/auto-format.sh`).
3. Only web and doc extensions continue (ts, tsx, js, jsx, mjs, cjs, json, jsonc, css, scss, less, html, vue, svelte, md, mdx, yaml, yml, graphql); Java and Kotlin are left to the Stop hook (`plugins/foundry/hooks/auto-format.sh`, `plugins/foundry/hooks/format-java-stop.sh`).
4. It walks up from the file's directory to the nearest `node_modules/.bin`; none exits 0 (`plugins/foundry/hooks/auto-format.sh`).
5. If prettier is there, it runs `prettier --find-config-path`; when that fails it prints a `hookSpecificOutput.additionalContext` JSON hint naming `scripts/prettier-config.mjs` on stdout and exits 0 without formatting (`plugins/foundry/hooks/auto-format.sh`).
6. Side effect: otherwise `prettier --write` rewrites the file in place; with no prettier but an eslint, `eslint --fix` runs instead. Both go through `plugins/foundry/hooks/auto-format.sh#run_tool`, which picks the unix shim, the `.cmd`, or `sh <bin>`. Always exits 0.

### The agent's Stop is gated on structural smells
1. Entrypoint: Stop runs `habit-hooks-guard.sh` first among five Stop commands, with a 120s timeout (`plugins/foundry/hooks/hooks.json`).
2. It exits 0 when `stop_hook_active` is true, `cd`s to the payload `cwd`, and prepends `~/.local/bin` and `~/.local/opt/pmd-bin-*/bin` to PATH (`plugins/foundry/hooks/habit-hooks-guard.sh`).
3. It collects `.` and each immediate subdirectory containing `.habit-hooks/`; none exits 0 silently (`plugins/foundry/hooks/habit-hooks-guard.sh`).
4. It appends `.claude/worktrees/` to `info/exclude` when needed (`plugins/foundry/hooks/habit-hooks-guard.sh`).
5. For each package, `plugins/foundry/hooks/habit-hooks-guard.sh#hh_for` picks the binary: when the package's `mise.toml` mentions `HABIT_HOOKS_VERSION`, it reads `HABIT_HOOKS_PLUGIN-HABIT_HOOKS_VERSION` through `mise exec` and uses `~/.local/opt/<pin>/bin/habit-hooks` (or `Scripts/habit-hooks.exe`), else `habit-hooks` from PATH. When none is usable it prints a WARNING to stderr and that package is skipped, not failed.
6. It runs `habit-hooks --branch` inside the package, adding the pinned binary's own directory to PATH only for an absolute-path binary. A non-zero exit in a package with `package.json` but no `node_modules` replaces the output with an install hint (`plugins/foundry/hooks/habit-hooks-guard.sh`).
7. Side effect: if any package failed, it writes the per-package report and the smell legend to stderr and exits 2, blocking the stop; otherwise exits 0 (`plugins/foundry/hooks/habit-hooks-guard.sh`).

## Unknowns
- How does Claude Code locate `plugins/foundry/hooks/hooks.json`? There is no plugin manifest under `plugins/foundry/`; is it found by the default `hooks/hooks.json` convention via the marketplace entry in `.claude-plugin/marketplace.json`?
- Does Claude Code run the five Stop commands sequentially in listed order or in parallel, and how are multiple exit-2 results combined? Not determined by code in this slice.
- What exactly does `plugins/foundry/scripts/jev/toolcall.mjs` send to Jev and print? It is outside this slice.
- What does the external `leash` CLI do for `snapshot`, `hook` and `session`, and what does its stdout decision look like? Not in this repo.
- Which task installs the pinned habit-hooks under `~/.local/opt/<plugin>-<version>/`? The script names `setup:habit-hooks`, which is not defined in this slice.
- Are `pre-commit` and `pre-push` ever installed automatically (for example by `foundry-init.sh`), or only by the manual `cp` / `core.hooksPath` steps in their headers?
- How does the MCP server pick between `CLAUDE_PLUGIN_ROOT/node_modules` and `CLAUDE_PLUGIN_DATA/node_modules` at start? `plugins/foundry/.mcp.json` is outside this slice.
