# Contributing

Thanks for taking a look. This repository is small on purpose: a viewer shell, five scripts, four
reference documents. The rules below exist so it stays that way.

## What belongs here

Good contributions:

- Fixes to a script in `assets/build/` or a driver in `drivers/`.
- A new capture preset or a new assertion in the browser test, as long as it runs under both drivers.
- A trap you hit that is not in `references/traps.md`, written as symptom → cause → fix.
- Corrections to the pass criteria in `references/pipeline.md`, especially where the current wording
  let a bad pass through.

Out of scope:

- Anything vendoring img2threejs or three.js into this repository.
- A one-click "generate from photo automatically" mode. The pass ladder depends on someone looking at
  each evidence frame; automating that away removes the only quality signal the pipeline has.
- Product photographs, brand assets, or sample deliverables. Keep the repository image-free; put
  screenshots of your own run in an issue or a discussion instead.
- Build output (`build/`, `dist/`, `node_modules/`). All of it is generated, all of it is ignored.

## Changing a script

Two rules that have already cost real debugging time:

1. **Both drivers, or none.** `assets/build/capture_frames.mjs` and `test_interactions.mjs` must run
   unchanged under `--driver playwright` and `--driver zcode`. They may only use the tab interface
   documented in `references/browser-run.md` (`goto`, `screenshot`, `url`, `title`, `close`,
   `playwright.evaluate`, `waitForTimeout`, `waitForLoadState`, `locator`). If you need something new,
   add it to both drivers.
2. **Pure standard library for Python.** `pack_single.py` and `render_viewer.py` must keep running on a
   bare Python 3 without Pillow, NumPy or ImageMagick. Same for the shell scripts: `bash`, `find`,
   `sed`, `sort`, `uniq` only.

## Changing documentation

- English in the tracked files; `README.zh-CN.md` is the only translated document and is allowed to
  drift a little behind.
- No emoji, no marketing tone. State what a script does, what it fails on, and what the reader has to
  supply.
- Every claim about behaviour should be something you ran. If you did not run it, mark it as untested.

## Reporting a trap

A useful trap report has four parts:

1. the symptom, in the words you would search for;
2. the cause, and how you proved it (a measurement, a diff, a frame);
3. the fix that worked;
4. which pass it appeared in and what it cost.

Open an issue with those, or send a pull request that adds an entry to `references/traps.md`. Keep the
numbering stable — other documents cite traps by number.

## Before you open a pull request

- `python -m py_compile assets/build/pack_single.py assets/viewer/render_viewer.py`
- `bash -n assets/build/*.sh`
- `node --check assets/build/*.mjs drivers/*.mjs`
- If you touched the viewer or the packer, run one real workspace end to end and say in the pull
  request which product, how many parts, and whether all five interaction assertions passed.

## License

Contributions are accepted under the Apache License 2.0, the license of this repository. By opening a
pull request you confirm you have the right to submit the code under those terms.