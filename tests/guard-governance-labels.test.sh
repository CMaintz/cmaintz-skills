#!/usr/bin/env bash
# Tests hooks/guard-governance-labels.sh by feeding it PreToolUse payloads the way Claude
# Code sends them: the command JSON-escaped inside tool_input.
#   Usage: tests/guard-governance-labels.test.sh
set -euo pipefail

HOOK="$(cd "$(dirname "$0")/../plugins/foundry" && pwd)/hooks/guard-governance-labels.sh"

failures=0
fail() { echo "FAIL: $*" >&2; failures=$((failures + 1)); }

json_escape() { # stdin -> a JSON string body: backslash, quote, newline, tab
  sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/	/\\t/g' | awk 'NR > 1 { printf "\\n" } { printf "%s", $0 }'
}

# Runs the hook on a Bash call; prints its exit code.
run_hook() { # <command> [description] [tool]
  local cmd desc
  cmd=$(printf '%s' "$1" | json_escape)
  desc=$(printf '%s' "${2:-run it}" | json_escape)
  printf '{"session_id":"s","tool_name":"%s","tool_input":{"command":"%s","description":"%s"}}' \
    "${3:-Bash}" "$cmd" "$desc" | bash "$HOOK" > /dev/null 2>&1 && echo 0 || echo $?
}

denies() { [ "$(run_hook "$@")" = 2 ] || fail "should deny: $1"; }
allows() { [ "$(run_hook "$@")" = 0 ] || fail "should allow: $1"; }

# Each way an agent could put a governance label on a PR or issue.
denies 'gh pr edit 12 --add-label suppression'
denies 'gh pr edit 12 --add-label=ruleset-change'
denies 'gh issue edit 7 --add-label "agent:working,ruleset-change"'
denies "gh pr edit 12 --add-label 'agent:working, suppression'"
denies 'gh pr edit 12 -R o/r --add-label suppression --add-label agent:working'
denies 'GH_REPO=o/r gh pr edit 3 --add-label suppression'
denies 'git push
gh pr edit 3 --add-label ruleset-change'
denies 'git push && gh pr edit 3 --add-label suppression'
denies 'gh issue create --title t --body-file b.md --label suppression'
denies 'gh issue create --title t --body-file b.md -l ruleset-change'
denies 'gh api -X POST repos/o/r/issues/3/labels -f "labels[]=suppression"'
denies 'gh api repos/o/r/issues/3/labels -f labels[]=ruleset-change'
denies 'gh api --method PUT repos/o/r/issues/3/labels --raw-field "labels[]=suppression"'
denies 'gh api -XPATCH repos/o/r/issues/3 -F labels[]=suppression'
# Renaming an ordinary label into a governance one applies it everywhere the old one was.
denies 'gh label edit agent:working --name suppression'
denies 'gh label create ruleset-change --color ff0000'

# Ordinary label work, reads, removals and mentions pass.
allows 'gh pr edit 3 --add-label agent:working'
allows 'gh issue edit 3 --add-label agent:working --remove-label agent:ready'
allows 'gh issue edit 3 --remove-label suppression'
allows 'gh pr edit 3 --add-label suppression-review'
allows 'gh issue create --title t --body-file b.md --label agent:ready'
allows 'gh api repos/o/r/labels/suppression'
allows 'gh api -X DELETE repos/o/r/issues/3/labels/suppression'
allows 'gh api -X POST repos/o/r/issues/3/labels -f "labels[]=agent:working"'
allows 'gh pr view 3 --json labels | grep -q suppression'
allows 'gh label list --search suppression'
allows 'git push && gh pr edit 3 --add-label agent:working; echo suppression'
allows 'ls' 'about to gh pr edit 3 --add-label suppression'
allows 'gh pr edit 3 --add-label suppression' 'x' 'Edit'

[ "$failures" -eq 0 ] || { echo "$failures failure(s)" >&2; exit 1; }
echo "ok: guard-governance-labels"
