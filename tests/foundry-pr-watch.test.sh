#!/usr/bin/env bash
# Tests plugins/foundry/scripts/foundry-pr-watch against a stub gh, so it needs no network.
# The stub models GitHub lag: the PR keeps showing its previous head, and that commit's
# finished passing check, until its head has been asked for LAG times; after that it shows
# the local HEAD (the commit just pushed), which has CHECKS checks, all in BUCKET (fail
# unless a case says otherwise). Like real gh it refuses `pr view`/`pr checks` with --repo
# and no <number>|<url>|<branch>; the PR of branch feat/x is 37.
#   Usage: tests/foundry-pr-watch.test.sh
set -euo pipefail

SCRIPT="$(cd "$(dirname "$0")/.." && pwd)/plugins/foundry/scripts/foundry-pr-watch"

fail() { echo "FAIL: $*" >&2; exit 1; }

setup() { # <lag> <checks on the pushed head> [bucket]
  work="$(mktemp -d)"
  export STATE="$work/state" LAG="$1" CHECKS="$2" BUCKET="${3:-fail}"
  mkdir -p "$STATE" "$work/bin"
  git init -q -b feat/x "$work/repo"
  cd "$work/repo"
  git -c user.email=t@example.com -c user.name=test commit -q --allow-empty -m pushed
  export NEW_SHA; NEW_SHA=$(git rev-parse HEAD)

  cat > "$work/bin/gh" <<'EOF'
#!/usr/bin/env bash
asked=$(cat "$STATE/head_asked" 2> /dev/null || echo 0)
if [ "$asked" -ge "$LAG" ]; then
  head=$NEW_SHA; bucket=$BUCKET; n=$CHECKS
else
  head=0000000000000000000000000000000000000000; bucket=pass; n=1
fi
case "$*" in
  "pr view --repo"* | "pr checks --repo"*)
    echo "argument required when using the --repo flag" >&2; exit 1 ;;
esac
# The --repo case reuses the plain stubs below once its flag is dropped.
args=$*; args=${args/ --repo owner\/repo/}
case "$args" in
  "pr view --json number -q .number" | "pr view feat/x --json number -q .number") echo 37 ;;
  *headRefOid*) echo $((asked + 1)) > "$STATE/head_asked"; echo "$head" ;;
  "pr checks 37 --watch"*) ;;
  "pr checks 37 --json name -q length") echo "$n" ;;
  *'select(.bucket=="fail"'*length*) [ "$bucket" = fail ] && echo "$n" || echo 0 ;;
  *'select(.bucket=="pending")'*) echo 0 ;;
  *'.link'*) echo https://example.test/actions/runs/1/job/2 ;;
  *'\(.bucket)'*) [ "$n" -gt 0 ] && printf '%s\tgate\n' "$bucket" || true ;;
  "run view"*) echo "step failed" ;;
  "pr ready 37") touch "$STATE/ready" ;;
  *) echo "stub gh: unexpected call: $*" >&2; exit 9 ;;
esac
EOF
  chmod +x "$work/bin/gh"
}

watch() {
  rc=0
  PATH="$work/bin:$PATH" FOUNDRY_PR_WATCH_POLL_SECONDS=0 "$SCRIPT" 37 "$@" > "$work/out.log" 2>&1 || rc=$?
}

watch_without_pr() {
  rc=0
  PATH="$work/bin:$PATH" FOUNDRY_PR_WATCH_POLL_SECONDS=0 "$SCRIPT" "$@" > "$work/out.log" 2>&1 || rc=$?
}

# Right after a push the PR still shows the previous commit's finished green run; the
# verdict must be the pushed commit's failing check.
(
  setup 2 1; watch
  [ "$rc" -eq 1 ] || fail "expected the pushed commit's failing check (exit 1), got exit $rc: $(cat "$work/out.log")"
  echo "ok: judges the pushed commit's checks, not the previous commit's"
)

# A pushed commit that never gets checks is not green.
(
  setup 0 0; watch
  [ "$rc" -eq 2 ] || fail "expected exit 2 when no checks register, got $rc: $(cat "$work/out.log")"
  grep -q 'no checks registered' "$work/out.log" || fail "did not say no checks registered: $(cat "$work/out.log")"
  echo "ok: a commit with no checks is reported, not passed"
)

# A PR whose head never becomes the pushed commit is reported as that.
(
  setup 1000 1; watch
  [ "$rc" -eq 2 ] || fail "expected exit 2 when the PR head never moves, got $rc"
  grep -q 'never reached' "$work/out.log" || fail "did not say the PR head never reached the push: $(cat "$work/out.log")"
  echo "ok: reports a PR head that never reaches the pushed commit"
)

# --ready-on-green is how foundry-ship-pr's draft becomes ready: only a green verdict flips it.
(
  setup 0 1 pass; watch --ready-on-green
  [ "$rc" -eq 0 ] || fail "expected a green verdict, got exit $rc: $(cat "$work/out.log")"
  [ -e "$STATE/ready" ] || fail "--ready-on-green did not mark the PR ready on green"
  echo "ok: --ready-on-green marks the PR ready on green"
)

(
  setup 2 1; watch --ready-on-green
  [ "$rc" -eq 1 ] || fail "expected the pushed commit's failing check (exit 1), got exit $rc"
  [ ! -e "$STATE/ready" ] || fail "--ready-on-green marked the PR ready on the previous commit's green"
  echo "ok: --ready-on-green leaves a red PR as a draft"
)

# Without the flag a watch only reports: a deliberately-draft PR is never flipped.
(
  setup 0 1 pass; watch
  [ ! -e "$STATE/ready" ] || fail "marked the PR ready without --ready-on-green"
  echo "ok: a plain watch never marks the PR ready"
)

# Without a PR number the watch follows the current branch's PR, with or without --repo.
(
  setup 0 1 pass; watch_without_pr
  [ "$rc" -eq 0 ] || fail "expected a green verdict, got exit $rc: $(cat "$work/out.log")"
  echo "ok: no PR number watches the current branch's PR"
)

(
  setup 0 1 pass; watch_without_pr --repo owner/repo
  [ "$rc" -eq 0 ] || fail "expected a green verdict, got exit $rc: $(cat "$work/out.log")"
  echo "ok: --repo without a PR number watches the current branch's PR"
)
