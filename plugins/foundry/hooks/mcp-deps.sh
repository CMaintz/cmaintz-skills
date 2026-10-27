#!/usr/bin/env sh
# SessionStart: install the MCP server's npm dependencies (package.json) into
# ${CLAUDE_PLUGIN_DATA}, which survives plugin updates, on first run and again whenever
# package.json changes. This is Claude Code's documented pattern for plugin dependencies
# (plugins docs, "Install dependencies into the data directory"). It does nothing when
# Claude Code already installed them beside the plugin, as it does for marketplace
# installs. Never blocks the session: a failed install only leaves the server unstarted.
root="${CLAUDE_PLUGIN_ROOT:?}"
data="${CLAUDE_PLUGIN_DATA:-}"
[ -n "$data" ] || exit 0
[ -d "$root/node_modules/@modelcontextprotocol/sdk" ] && exit 0
# .installed.json is a copy of the package.json the tree was built from, written only
# after npm succeeds, so an install that fails or is killed mid-way is retried next session.
if diff -q "$root/package.json" "$data/.installed.json" >/dev/null 2>&1; then exit 0; fi
mkdir -p "$data" || exit 0
cp "$root/package.json" "$root/package-lock.json" "$data/" 2>/dev/null || exit 0
(cd "$data" && npm ci --omit=dev --no-audit --no-fund >/dev/null 2>&1) && cp "$data/package.json" "$data/.installed.json"
exit 0
