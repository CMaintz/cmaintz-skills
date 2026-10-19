#!/usr/bin/env bash
# Tests hooks/pre-commit in throwaway repos. A stub prettier stands in for the real one
# (it rewrites UGLY to pretty), so the test needs no network or node_modules.
#   Usage: tests/pre-commit.test.sh
set -euo pipefail

HOOK="$(cd "$(dirname "$0")/.." && pwd)/hooks/pre-commit"

fail() { echo "FAIL: $*" >&2; exit 1; }

new_repo() {
  cd "$(mktemp -d)"
  git init -q
  git config user.email t@example.com
  git config user.name test
  git config core.hooksPath hooks
  mkdir hooks
  cp "$HOOK" hooks/pre-commit
  chmod +x hooks/pre-commit
}

with_stub_prettier() {
  mkdir -p node_modules/.bin
  cat > node_modules/.bin/prettier <<'EOF'
#!/bin/sh
for a in "$@"; do case "$a" in -*) ;; *) sed -i.bak 's/UGLY/pretty/' "$a" && rm -f "$a.bak" ;; esac; done
EOF
  chmod +x node_modules/.bin/prettier
  printf 'node_modules/\n' > .gitignore
  git add .gitignore
}

# A staged file is formatted before it is committed.
(
  new_repo; with_stub_prettier
  printf 'UGLY\n' > a.ts
  git add a.ts
  git commit -q -m one
  [ "$(git show HEAD:a.ts)" = pretty ] || fail "staged file was not formatted in the commit"
  echo "ok: formats staged files"
)

# A partially staged file is left alone: formatting and re-adding it would sweep the
# unstaged hunk into the commit.
(
  new_repo; with_stub_prettier
  printf 'line1\n' > a.ts
  git add a.ts
  git commit -q -m base
  printf 'UGLY staged\n' > a.ts
  git add a.ts
  printf 'UGLY staged\nunstaged work\n' > a.ts
  git commit -q -m two 2> err.log
  [ "$(git show HEAD:a.ts)" = "UGLY staged" ] || fail "partially staged file: commit got $(git show HEAD:a.ts)"
  grep -q 'unstaged work' a.ts || fail "unstaged work was lost from the working tree"
  echo "ok: skips partially staged files"
)

# No local prettier: the hook does nothing and the commit goes through unchanged.
(
  new_repo
  printf 'UGLY\n' > a.ts
  git add a.ts
  git commit -q -m one
  [ "$(git show HEAD:a.ts)" = UGLY ] || fail "changed a file without a prettier install"
  echo "ok: no-op without prettier"
)
