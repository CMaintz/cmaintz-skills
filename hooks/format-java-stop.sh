#!/usr/bin/env bash
# Foundry — format Java on Stop. Portable sh. Runs `./gradlew spotlessApply` once
# per turn, only when the turn touched .java and the build uses Spotless. Spotless
# ratchetFrom origin/main scopes the rewrite to changed files. Once-per-turn is the
# right cadence for a JVM formatter (per-edit is too slow — that's auto-format.sh's job).
set -u

payload=$(cat)
printf '%s' "$payload" | grep -q '"stop_hook_active"[[:space:]]*:[[:space:]]*true' && exit 0

cwd=$(printf '%s' "$payload" | sed -n 's/.*"cwd"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1 | sed 's/\\\\/\\/g')
if [ -n "$cwd" ]; then
  command -v cygpath >/dev/null 2>&1 && cwd=$(cygpath -u "$cwd" 2>/dev/null || printf '%s' "$cwd")
  cd "$cwd" 2>/dev/null || true
fi

[ -f ./gradlew ] || exit 0
# Is Spotless even configured? Avoid a pointless Gradle spin-up otherwise.
grep -rqsE 'spotless' ./build.gradle ./build.gradle.kts ./*/build.gradle ./*/build.gradle.kts 2>/dev/null || exit 0

# Did this turn touch Java? Working tree + new files + branch commits vs main.
changed=$( { git diff --name-only HEAD 2>/dev/null; \
             git ls-files --others --exclude-standard 2>/dev/null; \
             mb=$(git merge-base HEAD origin/main 2>/dev/null); \
             [ -n "$mb" ] && git diff --name-only "$mb" HEAD 2>/dev/null; } )
printf '%s\n' "$changed" | grep -qE '\.java$' || exit 0

# ratchetFrom origin/main scopes the rewrite to changed files. Silent, non-blocking.
sh ./gradlew spotlessApply --quiet --console=plain >/dev/null 2>&1 || true
exit 0
