#!/usr/bin/env bash
# Vendor a published @cmaintz/jev-core into scripts/jev/vendor/jev-core, so the Jev scripts
# and hooks run with plain node and no npm install. Copies the package's built JS (no
# types or source maps) and its LICENSE, plus a package.json that records the version.
#
#   scripts/jev/vendor-jev-core.sh 0.4.0
set -euo pipefail

version="${1:?usage: vendor-jev-core.sh <version>}"
dest="$(cd "$(dirname "$0")" && pwd)/vendor/jev-core"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

(cd "$tmp" && npm pack "@cmaintz/jev-core@$version" --silent > /dev/null && tar xzf ./*.tgz)
rm -rf "$dest"
mkdir -p "$dest"
for f in "$tmp"/package/dist/*.js; do
  grep -v '^//# sourceMappingURL=' "$f" > "$dest/$(basename "$f")"
done
cp "$tmp/package/LICENSE" "$dest/LICENSE"
printf '{\n  "name": "@cmaintz/jev-core",\n  "version": "%s",\n  "private": true,\n  "type": "module"\n}\n' \
  "$version" > "$dest/package.json"
echo "vendored @cmaintz/jev-core@$version into $dest"
