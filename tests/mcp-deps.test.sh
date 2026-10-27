#!/usr/bin/env bash
# Tests plugins/foundry/hooks/mcp-deps.sh with a stub npm that records each call, so it
# needs no network.
#   Usage: tests/mcp-deps.test.sh
set -euo pipefail

HOOK="$(cd "$(dirname "$0")/.." && pwd)/plugins/foundry/hooks/mcp-deps.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }

# A plugin root with a package.json, an empty data dir, and npm stubbed to log its cwd and
# exit with $NPM_RC.
setup() {
  work="$(mktemp -d)"
  export CLAUDE_PLUGIN_ROOT="$work/root" CLAUDE_PLUGIN_DATA="$work/data" NPM_LOG="$work/npm.log"
  mkdir -p "$CLAUDE_PLUGIN_ROOT" "$work/bin"
  echo '{"dependencies":{"a":"1.0.0"}}' > "$CLAUDE_PLUGIN_ROOT/package.json"
  echo '{}' > "$CLAUDE_PLUGIN_ROOT/package-lock.json"
  cat > "$work/bin/npm" <<'EOF'
#!/bin/sh
pwd >> "$NPM_LOG"
exit "${NPM_RC:-0}"
EOF
  chmod +x "$work/bin/npm"
  export PATH="$work/bin:$PATH"
}

npm_calls() { [ -f "$NPM_LOG" ] && wc -l < "$NPM_LOG" | tr -d ' ' || echo 0; }

setup
sh "$HOOK" || fail "hook exited non-zero"
[ "$(npm_calls)" = 1 ] || fail "first session should install once, got $(npm_calls)"
[ -f "$CLAUDE_PLUGIN_DATA/package-lock.json" ] || fail "lock file not copied, npm ci would refuse"
sh "$HOOK"
[ "$(npm_calls)" = 1 ] || fail "unchanged package.json reinstalled"
echo '{"dependencies":{"a":"2.0.0"}}' > "$CLAUDE_PLUGIN_ROOT/package.json"
sh "$HOOK"
[ "$(npm_calls)" = 2 ] || fail "changed package.json did not reinstall"

setup
NPM_RC=1 sh "$HOOK" || fail "a failed install must not fail the session"
[ ! -f "$CLAUDE_PLUGIN_DATA/.installed.json" ] || fail "failed install left its stamp, so it never retries"
sh "$HOOK"
[ "$(npm_calls)" = 2 ] || fail "next session did not retry after a failed install"

setup
mkdir -p "$CLAUDE_PLUGIN_ROOT/node_modules/@modelcontextprotocol/sdk"
sh "$HOOK"
[ "$(npm_calls)" = 0 ] || fail "installed although deps already sit beside the plugin"

echo "mcp-deps: ok"
