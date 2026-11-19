# Packed example

[`mdr-zx310.html`](mdr-zx310.html) — 4.0 MB, one file, nothing beside it.

Double-click it, or drag it into any browser. No server, no CDN, no network. That is verified, not
assumed: loaded over `file://` in Chrome, the page reports `__IMG2THREEJS_READY__` and 36 addressable
component nodes, and the packer that produced it refuses to write a file that still references anything
external (`external_refs: []`).

## What to try

| Action | What it should do |
| --- | --- |
| drag | orbit the assembly |
| scroll | zoom, clamped to the real size of the object (no falling through it) |
| click a part | only that part lights up; the readout names it, its level and its material |
| click empty space | selection clears |
| **Explode** | parts move along their own outward axis, and the camera pulls back so the assembly stays in frame |
| **Wireframe** | every mesh switches to wireframe — this is the generated topology, not a decal |
| **Auto-rotate** | a slow spin; click again to stop |
| **Reference** | the source photograph appears as a card, for comparing against the render |
| **Reset view** | collapse, deselect, reframe |

## Provenance

Built from a single product photograph by the eight passes described in [`../SKILL.md`](../SKILL.md):
`blockout -> structural-pass -> form-refinement -> material-pass -> surface-pass -> lighting-pass ->
interaction-pass -> optimization-pass`. The workspace that holds the spec (component tree, materials,
assumptions, review history) is per-run data and is not shipped here; this file is the artifact.

What this is: a visual reconstruction — 36 component nodes, 18 meshes, 35 textures, shaded to match the
photo. What it is not: a CAD model. It has no dimensional accuracy, no internal structure, and cannot be
used for machining, maintenance or assembly.

Faces that the photograph does not show were inferred by symmetry. That inference is recorded in the
spec's `assumptions`, and it is the reason the rear of the headband is smooth rather than detailed.

The product in this example is named only to identify the test subject. Nothing here is affiliated with
or endorsed by that brand.