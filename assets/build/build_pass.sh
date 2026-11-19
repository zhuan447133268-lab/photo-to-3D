#!/usr/bin/env bash
# Regenerate one build pass and bundle the preview.
#
# Every pass is generated from spec/, never edited by hand: the generator overwrites the factory on the
# next run, so a fix typed into src/model.ts survives exactly one pass and then vanishes without a diff
# to explain it. This script makes that loop one command.
#
# Usage:
#   build_pass.sh <work-dir> <pass-id> [engine-dir]
#
# pass-id: blockout | structural-pass | form-refinement | material-pass
#          surface-pass | lighting-pass | interaction-pass | optimization-pass
#
# The factory is always written to <work-dir>/src/model.ts. Keeping the filename fixed is what lets this
# script, the bundler and the viewer template agree without passing paths around; the exported function
# names still carry the subject (createSonyMDRZX310HeadphonesModel), so readability does not suffer.
set -euo pipefail

WP="${1:?usage: build_pass.sh <work-dir> <pass-id> [engine-dir]}"
PASS="${2:?pass id required}"
ENGINE="${3:-$HOME/.workbuddy/skills/img2threejs}"
SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

SPEC="$WP/spec/object-sculpt-spec.json"
FACTORY="$WP/src/model.ts"
BUILD="$WP/build"

[ -f "$SPEC" ] || { echo "missing spec: $SPEC" >&2; exit 1; }
[ -f "$ENGINE/forge/stage3_build/generate_threejs_factory.py" ] \
  || { echo "engine not found at $ENGINE (pass it as the third argument)" >&2; exit 1; }

# 1. generate the factory for this pass
python "$ENGINE/forge/stage3_build/generate_threejs_factory.py" "$SPEC" \
  --pass-id "$PASS" --out "$FACTORY" --force
cp -f "$FACTORY" "$BUILD/src/model.ts"

# 2. textures load by bare filename, so they must live at the page root
mkdir -p "$BUILD"
if [ -d "$WP/spec/pbr" ]; then
  dupes=$(find "$WP/spec/pbr" -type f -name '*.png' -printf '%f\n' | sort | uniq -d)
  if [ -n "$dupes" ]; then
    echo "duplicate texture basenames — one would silently overwrite the other:" >&2
    echo "$dupes" >&2
    echo "rename them like '<material>-albedo.png' inside spec/pbr/<material>/" >&2
    exit 1
  fi
  find "$WP/spec/pbr" -type f -name '*.png' -exec cp -f {} "$BUILD/" \;
fi

# 3. the page shows the original photo next to the model; missing means a blank card, not a crash
[ -f "$WP/reference/ref.jpg" ] && cp -f "$WP/reference/ref.jpg" "$BUILD/ref.jpg"

# 4. build the viewer shell once; re-run render_viewer.py directly to change titles or exposure
if [ ! -f "$BUILD/index.html" ] || [ ! -f "$WP/src/main.ts" ]; then
  python "$SKILL_DIR/assets/viewer/render_viewer.py" \
    --factory-file "$FACTORY" --out-dir "$WP/src" --build-dir "$BUILD"
fi
[ -f "$WP/src/main.ts" ] || { echo "viewer shell missing: $WP/src/main.ts" >&2; exit 1; }

# The bundler runs from build/, so its entry point and the factory both live under build/src. The
# authoritative copies stay in <work>/src; these are re-copied every pass so edits there win.
cp -f "$WP/src/main.ts" "$BUILD/src/main.ts"

# 5. bundle
cd "$BUILD"
if [ -x ./node_modules/.bin/esbuild ]; then
  ./node_modules/.bin/esbuild src/main.ts --bundle --format=iife --target=es2020 --outfile=app.js --log-level=warning
else
  npx --no-install esbuild src/main.ts --bundle --format=iife --target=es2020 --outfile=app.js --log-level=warning
fi

markers=$(grep -c 'userData.sculptComponent' "$FACTORY" || true)
maps=$(find . -maxdepth 1 -name '*.png' | wc -l | tr -d ' ')
echo "built pass '${PASS}': ${markers} component markers, ${maps} maps at page root, app.js $(du -h app.js | cut -f1)"
echo "preview: python -m http.server 8100 --directory \"$BUILD\""