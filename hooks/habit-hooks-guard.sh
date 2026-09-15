#!/usr/bin/env bash
# Foundry — in-loop habit check (Stop hook). Portable sh. Runs habit-hooks when the
# agent is about to finish, in every package that opted in with a .habit-hooks/
# directory — the repo root AND each immediate subdir, so a monorepo's backend/ and
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

# Make locally-installed tools discoverable — a hook's PATH often lacks these:
# habit-hooks (uv/pip user install) and the standalone PMD the Java sensor needs.
# We RUN the check locally rather than skip it; the whole point is CI mirrored here.
for d in "$HOME/.local/bin" "$HOME"/.local/opt/pmd-bin-*/bin; do
  [ -d "$d" ] && case ":$PATH:" in *":$d:"*) ;; *) PATH="$d:$PATH" ;; esac
done
export PATH

command -v habit-hooks >/dev/null 2>&1 || exit 0

# Package dirs with a .habit-hooks/: the root, plus one level down (backend/, frontend/).
dirs=""
[ -d .habit-hooks ] && dirs="."
for d in */; do [ -d "${d}.habit-hooks" ] && dirs="$dirs ${d%/}"; done
[ -n "$dirs" ] || exit 0

fail=0; report=""
for d in $dirs; do
  out=$(cd "$d" && habit-hooks --branch 2>&1); rc=$?
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
abstraction (a value object, a strategy, a named step) — never by splitting to a
line count, and never with a change designed only to appease the tool.
  oversized-function   too long to hold one idea       -> extract a named step / collaborator
  oversized-file       too many responsibilities        -> split by concern into cohesive units
  high-complexity      too many branches = too many     -> polymorphism/strategy; lift guard clauses; early returns
                       decisions in one place
  too-many-parameters  juggles too many collaborators   -> a parameter object, or split the responsibility
  deep-nesting         a nested block wants a name       -> extract it; use early returns
  duplication          same logic in two places          -> extract one shared function
  dead-code            nothing references it             -> delete it
Clearing a smell is necessary, not sufficient — "is this one thing?" is still your
call. Fix it (or, if it's genuinely warranted, say why) before finishing.
LEGEND
} >&2
exit 2
