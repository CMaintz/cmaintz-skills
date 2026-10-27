#!/usr/bin/env bash
# Tests the smell-trend block of plugins/foundry/scripts/foundry-loop-report against
# fixture telemetry. The verb half is exercised by the script's own behaviour; this
# pins the convergence signal the design calls for: a smell that returns after being
# cleared is thrash, a partial (incomplete-run) scan must not read as "everything
# cleared", and a row that carries no smells at all is not a cleared scan.
#   Usage: tests/foundry-loop-report.test.sh
set -euo pipefail

SCRIPT="$(cd "$(dirname "$0")/.." && pwd)/plugins/foundry/scripts/foundry-loop-report"

fail() { echo "FAIL: $*" >&2; exit 1; }

# Run the report over a fixture of one JSONL row per argument, returning its stdout.
report() {
  local f
  f="$(mktemp)"
  printf '%s\n' "$@" > "$f"
  python "$SCRIPT" "$f"
}

# A smell cleared (gone from the scan) and then seen again is non-converging.
(
  out="$(report \
    '{"ms":1,"verb":"lint","exit":0,"smells":{"a":2}}' \
    '{"ms":2,"verb":"lint","exit":0,"smells":{}}' \
    '{"ms":3,"verb":"lint","exit":0,"smells":{"a":1}}')"
  grep -q 'Smells: non-converging' <<< "$out" || fail "a return after clear was not flagged: $out"
  grep -q 'a cleared then returned x1' <<< "$out" || fail "the returning smell was not named: $out"
  echo "ok: a smell cleared then seen again is non-converging"
)

# A monotonically falling count is convergent - no return.
(
  out="$(report \
    '{"ms":1,"verb":"lint","exit":0,"smells":{"a":2}}' \
    '{"ms":2,"verb":"lint","exit":0,"smells":{"a":1}}' \
    '{"ms":3,"verb":"lint","exit":0,"smells":{}}')"
  grep -q 'Smells: converging' <<< "$out" || fail "a falling count was not read as converging: $out"
  ! grep -q 'non-converging' <<< "$out" || fail "a falling count was wrongly flagged as thrash: $out"
  echo "ok: a monotonically falling count is convergent"
)

# A partial (incomplete-run) scan between two full scans must be excluded, or `a` would
# read as 2 -> (absent=0) -> 1 and look like a false return. This is the trap.
(
  out="$(report \
    '{"ms":1,"verb":"lint","exit":0,"smells":{"a":2}}' \
    '{"ms":2,"verb":"lint","exit":1,"smells":{"incomplete-run":1}}' \
    '{"ms":3,"verb":"lint","exit":0,"smells":{"a":1}}')"
  ! grep -q 'non-converging' <<< "$out" || fail "a partial scan produced a false return: $out"
  grep -q 'Smells: converging' <<< "$out" || fail "expected converging once the partial scan is dropped: $out"
  grep -q '1 partial scan' <<< "$out" || fail "the excluded partial scan was not reported: $out"
  echo "ok: an incomplete-run scan is excluded from the trend"
)

# A row carrying no smells key is not a scan; it must not read as a cleared scan and so
# turn 1 -> (no key) -> 1 into a false return.
(
  out="$(report \
    '{"ms":1,"verb":"lint","exit":0,"smells":{"a":1}}' \
    '{"ms":2,"verb":"test","exit":0}' \
    '{"ms":3,"verb":"lint","exit":0,"smells":{"a":1}}')"
  ! grep -q 'non-converging' <<< "$out" || fail "a smells-less row read as a cleared scan: $out"
  grep -q 'Smells: converging' <<< "$out" || fail "expected converging across smells-less rows: $out"
  echo "ok: a row with no smells key is ignored, not read as cleared"
)

# A smell appearing for the first time in a later scan is scope growing, not a return:
# it was never present-then-cleared. (Red if the state machine started at "cleared".)
(
  out="$(report \
    '{"ms":1,"verb":"lint","exit":0,"smells":{"a":1}}' \
    '{"ms":2,"verb":"lint","exit":0,"smells":{"a":1,"b":3}}')"
  ! grep -q 'non-converging' <<< "$out" || fail "a first-time smell was flagged as a return: $out"
  ! grep -q 'b cleared then returned' <<< "$out" || fail "a newcomer smell counted as cleared then returned: $out"
  echo "ok: a smell's first appearance is scope growth, not a return"
)

# No scan wrote counts at all: say so plainly rather than invent a trend.
(
  out="$(report \
    '{"ms":1,"verb":"lint","exit":0}' \
    '{"ms":2,"verb":"test","exit":0}')"
  grep -q 'Smells: not recorded' <<< "$out" || fail "no-smells telemetry did not say so: $out"
  echo "ok: telemetry with no smell counts reports not recorded"
)
