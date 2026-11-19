#!/usr/bin/env bash
# Install everything this skill needs outside the repository, then optionally prove it works.
#
#   bash assets/build/bootstrap.sh [--check] [--engine-dir DIR] [--no-engine]
#
# Nothing here is vendored: three.js and esbuild are installed per workspace by setup_workspace.sh, and
# img2threejs is cloned on demand. That keeps this repository small and keeps upstream's license intact.
#
# The two variables that matter afterwards:
#   IMG2THREEJS_ENGINE   a checkout of https://github.com/img2threejs/img2threejs
#   PYTHON               the interpreter to call (python3 on most machines, python on Windows)
set -euo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEFAULT_ENGINE="$HOME/.cache/photo-to-3d/img2threejs"
UPSTREAM="https://github.com/img2threejs/img2threejs.git"
CHECK=0
ENGINE_ARG=""
WANT_ENGINE=1

while [ $# -gt 0 ]; do
  case "$1" in
    --check) CHECK=1 ;;
    --no-engine) WANT_ENGINE=0 ;;
    --engine-dir) ENGINE_ARG="${2:?--engine-dir needs a path}"; shift ;;
    -h|--help) sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

say() { printf '%s\n' "$*"; }
ok()  { printf '  ok    %s\n' "$*"; }
bad() { printf '  MISS  %s\n' "$*"; }

FAILED=0

# ---------- interpreters ----------
say "interpreters"

PY="${PYTHON:-}"
if [ -z "$PY" ]; then
  PY="$(command -v python3 || command -v python || true)"
fi
if [ -n "$PY" ] && "$PY" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 9) else 1)' 2>/dev/null; then
  ok "python: $PY ($("$PY" -c 'import sys; print(".".join(map(str, sys.version_info[:3])))'))"
else
  bad "python 3.9+ not found — install python3, or set PYTHON=/path/to/python3"
  FAILED=1
fi

if command -v node >/dev/null 2>&1; then
  NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  if [ "$NODE_MAJOR" -ge 18 ]; then
    ok "node: $(node -v)"
  else
    bad "node $(node -v) is older than 18 — the scripts use top-level await in .mjs"
    FAILED=1
  fi
else
  bad "node not found — install Node 18+ (https://nodejs.org)"
  FAILED=1
fi

command -v npm >/dev/null 2>&1 && ok "npm: $(npm -v)" || { bad "npm not found — it ships with Node"; FAILED=1; }
command -v git >/dev/null 2>&1 && ok "git: $(git --version | awk '{print $3}')" || bad "git not found (only needed to clone the engine)"

# ---------- node dependency of this repository ----------
say "driver dependency"
if [ -d "$SKILL_DIR/node_modules/playwright-core" ] || [ -d "$SKILL_DIR/node_modules/playwright" ]; then
  ok "playwright-core already installed"
elif command -v npm >/dev/null 2>&1; then
  say "  installing playwright-core (uses your installed Chrome, no browser download)"
  if (cd "$SKILL_DIR" && npm install --no-fund --no-audit >/dev/null 2>&1); then
    ok "playwright-core installed"
  else
    bad "npm install failed — run it by hand in $SKILL_DIR and read the output"
    FAILED=1
  fi
else
  bad "skipped: npm is missing"
  FAILED=1
fi

# ---------- engine ----------
say "generator engine (img2threejs, Apache-2.0)"
ENGINE=""
if [ "$WANT_ENGINE" -eq 1 ]; then
  # Precedence: explicit flag, environment, the historical default, then the clone target.
  if [ -n "$ENGINE_ARG" ]; then
    ENGINE="$ENGINE_ARG"
  elif [ -n "${IMG2THREEJS_ENGINE:-}" ]; then
    ENGINE="$IMG2THREEJS_ENGINE"
  elif [ -f "$HOME/.workbuddy/skills/img2threejs/forge/stage3_build/generate_threejs_factory.py" ]; then
    ENGINE="$HOME/.workbuddy/skills/img2threejs"
  else
    ENGINE="$DEFAULT_ENGINE"
  fi

  GEN="$ENGINE/forge/stage3_build/generate_threejs_factory.py"
  if [ -f "$GEN" ]; then
    ok "engine: $ENGINE"
  elif command -v git >/dev/null 2>&1; then
    say "  cloning into $ENGINE"
    mkdir -p "$(dirname "$ENGINE")"
    if git clone --depth 1 "$UPSTREAM" "$ENGINE" >/dev/null 2>&1; then
      ok "engine cloned: $ENGINE"
    else
      bad "clone failed — check network/proxy, then: git clone $UPSTREAM $ENGINE"
      FAILED=1
    fi
  else
    bad "no engine at $ENGINE and git is unavailable"
    FAILED=1
  fi
else
  ok "skipped (--no-engine)"
fi

# ---------- what to export ----------
say ""
say "export these for this shell (the scripts read them):"
[ -n "$ENGINE" ] && say "  export IMG2THREEJS_ENGINE=\"$ENGINE\""
[ -n "$PY" ] && say "  export PYTHON=\"$PY\""
say ""

# ---------- self check ----------
if [ "$CHECK" -eq 1 ]; then
  say "self check"

  if [ -n "$ENGINE" ] && [ -f "$ENGINE/forge/stage3_build/generate_threejs_factory.py" ]; then
    if "$PY" "$ENGINE/forge/stage3_build/generate_threejs_factory.py" --help >/dev/null 2>&1; then
      ok "the factory generator runs"
    else
      bad "the factory generator failed to start — run it by hand to see the traceback"
      FAILED=1
    fi
  fi

  if command -v node >/dev/null 2>&1; then
    BROWSER_OUT="$(node --input-type=module -e '
      const { pathToFileURL } = await import("node:url");
      const { openPage } = await import(pathToFileURL(process.argv[1]).href);
      const r = await openPage("about:blank");
      await r.browser.close();
      console.log(r.driver + " via " + r.moduleName);
    ' "$SKILL_DIR/drivers/index.mjs" 2>&1 | tail -3)"
    case "$BROWSER_OUT" in
      *"via"*) ok "browser launches: $BROWSER_OUT" ;;
      *) bad "browser did not launch: $BROWSER_OUT"; FAILED=1 ;;
    esac
  fi
fi

say ""
if [ "$FAILED" -ne 0 ]; then
  say "one or more checks failed; fix the MISS lines above before running a build"
  exit 1
fi
say "ready. next:"
say "  WP=~/photo-to-3d/\$SLUG"
say "  bash \"$SKILL_DIR/assets/build/setup_workspace.sh\" \"\$WP\""
say "  bash \"$SKILL_DIR/assets/build/build_pass.sh\" \"\$WP\" blockout"