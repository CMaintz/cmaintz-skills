#!/usr/bin/env bash
# Tests hooks/habit-hooks-guard.sh against a throwaway repo and a throwaway HOME. Stub
# habit-hooks binaries stand in for the real one: each prints its name and exits 1, so
# the guard reports which one it ran.
#   Usage: tests/habit-hooks-guard.test.sh
# Each case runs in its own ( ) so its HOME, PATH and mise trust cannot leak into the next.
# shellcheck disable=SC2030,SC2031
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

pin() { # <dir> <version> - a mise.toml there pinning habit-hooks-typescript <version>
  printf '[env]\nHABIT_HOOKS_PLUGIN = "habit-hooks-typescript"\nHABIT_HOOKS_VERSION = "%s"\n' "$2" > "$1/mise.toml"
}

# Prints the guard's output, then its exit code as the last line.
run_guard() { rc=0; printf '{"cwd":"%s"}' "$repo" | bash "$HOOK" 2>&1 || rc=$?; echo "rc=$rc"; }

# PATH without any real habit-hooks, so a "no global copy" case can't pass vacuously on
# a machine that has one installed.
no_global_path() {
  local p="" d IFS=:
  for d in $PATH; do
    [ -e "$d/habit-hooks" ] || [ -e "$d/habit-hooks.exe" ] || p="${p:+$p:}$d"
  done
  printf '%s' "$p"
}

# A repo whose mise.toml pins habit-hooks runs that version, not whatever PATH finds
# first. Otherwise a version bump leaves the in-loop check on the old global install.
(
  new_repo
  pin . 9.9.9
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

# A pinned version that setup:habit-hooks never installed must not quietly run the
# global copy, which would coach against thresholds gate doesn't use.
(
  new_repo
  pin . 1.0.0
  export MISE_TRUSTED_CONFIG_PATHS="$repo"
  out=$(run_guard)
  case "$out" in *"smell from global"*) fail "uninstalled pin ran the global copy: $out" ;; esac
  case "$out" in *"mise trust && mise install"*) ;; *) fail "uninstalled pin gave no fix: $out" ;; esac
  echo "ok: an uninstalled pin does not fall back to PATH"
)

# When mise can't read the pin (an untrusted fresh worktree), the guard must not guess.
# A stub mise makes the failure deterministic whatever the machine or CI trusts.
(
  new_repo
  pin . 9.9.9
  mkdir "$HOME/fakebin"
  printf '#!/bin/sh\necho "mise: config not trusted" >&2\nexit 1\n' > "$HOME/fakebin/mise"
  chmod +x "$HOME/fakebin/mise"
  PATH="$HOME/fakebin:$PATH"
  out=$(run_guard)
  case "$out" in *"smell from"*) fail "unreadable pin ran a habit-hooks: $out" ;; esac
  case "$out" in *"mise trust && mise install"*) ;; *) fail "unreadable pin gave no fix: $out" ;; esac
  echo "ok: a pin mise can't read does not fall back to PATH"
)

# A package that can't run the check must not discard another package's findings.
# backend sorts first, so its smells are found before frontend is reached.
(
  new_repo
  rm "$HOME/.local/bin/habit-hooks"
  rmdir .habit-hooks
  mkdir -p backend/.habit-hooks frontend/.habit-hooks
  pin backend 9.9.9
  export MISE_TRUSTED_CONFIG_PATHS="$repo"
  PATH=$(no_global_path)
  out=$(run_guard)
  case "$out" in *"smell from pinned"*) ;; *) fail "backend findings lost: $out" ;; esac
  case "$out" in *"rc=2") ;; *) fail "backend smells did not block the stop: $out" ;; esac
  case "$out" in *frontend*) ;; *) fail "frontend skip not reported: $out" ;; esac
  echo "ok: a package without habit-hooks does not mask another's smells"
)

# A session in a folder of repos (~/Projects) is in none of them, so their changesets
# aren't its work. Checking them blocked the stop on another session's half-made repo.
(
  new_repo
  parent=$(mktemp -d)
  mv "$repo" "$parent/sibling"
  repo=$parent
  cd "$repo"
  out=$(run_guard)
  case "$out" in *"smell from"*) fail "checked a repo the session is not in: $out" ;; esac
  echo "ok: a sibling repo under the session folder is not checked"
)

# habit-hooks reaches habit-sensors/habit-mapper through PATH whenever its next-to-me
# lookup misses, as it always does on Windows (pip names them *.exe, that lookup does
# not). The guard runs the pinned binary by absolute path, so its directory has to be on
# PATH too. A stub that only finds its sibling via PATH stands in for that behaviour.
sibling_pin() { # <version> - a pinned habit-hooks that reaches its sibling only via PATH
  local dir="$HOME/.local/opt/habit-hooks-typescript-$1/bin"
  stub "$dir/habit-sensors" "pinned sensors"
  printf '#!/bin/sh\nexec habit-sensors\n' > "$dir/habit-hooks"
  chmod +x "$dir/habit-hooks"
}

# The global sensors stub makes this discriminate prepend from append: the guard puts
# ~/.local/bin on PATH itself, so appending the pinned dir instead would reach the older
# global sensors under the pinned habit-hooks - the version mix hh_for exists to prevent.
(
  new_repo
  sibling_pin 9.9.9
  stub "$HOME/.local/bin/habit-sensors" "global sensors"
  pin . 9.9.9
  export MISE_TRUSTED_CONFIG_PATHS="$repo"
  out=$(run_guard)
  case "$out" in *"smell from pinned sensors"*) ;; *) fail "pinned habit-hooks could not reach its sibling: $out" ;; esac
  echo "ok: the pinned habit-hooks reaches its own sibling binaries, not an older global one"
)

# The unpinned path runs a bare `habit-hooks` resolved from PATH, so it must never reach
# dirname: that yields ".", and the check runs inside cd "$d", so the package being
# checked would go on PATH - executing a habit-sensors committed to any repo the agent
# stops in. Red if the two case arms are ever collapsed into one.
(
  new_repo
  printf '#!/bin/sh\nexec habit-sensors\n' > "$HOME/.local/bin/habit-hooks"
  chmod +x "$HOME/.local/bin/habit-hooks"
  stub ./habit-sensors "repo-local sensors"
  out=$(run_guard)
  case "$out" in *"repo-local sensors"*) fail "ran a habit-sensors from the checked repo: $out" ;; esac
  echo "ok: the unpinned path does not put the checked repo on PATH"
)
