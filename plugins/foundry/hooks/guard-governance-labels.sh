#!/usr/bin/env bash
# Foundry - keep the governance labels a human decision (PreToolUse/Bash).
# `ruleset-change` and `suppression` are how a human signs off on a weakened rule or a new
# suppression, so an agent applying one would approve its own exemption. This hook denies
# a Bash call that applies, aliases or (re)defines either label: --add-label/--label on
# gh pr|issue edit|create, a writing `gh api` call on labels, and gh label create|edit.
# Removing one, reading it, and every other label pass. It sees only the command string,
# so a label name hidden in a variable or an --input file is not caught.
set -u

payload=$(cat)
tool=$(printf '%s' "$payload" | sed -n 's/.*"tool_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)
[ "$tool" = "Bash" ] || exit 0

# The command ONLY, never the whole payload, so a description that mentions a label does
# not trip the guard. ERE because BSD sed rejects BRE `\|` and would extract nothing.
cmd=$(printf '%s' "$payload" | sed -nE 's/.*"command"[[:space:]]*:[[:space:]]*"(([^"\\]|\\.)*)".*/\1/p' | head -n1)
# Undo the JSON escaping that matters here: \n \r \t become spaces, \" a plain quote.
cmd=$(printf '%s' "$cmd" | sed -e 's/\\[nrt]/ /g' -e 's/\\"/"/g')

name='(ruleset-change|suppression)'
bounded="(^|[^[:alnum:]_-])${name}([^[:alnum:]_-]|$)"
gh='(^|[^[:alnum:]_./-])gh[[:space:]]+'
# A label flag whose value, bare, quoted or a comma list, holds a governance name.
label_flag="(^|[[:space:]])(--add-label|--label|-l)(=|[[:space:]]+)([\"']?|[\"'][^\"']*[,[:space:]]|[^\"'[:space:]]*,)${name}([^[:alnum:]_:/-]|$)"
# gh api writes when given a POST/PUT/PATCH method, or fields with no method (gh then POSTs).
api_method='(^|[[:space:]])(-X|--method)(=|[[:space:]]*)["'"'"']?(POST|PUT|PATCH|post|put|patch)'
api_any_method='(^|[[:space:]])(-X|--method)'
api_fields='(^|[[:space:]])(-[fF]|--field|--raw-field)'

denied=0
# One chained command per line, so a name echoed later in the chain is judged on its own.
while IFS= read -r seg; do
  if printf '%s' "$seg" | grep -Eq "${gh}(pr|issue)[[:space:]]+(edit|create)([^[:alnum:]_-]|$)"; then
    printf '%s' "$seg" | grep -Eq "$label_flag" && denied=1
  elif printf '%s' "$seg" | grep -Eq "${gh}label[[:space:]]+(create|edit)([^[:alnum:]_-]|$)"; then
    printf '%s' "$seg" | grep -Eq "$bounded" && denied=1
  elif printf '%s' "$seg" | grep -Eq "${gh}api([^[:alnum:]_-]|$)"; then
    printf '%s' "$seg" | grep -q labels || continue
    printf '%s' "$seg" | grep -Eq "$bounded" || continue
    if printf '%s' "$seg" | grep -Eq "$api_method"; then denied=1
    elif ! printf '%s' "$seg" | grep -Eq "$api_any_method" && printf '%s' "$seg" | grep -Eq "$api_fields"; then denied=1
    fi
  fi
done <<EOF
$(printf '%s\n' "$cmd" | tr ';' '\n' | tr '&' '\n' | tr '|' '\n')
EOF
[ "$denied" -eq 1 ] || exit 0

{
  echo "The ruleset-change and suppression labels are a human's sign-off, so an agent must not apply,"
  echo "alias or redefine them. Say in the PR why the change needs one and leave the label to a human."
} >&2
exit 2
