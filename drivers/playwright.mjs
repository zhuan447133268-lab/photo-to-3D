// Playwright driver: the portable backend. Works anywhere Node runs, no app session required.
//
// It resolves `playwright` or `playwright-core`, launches a real browser, and adapts a Page to the small
// tab interface the scripts use. Chrome/Edge channels are tried before a bundled chromium: most machines
// already have one, and using it avoids a ~150 MB browser download just to take screenshots.
import { withTimeout } from "../assets/build/browser.mjs";

const DEFAULT_EVALUATE_TIMEOUT_MS = 3000;

async function loadPlaywright() {
  const failures = [];
  for (const name of ["playwright", "playwright-core"]) {
    try {
      return { name, mod: await import(name) };
    } catch (e) {
      failures.push(`${name}: ${e.code ?? e.message}`);
    }
  }
  throw new Error(
    "no Playwright module available (" + failures.join("; ") + ").\n"
    + "Install one with `npm i -D playwright-core`, or run with the app-session driver: --driver zcode.",
  );
}

export async function openPage(url, opts = {}) {
  const { name, mod } = await loadPlaywright();
  const headless = opts.headless ?? true;
  // PW_CHANNEL="" is the documented way to skip the channel and force the playwright-managed build.
  const rawChannel = opts.channel ?? process.env.PW_CHANNEL ?? "chrome";
  const channel = rawChannel === "" ? undefined : rawChannel;
  const launchOpts = channel ? { channel, headless } : { headless };

  let browser;
  try {
    browser = await mod.chromium.launch(launchOpts);
  } catch (channelError) {
    // No Chrome/Edge under that name: fall back to the playwright-managed build, and say what to do if
    // that is missing too.
    try {
      browser = await mod.chromium.launch({ headless });
    } catch (bundledError) {
      throw new Error(
        `could not launch a browser via ${name}.\n`
        + `  channel "${channel}": ${channelError.message}\n`
        + `  bundled chromium: ${bundledError.message}\n`
        + "Install a browser with `npx playwright install chromium`, or set PW_CHANNEL to an installed channel.",
      );
    }
  }

  const context = await browser.newContext({
    viewport: opts.viewport ?? { width: 1280, height: 720 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);

  const tab = {
    page,
    url: () => page.url(),
    title: () => page.title(),
    close: () => browser.close(),
    goto: (target) => page.goto(target, { waitUntil: "domcontentloaded", timeout: 30000 }),
    screenshot: (screenshotOpts) => page.screenshot({ type: "png", ...screenshotOpts }),
    playwright: {
      evaluate: (fn, arg, evalOpts) => {
        const call = page.evaluate(fn, arg);
        const timeoutMs = evalOpts?.timeoutMs ?? DEFAULT_EVALUATE_TIMEOUT_MS;
        return withTimeout(call, timeoutMs, "page.evaluate()");
      },
      // playwright's own waitForTimeout is deprecated; a timer does the same thing without the warning.
      waitForTimeout: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      waitForLoadState: (state = "domcontentloaded") => page.waitForLoadState(state, { timeout: 15000 }),
      locator: (selector) => page.locator(selector),
    },
  };

  return { browser, tab, driver: "playwright", moduleName: name };
}