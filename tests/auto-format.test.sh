#!/usr/bin/env bash
# Tests hooks/auto-format.sh and hooks/pre-commit against a stub prettier that knows
# one config file (.prettierrc beside the file) and marks every file it writes, so the
# test needs no network or node_modules. Real prettier ignores --find-config-path after a
# `--` (it formats to stdout and exits 0), so the stub refuses that pairing.
#   Usage: tests/auto-format.test.sh
set -euo pipefail

HOOKS="$(cd "$(dirname "$0")/../plugins/foundry" && pwd)/hooks"
unset CI

fail() { echo "FAIL: $*" >&2; exit 1; }

new_project() {
  cd "$(mktemp -d)"
  git init -q
  git config user.email t@example.com
  git config user.name test
  mkdir -p node_modules/.bin
  cat > node_modules/.bin/prettier <<'EOF'
#!/bin/sh
mode=write
for a in "$@"; do
  case "$a" in
    --find-config-path) mode=find ;;
    --) [ "$mode" = find ] && exit 3 ;;
    -*) ;;
    *) if [ "$mode" = find ]; then [ -f "$(dirname "$a")/.prettierrc" ]; exit $?; fi
       printf 'formatted\n' >> "$a" ;;
  esac
done
EOF
  chmod +x node_modules/.bin/prettier
  printf 'node_modules/\n' > .gitignore
}

run_auto_format() { # <file> - feed the hook a PostToolUse payload for <file>
  printf '{"tool_input":{"file_path":"%s"}}' "$(pwd)/$1" | bash "$HOOKS/auto-format.sh"
}

# Without a project config, prettier's defaults would restyle the file; the hook must not run it.
(
  new_project
  printf 'x\n' > a.ts
  run_auto_format a.ts > out.json
  ! grep -q formatted a.ts || fail "auto-format ran prettier with no project config"
  node -e 'const o = JSON.parse(require("fs").readFileSync("out.json", "utf8")); if (!/no Prettier config/.test(o.hookSpecificOutput.additionalContext)) process.exit(1)' ||
    fail "auto-format gave no hint the model can read: $(cat out.json)"
  echo "ok: auto-format skips prettier without a config, with a hint"
)

(
  new_project
  printf '{}\n' > .prettierrc
  printf 'x\n' > a.ts
  run_auto_format a.ts > out.json
  grep -q formatted a.ts || fail "auto-format did not format with a project config"
  [ ! -s out.json ] || fail "auto-format printed a hint despite a config: $(cat out.json)"
  echo "ok: auto-format formats when the project has a config"
)

commit_with_hook() { # <file> - stage <file> and commit it through hooks/pre-commit
  mkdir -p hooks && cp "$HOOKS/pre-commit" hooks/pre-commit && chmod +x hooks/pre-commit
  git config core.hooksPath hooks
  git add .gitignore "$1"
  git commit -q -m one 2> err.log
}

(
  new_project
  printf 'x\n' > a.ts
  commit_with_hook a.ts
  ! git show HEAD:a.ts | grep -q formatted || fail "pre-commit ran prettier with no project config"
  grep -q 'no Prettier config' err.log || fail "pre-commit gave no hint: $(cat err.log)"
  echo "ok: pre-commit skips prettier without a config, with a hint"
)

(
  new_project
  printf '{}\n' > .prettierrc
  printf 'x\n' > a.ts
  git add .prettierrc
  commit_with_hook a.ts
  git show HEAD:a.ts | grep -q formatted || fail "pre-commit did not format with a project config"
  echo "ok: pre-commit formats when the project has a config"
)
