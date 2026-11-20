"""Fold the preview build into one HTML file.

The preview page loads app.js, ref.jpg and the map PNGs from the directory it sits in. A single file
carries them inline: the script and the reference photo are pasted into the page, and the maps go into
the __EMBEDDED_MAPS__ table that src/main.ts consults before it asks TextureLoader for a filename.
Publishing each map once as a table entry — rather than inlining its data URI at every call site in the
bundle — is what keeps the result near 4 MB instead of 7 MB+.

Usage:
  python pack_single.py <preview-build-dir> <out.html>

The build dir is the scratch folder the bundle is assembled in: app.js, index.html, ref.jpg and every
map PNG at its root (maps resolve by bare filename, so they have to sit beside the page).

Exits non-zero if the output still references an external file: a single-file deliverable that 404s
when emailed is the failure this script exists to prevent, so it is checked here rather than by eye.
"""
import base64
import json
import pathlib
import re
import sys

if len(sys.argv) < 3:
    print(__doc__.strip().splitlines()[3].strip(), file=sys.stderr)
    raise SystemExit(2)

BUILD = pathlib.Path(sys.argv[1]).resolve()
OUT = pathlib.Path(sys.argv[2]).resolve()
# Mesh deliveries carry no map PNGs (the GLB brings its own textures, embedded) — do not warn about a
# missing texture table that this route never had.
MESH_MODE = "--mesh" in sys.argv[3:]

for required in ("app.js", "index.html"):
    if not (BUILD / required).exists():
        raise SystemExit(f"missing {required} in {BUILD}; run build_pass.sh first")


def uri(path, mime="image/png"):
    return f"data:{mime};base64," + base64.b64encode(path.read_bytes()).decode("ascii")


OUT.parent.mkdir(parents=True, exist_ok=True)
maps = {p.name: uri(p) for p in sorted(BUILD.glob("*.png"))}
table = "<script>window.__EMBEDDED_MAPS__=" + json.dumps(maps) + ";</script>"

app = (BUILD / "app.js").read_text(encoding="utf-8")
html = (BUILD / "index.html").read_text(encoding="utf-8")

ref = BUILD / "ref.jpg"
if ref.exists():
    html = html.replace('src="ref.jpg"', f'src="{uri(ref, "image/jpeg")}"')
else:
    html = html.replace('src="ref.jpg"', 'src=""')

html = re.sub(r'<script src="app\.js[^"]*"></script>',
              lambda _: table + "\n<script>\n" + app + "\n</script>", html, count=1)
OUT.write_text(html, encoding="utf-8")

report = {
    "out": str(OUT),
    "maps": len(maps),
    "html_mb": round(OUT.stat().st_size / 1048576, 2),
    "external_refs": re.findall(r'(?:src|href)="(?!#|data:)([^"]+)"', html),
}
print(json.dumps(report, indent=1))

if report["external_refs"]:
    print("still references external files: " + ", ".join(report["external_refs"]), file=sys.stderr)
    raise SystemExit(1)
if not maps and not MESH_MODE:
    print("warning: no map PNGs were embedded — did the textures reach the build root?", file=sys.stderr)
