# cmaintz-skills

The agent half of [Foundry](https://github.com/CMaintz/foundry): skills and hooks that turn a deterministic engineering gate into a set of habits an agent actually keeps.

The CI half lives in **[foundry](https://github.com/CMaintz/foundry)**. The seam between them is [CONTRACT.md](./CONTRACT.md), copied verbatim into both.

## Install

```
/plugin marketplace add CMaintz/cmaintz-skills
/plugin install foundry@cmaintz
```

Skills are then invoked namespaced by the plugin: `/foundry:ship`, `/foundry:review`,
`/foundry:repo-align`, `/foundry:foundry-secret`.

## Why hooks and not documentation

A habit you have to *remember* is not a habit. Prose in `CLAUDE.md` is advisory and decays as context fills; a hook is enforcement. Three mechanisms, and picking the wrong one is why most "AI coding standards" documents get ignored:

| Layer | Mechanism | Character |
|---|---|---|
| **Reflex** | hooks (habit-hooks, pre-commit) | involuntary, fires unbidden |
| **Practice** | skills | invoked, procedural, has judgement |
| **Standing context** | `AGENTS.md`, `CONTEXT.md` | ambient, shared vocabulary |

`AGENTS.md` is canonical; `CLAUDE.md` is a one-line include of it. That keeps Codex, Gemini and Cursor working from the same source.

## Contents

### `ship`
Pre-PR review, run locally. Auto-fix → habit-hooks coaching → **green gate** → fresh-context review against the linked issue → conventional commit → PR. Moves review left of the PR entirely, which is also what keeps CI free of API keys.

> **The hooks are portable `sh`** (invoked via `bash`), so they run on Linux, macOS and Windows git-bash alike — no PowerShell, and none of its encoding/quoting quirks.

### `hooks/habit-hooks-guard.sh`
A `Stop` hook that runs [habit-hooks](https://github.com/habit-hooks/habit-hooks) before an agent declares work done — but only in repos that opted in with a `.habit-hooks/` directory, so it is silent everywhere else and safe to install globally.

It is a `Stop` hook rather than `PostToolUse` deliberately: habit-hooks costs ~25s cold (~6s warm), far too slow to fire after every edit. It also matches habit-hooks' own guidance — *"run it before considering work complete."*

### `hooks/auto-format.sh`
A `PostToolUse` hook (matches `Edit|Write|MultiEdit`) that formats the single file just written, so formatting is fixed **left of CI** — the gate's format check then almost never fails and the agent never burns a round-trip on a whitespace nit. It runs `prettier --write` on the one file (falling back to `eslint --fix`), sub-second.

Unlike habit-hooks-guard this *is* a `PostToolUse` hook, and that's the point: a single-file `prettier` run is cheap enough to fire on every edit, whereas whole-project formatters aren't. It opts in **by tooling** — it only acts when the file's project has a local `prettier`/`eslint`, so it's a silent no-op elsewhere and safe to install globally. **Java/Kotlin aren't formatted here** — Gradle's JVM startup is too slow to fire per-edit — but they aren't skipped either: see `format-java-stop.sh` below, which formats them once per turn at the right cadence.

Register it in `~/.claude/settings.json` (copy the script to `~/.claude/hooks/` first). Use forward slashes in the path — git-bash's `bash` won't open a backslash path:

```json
"hooks": {
  "PostToolUse": [
    {
      "matcher": "Edit|Write|MultiEdit",
      "hooks": [
        {
          "type": "command",
          "command": "bash",
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
A `Stop` hook that runs `./gradlew spotlessApply` once when a turn finishes, but only if the turn touched `.java` and the build actually uses Spotless. It's the Java counterpart to `auto-format.sh` — **the placement differs because the cost does**: a per-edit `prettier` run is sub-second, but Gradle's JVM startup is seconds, so firing Spotless on every keystroke would dominate wall-clock. Once-per-turn is the right cadence for a JVM formatter, and Spotless's `ratchetFrom origin/main` scopes the rewrite to changed files so nothing untouched is reformatted. Same config as the CI Spotless check — just applied before the PR instead of at it. Register it as a second `Stop` hook alongside `habit-hooks-guard.sh` (order-independent; format exits 0, the habit check may exit 2 to coach).

### `hooks/typecheck-stop.sh`
A `Stop` hook that runs `mise run typecheck` once per turn — but only when the turn touched source and the repo defines an **exact top-level** `typecheck` task (monorepos namespace theirs, so it cleanly no-ops there) — and `exit 2`s with the errors as coaching if it fails; infrastructure failures never block. It catches **type errors a turn before `/ship` would**, closing the in-loop feedback gap habit-hooks-guard (smells only) leaves open. Heavier than the per-edit formatters (it's tsc / gradle compile / mypy over the project), so it's a deliberate opt-in for people who want the type check mirrored locally; skip it if the per-turn latency isn't worth it on a slow Gradle build.

### `hooks/pre-push`
A native **git** `pre-push` hook (POSIX sh, not a Claude hook) that runs `mise run gate` before a push and aborts on failure — so a plain `git push` by a human gets the same gate the agent's `/ship` enforces. No-op where there's no `mise.toml`. Install with `cp hooks/pre-push .git/hooks/pre-push && chmod +x .git/hooks/pre-push` (or version it via `core.hooksPath`); bypass once with `git push --no-verify`.

### `hooks/guard-generated-files.sh`
A `PreToolUse` hook (matches `Edit|Write|MultiEdit`) that **hard-blocks** an agent from hand-editing tool-generated baselines — `snooze.json` and `eslint-suppressions.json` — with `exit 2` and a message pointing at the real path (regenerate via bootstrap `habit-snooze --prune` / `mise run fix`). This is *enforcement over recall*: the repo-align skill *says* not to hand-edit these, but a skill is advisory and decays with context; a PreToolUse block is involuntary. Fires only on the agent's own edits — CI/bootstrap regenerate these outside the agent's tools.

## Standing on shoulders

This repo is deliberately thin, because most of the practice layer is already written by people who did it better. Install these alongside it:

| Source | Licence | What it gives you |
|---|---|---|
| [mattpocock/skills](https://github.com/mattpocock/skills) | MIT | Breadth of practice: `tdd`, `diagnosing-bugs`, `research`, `code-review`, `codebase-design`, `domain-modeling`, `to-spec`, `to-tickets`, `triage` |
| [devill/ivetts-skills](https://github.com/devill/ivetts-skills) | MIT | The flywheel: `learn`, `build-project-review`, `hotspot-rec` |
| [habit-hooks](https://github.com/habit-hooks/habit-hooks) | see repo | The reflex layer, and the tool-independent smell vocabulary this whole design borrows |

They are installed as plugins, not vendored, so upstream fixes flow automatically and the attribution stays where it belongs.

## Reviewing: one entry point

Installing these plugins leaves several things called some flavour of "code review". Rather than juggle them, `cmaintz-skills:review` is the **single entry point** — it runs three fresh-context lenses itself and folds in the others:

| Piece | Role | How `review` uses it |
|---|---|---|
| **`cmaintz-skills:review`** | the one you invoke: correctness + standards + spec, in parallel fresh sub-agents | — |
| a repo-local skill from **`build-project-review`** | encodes *this* project's maintainers' preferences | loaded into the Standards lens if present |
| **`mattpocock-skills:code-review`** | the Standards+Spec shape `review` is modelled on | reference; not called directly |
| built-in **`/code-review`** | fast on-demand bug + cleanup pass, with `--fix` | stays your manual by-hand tool |

`ship` step 4 calls `review`. The built-in `/code-review` stays your manual bug hunt. Everything namespaces as `plugin:skill`, so nothing clashes.

## The flywheel: `learn`

Ivett's `learn` is the load-bearing skill in this whole setup. It reflects on a session and routes each learning to the store that will actually *enforce* it, in priority order:

1. **a deterministic hook** (habit-hooks / a check) — enforcement, not memory
2. **`AGENTS.md` / `CLAUDE.md`** — standing context
3. **a new skill** — a reusable procedure
4. **auto-memory** — last resort

That ordering *is* this project's thesis expressed as a skill: prefer the placement that makes a mistake impossible over the one that just reminds you not to make it. Run it (`/learn`, or "what did we learn?") before saving anything to memory — a lesson that could be a hook shouldn't decay into a note. It's how borrowed habits gradually become your own, and how a one-off fix in this session becomes a rule the next one can't skip.

## Licence

MIT. The skills listed above are separate works under their own licences and are not redistributed here.
