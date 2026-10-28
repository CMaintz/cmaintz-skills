#!/usr/bin/env bash
# Tests plugins/foundry/scripts/foundry-ship-pr against a local bare remote and a stub gh,
# so it needs no network. The stub models GitHub lag: the PR keeps showing its previous
# head, and that commit's finished passing check, until its head has been asked for LAG
# times; after that it shows the pushed head, whose check lands in NEW_BUCKET. Every gh call
# is logged with the directory it ran in, and `pr checks --watch` takes WATCH_SLEEP seconds,
# so a caller that blocks on the watch is visible.
#   Usage: tests/foundry-ship-pr.test.sh
set -euo pipefail

SCRIPT="$(cd "$(dirname "$0")/.." && pwd)/plugins/foundry/scripts/foundry-ship-pr"

fail() { echo "FAIL: $*" >&2; exit 1; }

# A branch whose PR head is commit one, with commit two made locally and not yet pushed.
# HAS_PR=0 models a branch with no PR yet, so the run takes the create path.
setup() { # <lag> <bucket of the pushed head's check> [has_pr]
  work="$(mktemp -d)"
  export STATE="$work/state" REMOTE="$work/remote.git" BRANCH=feat/x LAG="$1" NEW_BUCKET="$2"
  export HAS_PR="${3:-1}" WATCH_SLEEP=0
  mkdir -p "$STATE" "$work/bin"
  git init -q --bare "$REMOTE"
  git clone -q "$REMOTE" "$work/repo" 2> /dev/null
  cd "$work/repo"
  git config user.email t@example.com
  git config user.name test
  git checkout -q -b "$BRANCH"
  git commit -q --allow-empty -m one
  git push -q -u origin HEAD 2> /dev/null
  git rev-parse HEAD > "$STATE/old_sha"
  git commit -q --allow-empty -m two
  [ "$HAS_PR" = 1 ] && touch "$STATE/created"

  cat > "$work/bin/gh" <<'EOF'
#!/usr/bin/env bash
printf '%s\t%s\n' "$PWD" "$*" >> "$STATE/calls"
asked=$(cat "$STATE/head_asked" 2> /dev/null || echo 0)
if [ "$asked" -ge "$LAG" ]; then
  head=$(git -C "$REMOTE" rev-parse "refs/heads/$BRANCH"); bucket=$NEW_BUCKET
else
  head=$(cat "$STATE/old_sha"); bucket=pass
fi
case "$*" in
  # Real gh: `repo view` takes the repo as a positional and has no --repo flag, and
  # `pr view --repo` without a PR argument is an error.
  "repo view --repo"*|"pr view --repo"*) echo "unknown flag: --repo" >&2; exit 1 ;;
  "repo view --json defaultBranchRef"*) echo main ;;
  "pr view --json number"*) [ -e "$STATE/created" ] && echo 37 || exit 1 ;;
  "pr create "*) touch "$STATE/created" ;;
  "pr view 37 --json url"*) echo https://example.test/pr/37 ;;
  *headRefOid*) echo $((asked + 1)) > "$STATE/head_asked"; echo "$head" ;;
  "pr checks 37 --watch"*) sleep "$WATCH_SLEEP" ;;
  *'select(.bucket=="fail"'*length*) [ "$bucket" = fail ] && echo 1 || echo 0 ;;
  *'select(.bucket=="pending")'*) echo 0 ;;
  *'.link'*) echo https://example.test/actions/runs/1/job/2 ;;
  *'\(.bucket)'*) printf '%s\tgate\n' "$bucket" ;;
  "pr checks 37 --json name -q length") echo 1 ;;
  "run view"*) echo "step failed" ;;
  "pr ready 37"*) touch "$STATE/ready" ;;
  *) echo "stub gh: unexpected call: $*" >&2; exit 9 ;;
esac
EOF
  chmod +x "$work/bin/gh"
  printf 'body\n' > "$work/body.md"
}

# Outside Herdr unless a case sets IN_HERDR=1: the developer's shell may be inside it, CI
# is not.
ship() {
  rc=0
  env -u HERDR_ENV ${IN_HERDR:+HERDR_ENV=1} PATH="$work/bin:$PATH" FOUNDRY_PR_WATCH_POLL_SECONDS=0 \
    timeout 20 "$SCRIPT" --body-file "$work/body.md" "$@" > "$work/out.log" 2>&1 || rc=$?
}

# The detached watch's log ends with a sentinel carrying its exit code; wait for it.
watch_verdict() { # <log>
  local log="$1"
  for _ in $(seq 1 100); do
    if grep -q -- '---PR-CI-WATCH-DONE---' "$log" 2> /dev/null; then
      verdict=$(sed -n 's/.*---PR-CI-WATCH-DONE--- exit \([0-9]*\).*/\1/p' "$log" | tail -n1)
      return 0
    fi
    sleep 0.1
  done
  fail "the background watch never finished: $(cat "$log" 2> /dev/null)"
}

# An existing PR gets the new commit pushed, and its verdict is the new commit's checks,
# not the previous commit's run that is still on the PR when the script starts.
(
  setup 2 fail; ship
  [ "$rc" -eq 0 ] || fail "expected exit 0 once the watch is launched, got $rc: $(cat "$work/out.log")"
  [ "$(git -C "$REMOTE" rev-parse "refs/heads/$BRANCH")" = "$(git rev-parse HEAD)" ] \
    || fail "the new commit was not pushed to the existing PR's branch: $(cat "$work/out.log")"
  watch_verdict "$work/repo/.foundry/pr-watch.log"
  [ "$verdict" -eq 1 ] || fail "expected the new commit's failing check (exit 1), got $verdict"
  [ ! -e "$STATE/ready" ] || fail "marked the PR ready on a stale green"
  echo "ok: pushes to an existing PR and judges the pushed commit's checks"
)

# The CI watch runs in the background: the caller is handed back the PR long before CI ends.
(
  setup 0 pass; export WATCH_SLEEP=5
  start=$(date +%s); ship; took=$(( $(date +%s) - start ))
  [ "$rc" -eq 0 ] || fail "expected exit 0 once the watch is launched, got $rc: $(cat "$work/out.log")"
  [ "$took" -lt 4 ] || fail "blocked for ${took}s on the CI watch instead of returning"
  echo "ok: returns without waiting for CI"
)

# Green CI flips the draft to ready from the background watch, after the script has exited.
(
  setup 0 pass; ship
  [ "$rc" -eq 0 ] || fail "expected exit 0, got $rc: $(cat "$work/out.log")"
  watch_verdict "$work/repo/.foundry/pr-watch.log"
  [ "$verdict" -eq 0 ] || fail "expected a green verdict, got $verdict: $(cat "$work/repo/.foundry/pr-watch.log")"
  [ -e "$STATE/ready" ] || fail "green CI did not mark the PR ready"
  echo "ok: the background watch marks the PR ready on green"
)

# Inside Herdr the watch goes to a sibling pane, and the PR is still marked ready on green.
(
  setup 0 pass
  cat > "$work/bin/herdr" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$STATE/herdr"
case "$1 $2" in
  "pane split") echo '{"result":{"pane":{"pane_id":"p9"}}}' ;;
  "pane run") nohup bash -c "$4" > "$STATE/pane.log" 2>&1 < /dev/null & ;;
esac
EOF
  chmod +x "$work/bin/herdr"
  IN_HERDR=1 ship
  [ "$rc" -eq 0 ] || fail "expected exit 0, got $rc: $(cat "$work/out.log")"
  grep -q '^pane split .*--no-focus' "$STATE/herdr" || fail "did not split a background pane: $(cat "$STATE/herdr")"
  grep -q '^pane run p9 ' "$STATE/herdr" || fail "did not run the watch in the new pane: $(cat "$STATE/herdr")"
  watch_verdict "$STATE/pane.log"
  [ "$verdict" -eq 0 ] || fail "expected a green verdict in the pane, got $verdict: $(cat "$STATE/pane.log")"
  [ -e "$STATE/ready" ] || fail "green CI in the pane did not mark the PR ready"
  echo "ok: inside Herdr the watch runs in a sibling pane and marks ready on green"
)

# From a linked worktree the PR is opened for that worktree's branch and checkout, with no
# --repo needed; every gh call runs there so gh resolves the repo from its remote.
(
  setup 0 pass 0
  git checkout -q --detach
  git worktree add -q "$work/linked" "$BRANCH"
  cd "$work/linked"
  ship
  [ "$rc" -eq 0 ] || fail "expected exit 0 from a linked worktree, got $rc: $(cat "$work/out.log")"
  [ -e "$STATE/created" ] || fail "no PR was created: $(cat "$work/out.log")"
  [ -s "$work/linked/.foundry/pr-url" ] || fail "the PR url was not written into the linked worktree"
  [ ! -e "$work/repo/.foundry" ] || fail "wrote state into the main checkout instead of the linked worktree"
  watch_verdict "$work/linked/.foundry/pr-watch.log"
  linked=$(cd "$work/linked" && pwd)
  if cut -f1 "$STATE/calls" | grep -vxF "$linked"; then
    fail "a gh call ran outside the linked worktree: $(cat "$STATE/calls")"
  fi
  if grep -q -- '--repo' "$STATE/calls"; then fail "passed --repo to gh: $(cat "$STATE/calls")"; fi
  echo "ok: from a linked worktree, opens the PR for that checkout without --repo"
)

# --repo is refused up front, before anything is pushed or created, so a caller never ends up
# with a PR but no watch.
(
  setup 0 pass 0; ship --repo CMaintz/elsewhere
  [ "$rc" -eq 2 ] || fail "expected exit 2 for --repo, got $rc: $(cat "$work/out.log")"
  [ ! -e "$STATE/calls" ] || fail "called gh despite refusing --repo: $(cat "$STATE/calls")"
  [ "$(git -C "$REMOTE" rev-parse "refs/heads/$BRANCH")" = "$(cat "$STATE/old_sha")" ] \
    || fail "pushed before refusing --repo"
  grep -q 'remote' "$work/out.log" || fail "did not say the repo comes from the git remote: $(cat "$work/out.log")"
  echo "ok: refuses --repo before pushing"
)

# A rejected push has its own exit code, so ship does not go looking for CI logs.
(
  setup 2 fail
  git clone -q -b "$BRANCH" "$REMOTE" "$work/other" 2> /dev/null
  git -C "$work/other" -c user.email=t@example.com -c user.name=test commit -q --allow-empty -m elsewhere
  git -C "$work/other" push -q origin "HEAD:$BRANCH" 2> /dev/null
  ship
  [ "$rc" -eq 3 ] || fail "expected exit 3 on a rejected push, got $rc: $(cat "$work/out.log")"
  echo "ok: a rejected push exits 3"
)
