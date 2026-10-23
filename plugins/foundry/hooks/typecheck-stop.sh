#!/usr/bin/env bash
# Foundry — in-loop typecheck reflex (Stop hook). Portable sh. Runs `mise run
# typecheck` once per turn, only when the turn touched source AND the repo defines
# an exact TOP-LEVEL `typecheck` task (monorepos namespace theirs, so it no-ops
# there instead of running a task that doesn't exist). exit 2 coaches on real type
# errors; infrastructure failures never block.
set -u

payload=$(cat)
printf '%s' "$payload" | grep -q '"stop_hook_active"[[:space:]]*:[[:space:]]*true' && exit 0

cwd=$(printf '%s' "$payload" | sed -n 's/.*"cwd"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1 | sed 's/\\\\/\\/g')
if [ -n "$cwd" ]; then
  command -v cygpath >/dev/null 2>&1 && cwd=$(cygpath -u "$cwd" 2>/dev/null || printf '%s' "$cwd")
  cd "$cwd" 2>/dev/null || true
fi

command -v mise >/dev/null 2>&1 || exit 0
[ -f mise.toml ] || exit 0
# Exact top-level `typecheck` task (first column of `mise tasks ls`), not a substring.
mise tasks ls 2>/dev/null | awk '{print $1}' | grep -qx 'typecheck' || exit 0

# Gradle typecheck is a JVM compile — too slow to run every turn. Skip in-loop for
# Gradle projects and let /ship + CI cover it; the hook stays worthwhile for fast
# toolchains (tsc, mypy). Without this, a monorepo runs the full compile at every Stop.
[ -f ./gradlew ] && exit 0

changed=$( { git diff --name-only HEAD 2>/dev/null; \
             git ls-files --others --exclude-standard 2>/dev/null; \
             mb=$(git merge-base HEAD origin/main 2>/dev/null); \
             [ -n "$mb" ] && git diff --name-only "$mb" HEAD 2>/dev/null; } )
printf '%s\n' "$changed" | grep -qE '\.(ts|tsx|js|jsx|java|kt|kts|cs|py|php)$' || exit 0

out=$(mise run typecheck 2>&1); rc=$?
[ "$rc" -eq 0 ] && exit 0
# Never block on an infrastructure failure — only on a genuine type error.
printf '%s' "$out" | grep -qiE 'no task|is not recognized|command not found|no such file|cannot be loaded' && exit 0
printf 'Type check failed - resolve before finishing:\n%s\n' "$out" >&2
exit 2
