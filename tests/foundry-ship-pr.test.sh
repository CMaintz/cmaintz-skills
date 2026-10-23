#!/usr/bin/env bash
# Tests plugins/foundry/scripts/foundry-ship-pr against a local bare remote and a stub gh,
# so it needs no network. The stub models GitHub lag: the PR keeps showing its previous
# head, and that commit's finished passing check, until its head has been asked for LAG
# times; after that it shows the pushed head, whose check fails.
#   Usage: tests/foundry-ship-pr.test.sh
set -euo pipefail

SCRIPT="$(cd "$(dirname "$0")/.." && pwd)/plugins/foundry/scripts/foundry-ship-pr"

fail() { echo "FAIL: $*" >&2; exit 1; }

# A branch whose PR head is commit one, with commit two made locally and not yet pushed.
setup() {
  work="$(mktemp -d)"
  export STATE="$work/state" REMOTE="$work/remote.git" BRANCH=feat/x LAG="$1"
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

  cat > "$work/bin/gh" <<'EOF'
#!/usr/bin/env bash
asked=$(cat "$STATE/head_asked" 2> /dev/null || echo 0)
if [ "$asked" -ge "$LAG" ]; then
  head=$(git -C "$REMOTE" rev-parse "refs/heads/$BRANCH"); bucket=fail
else
  head=$(cat "$STATE/old_sha"); bucket=pass
fi
case "$*" in
  "pr view --json number"*) echo 37 ;;
  "pr view 37 --json url"*) echo https://example.test/pr/37 ;;
  *headRefOid*) echo $((asked + 1)) > "$STATE/head_asked"; echo "$head" ;;
  "pr checks 37 --watch"*) ;;
  *'select(.bucket=="fail"'*length*) [ "$bucket" = fail ] && echo 1 || echo 0 ;;
  *'select(.bucket=="pending")'*) echo 0 ;;
  *'.link'*) echo https://example.test/actions/runs/1/job/2 ;;
  *'\(.bucket)'*) printf '%s\tgate\n' "$bucket" ;;
  "pr checks 37 --json name -q length") echo 1 ;;
  "run view"*) echo "step failed" ;;
  "pr ready"*) touch "$STATE/ready" ;;
  *) echo "stub gh: unexpected call: $*" >&2; exit 9 ;;
esac
EOF
  chmod +x "$work/bin/gh"
  printf 'body\n' > "$work/body.md"
}

ship() {
  rc=0
  PATH="$work/bin:$PATH" FOUNDRY_SHIP_PR_POLL_SECONDS=0 "$SCRIPT" --body-file "$work/body.md" > "$work/out.log" 2>&1 || rc=$?
}

# An existing PR gets the new commit pushed, and its verdict is the new commit's checks,
# not the previous commit's run that is still on the PR when the script starts.
(
  setup 2; ship
  [ "$(git -C "$REMOTE" rev-parse "refs/heads/$BRANCH")" = "$(git rev-parse HEAD)" ] \
    || fail "the new commit was not pushed to the existing PR's branch (exit $rc): $(cat "$work/out.log")"
  [ "$rc" -eq 1 ] || fail "expected the new commit's failing check (exit 1), got exit $rc: $(cat "$work/out.log")"
  [ ! -e "$STATE/ready" ] || fail "marked the PR ready on a stale green"
  echo "ok: pushes to an existing PR and judges the pushed commit's checks"
)

# A PR whose head never becomes the pushed commit is reported as that, not as missing CI.
(
  setup 1000; ship
  [ "$rc" -eq 2 ] || fail "expected exit 2 when the PR head never moves, got $rc"
  grep -q 'never reached' "$work/out.log" || fail "did not say the PR head never reached the push: $(cat "$work/out.log")"
  echo "ok: reports a PR head that never reaches the pushed commit"
)

# A rejected push has its own exit code, so ship does not go looking for CI logs.
(
  setup 2
  git clone -q -b "$BRANCH" "$REMOTE" "$work/other" 2> /dev/null
  git -C "$work/other" -c user.email=t@example.com -c user.name=test commit -q --allow-empty -m elsewhere
  git -C "$work/other" push -q origin "HEAD:$BRANCH" 2> /dev/null
  ship
  [ "$rc" -eq 3 ] || fail "expected exit 3 on a rejected push, got $rc: $(cat "$work/out.log")"
  echo "ok: a rejected push exits 3"
)
