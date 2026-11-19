---
name: photo-to-3d-demo
description: Turn one or more product photographs into a tested, single-file interactive Three.js demo (orbit, click-to-select, explode, wireframe), with per-pass review frames and browser-verified evidence. Use when the user supplies a product photo and asks to "make it 3D", "turn this into a 3D model", "make it rotatable", "an interactive model", "an exploded view", "a web 3D display", or "a model from one image". Not suitable for faces, cloth, hair, or engineering/CAD work.
license: Apache-2.0
version: 0.1.0
---

# Product photos to an interactive 3D web demo

## Scope, stated up front

- **This is not a one-click generator.** Generation, bundling, captures, packaging and the browser test
  are scripted. Deciding what to change after looking at a frame is not: every pass needs someone to
  open the evidence frame, compare it against the photo, and edit the spec. Batch-changing parameters
  without looking produces differences nobody can attribute.
- **It is a front end for img2threejs** (`https://github.com/img2threejs/img2threejs`, Apache-2.0).
  This repo adds the delivery half that upstream stops short of: a viewer shell, the evidence capture
  contract, the single-file packer, and interaction assertions that run in a real browser.
- **Photographs must cover the object, not outnumber it.** Two to four views (front, back, 45 degrees,
  one detail crop) beat twenty near-identical frames. A single view works, but then the rear faces are
  inferred by symmetry and that must be written into `spec.assumptions`.
- **Do not build what cannot be seen and is not constrained** (drivers, circuit boards, screw bosses).
  Inventing them is storytelling; leave them out and list them under known gaps.

## Before starting: are the photos enough

| Situation | Action |
| --- | --- |
| Single subject, clean light, not cropped, 2-4 angles | Proceed |
| Front view only | Proceed, but `assumptions` must say the rear is inferred by symmetry, and tell the user at delivery |
| Strong specular blowout hiding shape | Proceed, mark those regions low confidence; if a key face is fully blown out, ask for a reshoot |
| Transparent, mirrored or glass-heavy | Warn first: this route degrades badly on those materials |
| Faces, cloth folds, hair, plants | Say this route is wrong; use scanning or conventional modelling |
| Needs to be machined, maintained or assembled | Say no; this is not an engineering model |

Say this before starting, not after the work is done.

## Install (once per machine)

```bash
git clone <this repo> ~/photo-to-3d-demo
bash ~/photo-to-3d-demo/assets/build/bootstrap.sh --check
```

Put the clone where the agent can read it — `~/.zcode/skills/photo-to-3d-demo` or a plain clone both
work, because every script resolves its own directory (step 0 shows the assignment). `--check` exits
non-zero when something is missing, so a fresh machine says what to install instead of failing three
passes later.

What the script installs:

- `playwright-core` into the repo (`npm install`); it drives the Chrome already on the machine and
  downloads no browser
- an [img2threejs](https://github.com/img2threejs/img2threejs) checkout at
  `$HOME/.cache/photo-to-3d/img2threejs` when no existing checkout is found; `--engine-dir DIR` and
  `--no-engine` override that
- nothing else. `three` and `esbuild` are pinned per workspace by `setup_workspace.sh`, because the
  version that produced a signed-off review has to stay the version that reproduces it.

`--check` then runs the generator's `--help` and launches one real browser through `drivers/index.mjs`,
printing which driver resolved. That launch is the difference between "dependencies installed" and
"the evidence pipeline works".

Two optional variables, both with working defaults:

| Variable | Default resolution | Set it when |
| --- | --- | --- |
| `IMG2THREEJS_ENGINE` | third argument to `build_pass.sh`, else `~/.workbuddy/skills/img2threejs`, else `~/.cache/photo-to-3d/img2threejs` | the upstream checkout lives elsewhere |
| `PYTHON` | `python3`, falling back to `python` | neither exists on `PATH`, or `python3` there is older than 3.9 |

## Workspace layout

```
<slug>/                            slug = kebab-case product name, e.g. sony-mdr-zx310
  reference/ref.jpg                the supplied photo(s); ref-01.jpg / ref-back.jpg for several
  spec/object-sculpt-spec.json     single source of truth: component tree, materials, assumptions, reviewHistory
  spec/crops/                      per-material crops
  spec/pbr/<material>/             extracted albedo/roughness/height/normal/ao
  src/model.ts                     generated; never hand-edited (the next pass overwrites it; the filename is
                                   fixed so the build script needs no arguments, exports still carry the subject)
  src/main.ts                      viewer shell, from this repo's template
  src/index.template.html          viewer page
  review/captures/                 evidence frames per pass
  review/compare-<pass>.png        reference-vs-render comparison sheets
  dist/<slug>.html                 the deliverable
  build/                           scratch: app.js / index.html / *.png / node_modules
```

`build/` is a scratch directory: **textures load by bare filename and must all sit at the build root**,
or they silently come out black.

## Steps

### 0. Choose a slug, create the workspace

```bash
SKILL_DIR=/path/to/photo-to-3d-demo     # this repo
WP=~/photo-to-3d/$SLUG                  # keep it out of the repo you are working in
bash "$SKILL_DIR/assets/build/setup_workspace.sh" "$WP"
```

`setup_workspace.sh` creates the tree and installs `three@0.169.0 + esbuild@0.24.0` inside `build/`.
The versions are pinned on purpose: a different three can shift PMREM or OrbitControls behaviour and
invalidate lighting a review already signed off.

### 1. stage1: crop materials, extract PBR

Crop per material region (shell / metal / glass / cushion / logo) and extract
albedo/roughness/height/normal/ao for each. One view only ever yields estimates: record `confidence`
honestly in the spec (typically around 0.8, not 1.0).

### 2. stage2: write the spec

Required content:

- `componentTree`: id, name, level (macro/meso/micro), dimensions, `topologyRationale` (why this
  geometry, at what cost).
- `materials`: baseColor, roughness, metalness, normal/height/AO, texture `url` (**bare filename**).
- `assumptions`: **everything invisible goes here**, one sentence each. It is the only thing that can
  prove at delivery which parts were guessed.
- `featureAcceptance` (optional): passIds plus a score floor; the review gate uses it.

### 3. The eight passes (the core loop)

Fixed order, one concern per pass:

```
blockout -> structural-pass -> form-refinement -> material-pass
         -> surface-pass -> lighting-pass -> interaction-pass -> optimization-pass
```

Fixed actions per pass (finish a pass before starting the next):

```bash
# 1) regenerate the factory for this pass
bash "$SKILL_DIR/assets/build/build_pass.sh" "$WP" <pass-id>
# 2) serve the preview (first time)
python3 -m http.server 8100 --directory "$WP/build" &
# 3) capture evidence frames (see references/browser-run.md)
# 4) look at the frames -> edit the spec (not the generated .ts) -> back to 1)
# 5) record the review (references/review-cli.md)
```

Capture and interaction scripts need a browser; they run through a driver, so both a plain Node setup
(`--driver playwright`) and the ZCode desktop session (`--driver zcode`) work. Setup, presets and the
`emitImage` step: **read `references/browser-run.md`**.

What to change each pass, which frames to capture, and how to judge the gate: **read
`references/pipeline.md`**.

### 4. Record the review

`append_review.py` writes `spec.reviewHistory`. The flag set is long and **paths must be absolute**;
copy the template from `references/review-cli.md` rather than reconstructing it from memory.

`--action continue` requires layer scores plus a viewpoint list (must include `long-axis` and
`thickness-axis`) plus per-feature scores plus screenshot files that actually exist. The final pass
uses `--action stop`.

### 5. Optimize, then pack the single file

```bash
python3 "$SKILL_DIR/assets/build/pack_single.py" "$WP/build" "$WP/dist/$SLUG.html"
```

- Converge textures first: 1024 to 512 (keep wordmarks and fine print at full size), shadow map
  2048 to 1024.
- After packing, verify: `external_refs` is empty, size is plausible (usually 3-6 MB), map count matches.

### 6. Browser test (not optional)

Call `testInteractions(tab, { outDir, prefix })` from `assets/build/test_interactions.mjs`, through
either driver. It opens the page, dispatches real pointer events, takes real screenshots, and asserts:

- the camera moved after a drag (before/after coordinates printed)
- after a click `#readout` is populated and **only the clicked mesh** is lit (this catches the
  shared-material trap where mirrored parts light up together)
- a click that hits nothing clears the highlight (a stale selection keeps one part lit for the rest of
  the run and leaves the readout describing a part nobody is pointing at)
- explode moved parts by more than zero, and the camera kept the exploded assembly in frame
- wireframe covers 100% of meshes
- auto-rotate advances the azimuth when on and holds still when off

A failure is reported with its actual output, never skipped. Screenshots go back to the user; a
`canvas` entry in `shotSources` means the compositor would not screenshot and the renderer frame was
used instead, which is not a failure.

### 7. Delivery

Four things, or it is not finished:

1. `dist/<slug>.html` plus a working local link
2. Browser-test screenshots (orbit / select / explode)
3. **Known gaps**: which silhouette is off, which surfaces were inferred, which materials degrade,
   what the scores were
4. Short notes: how to change it, which traps bit, what checklist to follow next time

## Acceptance checklist

- [ ] `reviewHistory` has eight entries and the last one is `action=stop`
- [ ] `spec.assumptions` is non-empty and every line maps to a part that cannot be seen
- [ ] `review/captures/` has at least one beauty frame per pass, plus silhouette / map-stripped on the
      passes where they matter
- [ ] the single file reports `external_refs: []`
- [ ] all six browser assertions pass, with screenshots
- [ ] the delivery text states which parts were measured and which were inferred

## Six traps that bite first

Full symptom/cause/fix list in `references/traps.md`; the numbers below are that file's.

1. Editing the generated `.ts` — the next pass overwrites it. **Edit the spec.**
2. Textures in a subdirectory — silently black, because `url` resolves by bare filename (trap 5).
3. With maps present, `material.roughness` is pinned to 1 — roughness only survives in the map
   (trap 6).
4. A near-constant roughness map terraces into visible bands at 8-bit — use a flat value instead
   (trap 7).
5. Selection highlight written onto shared materials — mirrored parts light up together. **Clone per
   mesh** (trap 13).
6. Shadow camera near/far not fitted to the light's actual distance — contact shadow never appears
   (trap 10).

## When not to use this

- The user wants a rough look — a short video is faster.
- Photoreal or engineering accuracy is required — say it cannot deliver that.
- Organic forms — use scanning or conventional modelling.
- No usable photo — ask for one; do not start from imagination.