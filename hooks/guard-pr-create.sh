#!/usr/bin/env bash
# Foundry - force PRs through the ship flow, not a raw `gh pr create` (PreToolUse/Bash).
# ship runs fix -> smells -> gate -> review -> commit, then opens the PR via
# `foundry-ship-pr`, which also watches CI; a bare `gh pr create` skips all of it. This
# hook denies `gh pr create` on the Bash tool. The sanctioned path, foundry-ship-pr, runs
# create as a SUBPROCESS - and a PreToolUse hook only ever sees the agent's own tool call,
# never a child process - so the sanction lives in the script itself, not in a forgeable
# token. Only `gh pr create` as whole words is matched - never `gh pr checks|view|edit|
# merge|diff`, `gh run`, `gh issue`, `git push`/`commit`, nor `gh pr createx` - allowing
# leading env assignments and flags.
set -u

payload=$(cat)
tool=$(printf '%s' "$payload" | sed -n 's/.*"tool_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)
[ "$tool" = "Bash" ] || exit 0

# Match the command ONLY, never the whole payload, so a Bash `description` that merely
# mentions "gh pr create" on some other command never trips the guard. ERE (`-E`) so the
# alternation is portable: BSD sed (macOS) rejects BRE `\|` and would silently extract
# nothing, failing the guard open.
cmd=$(printf '%s' "$payload" | sed -nE 's/.*"command"[[:space:]]*:[[:space:]]*"(([^"\\]|\\.)*)".*/\1/p' | head -n1)
# A multi-line command arrives JSON-escaped (newline as \n); fold \n \r \t back to spaces
# so a `git push\ngh pr create` second line is still seen as a word boundary.
cmd=$(printf '%s' "$cmd" | sed 's/\\[nrt]/ /g')

# gh, pr, create as consecutive words. Leading class allows a command start, a chain
# (;, &&, |) or an env-assignment/flag prefix; trailing class rejects `createx`. Not a
# `gh pr create`? Pass.
printf '%s' "$cmd" | grep -Eq '(^|[^[:alnum:]_./-])gh[[:space:]]+pr[[:space:]]+create([^[:alnum:]_-]|$)' || exit 0

ship_pr="$(cd "$(dirname "$0")/../scripts" 2> /dev/null && pwd)/foundry-ship-pr"
{
  echo "Open PRs through the ship skill (/foundry:ship), not a raw gh pr create."
  echo "ship runs the gate, review and CI-watch, then opens the PR via foundry-ship-pr;"
  echo "a bare create skips every one of those."
  echo "If you ARE ship, call that script in its own Bash call (body/title from files):"
  echo "  $ship_pr --body-file <file> [--title-file <file>] [--base <branch>]"
} >&2
exit 2
