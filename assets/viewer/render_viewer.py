"""Fill the viewer templates for one generated factory.

The harness has to import the five functions the generator exports, and those are named after the
subject (createSonyMDRZX310HeadphonesModel, ...). Rather than make the caller spell them out and get one
wrong, the script reads the generated .ts and pulls the names from its `export function` lines. Names
that do not fit the pattern can still be passed explicitly.

Usage:
  python render_viewer.py --factory-file <work>/src/model.ts \
      --out-dir <work>/src --build-dir <work>/build \
      --title "MDR-ZX310 · procedural rebuild" \
      --ref-caption "Reference: single product photo; rear faces inferred by symmetry" \
      --locale en
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


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--factory-file", required=True, type=pathlib.Path)
    ap.add_argument("--out-dir", required=True, type=pathlib.Path)
    ap.add_argument("--build-dir", type=pathlib.Path)
    ap.add_argument("--module", help="factory module name without extension (default: file stem)")
    ap.add_argument("--model-fn")
    ap.add_argument("--lights-fn")
    ap.add_argument("--env-fn")
    ap.add_argument("--controls-fn")
    ap.add_argument("--renderer-fn")
    ap.add_argument("--locale", default="en", choices=sorted(LOCALES), help="default page copy")
    for flag in HTML_FLAGS:
        ap.add_argument("--" + flag, default=None, help=f"override the {flag} text")
    ap.add_argument("--exposure", default="0.85", help="calibrate it, see references/pipeline.md")
    ap.add_argument("--env-intensity", default="0.85")
    ap.add_argument("--hero-azimuth", default="26")
    args = ap.parse_args()

    factory_file = args.factory_file.resolve()
    if not factory_file.exists():
        raise SystemExit(f"factory file not found: {factory_file}")
    found = detect(factory_file)

    model = args.model_fn or found["Model"]
    lights = args.lights_fn or found["LookDevLights"]
    env = args.env_fn or found["Environment"]
    controls = args.controls_fn or found["InspectControls"]
    renderer_fn = args.renderer_fn or found["Renderer"]
    module = args.module or factory_file.stem

    ts = TPL_TS.read_text(encoding="utf-8")
    ts_fields = {
        "__MODEL_MODULE__": module,
        "__FACTORY__": model,
        "__LIGHTS__": lights,
        "__ENV__": env,
        "__CONTROLS__": controls,
        "__RENDERER_SETUP__": renderer_fn,
        "__EXPOSURE__": str(args.exposure),
        "__ENV_INTENSITY__": str(args.env_intensity),
        "__HERO_AZIMUTH__": str(args.hero_azimuth),
    }
    for key, value in ts_fields.items():
        ts = ts.replace(key, value)

    # Only verify the placeholders this script owns. The template legitimately contains other
    # double-underscore globals (__EMBEDDED_MAPS__, __IMG2THREEJS_CAPTURE__), so a generic
    # __[A-Z_]+__ regex would flag working output as broken.
    leftover = [k for k in ts_fields if k in ts]
    if leftover:
        raise SystemExit("unfilled placeholders in main.ts: " + ", ".join(sorted(leftover)))

    copy = dict(LOCALES[args.locale])
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

    if args.build_dir:
        args.build_dir.mkdir(parents=True, exist_ok=True)
        (args.build_dir / "index.html").write_text(html, encoding="utf-8")
        ref = args.build_dir / "ref.jpg"
        if not ref.exists():
            print(f"warning: {ref} missing; copy the reference photo there or the card will be blank", file=sys.stderr)

    print(f"viewer written: {args.out_dir / 'main.ts'} (locale={args.locale})")
    print(f"  model={model} lights={lights} env={env} controls={controls} renderer={renderer_fn}")


if __name__ == "__main__":
    main()