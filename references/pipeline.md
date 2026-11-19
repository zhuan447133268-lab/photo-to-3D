# The eight passes: one concern per pass

The order is fixed. Skipping a pass destroys attribution: you can no longer tell whether a difference is
geometry, material, or lighting.

Every pass runs the same loop:

1. generate the factory, 2. build, 3. capture evidence frames, 4. **look at them**, 5. edit the spec,
6. record the review, back to 1.

---

## 1. blockout

**Goal:** volume and proportion only. Is the skeleton of the object right?

- Change: component tree, each part's dimensions and centre, overall orientation.
- Evidence: `alpha-silhouette` (white shape on black) plus `beauty`.
- Pass criteria: the silhouette overlays the reference — main masses' height, width ratio, and the
  relative placement of parts. Do not discuss materials in this pass.
- Common misjudgement: "close enough" when the proportion is off by 10%. Put the silhouette next to the
  reference and compare pixel positions of the key turns (highest point, widest point, fork position).

## 2. structural-pass

**Goal:** connect the parts and expose wrong structural relationships.

- Change: parent/child relations, connecting pieces (rails, clips, hinges), gaps and intersections.
- Evidence: `beauty`, a wireframe screenshot, and the long-axis view.
- Pass criteria: nothing floating, nothing interpenetrating, connectors actually span two parts.
- Common misjudgement: packing geometry into hidden areas so the render "looks complete" — the long-axis
  view exposes it immediately.

## 3. form-refinement

**Goal:** get the primary form right (curvature, turns, thickness).

- Change: lathe profile points, extrusion paths, segment counts, fillets.
- Evidence: `beauty` from the reference angle, a 45-degree view, a close-up of the key feature.
- Pass criteria: curvature direction at each turn is right (straight where straight, bulged where
  bulged), and thickness reads as real.
- Generator notes: the lathe axis is local Y, so define the profile in XY (trap 1); close the profile
  or the lathe renders with a hole.

## 4. material-pass

**Goal:** material zoning correct — "which region is what" matters more than "how pretty".

- Change: the relationship between base colour, metalness and roughness; where material boundaries fall.
- Evidence: `beauty`, `roughness-material-id` (colour by material), `semantic-id` (colour by part).
- Pass criteria: every visible region can be named as a material, and boundaries sit on real seams
  rather than arbitrary cuts.
- Common misjudgement: can't tell gloss from matte, so everything gets brightened. Confirm zoning with
  `semantic-id` first, then talk about value.

## 5. surface-pass

**Goal:** surface detail — texture direction, grain, seams.

- Change: the maps themselves (albedo cleanup, high-pass normals, zeroed AO), UV repeat, anisotropy.
- Evidence: `beauty`, a grazing-angle frame, a close-up.
- Pass criteria: no decal feel, no 8-bit terracing, seam direction consistent with how the part is made.
- Generator note: `material.roughness` is pinned to 1, so roughness only survives in the map (trap 6).

## 6. lighting-pass

**Goal:** make it stop looking rendered — exposure, shadow contact, highlight shape.

- Change: environment map, key/fill/rim lights, exposure (**measured, not tuned until pretty**), contact
  shadow.
- Evidence: `beauty` from the reference camera, `neutral` (warm light off), `contact` (ground shadow
  visible), `map-stripped` (form without textures).
- Pass criteria: mean object luminance is in the same range as the reference (within about 20%); the
  contact shadow lands on the ground; structure stays readable under neutral light.
- Exposure method: measure mean luminance of the subject in the reference, measure the same region in
  the render, set `toneMappingExposure` from the ratio. Two iterations converge.
- Common misjudgement: raising light levels to "recover detail" until black plastic becomes grey plastic.

## 7. interaction-pass

**Goal:** the interactions actually work.

- Change: picking (raycast), selection highlight, explode axis and travel, wireframe, auto-rotate,
  reset, reference card.
- Evidence: the four screenshots from the interaction test (orbit / select / explode / wireframe).
- Pass criteria: every assertion in `assets/build/test_interactions.mjs` is true.
- Generator note: mirrored parts share materials, so selection highlight must clone per mesh (trap 13).

## 8. optimization-pass

**Goal:** converge the budget without losing quality.

- Change: texture resolution (1024 to 512, except wordmarks), shadow map (2048 to 1024), redundant
  duplicate maps.
- Evidence: one frame before and one after from the **same camera**, compared pixel by pixel.
- Pass criteria: same-view `mean abs diff` < 0.5/255, p99 <= 4, mean luminance change < 1%; texture VRAM
  reduction recorded.
- Do at the same time: single-file packaging plus the browser test (SKILL.md steps 5 and 6).

---

## Capture modes

`__IMG2THREEJS_CAPTURE__.captureDataUrl({ mode })` supports:

| mode | Use |
| --- | --- |
| `beauty` | Normal render; the baseline frame for every review |
| `alpha-silhouette` | Pure white silhouette; judge proportion and outline (required in blockout) |
| `map-stripped` | Textures and lights off; does the form actually exist (required in surface/lighting) |
| `semantic-id` | Colour by part hash; judge zoning and intersections |
| `roughness-material-id` | Greyscale by material roughness; judge material zoning |
| `depth` / `normal` | Debugging (intersections, surface direction) |

Camera: `setCamera({ azimuthDegrees, elevationDegrees, distance, target, rollDegrees })`.
Product photos are almost never shot perfectly level, so **align roll to the reference**, otherwise the
comparison is always slightly off.

## Viewpoint list (required when recording a review)

`reference-match`, `plate-face` (or the product's key face), `contact-shadow`, `neutral-light`,
`grazing-close-up`, and **mandatory** `long-axis` (end-on along the long axis) and `thickness-axis`.
Those two exist to catch thin-plate artefacts, intersections and fake thickness.

## Feature gate (featureAcceptance)

Give key features `{id, passIds, threshold, weight}` in the spec. The gate only checks features whose
`passIds` include the pass being reviewed, so a 0.62 shortfall does not block the pipeline — it stays on
record. **That is the design, not a loophole:** the pipeline keeps moving, the weak spot keeps a trace.