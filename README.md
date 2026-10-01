# cmaintz-skills

The agent half of [Foundry](https://github.com/CMaintz/foundry): skills and hooks that turn a deterministic engineering gate into habits an agent actually keeps.

![reflex hooks format + coach as an agent edits, then /foundry:ship drives the gate to a PR](docs/demo.svg)

The CI half lives in [foundry](https://github.com/CMaintz/foundry). The seam between them is [CONTRACT.md](./CONTRACT.md), copied verbatim into both.

## Install

```
/plugin marketplace add CMaintz/cmaintz-skills
/plugin install foundry@cmaintz
```

The skills are namespaced by the plugin: `/foundry:ship`, `/foundry:review`, `/foundry:feature`,
`/foundry:spec`, `/foundry:repo-align`, `/foundry:loop-report` and `/foundry:foundry-secret`.

## Why hooks and not documentation

A habit you have to *remember* isn't a habit. Prose in `CLAUDE.md` is advisory and fades as the context fills up; a hook is enforcement. There are three mechanisms, and picking the wrong one is why most "AI coding standards" documents get ignored:

| Layer | Mechanism | Character |
|---|---|---|
| Reflex | hooks (habit-hooks, pre-commit) | involuntary, fires on its own |
| Practice | skills | invoked, procedural, uses judgement |
| Standing context | `AGENTS.md`, `CONTEXT.md` | ambient, shared vocabulary |

`AGENTS.md` is the canonical file and `CLAUDE.md` is a one-line include of it, so Codex, Gemini and Cursor all work from the same source.

## Skills

- `ship`: pre-PR review, run locally. Auto-fix, habit-hooks coaching, a green gate, a fresh-context review against the linked issue, a conventional commit, then the PR. Review happens before the PR exists, which is also what keeps CI free of API keys.
- `review`: one reviewer instead of three. Correctness, standards and spec lenses in parallel fresh sub-agents, scaled to the size of the change (more below).
- `spec`: turns a rough idea into a testable spec through a short back-and-forth, then files it as an `agent:ready` issue.
- `feature`: claims a ready ticket, implements it in its own worktree, loops against `mise run gate` until green, checks the acceptance criteria, and hands off to `ship`.
- `repo-align`: pays down formatting and structural-smell debt across a repo, one small PR at a time.
- `loop-report`: reads Foundry's verb telemetry to show where the gate spends time and whether the loop is converging or thrashing. Read-only.
- `foundry-secret`: triages a gitleaks finding, either allowlisting a confirmed false positive or walking through rotate-then-purge for a real leak.

## Hooks

All the hooks are portable `sh` run through `bash`, so they work on Linux, macOS and Windows git-bash alike. No PowerShell, and none of its encoding and quoting quirks.

### `hooks/habit-hooks-guard.sh`
A `Stop` hook that runs [habit-hooks](https://github.com/habit-hooks/habit-hooks) before an agent declares the work done. It only acts in repos that opted in with a `.habit-hooks/` directory, so it's silent everywhere else and safe to install globally.

It's a `Stop` hook rather than `PostToolUse` on purpose: habit-hooks takes ~25s cold (~6s warm), far too slow to run after every edit. That also matches habit-hooks' own advice to *"run it before considering work complete."*

### `hooks/auto-format.sh`
A `PostToolUse` hook (matching `Edit|Write|MultiEdit`) that formats the one file just written, so formatting is sorted before CI ever sees it. The gate's format check then almost never fails and the agent doesn't burn a round-trip on a whitespace nit. It runs `prettier --write` on that file (falling back to `eslint --fix`) and is sub-second.

Unlike habit-hooks-guard this one *is* `PostToolUse`, and that's the point: a single-file `prettier` run is cheap enough for every edit, whole-project formatters aren't. It only acts when the file's project has a local `prettier` or `eslint`, so elsewhere it's a silent no-op and safe to install globally. Java and Kotlin aren't formatted here because Gradle's JVM startup is too slow per edit; `format-java-stop.sh` below handles them once per turn instead.

Register it in `~/.claude/settings.json` (copy the script to `~/.claude/hooks/` first). On Windows, point `command` at git-bash's bash by full path. A bare `"bash"` resolves to WSL's `System32\bash.exe`, which fails with `execvpe(/bin/bash)`. Use forward slashes in the script argument, since git-bash won't open a backslash path:

```json
"hooks": {
  "PostToolUse": [
    {
      "matcher": "Edit|Write|MultiEdit",
      "hooks": [
        {
          "type": "command",
          "command": "C:\\Program Files\\Git\\bin\\bash.exe",
          "args": ["C:/Users/<you>/.claude/hooks/auto-format.sh"],
          "timeout": 30,
          "statusMessage": "Formatting..."
        }
      ]
    }
  ]
}
```

### `hooks/format-java-stop.sh`
A `Stop` hook that runs `./gradlew spotlessApply` once when a turn finishes, but only if the turn touched `.java` files and the build actually uses Spotless. It's the Java counterpart to `auto-format.sh`, placed differently because the cost is different: a `prettier` run is sub-second, Gradle's JVM startup takes seconds. Once per turn is the right cadence for a JVM formatter, and Spotless's `ratchetFrom origin/main` limits the rewrite to changed files so nothing untouched gets reformatted. It's the same config as the CI Spotless check, just applied before the PR instead of on it. Register it as a second `Stop` hook next to `habit-hooks-guard.sh`; order doesn't matter (the formatter exits 0, the habit check may exit 2 to coach).

### `hooks/typecheck-stop.sh`
A `Stop` hook that runs `mise run typecheck` once per turn, but only when the turn touched source and the repo has an exact top-level `typecheck` task (monorepos namespace theirs, so it cleanly does nothing there). If the check fails it exits 2 with the errors as coaching; infrastructure failures never block. It catches type errors a turn before `/ship` would, which closes the gap habit-hooks-guard leaves (it only checks smells). It's heavier than the per-edit formatters (tsc, a Gradle compile or mypy over the whole project), so it's opt-in. Skip it if the per-turn wait isn't worth it on a slow Gradle build.

### `hooks/pre-push`
A plain git `pre-push` hook (POSIX sh, not a Claude hook) that runs `mise run gate` before a push and aborts if it fails. That way a human doing `git push` gets the same gate the agent's `/ship` enforces. It does nothing where there's no `mise.toml`. Install with `cp hooks/pre-push .git/hooks/pre-push && chmod +x .git/hooks/pre-push` (or version it via `core.hooksPath`), and skip it once with `git push --no-verify`.

### `hooks/guard-generated-files.sh`
A `PreToolUse` hook (matching `Edit|Write|MultiEdit`) that blocks an agent from hand-editing tool-generated baselines (`snooze.json` and `eslint-suppressions.json`). It exits 2 with a message pointing at the right way to regenerate them (bootstrap's `habit-snooze --prune`, or `mise run fix`). The repo-align skill already *says* not to hand-edit these, but a skill is advisory and fades with context; a `PreToolUse` block isn't. It only fires on the agent's own edits, since CI and bootstrap regenerate these files outside the agent's tools.

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

## The flywheel: `learn`

Ivett's `learn` is the skill the whole setup leans on most. It reflects on a session and routes each lesson to the place that will actually *enforce* it, in this order:

1. a deterministic hook (habit-hooks or a check): enforcement, not memory
2. `AGENTS.md` / `CLAUDE.md`: standing context
3. a new skill: a reusable procedure
4. auto-memory: last resort

That ordering is basically this project's thesis written as a skill: prefer the placement that makes a mistake impossible over the one that just reminds you not to make it. Run it (`/learn`, or "what did we learn?") before saving anything to memory, because a lesson that could be a hook shouldn't fade into a note. It's how borrowed habits gradually become your own, and how a one-off fix in this session becomes a rule the next session can't skip.

## Licence

MIT. The skills listed above are separate works under their own licences and aren't redistributed here.
