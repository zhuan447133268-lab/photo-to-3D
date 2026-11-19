# Running the capture and interaction scripts

The two runner scripts need a browser. Which browser, and who owns it, is the only thing that
changes between setups: both take `--driver`, and both speak to the same tiny tab interface, so the
capture presets and the assertions are identical either way.

| driver | Who owns the browser | When |
| --- | --- | --- |
| `playwright` (default) | the script launches Chrome itself | plain Node, CI, any machine with Chrome installed |
| `zcode` | the app session's browser bridge | inside the ZCode desktop app, when you want to watch it run |

```bash
# the portable driver is a dev dependency; this uses your installed Chrome via channel: "chrome"
# assets/build/bootstrap.sh does this install, and launches one browser to prove it
npm install
# if Chrome is not installed: npx playwright install chromium   (then PW_CHANNEL="" to use the bundle)

# portable
node assets/build/capture_frames.mjs --url http://127.0.0.1:8100/ \
  --out <work>/review/captures --pass-id lighting-pass --shots refmatch,silhouette \
  --az 150 --el 16 --roll -15 --driver playwright

node assets/build/test_interactions.mjs --url http://127.0.0.1:8100/dist/demo.html \
  --out <work>/review/captures --prefix single-file --driver playwright
```

Both print one JSON report and exit non-zero when an assertion fails.

`--driver` also reads `DEMO_DRIVER` from the environment. There is no auto-detection on purpose: a
driver that quietly falls back hides the reason it changed.

## Using the app's own browser (`--driver zcode`)

This path only exists inside the app session. A plain `node` process cannot reach it and fails with
`browser runtime bridge is unavailable` (trap 19). Import the scripts into the app's JS runtime
instead:

```js
const { join } = await import("node:path");
const { pathToFileURL } = await import("node:url");
const { setupBrowserRuntime } = await import(
  pathToFileURL(join(process.env.ZCODE_PLUGIN_ROOT, "scripts", "browser-client.mjs")).href
);
await setupBrowserRuntime({ globals: globalThis });

const REPO = "/path/to/photo-to-3d-demo";
const B = await import(pathToFileURL(join(REPO, "drivers/zcode.mjs")).href);
const { tab } = await B.openPage("http://127.0.0.1:8100/", globalThis.agent);
```

That block has to be repeated in every runtime call: each call is a **fresh kernel**, so the previous
`agent` and `tab` are gone. `setupBrowserRuntime` returns nothing — the runtime lands on
`globalThis.agent` — and a module has its own context, so it cannot see that global. Pass the agent in
explicitly; that is what `openPage(url, agent)` is for (traps 18, 20).

## Capture evidence frames

```js
const CAP = await import(pathToFileURL(join(REPO, "assets/build/capture_frames.mjs")).href);
const report = await CAP.captureFrames(tab, {
  passId: "lighting-pass",
  outDir: "<work>/review/captures",
  shots: ["refmatch", "silhouette", "mapstripped"],  // presets below
  az: 150, el: 16, roll: -15,
  // dist: 0.30,   // omitted: framed from the bounding sphere
});
nodeRepl.write(JSON.stringify(report, null, 1));
```

Presets: `refmatch` (beauty, the review hero frame), `silhouette` (pure silhouette, compare outlines),
`mapstripped` (maps off, is the form really there), `semantic` (colour by component, catches parts
bleeding into each other), `roughness` (material id), `contact` (light background, ground kept, check
the contact shadow), `tri` (white, inspect triangle density).

`setCamera` positions first and `captureDataUrl` then reads pixels from the frame the renderer just
finished, so the result does not depend on the compositor being available.

## Interaction test

```js
const TI = await import(pathToFileURL(join(REPO, "assets/build/test_interactions.mjs")).href);
const r = await TI.testInteractions(tab, { outDir: "<work>/review/captures", prefix: "single-file" });
nodeRepl.write(JSON.stringify(r, null, 1));
```

Returns `{ orbit, select, explode, wireframe, autoRotate, shots, shotSources, failed }`. A non-empty
`failed` means it did not pass: **report the failure output as it is, never skip it**.

## Showing the images

Screenshots have to be emitted, otherwise the user receives nothing but JSON:

```js
const fs = await import("node:fs/promises");
for (const f of r.shots) await nodeRepl.emitImage(await fs.readFile(f));
```

## Three things that are easy to get wrong

- **Screenshots can time out.** `tab.screenshot()` goes through the compositor and a background tab
  occasionally runs to the 30 s limit. `shot()` already covers this: on timeout it uses the renderer
  frame (`captureDataUrl`) and marks `canvas` in `shotSources`. A `canvas` entry is not a failure, it
  just means that image has no HUD.
- **The auto-rotate assertion needs the damping tail to settle.** OrbitControls runs with damping, so
  the camera keeps turning for a while after a drag. The test pumps both phases before measuring,
  otherwise the assertion passes and fails on alternate runs.
- **Open a tab with `browsers.open(url, { reuseTab: true })`.** In a cold session `tabs.list()` is an
  empty array, and any "take the current tab" code fails with `no browser tab available`.