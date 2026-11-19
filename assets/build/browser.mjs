// Helpers shared by the capture and interaction scripts.
//
// Nothing here knows which browser backend is driving the page: the scripts only need
//   tab.goto(url) / tab.screenshot() / tab.playwright.evaluate(fn, arg, {timeoutMs}) /
//   tab.playwright.waitForTimeout(ms)
// and both drivers in ../drivers/ produce exactly that shape.
import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";

export async function goto(tab, url) {
  // A first load of a texture-heavy page can exceed a driver's navigation budget. A timeout there is
  // not a failure: the page keeps loading and waitReady() is the real gate.
  try {
    await tab.goto(url);
  } catch (e) {
    process.stderr.write(`goto reported: ${e.message}\n`);
  }
}

export async function waitReady(tab, tries = 45, gapMs = 400) {
  for (let i = 0; i < tries; i += 1) {
    try {
      const ok = await tab.playwright.evaluate(
        () => !!(window.__IMG2THREEJS_READY__ && window.__demo?.model),
        null,
        { timeoutMs: 3000 },
      );
      if (ok) return true;
    } catch {
      // page still navigating
    }
    await tab.playwright.waitForTimeout(gapMs);
  }
  return false;
}

// tab.screenshot() goes through the browser's compositor, which can stall on a background tab until
// the backend gives up. A still frame of the model is still obtainable — the renderer can hand over the
// pixels it just drew — so fall back to that instead of failing the whole test over a missing HUD. The
// result says which source was used.
export async function shot(tab, file, opts = {}) {
  const { canvasFallback = true, timeoutMs = 12000 } = opts;
  try {
    const png = await withTimeout(tab.screenshot(), timeoutMs, "tab.screenshot()");
    await fs.writeFile(file, Buffer.from(png));
    return { file, source: "screenshot" };
  } catch (e) {
    if (!canvasFallback) throw e;
    const dataUrl = await tab.playwright.evaluate(
      async () => (await window.__IMG2THREEJS_CAPTURE__.captureDataUrl({ mode: "beauty" })).dataUrl,
      null, { timeoutMs: 8000 },
    );
    await fs.writeFile(file, Buffer.from(dataUrl.split(",")[1], "base64"));
    return { file, source: "canvas", note: "tab.screenshot() unavailable: " + e.message };
  }
}

export async function clickById(tab, id) {
  return tab.playwright.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return "missing:" + sel;
    el.click();
    return el.className;
  }, id, { timeoutMs: 3000 });
}

export function argOf(argv, name, fallback = undefined) {
  const i = argv.indexOf("--" + name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
}

// True only when the file was started directly (`node x.mjs ...`), false when imported. The runners use
// this to keep a CLI entry point without executing anything on import.
export function isMain(metaUrl) {
  const entry = process.argv[1];
  return Boolean(entry) && metaUrl === pathToFileURL(entry).href;
}

export function withTimeout(promise, ms, label) {
  promise.catch(() => {}); // the losing promise may reject later; that is not our failure
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ]);
}