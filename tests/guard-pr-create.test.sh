#!/usr/bin/env bash
# Tests hooks/guard-pr-create.sh by feeding it PreToolUse payloads the way Claude Code
# sends them: the command JSON-escaped inside tool_input, the session cwd alongside.
#   Usage: tests/guard-pr-create.test.sh
set -euo pipefail

HOOK="$(cd "$(dirname "$0")/../plugins/foundry" && pwd)/hooks/guard-pr-create.sh"

failures=0
fail() { echo "FAIL: $*" >&2; failures=$((failures + 1)); }

json_escape() { # stdin -> a JSON string body: backslash, quote, newline, tab
  sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/	/\\t/g' | awk 'NR > 1 { printf "\\n" } { printf "%s", $0 }'
}

# Claude Code on Windows sends a native path (C:\...); elsewhere it is the POSIX path.
native_path() { if command -v cygpath > /dev/null 2>&1; then cygpath -w "$1"; else printf '%s' "$1"; fi; }

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

foundry_repo="$tmp/foundry-repo"
mkdir -p "$foundry_repo/src/deep"
git -C "$foundry_repo" init -q
printf '[tasks.gate]\nrun = ["mise run lint"]\n' > "$foundry_repo/mise.toml"

quoted_gate_repo="$tmp/quoted-gate"
mkdir -p "$quoted_gate_repo"
git -C "$quoted_gate_repo" init -q
printf '[tasks."gate"]\nrun = "true"\n' > "$quoted_gate_repo/mise.toml"

plain_repo="$tmp/plain-repo"
mkdir -p "$plain_repo"
git -C "$plain_repo" init -q

dot_mise_repo="$tmp/dot-mise"
mkdir -p "$dot_mise_repo"
git -C "$dot_mise_repo" init -q
printf '[tasks.gate]\nrun = "true"\n' > "$dot_mise_repo/.mise.toml"

# A `[tasks]` table form only mise itself can read; trusted below so mise lists its tasks.
table_gate_repo="$tmp/table-gate"
mkdir -p "$table_gate_repo"
git -C "$table_gate_repo" init -q
printf '[tasks]\ngate = "true"\n' > "$table_gate_repo/mise.toml"

mise_no_gate_repo="$tmp/mise-no-gate"
mkdir -p "$mise_no_gate_repo"
git -C "$mise_no_gate_repo" init -q
printf '[tasks.gate-docs]\nrun = "true"\n[tasks.test]\nrun = "true"\n' > "$mise_no_gate_repo/mise.toml"

not_a_repo="$tmp/not-a-repo"
mkdir -p "$not_a_repo"

# A mise that can't list tasks (untrusted or broken), so only the toml check can see a gate.
broken_mise="$tmp/bin-broken-mise"
mkdir -p "$broken_mise"
printf '#!/bin/sh\nexit 1\n' > "$broken_mise/mise"
# A mise whose `tasks ls` ran into the time bound (timeout reports 124).
slow_mise="$tmp/bin-slow-mise"
mkdir -p "$slow_mise"
printf '#!/bin/sh\nexit 124\n' > "$slow_mise/mise"
chmod +x "$broken_mise/mise" "$slow_mise/mise"

# Runs the hook on a Bash call from <cwd> ("" sends no cwd); prints its exit code.
run_hook() { # <cwd> <command> [description] [tool]
  local cmd desc cwd_field=""
  cmd=$(printf '%s' "$2" | json_escape)
  desc=$(printf '%s' "${3:-run it}" | json_escape)
  [ -n "$1" ] && cwd_field=$(printf ',"cwd":"%s"' "$(native_path "$1" | json_escape)")
  printf '{"session_id":"s","tool_name":"%s","tool_input":{"command":"%s","description":"%s"}%s}' \
    "${4:-Bash}" "$cmd" "$desc" "$cwd_field" | bash "$HOOK" > /dev/null 2>&1 && echo 0 || echo $?
}

denies() { [ "$(run_hook "$@")" = 2 ] || fail "should deny in ${1:-<no cwd>}: $2"; }
allows() { [ "$(run_hook "$@")" = 0 ] || fail "should allow in ${1:-<no cwd>}: $2"; }

# A Foundry repo (it defines the gate verb) routes PRs through ship.
denies "$foundry_repo" 'gh pr create --title t --body b'
denies "$foundry_repo/src/deep" 'gh pr create --fill'
denies "$quoted_gate_repo" 'gh pr create --fill'
denies "$foundry_repo" 'git push
gh pr create --fill'
denies "$foundry_repo" 'GH_REPO=o/r gh pr create --fill'
PATH="$broken_mise:$PATH" denies "$foundry_repo" 'gh pr create --fill'
PATH="$broken_mise:$PATH" denies "$quoted_gate_repo" 'gh pr create --fill'
PATH="$broken_mise:$PATH" denies "$dot_mise_repo" 'gh pr create --fill'
command -v timeout > /dev/null 2>&1 &&
  PATH="$slow_mise:$PATH" denies "$plain_repo" 'gh pr create --fill'
command -v mise > /dev/null 2>&1 &&
  MISE_TRUSTED_CONFIG_PATHS="$table_gate_repo" denies "$table_gate_repo" 'gh pr create --fill'
# The session cwd is often a parent folder, with the repo reached by a leading cd.
denies "$tmp" "cd \"$(native_path "$foundry_repo")\" && gh pr create --fill"
denies "$tmp" 'cd foundry-repo && gh pr create --fill'
denies "$plain_repo" '(cd ../foundry-repo && gh pr create --fill)'
denies "$plain_repo" 'pushd ../foundry-repo && gh pr create --fill'
denies "$plain_repo" 'cd -- ../foundry-repo && gh pr create --fill'
# Unclassifiable (no cwd, or outside any git work tree) means the guard stays on.
denies "" 'gh pr create --fill'
denies "$not_a_repo" 'gh pr create --repo o/r --fill'

# Repos without a gate have no ship flow to route through.
allows "$plain_repo" 'gh pr create --title t --body b'
allows "$mise_no_gate_repo" 'gh pr create --fill'
allows "$tmp" 'cd plain-repo && gh pr create --fill'
allows "$foundry_repo" "cd \"$(native_path "$plain_repo")\" && gh pr create --fill"

# Other gh commands and mere mentions pass, even in a Foundry repo.
allows "$foundry_repo" 'gh pr view 3'
allows "$foundry_repo" 'gh pr createx'
allows "$foundry_repo" 'ls' 'about to gh pr create'
allows "$foundry_repo" 'gh pr create --fill' 'x' 'Edit'

[ "$failures" -eq 0 ] || { echo "$failures failure(s)" >&2; exit 1; }
echo "ok: guard-pr-create"
