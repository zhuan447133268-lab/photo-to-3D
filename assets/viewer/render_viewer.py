"""Fill the viewer templates for one model source.

Two sources produce the same page:

  --factory-file   the spec-compiled factory (build_pass.sh). The harness imports the five functions the
                   generator exports, and those are named after the subject
                   (createSonyMDRZX310HeadphonesModel, ...). Rather than make the caller spell them out
                   and get one wrong, the script reads the generated .ts and pulls the names from its
                   `export function` lines. Names that do not fit the pattern can still be passed
                   explicitly.
  --mesh-file      a reconstructed GLB (build_mesh.sh). No factory: the script copies mesh_rig.ts beside
                   main.ts, embeds the GLB as a base64 data URL in mesh_data.ts, and wires the default
                   light / environment / controls rig. Keeps `external_refs: []` true for the packed file.

Usage:
  python render_viewer.py --factory-file <work>/src/model.ts \
      --out-dir <work>/src --build-dir <work>/build \
      --title "MDR-ZX310 · procedural rebuild" \
      --ref-caption "Reference: single product photo; rear faces inferred by symmetry" \
      --locale en

  python render_viewer.py --mesh-file <input>.glb \
      --out-dir <work>/src --build-dir <work>/build --locale zh
"""
import argparse
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).resolve().parent
TPL_TS = HERE / "main.template.ts"
TPL_HTML = HERE / "index.template.html"

# Everything the page says. Locale only supplies defaults; any --flag overrides its entry, which is how
# a delivery in another language is done without editing the template.
LOCALES = {
    "en": {
        "title": "Product rebuild · interactive model",
        "page-title": "Product rebuild · image to Three.js",
        "subtitle": "Reference photo → component breakdown → procedural Three.js geometry. "
                    "<b>Click any part</b> to inspect it, drag to orbit, scroll to zoom.",
        "ref-caption": "Reference (single view; hidden faces inferred)",
        "credit": "Rebuilt with the img2threejs pipeline",
        "btn-explode": "Explode",
        "btn-wire": "Wireframe",
        "btn-rotate": "Auto-rotate",
        "btn-reference": "Reference",
        "btn-reset": "Reset view",
    },
    "zh": {
        "title": "产品重建 · 可交互模型",
        "page-title": "产品重建 · 图像生成三维模型",
        "subtitle": "参考图 → 结构拆解 → 程序化 Three.js 几何体。<b>点击任意零件</b>查看层级，拖动旋转，滚轮缩放。",
        "ref-caption": "参考图（单视图，背面按结构推断）",
        "credit": "由 img2threejs 流水线重建",
        "btn-explode": "爆炸视图",
        "btn-wire": "线框",
        "btn-rotate": "自动旋转",
        "btn-reference": "参考图",
        "btn-reset": "重置视角",
    },
}

HTML_FLAGS = ("title", "page-title", "subtitle", "ref-caption", "credit",
              "btn-explode", "btn-wire", "btn-rotate", "btn-reference", "btn-reset")

# Mesh mode says what it is: the geometry came from a reconstruction or an export, not from numbers typed
# into a spec. Saying "procedural" here would be the exact mislabelling this pipeline was called out for.
# It also does not claim "neural": a CAD export arrives by the same route, and either way the parts came
# from segmenting the surface, not from connected components alone.
MESH_LOCALES = {
    "en": {
        "title": "Reconstructed mesh · interactive model",
        "page-title": "Reconstructed mesh · interactive viewer",
        "subtitle": "Reconstructed mesh → segmented parts. "
                    "<b>Click any part</b> to inspect it, drag to orbit, scroll to zoom.",
        "ref-caption": "Reconstruction input",
        "credit": "Mesh reconstructed externally; viewer and tests by the photo-to-3d pipeline",
        "btn-explode": "Explode",
        "btn-wire": "Wireframe",
        "btn-rotate": "Auto-rotate",
        "btn-reference": "Input",
        "btn-reset": "Reset view",
    },
    "zh": {
        "title": "重建网格 · 可交互模型",
        "page-title": "重建网格 · 可交互查看器",
        "subtitle": "重建网格 → 曲面分件。<b>点击任意零件</b>查看层级，拖动旋转，滚轮缩放。",
        "ref-caption": "重建输入",
        "credit": "网格由外部重建模型生成；查看器与测试由 photo-to-3d 流水线提供",
        "btn-explode": "爆炸视图",
        "btn-wire": "线框",
        "btn-rotate": "自动旋转",
        "btn-reference": "重建输入",
        "btn-reset": "重置视角",
    },
}


def detect(factory_file: pathlib.Path) -> dict:
    """Pull the five export names out of the generated factory."""
    text = factory_file.read_text(encoding="utf-8")
    names = re.findall(r"export function (\w+)\s*\(", text)
    pick = {}
    for n in names:
        if n.endswith("Model") and "Model" not in pick:
            pick["Model"] = n
        elif n.endswith("LookDevLights") and "LookDevLights" not in pick:
            pick["LookDevLights"] = n
        elif n.endswith("Environment") and "Environment" not in pick:
            pick["Environment"] = n
        elif n.endswith("InspectControls") and "InspectControls" not in pick:
            pick["InspectControls"] = n
        elif n.endswith("Renderer") and "Renderer" not in pick:
            pick["Renderer"] = n
    missing = [k for k in ("Model", "LookDevLights", "Environment", "InspectControls", "Renderer") if k not in pick]
    if missing:
        raise SystemExit(
            "could not detect factory exports: " + ", ".join(missing)
            + "\nexports found: " + ", ".join(names)
        )
    return pick


def mesh_data_ts(glb: pathlib.Path) -> str:
    """Embed the GLB as a data URL, chunked so no single line is megabytes long."""
    import base64

    payload = base64.b64encode(glb.read_bytes()).decode("ascii")
    chunk = 8192
    pieces = [payload[i:i + chunk] for i in range(0, len(payload), chunk)]
    body = " +\n  ".join('"{}"'.format(p) for p in pieces)
    return (
        "// generated by render_viewer.py --mesh-file.\n"
        "// The GLB is embedded rather than fetched: the packed page has to keep external_refs: [], and a\n"
        "// sibling .glb would also break the double-click-to-open promise.\n"
        "export const MESH_URL =\n"
        '  "data:model/gltf-binary;base64," +\n  ' + body + ";\n"
    )


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--factory-file", type=pathlib.Path, help="spec-compiled factory (.ts) from build_pass.sh")
    ap.add_argument("--mesh-file", type=pathlib.Path, help="reconstructed mesh (.glb) for mesh mode")
    ap.add_argument("--out-dir", required=True, type=pathlib.Path)
    ap.add_argument("--build-dir", type=pathlib.Path)
    ap.add_argument("--module", help="factory module name without extension (default: file stem)")
    ap.add_argument("--model-fn")
    ap.add_argument("--lights-fn")
    ap.add_argument("--env-fn")
    ap.add_argument("--controls-fn")
    ap.add_argument("--renderer-fn")
    ap.add_argument("--mesh-max-parts", default="64",
                    help="mesh mode: keep at most N parts, largest first (0 = every patch)")
    ap.add_argument("--mesh-partition", default="auto", choices=["auto", "components", "angle", "spatial"],
                    help="mesh mode: how a single-primitive GLB is cut into parts")
    ap.add_argument("--mesh-dihedral", default="32",
                    help="mesh mode: dihedral threshold in degrees for angle/auto partitioning")
    ap.add_argument("--mesh-min-segment-triangles", default="1200",
                    help="mesh mode: only shells at least this large are crease-split; lower it for a "
                         "single-part mesh whose structure is small (a gear, a bracket)")
    ap.add_argument("--locale", default="en", choices=sorted(LOCALES), help="default page copy")
    for flag in HTML_FLAGS:
        ap.add_argument("--" + flag, default=None, help=f"override the {flag} text")
    ap.add_argument("--exposure", default=None,
                    help="calibrate it, see references/pipeline.md (default 0.85 factory, 0.72 mesh)")
    ap.add_argument("--env-intensity", default=None)
    ap.add_argument("--hero-azimuth", default="26")
    args = ap.parse_args()

    if bool(args.factory_file) == bool(args.mesh_file):
        raise SystemExit("pass exactly one of --factory-file / --mesh-file")

    mesh_mode = args.mesh_file is not None
    extras: dict[str, str] = {}

    if mesh_mode:
        mesh_file = args.mesh_file.resolve()
        if not mesh_file.exists():
            raise SystemExit(f"mesh file not found: {mesh_file}")
        if mesh_file.suffix.lower() not in (".glb", ".gltf"):
            raise SystemExit(f"mesh mode reads .glb / .gltf, got: {mesh_file.name}")
        model_import = (
            "import {\n"
            "  loadMeshDataUrl, defaultLights, defaultEnvironment, defaultControls, defaultRendererSetup,\n"
            "} from './mesh_rig';\n"
            "import { MESH_URL } from './mesh_data';"
        )
        model_setup = (
            # The option braces are doubled: .format() owns the scalars, the page owns the object.
            "await loadMeshDataUrl(MESH_URL, {{ maxParts: {}, partition: '{}', dihedralDegrees: {}, minSegmentTriangles: {} }})"
            .format(args.mesh_max_parts, args.mesh_partition, args.mesh_dihedral,
                    args.mesh_min_segment_triangles)
        )
        exposure = args.exposure if args.exposure is not None else "0.72"
        env_intensity = args.env_intensity if args.env_intensity is not None else "0.7"
        model = "loadMeshDataUrl"
        lights = "defaultLights"
        env = "defaultEnvironment"
        controls = "defaultControls"
        renderer_fn = "defaultRendererSetup"
    else:
        factory_file = args.factory_file.resolve()
        if not factory_file.exists():
            raise SystemExit(f"factory file not found: {factory_file}")
        found = detect(factory_file)
        model = args.model_fn or found["Model"]
        lights = args.lights_fn or found["LookDevLights"]
        env = args.env_fn or found["Environment"]
        controls = args.controls_fn or found["InspectControls"]
        renderer_fn = args.renderer_fn or found["Renderer"]
        extras["__MODEL_MODULE__"] = args.module or factory_file.stem
        model_import = (
            "import {\n"
            "  __FACTORY__,\n  __LIGHTS__,\n  __ENV__,\n  __RENDERER_SETUP__,\n  __CONTROLS__,\n"
            "} from './__MODEL_MODULE__';"
        )
        model_setup = "__FACTORY__({ castShadow: true, receiveShadow: true })"
        exposure = args.exposure if args.exposure is not None else "0.85"
        env_intensity = args.env_intensity if args.env_intensity is not None else "0.85"

    ts = TPL_TS.read_text(encoding="utf-8")
    # Order matters: the import block and the model setup are written first and contain the function
    # placeholders themselves, which the later passes then fill in.
    ts_fields = {
        "__MODEL_IMPORT__": model_import,
        "__MODEL_SETUP__": model_setup,
        "__FACTORY__": args.model_fn or (model if not mesh_mode else ""),
        "__LIGHTS__": lights,
        "__ENV__": env,
        "__CONTROLS__": controls,
        "__RENDERER_SETUP__": renderer_fn,
        "__EXPOSURE__": str(exposure),
        "__ENV_INTENSITY__": str(env_intensity),
        "__HERO_AZIMUTH__": str(args.hero_azimuth),
    }
    if mesh_mode:
        ts_fields.pop("__FACTORY__")
    ts_fields.update(extras)
    for key, value in ts_fields.items():
        ts = ts.replace(key, value)

    # Only verify the placeholders this script owns. The template legitimately contains other
    # double-underscore globals (__EMBEDDED_MAPS__, __IMG2THREEJS_CAPTURE__), so a generic
    # __[A-Z_]+__ regex would flag working output as broken.
    leftover = [k for k in ts_fields if k in ts]
    if leftover:
        raise SystemExit("unfilled placeholders in main.ts: " + ", ".join(sorted(leftover)))

    copy = dict((MESH_LOCALES if mesh_mode else LOCALES)[args.locale])
    for flag in HTML_FLAGS:
        # argparse turns --page-title into args.page_title
        value = getattr(args, flag.replace("-", "_"))
        if value is not None:
            copy[flag] = value

    html = TPL_HTML.read_text(encoding="utf-8")
    html_fields = {
        "__PAGE_TITLE__": copy["page-title"],
        "__TITLE__": copy["title"],
        "__SUBTITLE__": copy["subtitle"],
        "__REF_CAPTION__": copy["ref-caption"],
        "__CREDIT__": copy["credit"],
        "__BTN_EXPLODE__": copy["btn-explode"],
        "__BTN_WIRE__": copy["btn-wire"],
        "__BTN_ROTATE__": copy["btn-rotate"],
        "__BTN_REFERENCE__": copy["btn-reference"],
        "__BTN_RESET__": copy["btn-reset"],
    }
    for key, value in html_fields.items():
        html = html.replace(key, value)

    missing_html = [k for k in html_fields if k in html]
    if missing_html:
        raise SystemExit("unfilled placeholders in index.html: " + ", ".join(sorted(missing_html)))

    args.out_dir.mkdir(parents=True, exist_ok=True)
    (args.out_dir / "main.ts").write_text(ts, encoding="utf-8")
    (args.out_dir / "index.template.html").write_text(html, encoding="utf-8")

    if mesh_mode:
        # The rig is shipped as source, not generated: it is the same code for every mesh, and a delivery
        # that vendors it can be read and patched.
        (args.out_dir / "mesh_rig.ts").write_text(
            (HERE / "mesh_rig.ts").read_text(encoding="utf-8"), encoding="utf-8")
        (args.out_dir / "mesh_data.ts").write_text(mesh_data_ts(args.mesh_file.resolve()), encoding="utf-8")

    if args.build_dir:
        args.build_dir.mkdir(parents=True, exist_ok=True)
        (args.build_dir / "index.html").write_text(html, encoding="utf-8")
        if not mesh_mode:
            ref = args.build_dir / "ref.jpg"
            if not ref.exists():
                print(f"warning: {ref} missing; copy the reference photo there or the card will be blank",
                      file=sys.stderr)

    print(f"viewer written: {args.out_dir / 'main.ts'} (locale={args.locale}, mode={'mesh' if mesh_mode else 'factory'})")
    print(f"  model={model} lights={lights} env={env} controls={controls} renderer={renderer_fn}")


if __name__ == "__main__":
    main()