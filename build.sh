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

# Reproducibility guard: package.json names the pnpm release the lockfile was
# generated with. A different pnpm can resolve or lay out dependencies
# differently, so warn loudly (do not fail: local contributors may be testing a
# newer pnpm, and CI pins the exact version through pnpm/action-setup).
package_manager="$(node -e "const p=require('./package.json'); process.stdout.write(String(p.packageManager || ''))" 2>/dev/null || true)"
expected_pnpm=''
actual_pnpm=''
if [[ "$package_manager" == pnpm@* ]]; then
  expected_pnpm="${package_manager#pnpm@}"
  actual_pnpm="$(pnpm --version 2>/dev/null || true)"
  if [[ -z "$actual_pnpm" ]]; then
    echo "WARNING: could not determine the installed pnpm version; package.json expects pnpm@$expected_pnpm." >&2
  elif [[ "$actual_pnpm" != "$expected_pnpm" ]]; then
    echo "WARNING: pnpm $actual_pnpm is installed but package.json packageManager expects pnpm@$expected_pnpm; the packaged result may differ from CI." >&2
  fi
fi
node_version="$(node --version 2>/dev/null || echo unknown)"
echo "==> environment: node $node_version, pnpm ${actual_pnpm:-unknown}${expected_pnpm:+ (expected pnpm@$expected_pnpm)}"
mkdir -p "$here/.build"
printf 'node=%s\npnpm=%s\npackageManager=%s\n' "$node_version" "${actual_pnpm:-unknown}" "${package_manager:-unset}" > "$here/.build/build-env.txt"

if [ ! -x node_modules/.bin/vsce ]; then
  echo "==> installing dependencies"
  pnpm install --frozen-lockfile --store-dir "$here/.build/pnpm-store"
fi

echo "==> building"
node scripts/build.mjs

echo "==> packaging"
# The extension is fully bundled by esbuild above. The npm dependencies are kept
# for audit/SCA visibility, but VSCE's dependency detection cannot walk pnpm's
# virtual store and would either fail or add node_modules to the VSIX. Package
# without dependencies; do not remove these two flags.
./node_modules/.bin/vsce package --readme-path README.marketplace.md --no-dependencies --out dsh-vscode.vsix

version="$(grep -m1 '"version"' package.json | sed -E 's/.*"version" *: *"([^"]+)".*/\1/')"
mkdir -p "$here/artifacts"
out="$here/artifacts/dsh-sidebar-$version.vsix"
cp dsh-vscode.vsix "$out"
echo "==> wrote $out"
