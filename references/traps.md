# Traps: symptom → cause → fix

All of these come from one real delivery (Sony MDR-ZX310, 18 parts, eight review passes) plus the
browser work that followed. Look up by symptom; the numbers are stable and referenced from the other
documents.

## Geometry / generator

### 1. A lathed part comes out lying on its side
- Symptom: the profile was drawn upright, the result is a barrel lying down.
- Cause: the lathe spins around **local Y**. A profile laid out in Z ends up on its side.
- Fix: define the profile points in the XY plane (x = radius, y = height), then orient the whole
  assembly.

### 2. A small speck floats between parts
- Symptom: a tiny cube hanging between the two ear cups.
- Cause: the generator emitted the assembly root as **real geometry** — it has no "pivot-only
  primitive".
- Fix: shrink the root's `dimensions` to `0.0002` (0.2 mm). The node and its hierarchy survive, and it
  stays under one pixel from every camera position.

### 3. Ear pads stack into blades
- Symptom: thin sheet artefacts across the cushion side, like a pile of paper.
- Cause: `repetitionSystems` instanced geometry across a curved surface and produced dirty thin
  shells.
- Fix: drop that repetition system, use a solid lathe instead, and let the map carry the detail.
  **If a texture can express it, do not stack geometry for it.**

### 4. Interpenetration when viewed end-on
- Symptom: looking down the long axis, parts bite into each other.
- Cause: only the hero angle was ever checked; there was no end-on viewpoint.
- Fix: add `long-axis` and `thickness-axis` viewpoints to every pass. Do not review only from the
  flattering angle.

## Materials / maps

### 5. Textures all black, every material looks like plastic
- Symptom: the model orbits, but the surface is dead black; the maps seem not to apply.
- Cause: the spec's `url` is a **bare filename** and the page fetches it as written, while the PNGs
  still sit in `spec/pbr/<material>/`.
- Fix: copy every PNG to the `build/` root during the build (`build_pass.sh` already does this).

### 6. Changing roughness does nothing
- Symptom: `roughness: 0.13` in the spec, the render is still fully matte.
- Cause: **with a map present the generator pins `material.roughness` to 1**; the real value is read
  from the texture only.
- Fix: paint the target roughness into the roughness map (a flat grey value is fine).

### 7. Terraced bands across a smooth surface
- Symptom: a surface that should be smooth shows step edges with clean boundaries.
- Cause: the roughness map is nearly constant (say 33/255 ± 1). One count of 8-bit difference selects
  a different PMREM mip and renders as a visible plateau; averaging the noise does not help.
- Fix: make that map a **single constant** (no variation, no steps). Or spread the roughness range
  according to real physics instead of hunting for detail inside noise.

### 8. Maps crack the curved surface
- Symptom: dark "cracks" scattered across a black plastic shell.
- Cause: a normal map extracted from the photo carries the photo's own mid-frequency specular
  streaks; wrapped onto a curved surface they read as grime.
- Fix: high-pass the normal map (subtract a Gaussian low frequency, then amplify) so only the
  high-frequency grain remains — or drop its strength a lot.

### 9. Cushion highlights turn brown
- Symptom: black ear pads shift brown under warm light.
- Cause: the fabric sheen's white lobe plus a warm key light adds a brown layer on top of the surface.
- Fix: bring sheen down to the 0.06-0.1 range. Synthetic leather is not fabric.

## Lighting / shadows

### 10. Contact shadow never appears
- Symptom: the object floats; the ground looks freshly wiped.
- Cause: the shadow camera's `near/far` were set for a metre-scale object with the light within 1.6,
  while the actual light sits 9.8 units away — **everything that should cast is before near or beyond
  far**, so the shadow map is empty.
- Fix: fit to the light's real world distance: `standoff = light.getWorldPosition().length(); near =
  standoff*0.5; far = standoff*2`. Then tighten the ortho frustum to the object (`±radius*0.95`).

### 11. Shadow acne (striped patches) on curved surfaces
- Symptom: stripes along the inner wall of the ear pads.
- Cause: the shadow map resolution is too high relative to the object; one texel covers a visible
  area.
- Fix: tighten the frustum to the object's size, set `normalBias = 0.0025` and `bias = -0.0002`, and
  drop the shadow map to 1024 if needed.

### 12. Black plastic renders as grey plastic
- Symptom: the reference is near-black, the render is mid-grey.
- Cause: exposure was tuned by eye.
- Fix: measure mean luminance of the subject in the reference, measure the same region in the render,
  and set `toneMappingExposure` from the ratio. Record both measurements — no "looks about right".

## Interaction / viewer shell

### 13. Clicking one part also lights its mirrored twin
- Symptom: click the left ear pad, the right one turns blue too; blue stays after reset.
- Cause: the generator emits **one material instance per material id** and both sides share it.
  Writing `material.emissive` changes both, and restoring only `emissiveIntensity` leaves the blue
  behind.
- Fix: on select, clone the material per mesh (`clone.emissive = HIGHLIGHT`); on restore, put the
  original material object back. `assets/viewer/main.template.ts` already implements this.

### 14. Camera will not zoom in / the model leaves the far plane
- Symptom: zooming stalls, or the whole model disappears.
- Cause: the generated control parameters assume a metre-scale object (`minDistance = 1.0`) while this
  object is 0.17 units; and `frameCamera()` sets near/far before OrbitControls overwrites them.
- Fix: set `minDistance = radius*0.5`, `maxDistance = radius*12` from the bounding sphere; write your
  own `frame()` that **positions the camera first, then sets near/far**.

### 15. Auto-rotate "on but not moving"
- Symptom: the button lights up, the image stays still.
- Cause: almost always a background-throttled tab where `requestAnimationFrame` does not run — common
  in automated screenshot environments. It is not a code bug.
- Fix: when verifying the wiring, pump `controls.update()` manually a few times and watch the azimuth
  advance. It recovers on its own in a real foreground browser.

## Review CLI

### 16. `append_review.py` says the file does not exist, but it does
- Cause: relative paths resolve against the **skill directory**, not the current directory.
- Fix: pass absolute paths for every screenshot and reference image.

### 17. Wanting to record a score without scoring a layer
- Cause: `--action continue` requires layer scores, the viewpoint list, per-feature scores and
  screenshot files that actually exist.
- Fix: score it honestly. Scores may be low, they may not be missing — a low score is a record, not a
  failure.

## Drivers and browsers

### 18. `browser runtime bridge is unavailable`, or `setupBrowserRuntime` returns undefined
- Cause: `setupBrowserRuntime` has no return value; it hangs the runtime on `globalThis.agent`. And
  this whole path only exists inside the app session — see 19.
- Fix: import it as
  `join(process.env.ZCODE_PLUGIN_ROOT, "scripts", "browser-client.mjs")` through `pathToFileURL`,
  call it, then read `globalThis.agent`.

### 19. Running the scripts with plain `node` fails with `bridge unavailable`
- Cause: the browser is a bridge owned by the app session. A plain node subprocess has no bridge.
- Fix: either import the scripts inside the app's JS runtime (`--driver zcode`), or use the portable
  driver: `node assets/build/capture_frames.mjs ... --driver playwright` launches its own Chrome and
  needs no app session. See `references/browser-run.md`.

### 20. `globalThis.agent` is undefined inside an imported module
- Cause: each runtime call is a fresh kernel, and a module has its own context — it cannot see the
  `globalThis.agent` the caller attached.
- Fix: pass it explicitly, `openPage(url, globalThis.agent)`. Do not read globals inside modules.

### 21. `no browser tab available`
- Cause: in a cold session `tabs.list()` returns an empty array; there is no "current tab" to take.
- Fix: use `openPage(url, agent)`, which calls `agent.browsers.open(url, { reuseTab: true })` and
  picks or creates a tab itself.

### 22. `tab.playwright` has no click / screenshot / mouse
- Note: that shim exposes only `evaluate / locator / getByRole / getByText / waitForTimeout /
  waitForLoadState`. Screenshots are `tab.screenshot()`; navigation is `tab.goto()`.
- Fix: click via `element.click()` or a dispatched `PointerEvent` inside `evaluate`. Do not use
  `locator.click()` under the app driver — it waits until timeout.

### 23. `tab.screenshot()` times out after 30 s
- Cause: screenshots go through the compositor, and a background tab sometimes never answers.
- Fix: `shot()` already handles it — on timeout it falls back to
  `captureDataUrl({mode:"beauty"})` and records `canvas` in `shotSources`. Retry if you need the HUD;
  if you only need the model, do not fight the compositor.

### 24. The auto-rotate assertion flakes
- Cause: OrbitControls runs with damping, so the camera keeps drifting after a drag; with rotation
  off, that inertial tail reads as movement.
- Fix: pump each phase before measuring (60 pumps on, 240 off) and put the threshold at 5%. Both
  runner scripts already do this.

### 25. `captureDataUrl()` returns `[object Object]`
- Cause: it returns `{ ok, dataUrl }`, not a string.
- Fix: read `r.dataUrl`, then `Buffer.from(url.split(",")[1], "base64")`.

### 26. `file://` will not open the deliverable
- Cause: automated browsers block `file://`.
- Fix: serve a directory containing only the single file (`python3 -m http.server 8101 --directory
  dist`) and test "zero external dependencies" through that. Mention that a real browser can also open
  it by double-clicking.