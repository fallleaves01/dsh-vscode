#!/usr/bin/env bash
# Rebuild the DSH Sidebar extension and package a VSIX.
#
#   ./build.sh          ->  artifacts/dsh-sidebar-<version>.vsix
#
# Build caches live in ./.build so nothing leaks into the global pnpm/npm state.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$here"

export PNPM_HOME="$here/.build/pnpm-home"
export XDG_DATA_HOME="$here/.build/xdg-data"
export XDG_CACHE_HOME="$here/.build/xdg-cache"
export XDG_STATE_HOME="$here/.build/xdg-state"
export npm_config_cache="$here/.build/npm-cache"

if [ ! -x node_modules/.bin/vsce ]; then
  echo "==> installing dependencies"
  pnpm install --frozen-lockfile --store-dir "$here/.build/pnpm-store"
fi

echo "==> building"
node scripts/build.mjs

echo "==> packaging"
./node_modules/.bin/vsce package --readme-path README.marketplace.md --out dsh-vscode.vsix

version="$(grep -m1 '"version"' package.json | sed -E 's/.*"version" *: *"([^"]+)".*/\1/')"
mkdir -p "$here/artifacts"
out="$here/artifacts/dsh-sidebar-$version.vsix"
cp dsh-vscode.vsix "$out"
echo "==> wrote $out"
