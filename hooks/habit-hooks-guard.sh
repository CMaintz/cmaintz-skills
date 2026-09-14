#!/usr/bin/env bash
# Foundry — in-loop habit check (Stop hook). Portable sh. Runs habit-hooks when the
# agent is about to finish, but only in repos that opted in with a .habit-hooks/
# directory, so it's silent and near-zero cost elsewhere — safe to install globally.
# Scope is --branch (the changeset), which is the right scope for an in-loop check.
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

[ -d .habit-hooks ] || exit 0
command -v habit-hooks >/dev/null 2>&1 || exit 0

out=$(habit-hooks --branch 2>&1); rc=$?
[ "$rc" -eq 0 ] && exit 0

# Exit 2 blocks the stop and feeds stderr back to the agent as coaching.
printf '%s\n' "$out" >&2
exit 2
