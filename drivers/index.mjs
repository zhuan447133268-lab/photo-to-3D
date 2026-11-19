// Pick a browser backend.
//
// The scripts only care about the small tab interface documented in assets/build/browser.mjs, so the
// backend is a runtime choice, not a code change:
//   --driver playwright   portable; needs a playwright module and a browser
//   --driver zcode        the ZCode desktop session's browser (only usable from node_repl)
// Default is playwright: an open-source checkout should work for someone who has never heard of ZCode.
export const DRIVERS = ["playwright", "zcode"];

export async function openPage(url, opts = {}) {
  const driver = opts.driver ?? process.env.DEMO_DRIVER ?? "playwright";

  if (driver === "zcode") {
    return (await import("./zcode.mjs")).openPage(url, opts);
  }
  if (driver === "playwright") {
    return (await import("./playwright.mjs")).openPage(url, opts);
  }
  throw new Error(`unknown driver "${driver}"; expected one of: ${DRIVERS.join(", ")}`);
}