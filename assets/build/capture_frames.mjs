// Capture evidence frames through the page's own capture contract.
//
// This deliberately does not use tab.screenshot(): that grabs the compositor, HUD and all, and it fails
// outright when the shell cannot prepare a surface. captureDataUrl() returns the pixels the renderer
// just drew, in the same task, which is exactly what a review wants to compare against the reference.
//
// CLI:
//   node capture_frames.mjs --url http://127.0.0.1:8100/index.html --out captures //        --pass lighting-pass --shots refmatch,contact --az 150 --el 16 --roll -15 [--driver playwright|zcode]
//
// Programmatic use, when you already hold a tab:
//   const { captureFrames } = await import(pathToFileURL("<repo>/assets/build/capture_frames.mjs").href);
//   await captureFrames(tab, { passId: "lighting-pass", outDir, shots: ["refmatch", "contact"] });
//
// Shot presets: refmatch silhouette mapstripped semantic roughness contact tri
// Angles are in degrees; --dist is optional (omit it and the camera fits the object).
import fs from "node:fs/promises";
import path from "node:path";
import { openPage } from "../../drivers/index.mjs";
import { argOf, goto, isMain, waitReady } from "./browser.mjs";

const PRESETS = {
  refmatch: { mode: "beauty" },
  silhouette: { mode: "alpha-silhouette" },
  mapstripped: { mode: "map-stripped" },
  semantic: { mode: "semantic-id" },
  roughness: { mode: "roughness-material-id" },
  contact: { mode: "beauty", background: 0xf2f2f2, keepGround: true },
  tri: { mode: "beauty", background: 0xffffff },
};

export const SHOT_NAMES = Object.keys(PRESETS);

export async function captureFrames(tab, opts) {
  const {
    passId = "pass",
    outDir = "captures",
    shots = ["refmatch"],
    az = 150,
    el = 16,
    roll = 0,
    dist = null,
    settle = 350,
  } = opts ?? {};

  const unknown = shots.filter((s) => !PRESETS[s]);
  if (unknown.length) {
    throw new Error(`unknown shot preset(s): ${unknown.join(", ")} — known: ${SHOT_NAMES.join(", ")}`);
  }

  const dir = path.resolve(outDir);
  await fs.mkdir(dir, { recursive: true });

  const files = [];
  for (const name of shots) {
    const preset = PRESETS[name];
    const dataUrl = await tab.playwright.evaluate(async (p) => {
      const spec = { azimuthDegrees: p.az, elevationDegrees: p.el, rollDegrees: p.roll };
      if (p.dist != null) spec.distance = p.dist;
      await window.__IMG2THREEJS_CAPTURE__.setCamera(spec);
      // captureDataUrl resolves to { ok, dataUrl }, not to the string itself.
      const r = await window.__IMG2THREEJS_CAPTURE__.captureDataUrl({
        mode: p.preset.mode,
        background: p.preset.background,
        keepGround: p.preset.keepGround,
      });
      return r.dataUrl;
    }, { az, el, roll, dist, preset }, { timeoutMs: 8000 });

    const file = path.join(dir, `${passId}-${name}.png`);
    await fs.writeFile(file, Buffer.from(dataUrl.split(",")[1], "base64"));
    files.push(file);
    if (settle) await tab.playwright.waitForTimeout(settle);
  }

  // Leave the page in its normal state so a later screenshot is not stuck in a capture mode.
  await tab.playwright.evaluate(() => {
    window.__IMG2THREEJS_CAPTURE__.captureDataUrl({ mode: "beauty" });
  }, null, { timeoutMs: 4000 }).catch(() => {});

  const sized = await Promise.all(files.map(async (f) => ({ file: f, kb: Math.round((await fs.stat(f)).size / 1024) })));
  return { pass: passId, camera: { az, el, roll, dist }, files: sized };
}

if (isMain(import.meta.url)) {
  const argv = process.argv.slice(2);
  const url = argOf(argv, "url");
  if (!url) {
    console.error("--url is required (when run directly; inside the app runtime, import captureFrames instead)");
    process.exit(2);
  }
  const { tab, browser, driver } = await openPage(url, {
    driver: argOf(argv, "driver", process.env.DEMO_DRIVER ?? "playwright"),
    agent: globalThis.agent,
  });
  await goto(tab, url);
  if (!(await waitReady(tab))) {
    console.error("page never reported __IMG2THREEJS_READY__; nothing captured");
    await browser?.close?.();
    process.exit(1);
  }
  const report = await captureFrames(tab, {
    passId: argOf(argv, "pass-id", argOf(argv, "pass", "pass")),
    outDir: argOf(argv, "out", "captures"),
    shots: (argOf(argv, "shots", "refmatch") || "").split(",").map((s) => s.trim()).filter(Boolean),
    az: Number(argOf(argv, "az", "150")),
    el: Number(argOf(argv, "el", "16")),
    roll: Number(argOf(argv, "roll", "0")),
    dist: argOf(argv, "dist") == null ? null : Number(argOf(argv, "dist")),
    settle: Number(argOf(argv, "settle", "350")),
  });
  await browser?.close?.();
  console.log(JSON.stringify({ driver, ...report }, null, 1));
}