#!/usr/bin/env bash
# Foundry - per-turn Jev tool-call risk triage (Stop hook). Portable sh. Advisory and
# WARN-ONLY: asks Jev whether the turn looked destructive or irreversible and prints a
# warning, but NEVER blocks (it never exit-2s - Jev is a proposer, not the oracle).
# Opt-in by JEV_API_KEY + node; silent no-op otherwise, so it is safe to install globally.
set -u

payload=$(cat)
# Avoid a stop-hook loop.
printf '%s' "$payload" | grep -q '"stop_hook_active"[[:space:]]*:[[:space:]]*true' && exit 0

# Opt-in by tooling: no key or no node means silent no-op.
[ -n "${JEV_API_KEY:-}" ] || exit 0
command -v node >/dev/null 2>&1 || exit 0

# cd to the session cwd if provided (normalize a Windows path for git-bash), like the
# other Stop hooks so the diff is taken in the right repo.
cwd=$(printf '%s' "$payload" | sed -n 's/.*"cwd"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1 | sed 's/\\\\/\\/g')
if [ -n "$cwd" ]; then
  command -v cygpath >/dev/null 2>&1 && cwd=$(cygpath -u "$cwd" 2>/dev/null || printf '%s' "$cwd")
  cd "$cwd" 2>/dev/null || true
fi

# Resolve the vendored scripts: the plugin root when plugin-managed, else relative to
# this hook (works when run from the repo). If it cannot be found, no-op silently.
root="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." 2>/dev/null && pwd)}"
triage="$root/scripts/jev/toolcall.mjs"
[ -f "$triage" ] || exit 0

# The triage warns on stderr and always exits 0; it never blocks. Wrap in `|| true`
# so a Jev/network hiccup can never break the session.
printf '%s' "$payload" | node "$triage" || true
exit 0
