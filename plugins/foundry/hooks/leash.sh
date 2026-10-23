#!/usr/bin/env bash
# Foundry adapter for Leash (@cmaintz/leash): runs one Leash turn hook so Foundry drives
# Leash instead of Leash installing its own hooks (`leash init` sees this script and
# stays out, so a repo is never double-hooked). Advisory: always exits 0.
#
# Register it three times with the Leash subcommand as the argument:
#   UserPromptSubmit -> leash.sh snapshot   (timeout 30)
#   Stop             -> leash.sh hook       (timeout 90)
#   SessionStart     -> leash.sh session    (timeout 30)
#
# Opt-in: OFF unless LEASH_ENABLED is truthy (set it in the repo's mise [env]), and a
# silent no-op without the `leash` CLI on PATH. Leash finds its own key (env, .env,
# ~/.leash/.env) and fails open without one, so no key check here.
set -u

case "${1:-}" in
  snapshot | hook | session) : ;;
  *) exit 0 ;;
esac

case "${LEASH_ENABLED:-}" in
  1 | true | yes | on) : ;;
  *) exit 0 ;;
esac

command -v leash >/dev/null 2>&1 || exit 0

payload=$(cat)

# cd to the session cwd if provided (normalize a Windows path for git-bash), like the
# other Stop hooks so Leash reads the right repo.
cwd=$(printf '%s' "$payload" | sed -n 's/.*"cwd"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1 | sed 's/\\\\/\\/g')
if [ -n "$cwd" ]; then
  command -v cygpath >/dev/null 2>&1 && cwd=$(cygpath -u "$cwd" 2>/dev/null || printf '%s' "$cwd")
  cd "$cwd" 2>/dev/null || true
fi

# No stop_hook_active guard: Leash re-checks continuations on purpose (that is how a
# repair gets verified) and never blocks the same finding twice, so it cannot loop.
# Its stdout is the hook's decision/context, so it passes through untouched.
printf '%s' "$payload" | leash "$1" || true
exit 0
