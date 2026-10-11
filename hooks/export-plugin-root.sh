#!/usr/bin/env bash
# Bridge the plugin's install path into the agent's Bash environment. Claude Code
# substitutes ${CLAUDE_PLUGIN_ROOT} in hook command strings but does NOT set it in
# the Bash tool's environment, and it is not substituted in skill bodies either, so a
# skill cannot resolve a plugin-resident script (foundry-pr-report, foundry-ship-pr,
# foundry-loop-report) from a plain shell. Persist it once at session start as
# FOUNDRY_PLUGIN_ROOT via $CLAUDE_ENV_FILE. The root is passed as $1 because the var is
# not in this script's own environment.
set -u

root="${1:-}"
[ -n "$root" ] || exit 0
[ -n "${CLAUDE_ENV_FILE:-}" ] || exit 0
printf 'FOUNDRY_PLUGIN_ROOT=%s\n' "$root" >> "$CLAUDE_ENV_FILE"
