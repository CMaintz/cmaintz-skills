#!/usr/bin/env bash
# Tests plugins/foundry/scripts/foundry-pr-report against a stub gh, so it needs no network.
# The stub enforces real gh's rule that `pr checks` and `pr view` take an explicit
# <number>|<url>|<branch> once --repo is given, and answers for the PR of branch feat/x,
# whose one check is in BUCKET.
#   Usage: tests/foundry-pr-report.test.sh
set -euo pipefail

SCRIPT="$(cd "$(dirname "$0")/.." && pwd)/plugins/foundry/scripts/foundry-pr-report"

fail() { echo "FAIL: $*" >&2; exit 1; }

setup() { # <bucket>
  work="$(mktemp -d)"
  export BUCKET="$1"
  mkdir -p "$work/bin"
  git init -q -b feat/x "$work/repo"
  cd "$work/repo"
  git -c user.email=t@example.com -c user.name=test commit -q --allow-empty -m one

  cat > "$work/bin/gh" <<'STUB'
#!/usr/bin/env bash
case "$*" in
  "pr checks --repo"* | "pr view --repo"*)
    echo "argument required when using the --repo flag" >&2; exit 1 ;;
  "pr checks --json"* | "pr checks feat/x "*) ;;
  *) echo "stub gh: unexpected call: $*" >&2; exit 9 ;;
esac
case "$*" in
  *'select(.bucket=="fail"'*length*) [ "$BUCKET" = fail ] && echo 1 || echo 0 ;;
  *'select(.bucket=="pending")'*) [ "$BUCKET" = pending ] && echo 1 || echo 0 ;;
  *'.link'*) echo https://example.test/actions/runs/1/job/2 ;;
  *'\(.bucket)'*) printf '%s\tgate\n' "$BUCKET" ;;
esac
STUB
  chmod +x "$work/bin/gh"
}

report() {
  rc=0
  PATH="$work/bin:$PATH" "$SCRIPT" "$@" > "$work/out.log" 2>&1 || rc=$?
}

# With no PR number gh resolves the current branch's PR itself.
(
  setup pass; report
  [ "$rc" -eq 0 ] || fail "expected a green verdict, got exit $rc: $(cat "$work/out.log")"
  echo "ok: no arguments judges the current branch's PR"
)

# --repo alone must still mean the current branch's PR, not a gh usage error.
(
  setup pass; report --repo owner/repo
  [ "$rc" -eq 0 ] || fail "expected a green verdict, got exit $rc: $(cat "$work/out.log")"
  grep -q 'all checks passed' "$work/out.log" || fail "no verdict printed: $(cat "$work/out.log")"
  echo "ok: --repo without a PR judges the current branch's PR"
)

(
  setup pending; report --repo owner/repo
  [ "$rc" -eq 2 ] || fail "expected exit 2 for pending checks, got $rc: $(cat "$work/out.log")"
  echo "ok: --repo without a PR reports pending checks as pending"
)

# A detached HEAD has no branch to look up, so the script must say so instead of guessing.
(
  setup pass; git checkout -q --detach; report --repo owner/repo
  [ "$rc" -eq 2 ] || fail "expected a usage exit 2 on a detached HEAD, got $rc: $(cat "$work/out.log")"
  grep -q 'pass the PR number' "$work/out.log" || fail "no clear message on a detached HEAD: $(cat "$work/out.log")"
  echo "ok: --repo on a detached HEAD asks for the PR number"
)
