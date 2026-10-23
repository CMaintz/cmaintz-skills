#!/usr/bin/env bash
# Foundry — format-on-write (PostToolUse: Edit|Write|MultiEdit). Portable sh; runs
# anywhere bash does (Linux, macOS, Windows git-bash). Formats the single edited
# file with prettier (else eslint --fix), sub-second. Opts in by tooling: no-ops
# when the file's project has no local formatter, so it's safe to install globally.
# Java/Kotlin are handled at Stop by format-java-stop.sh (Gradle is too slow per-edit).
set -u

payload=$(cat)
# tool_input.file_path — no jq dependency; unescape JSON backslashes.
file=$(printf '%s' "$payload" | sed -n 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1 | sed 's/\\\\/\\/g')
[ -n "$file" ] || exit 0

# Windows: git-bash needs a POSIX path for tests; node tools need a C:/... path.
# Elsewhere the path is already POSIX.
if command -v cygpath >/dev/null 2>&1; then
  testfile=$(cygpath -u "$file" 2>/dev/null || printf '%s' "$file")
  toolfile=$(cygpath -m "$file" 2>/dev/null || printf '%s' "$file")
else
  testfile="$file"; toolfile="$file"
fi
[ -f "$testfile" ] || exit 0

case "$testfile" in
  *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs|*.json|*.jsonc|*.css|*.scss|*.less|*.html|*.vue|*.svelte|*.md|*.mdx|*.yaml|*.yml|*.graphql) ;;
  *) exit 0 ;;
esac

# Walk up to the nearest node_modules/.bin (handles monorepos).
dir=$(dirname "$testfile"); bin=""
while [ -n "$dir" ] && [ "$dir" != "/" ] && [ "$dir" != "." ]; do
  if [ -d "$dir/node_modules/.bin" ]; then bin="$dir/node_modules/.bin"; break; fi
  parent=$(dirname "$dir"); [ "$parent" = "$dir" ] && break; dir="$parent"
done
[ -n "$bin" ] || exit 0

# Run a node bin portably: unix shim if executable, else the Windows .cmd, else via sh.
run_tool() {
  base="$1"; shift
  if [ -x "$base" ]; then "$base" "$@"; return $?; fi
  if [ -f "$base.cmd" ]; then "$base.cmd" "$@"; return $?; fi
  if [ -f "$base" ]; then sh "$base" "$@"; return $?; fi
  return 127
}

if [ -e "$bin/prettier" ] || [ -e "$bin/prettier.cmd" ]; then
  run_tool "$bin/prettier" --write --log-level warn -- "$toolfile" >/dev/null 2>&1
  exit 0
fi
if [ -e "$bin/eslint" ] || [ -e "$bin/eslint.cmd" ]; then
  run_tool "$bin/eslint" --fix -- "$toolfile" >/dev/null 2>&1
  exit 0
fi
exit 0
