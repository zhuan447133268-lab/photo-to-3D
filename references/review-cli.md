# Recording a review: copy the template, do not reconstruct it

Engine location, once:

```bash
ENGINE="${IMG2THREEJS_ENGINE:-$HOME/.cache/photo-to-3d/img2threejs}"   # a checkout of
                                       # https://github.com/img2threejs/img2threejs
SPEC="$WP/spec/object-sculpt-spec.json"
```

Every command below says `python3`; on a machine where only `python` exists, use that instead. The shell
scripts pick whichever is on `PATH` (or `PYTHON`, if set), so this only matters when you call the
generator or the review tool by hand.

## Generate one pass

```bash
python3 "$ENGINE/forge/stage3_build/generate_threejs_factory.py" "$SPEC" \
  --pass-id <pass-id> --out "$WP/src/model.ts" --force
```

`build_pass.sh` wraps this together with the bundle and the texture copy; call the generator directly only
when you need a different output path.

After generating, check two things: `grep -c userData.sculptComponent` matches the component count in the
spec, and every map reached the `build/` root.

## Record the review

```bash
python3 "$ENGINE/forge/stage4_review/append_review.py" "$SPEC" \
  --pass-id <pass-id> \
  --fidelity 0.80 \
  --action continue \
  --summary "one sentence: what this pass changed, and what it cost" \
  --matched "point 1;point 2;point 3" \
  --mismatches "gap 1;gap 2" \
  --spec-fixes "spec items for the next pass" \
  --code-fixes "code changes, if any" \
  --evidence "$WP/review/captures/a.png;$WP/review/captures/b.png" \
  --reference-screenshot "$WP/reference/ref.jpg" \
  --render-screenshot "$WP/review/captures/a.png" \
  --comparison-image "$WP/review/compare-<pass>.png" \
  --ai-vision-score 0.80 \
  --layer-scores-json '{"silhouetteProportion":0.62,"componentStructure":0.76,"formDetail":0.80,"materialSurface":0.82,"lightingCamera":0.78}' \
  --feature-reviews-json '[{"id":"<feature-id>","visible":true,"score":0.82,"notes":"what you saw"}]' \
  --review-viewpoints-json '["reference-match","contact-shadow","neutral-light","grazing-close-up","long-axis","thickness-axis"]' \
  --camera-view "az 150 / el 16 / distance 0.30 / roll -15" \
  --require-screenshot-files --in-place
```

### Hard rules

1. **Paths must be absolute.** A relative path resolves against the *engine* directory and fails with
   "file not found" while the file is sitting right there.
2. `--layer-scores-json` needs all five keys: `silhouetteProportion`, `componentStructure`, `formDetail`,
   `materialSurface`, `lightingCamera`.
3. `--review-viewpoints-json` **must** contain `long-axis` and `thickness-axis`. Those two exist to catch
   thin-plate artefacts, intersections and fake thickness.
4. `--require-screenshot-files`: every referenced screenshot must exist on disk. No citing files you did
   not produce.
5. Low scores get low numbers. A score is a record, not a report card; inflating it gives the next pass the
   wrong baseline.
6. The last pass uses `--action stop`; intermediate passes use `--action continue`.
7. `--action refine-code` covers the rare case where the spec is right and the generator was wrong.
   Normally it is `refine-spec` or `continue`.

### map-stripped frame

surface-pass and lighting-pass also take:

```bash
  --map-stripped-render "$WP/review/captures/<pass>-mapstripped.png"
```

It proves the form exists, rather than being faked into looking detailed by textures.

## Feature gate (optional, strongly recommended)

Add to the spec:

```json
"featureAcceptance": {
  "targets": [
    { "id": "overall-silhouette", "passIds": ["blockout", "form-refinement"], "threshold": 0.8, "weight": 3 },
    { "id": "material-split",   "passIds": ["material-pass"], "threshold": 0.8, "weight": 2 }
  ]
}
```

Gate semantics: only targets whose `passIds` include the current pass are checked. A 0.62 therefore does
not block the pipeline but stays on record. **That is the intent**: keep moving, keep the weak spot
visible, do not edit scores to make everything green.

## Status check

```bash
python3 "$ENGINE/forge/next.py" "$SPEC"      # what the next pass should be, when that script exists
python3 - <<'PY'
import json, pathlib, os
spec = json.loads(pathlib.Path(os.environ["SPEC"]).read_text(encoding="utf-8"))
print([(r["passId"], r["action"], r["estimatedFidelity"]) for r in spec["reviewHistory"]])
print("assumptions:", len(spec.get("assumptions", [])))
PY
```

Eight records, the last one `action=stop`, `assumptions` non-empty — only then is the work done.