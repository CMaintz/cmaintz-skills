#!/usr/bin/env bash
# Foundry - in-loop habit check (Stop hook). Portable sh. Runs habit-hooks when the
# agent is about to finish, in every package that opted in with a .habit-hooks/
# directory - the repo root AND each immediate subdir, so a monorepo's backend/ and
# frontend/ are both checked (not just the cwd). Silent where nothing opted in, so
# it's safe to install globally. Scope is --branch (the changeset).
set -u

payload=$(cat)
# Avoid a stop-hook loop.
printf '%s' "$payload" | grep -q '"stop_hook_active"[[:space:]]*:[[:space:]]*true' && exit 0

# cd to the session cwd if provided (normalize a Windows path for git-bash).
cwd=$(printf '%s' "$payload" | sed -n 's/.*"cwd"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1 | sed 's/\\\\/\\/g')
if [ -n "$cwd" ]; then
  command -v cygpath >/dev/null 2>&1 && cwd=$(cygpath -u "$cwd" 2>/dev/null || printf '%s' "$cwd")
  cd "$cwd" 2>/dev/null || true
fi

# Make locally-installed tools discoverable - a hook's PATH often lacks these:
# habit-hooks (uv/pip user install) and the standalone PMD the Java sensor needs.
# We RUN the check locally rather than skip it; the whole point is CI mirrored here.
for d in "$HOME/.local/bin" "$HOME"/.local/opt/pmd-bin-*/bin; do
  [ -d "$d" ] && case ":$PATH:" in *":$d:"*) ;; *) PATH="$d:$PATH" ;; esac
done
export PATH

# Package dirs with a .habit-hooks/: the root, plus one level down (backend/, frontend/).
dirs=""
[ -d .habit-hooks ] && dirs="."
for d in */; do [ -d "${d}.habit-hooks" ] && dirs="$dirs ${d%/}"; done
[ -n "$dirs" ] || exit 0   # nothing opted in here - silent, safe to install globally

# Claude Code's EnterWorktree puts full repo copies under .claude/worktrees/. Unignored,
# --branch counts them as untracked branch files and reports every file as duplicated.
# Exclude them clone-locally: info/exclude is never committed, and although all worktrees
# share it, the pattern is anchored to each one's own root so its own files stay checked.
# foundry-init gitignores the path; this covers repos onboarded before it did.
if [ -d .claude/worktrees ] && ! git check-ignore -q .claude/worktrees 2>/dev/null; then
  gd=$(git rev-parse --git-common-dir 2>/dev/null) && mkdir -p "$gd/info" &&
    printf '\n%s\n' '.claude/worktrees/' >> "$gd/info/exclude"
fi

# The habit-hooks a package's mise.toml pins (HABIT_HOOKS_PLUGIN/VERSION, installed by
# setup:habit-hooks), so this runs the same version as gate and CI. A bare habit-hooks is
# whatever PATH finds first, often an older global pip install in ~/.local/bin above.
hh_for() {
  pin=""
  if command -v mise >/dev/null 2>&1 && [ -f "$1/mise.toml" ]; then
    # printenv prints one value per line and fails if either is unset.
    pin=$(cd "$1" && mise exec -- printenv HABIT_HOOKS_PLUGIN HABIT_HOOKS_VERSION 2>/dev/null | paste -sd- -) || pin=""
  fi
  if [ -n "$pin" ]; then
    for c in "$HOME/.local/opt/$pin/bin/habit-hooks" "$HOME/.local/opt/$pin/Scripts/habit-hooks.exe"; do
      [ -x "$c" ] && { printf '%s\n' "$c"; return; }
    done
  fi
  printf '%s\n' habit-hooks
}

fail=0; report=""
for d in $dirs; do
  hh=$(hh_for "$d")
  # A repo opted in (has .habit-hooks/) but the tool isn't installed: DON'T fail green
  # silently - that's the exact trap this system exists to avoid. Warn loudly (non-
  # blocking) with how to fix, then allow the stop; we can't run the check from here.
  if [ "$hh" = habit-hooks ] && ! command -v habit-hooks >/dev/null 2>&1; then
    printf '%s\n' "habit-hooks-guard: WARNING - this repo has .habit-hooks/ but 'habit-hooks' is not on PATH, so the in-loop structural-smell check did NOT run (CI still enforces it). Install it so local mirrors CI: pip install --user habit-hooks <lang-plugin> (+ standalone PMD for Java), or add its bin dir to PATH." >&2
    exit 0
  fi
  out=$(cd "$d" && "$hh" --branch 2>&1); rc=$?
  # A JS package never installed here (fresh clone or worktree): its sensors report
  # eslint/knip/ts-morph as "not installed", which nudges the agent into
  # `npm install --save-dev <tool>`. The deps are declared, just not installed.
  if [ "$rc" -ne 0 ] && [ -f "$d/package.json" ] && [ ! -d "$d/node_modules" ]; then
    out="${d}/node_modules is missing, so the habit sensors couldn't run. Install what
package.json already declares (\`mise install\` if the repo provisions it, else
\`npm ci\` in ${d}) and finish again. Don't add or change dependencies for this."
  fi
  if [ "$rc" -ne 0 ]; then
    fail=1
    report="${report}
=== ${d} ===
${out}"
  fi
done
[ "$fail" -eq 0 ] && exit 0

# Exit 2 blocks the stop and feeds the findings back to the agent as coaching.
# habit-hooks names the smell + file:line; append a concrete "fix toward" legend so
# the agent acts on it (mirrors the CI step-summary explainer) instead of guessing.
{
  printf '%s\n' "$report"
  cat <<'LEGEND'

── how to act on these smells ──
Each smell is a shadow of code doing more than one thing. Fix toward the missing
abstraction (a value object, a strategy, a named step) - never by splitting to a
line count, and never with a change designed only to appease the tool.
  oversized-function   too long to hold one idea       -> extract a named step / collaborator
  oversized-file       too many responsibilities        -> split by concern into cohesive units
  high-complexity      too many branches = too many     -> polymorphism/strategy; lift guard clauses; early returns
                       decisions in one place
  too-many-parameters  juggles too many collaborators   -> a parameter object, or split the responsibility
  deep-nesting         a nested block wants a name       -> extract it; use early returns
  duplication          same logic in two places          -> extract one shared function
  dead-code            nothing references it             -> delete it
Clearing a smell is necessary, not sufficient - "is this one thing?" is still your
call. Fix it (or, if it's genuinely warranted, say why) before finishing.
LEGEND
} >&2
exit 2
