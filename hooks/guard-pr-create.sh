#!/usr/bin/env bash
# Foundry - force PRs through the `ship` skill, not raw `gh pr create` (PreToolUse).
# ship runs fix -> smells -> gate -> review -> commit -> PR -> non-blocking CI watch;
# a bare `gh pr create` skips every one of those. This hook denies `gh pr create` on
# the Bash tool unless ship's single-use sentinel (.foundry/.ship-open-pr) is present,
# and consumes it on allow so it can't authorise a second bare create. Everything else
# passes untouched: only `gh pr create` as whole words is matched - never
# `gh pr checks|view|edit|merge|diff`, `gh run`, `gh issue`, `git push`/`commit`, nor
# `gh pr createx` - accounting for leading env assignments and flags.
set -u

payload=$(cat)
tool=$(printf '%s' "$payload" | sed -n 's/.*"tool_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)
[ "$tool" = "Bash" ] || exit 0

# Pull the command out of tool_input, tolerating escaped quotes. Match the command
# ONLY - never the whole payload - so a Bash `description` that merely mentions
# "gh pr create" on some other command never trips the guard. ERE (`-E`) so the
# alternation is portable: BSD sed (macOS) rejects BRE `\|` and would silently
# extract nothing, failing the guard open.
cmd=$(printf '%s' "$payload" | sed -nE 's/.*"command"[[:space:]]*:[[:space:]]*"(([^"\\]|\\.)*)".*/\1/p' | head -n1)
# A multi-line command arrives JSON-escaped (newline as \n); fold \n \r \t back to
# spaces so a `git push\ngh pr create` second line is still seen as a word boundary.
cmd=$(printf '%s' "$cmd" | sed 's/\\[nrt]/ /g')

# gh, pr, create as consecutive words. The leading class allows a command start, a
# chain (;, &&, |), or an env-assignment/flag prefix; the trailing class rejects
# `createx` while allowing `create`, `create ...`, `create;`. Not a `gh pr create`? Pass.
printf '%s' "$cmd" | grep -Eq '(^|[^[:alnum:]_./-])gh[[:space:]]+pr[[:space:]]+create([^[:alnum:]_-]|$)' || exit 0

# Resolve the sentinel against the repo the command runs in (normalize a Windows cwd
# for git-bash, like the other hooks).
cwd=$(printf '%s' "$payload" | sed -n 's/.*"cwd"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1 | sed 's/\\\\/\\/g')
if [ -n "$cwd" ]; then
  command -v cygpath >/dev/null 2>&1 && cwd=$(cygpath -u "$cwd" 2>/dev/null || printf '%s' "$cwd")
else
  cwd=$(pwd)
fi
root=$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null || printf '%s' "$cwd")
sentinel="$root/.foundry/.ship-open-pr"

# Sentinel present means ship ran this: consume it (single-use) and allow.
if [ -f "$sentinel" ]; then
  rm -f "$sentinel"
  exit 0
fi

{
  echo "Open PRs through the ship skill, not raw gh pr create."
  echo "ship runs the gate, review and CI-watch before the PR exists; a bare create skips them."
  echo "If you ARE ship: create the sentinel .foundry/.ship-open-pr in its OWN Bash call"
  echo "immediately before gh pr create (this hook consumes it single-use), and recreate"
  echo "it before retrying if a create fails."
} >&2
exit 2
