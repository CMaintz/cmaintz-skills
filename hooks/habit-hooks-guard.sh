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
printf '%s\n' "$report" >&2
exit 2
