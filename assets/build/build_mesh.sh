#!/usr/bin/env bash
# Build the viewer for a mesh that was reconstructed elsewhere.
#
# The procedural route (build_pass.sh) compiles a hand-written spec into primitives and needs the
# img2threejs engine. This route starts from the mesh itself: a GLB/GLTF produced by a neural image-to-3D
# model, a photogrammetry export, or any DCC tool. No engine, no spec, no eight passes — the reconstruction
# is somebody else's job, and this script delivers it: addressable parts, picking, explode, wireframe,
# capture modes, six interaction assertions.
#
# Usage:
#   build_mesh.sh <work-dir> <model.glb> [--ref-photo <input.jpg>] [extra render_viewer.py flags]
#
# Example:
#   build_mesh.sh ~/photo-to-3d/widget ~/Downloads/widget.glb --locale zh --exposure 1.0
#
# What it does that a plain three.js viewer would not:
#   * splits the mesh into connected components, so "click a part" has something to click;
#   * embeds the GLB as a base64 data URL, so the packed page still has zero external references;
#   * normalises the mesh to unit size, so a model authored in millimetres and one in metres frame the
#     same way and the camera/ground/shadow rig needs no per-model constants.
set -euo pipefail

WP="${1:?usage: build_mesh.sh <work-dir> <model.glb> [--ref-photo <input.jpg>] [extra viewer flags]}"
GLB="${2:?mesh file required (glb or gltf)}"
shift 2

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PY="${PYTHON:-$(command -v python3 || command -v python || true)}"
[ -n "$PY" ] || { echo "python 3.9+ not found; set PYTHON=/path/to/python3" >&2; exit 1; }
[ -f "$GLB" ] || { echo "mesh file not found: $GLB" >&2; exit 1; }

REF_PHOTO=""
ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --ref-photo)
      REF_PHOTO="${2:?--ref-photo needs a path}"
      shift 2
      ;;
    *)
      ARGS+=("$1")
      shift
      ;;
  esac
done

# setup_workspace.sh is the single place the pinned three/esbuild versions live. It also creates the
# spec/ tree, which this route simply never uses.
bash "$SKILL_DIR/assets/build/setup_workspace.sh" "$WP" >/dev/null

BUILD="$WP/build"
mkdir -p "$WP/src" "$BUILD/src" "$WP/dist" "$WP/review/captures"
if [ -n "$REF_PHOTO" ]; then
  [ -f "$REF_PHOTO" ] || { echo "reference photo not found: $REF_PHOTO" >&2; exit 1; }
  cp -f "$REF_PHOTO" "$BUILD/ref.jpg"
fi

# 1. fill the templates: mesh_rig.ts + mesh_data.ts (base64 GLB) + main.ts
"$PY" "$SKILL_DIR/assets/viewer/render_viewer.py" \
  --mesh-file "$GLB" --out-dir "$WP/src" --build-dir "$BUILD" ${ARGS[@]+"${ARGS[@]}"}

# 2. bundle from build/, where node_modules lives
cp -f "$WP/src/main.ts" "$WP/src/mesh_rig.ts" "$WP/src/mesh_data.ts" "$BUILD/src/"
cd "$BUILD"
if [ -x ./node_modules/.bin/esbuild ]; then
  ./node_modules/.bin/esbuild src/main.ts --bundle --format=iife --target=es2020 --outfile=app.js --log-level=warning
else
  npx --no-install esbuild src/main.ts --bundle --format=iife --target=es2020 --outfile=app.js --log-level=warning
fi

echo "built mesh viewer: $(du -h app.js | awk '{print $1}') app.js from $(basename "$GLB")"
echo "preview: \"$PY\" -m http.server 8100 --directory \"$BUILD\""