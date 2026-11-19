#!/usr/bin/env bash
# Create the working tree for one product and install the build dependencies.
#
# The preview build needs two packages and nothing else: three (the runtime the generated factory
# imports) and esbuild (bundles src/main.ts into a single script the page loads). Pinning them matters:
# a newer three can change PMREM or OrbitControls behaviour and silently move the lighting a review
# already signed off on.
set -euo pipefail

WP="${1:?usage: setup_workspace.sh <work-dir>}"
mkdir -p "$WP"/reference "$WP"/spec/crops "$WP"/spec/pbr "$WP"/src "$WP"/review/captures "$WP"/dist "$WP"/build/src

cd "$WP/build"
if [ ! -d node_modules/three ] || [ ! -d node_modules/esbuild ]; then
  [ -f package.json ] || npm init -y >/dev/null
  npm install --no-fund --no-audit three@0.169.0 esbuild@0.24.0 >/dev/null
fi

echo "workspace ready: $WP"
echo "next: put the photo(s) in $WP/reference/ref.jpg, then write $WP/spec/object-sculpt-spec.json"