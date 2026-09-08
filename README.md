# cmaintz-skills

The agent half of [Foundry](https://github.com/CMaintz/foundry): skills and hooks that turn a deterministic engineering gate into a set of habits an agent actually keeps.

The CI half lives in **[foundry](https://github.com/CMaintz/foundry)**. The seam between them is [CONTRACT.md](./CONTRACT.md), copied verbatim into both.

## Install

```
/plugin marketplace add CMaintz/cmaintz-skills
/plugin install foundry-skills@cmaintz
```

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

### `hooks/habit-hooks-guard.ps1`
A `Stop` hook that runs [habit-hooks](https://github.com/habit-hooks/habit-hooks) before an agent declares work done — but only in repos that opted in with a `.habit-hooks/` directory, so it is silent everywhere else and safe to install globally.

It is a `Stop` hook rather than `PostToolUse` deliberately: habit-hooks costs ~25s cold (~6s warm), far too slow to fire after every edit. It also matches habit-hooks' own guidance — *"run it before considering work complete."*

## Standing on shoulders

This repo is deliberately thin, because most of the practice layer is already written by people who did it better. Install these alongside it:

| Source | Licence | What it gives you |
|---|---|---|
| [mattpocock/skills](https://github.com/mattpocock/skills) | MIT | Breadth of practice: `tdd`, `diagnosing-bugs`, `research`, `code-review`, `codebase-design`, `domain-modeling`, `to-spec`, `to-tickets`, `triage` |
| [devill/ivetts-skills](https://github.com/devill/ivetts-skills) | MIT | The flywheel: `learn`, `build-project-review`, `hotspot-rec` |
| [habit-hooks](https://github.com/habit-hooks/habit-hooks) | see repo | The reflex layer, and the tool-independent smell vocabulary this whole design borrows |

They are installed as plugins, not vendored, so upstream fixes flow automatically and the attribution stays where it belongs.

Ivett's `learn` is the load-bearing one: it routes a session learning to *a deterministic hook first*, `CLAUDE.md` second, a new skill third. That ordering is this project's entire thesis expressed as a skill, and it's how borrowed habits gradually become your own.

## Licence

MIT. The skills listed above are separate works under their own licences and are not redistributed here.
