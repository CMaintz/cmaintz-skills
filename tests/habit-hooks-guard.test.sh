#!/usr/bin/env bash
# Tests hooks/habit-hooks-guard.sh against a throwaway repo and a throwaway HOME. Stub
# habit-hooks binaries stand in for the real one: each prints its name and exits 1, so
# the guard reports which one it ran.
#   Usage: tests/habit-hooks-guard.test.sh
set -euo pipefail

HOOK="$(cd "$(dirname "$0")/../plugins/foundry" && pwd)/hooks/habit-hooks-guard.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }

stub() { # <path> <name> - a habit-hooks that reports <name> as a smell
  mkdir -p "$(dirname "$1")"
  printf '#!/bin/sh\necho "smell from %s"\nexit 1\n' "$2" > "$1"
  chmod +x "$1"
}

# A repo that opted in, with a global habit-hooks in ~/.local/bin (which the guard
# puts on PATH) and a pinned one where setup:habit-hooks installs it.
new_repo() {
  HOME=$(mktemp -d); export HOME
  stub "$HOME/.local/bin/habit-hooks" global
  stub "$HOME/.local/opt/habit-hooks-typescript-9.9.9/bin/habit-hooks" pinned
  repo=$(mktemp -d)
  cd "$repo"
  git init -q
  mkdir .habit-hooks
}

run_guard() { printf '{"cwd":"%s"}' "$repo" | bash "$HOOK" 2>&1 || true; }

# A repo whose mise.toml pins habit-hooks runs that version, not whatever PATH finds
# first. Otherwise a version bump leaves the in-loop check on the old global install.
(
  new_repo
  printf '[env]\nHABIT_HOOKS_PLUGIN = "habit-hooks-typescript"\nHABIT_HOOKS_VERSION = "9.9.9"\n' > mise.toml
  export MISE_TRUSTED_CONFIG_PATHS="$repo"
  out=$(run_guard)
  case "$out" in *"smell from pinned"*) ;; *) fail "pinned repo ran: $out" ;; esac
  echo "ok: runs the pinned habit-hooks"
)

# Without a pin, the guard still runs the habit-hooks on PATH.
(
  new_repo
  out=$(run_guard)
  case "$out" in *"smell from global"*) ;; *) fail "unpinned repo ran: $out" ;; esac
  echo "ok: falls back to habit-hooks on PATH"
)
