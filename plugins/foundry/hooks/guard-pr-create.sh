#!/usr/bin/env bash
# Foundry - force PRs through the ship flow, not a raw `gh pr create` (PreToolUse/Bash).
# ship runs fix -> smells -> gate -> review -> commit, then opens the PR via
# `foundry-ship-pr`, which also watches CI; a bare `gh pr create` skips all of it. This
# hook denies `gh pr create` on the Bash tool in any repo ship accepts. The sanctioned path, foundry-ship-pr, runs
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
# The command arrives JSON-escaped. Fold \n \r \t to spaces so a `git push\ngh pr create`
# second line is still a word boundary, and unescape \" and \\. Escaped backslashes are
# parked first: folding first would read the `\t` in a path like `C:\\tmp` as a tab.
soh=$'\001'
cmd=${cmd//\\\\/$soh}
cmd=${cmd//\\[nrt]/ }
cmd=${cmd//\\\"/\"}
cmd=${cmd//$soh/\\}

# gh, pr, create as consecutive words. Leading class allows a command start, a chain
# (;, &&, |) or an env-assignment/flag prefix; trailing class rejects `createx`. Not a
# `gh pr create`? Pass.
printf '%s' "$cmd" | grep -Eq '(^|[^[:alnum:]_./-])gh[[:space:]]+pr[[:space:]]+create([^[:alnum:]_-]|$)' || exit 0

deny() { # [why the repo couldn't be classified]
  ship_pr="$(cd "$(dirname "$0")/../scripts" 2> /dev/null && pwd)/foundry-ship-pr"
  {
    [ -n "${1:-}" ] && echo "$1" && echo "If it isn't a Foundry repo, rerun the command from inside that repo with no cd prefix." && echo
    echo "Open PRs through the ship skill (/foundry:ship), not a raw gh pr create."
    echo "ship runs the gate, review and CI-watch, then opens the PR via foundry-ship-pr;"
    echo "a bare create skips every one of those."
    echo "If you ARE ship, call that script in its own Bash call (body/title from files):"
    echo "  $ship_pr --body-file <file> [--title-file <file>] [--base <branch>]"
  } >&2
  exit 2
}

to_posix() { if command -v cygpath > /dev/null 2>&1; then cygpath -u "$1" 2> /dev/null || printf '%s' "$1"; else printf '%s' "$1"; fi; }

# The directory a leading `cd <dir>` (or `(cd`, `pushd`, `cd --`) moves to; sessions often
# start in a parent folder and reach the repo that way, so the payload cwd alone would
# misclassify the call.
cd_target() {
  printf '%s' "$cmd" |
    sed -nE "s/^[[:space:]]*\(?[[:space:]]*(cd|pushd)[[:space:]]+(--[[:space:]]+)?(\"([^\"]*)\"|'([^']*)'|([^[:space:];&|)]+)).*/\4\5\6/p"
}

# Asking mise runs the repo's [env] directives, which can outlast the hook's 10s timeout,
# and a timed-out hook lets the call through. Bound it, and treat a timeout as a gate.
mise_lists_gate() {
  command -v mise > /dev/null 2>&1 || return 1
  if command -v timeout > /dev/null 2>&1; then
    tasks=$(timeout 5 mise tasks ls 2> /dev/null)
    [ $? -eq 124 ] && return 0
  else
    tasks=$(mise tasks ls 2> /dev/null)
  fi
  printf '%s\n' "$tasks" | awk '{print $1}' | grep -qx gate
}

# Only a Foundry repo has a ship flow to route through; elsewhere ship refuses to run, so
# denying would leave no way to open a PR. Anything that can't be classified (no cwd, or
# a directory outside any git work tree) stays guarded rather than failing open.
cwd=$(printf '%s' "$payload" | sed -n 's/.*"cwd"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1 | sed 's/\\\\/\\/g')
[ -n "$cwd" ] || deny "guard-pr-create: the hook payload has no cwd, so the repo can't be classified."
dir=$(to_posix "$cwd")
target=$(cd_target)
case $target in
  "") ;;
  /* | [A-Za-z]:*) dir=$(to_posix "$target") ;;
  \~ | \~/*) dir="$HOME${target#\~}" ;;
  *) dir="$dir/$target" ;;
esac
cd "$dir" 2> /dev/null || deny "guard-pr-create: couldn't resolve the target directory '$dir'."
root=$(git rev-parse --show-toplevel 2> /dev/null) || deny "guard-pr-create: '$dir' is not inside a git work tree."

# The toml header check runs first: it is instant and needs no trusted config, so a fresh
# worktree of a Foundry repo stays guarded. Then the same test ship applies (`mise tasks
# ls` lists `gate`), which catches every other task form mise understands.
grep -qsE '^\[tasks\.("gate"|gate)\]' mise.toml "$root/mise.toml" "$root/.mise.toml" && deny
mise_lists_gate && deny
exit 0
