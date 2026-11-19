// Drive the demo like a person would, and prove each interaction changed something.
//
// A build that merely loads is not a deliverable: the four things a product page promises — orbit,
// click-to-select, explode, wireframe — each have to be observed changing state, and the selection has
// to light up only the part that was clicked. That last one is the specific regression the shared-material
// trap causes (mirrored parts reuse one material instance), so it is asserted, not eyeballed.
//
// CLI:
//   node test_interactions.mjs --url http://127.0.0.1:8101/product.html --out captures --prefix single-file
//
// Programmatic use, when you already hold a tab:
//   const { testInteractions } = await import(pathToFileURL("<repo>/assets/build/test_interactions.mjs").href);
//   const r = await testInteractions(tab, { outDir, prefix: "single-file" });
//   if (r.failed.length) throw new Error("failed: " + r.failed.join(", "));
import fs from "node:fs/promises";
import path from "node:path";
import { openPage } from "../../drivers/index.mjs";
import { argOf, clickById, goto, isMain, shot, waitReady } from "./browser.mjs";

export async function testInteractions(tab, opts) {
  const { outDir = "captures", prefix = "interaction" } = opts ?? {};
  const dir = path.resolve(outDir);
  await fs.mkdir(dir, { recursive: true });

  const results = {};
  const shots = [];
  const shotSources = [];
  // Snapshots may come from the compositor or, when that is unavailable, from the renderer canvas.
  const snap = async (name) => {
    const r = await shot(tab, path.join(dir, `${prefix}-${name}.png`));
    shots.push(r.file);
    shotSources.push(r.source);
    return r;
  };
  const camPos = () => tab.playwright.evaluate(
    () => window.__demo.camera.position.toArray().map((n) => +n.toFixed(4)),
    null, { timeoutMs: 3000 },
  );

  // ---------- 1. orbit ----------
  const before = await camPos();
  await tab.playwright.evaluate(() => {
    const c = document.getElementById("view");
    const mk = (t, x, y) => new PointerEvent(t, {
      clientX: x, clientY: y, bubbles: true, pointerId: 1, pointerType: "mouse",
      buttons: t === "pointerup" ? 0 : 1,
    });
    const x0 = Math.round(innerWidth * 0.44);
    const y0 = Math.round(innerHeight * 0.5);
    c.dispatchEvent(mk("pointerdown", x0, y0));
    for (let i = 1; i <= 12; i += 1) c.dispatchEvent(mk("pointermove", x0 + i * 12, y0 + i * 1.5));
    c.dispatchEvent(mk("pointerup", x0 + 144, y0 + 18));
  }, null, { timeoutMs: 3000 });
  await tab.playwright.waitForTimeout(250);
  const after = await camPos();
  const moved = Math.hypot(after[0] - before[0], after[1] - before[1], after[2] - before[2]);
  results.orbit = { ok: moved > 0.005, cameraBefore: before, cameraAfter: after, moved: +moved.toFixed(4) };
  await snap("01-orbit");

  // ---------- 2. click-to-select ----------
  const target = await tab.playwright.evaluate(() => {
    const d = window.__demo;
    let best = null;
    // Project each part's node position; pick the one nearest the middle of the viewport. The node's own
    // position is where the part actually sits in the assembly, which is what a person aims at.
    const cx = innerWidth / 2;
    const cy = innerHeight / 2;
    for (const part of d.parts) {
      if (!part.node.isObject3D) continue;
      const v = part.node.getWorldPosition(d.camera.position.clone().set(0, 0, 0)).project(d.camera);
      if (v.z > 1 || Math.abs(v.x) > 0.95 || Math.abs(v.y) > 0.95) continue;
      const x = (v.x * 0.5 + 0.5) * innerWidth;
      const y = (-v.y * 0.5 + 0.5) * innerHeight;
      const dist = Math.hypot(x - cx, y - cy);
      if (!best || dist < best.dist) best = { id: part.id, x: Math.round(x), y: Math.round(y), dist };
    }
    return best;
  }, null, { timeoutMs: 4000 });

  results.select = { aim: target };
  if (target) {
    const sel = await tab.playwright.evaluate((p) => {
      const c = document.getElementById("view");
      const mk = (t) => new PointerEvent(t, {
        clientX: p.x, clientY: p.y, bubbles: true, pointerId: 1, pointerType: "mouse",
        buttons: t === "pointerup" ? 0 : 1,
      });
      c.dispatchEvent(mk("pointerdown"));
      c.dispatchEvent(mk("pointerup"));
      const readout = document.getElementById("readout");
      const lit = [];
      window.__demo.model.traverse((o) => {
        const e = o.isMesh && o.material?.emissive;
        if (e && (e.r + e.g + e.b) > 0.01) lit.push(o.userData?.sculptComponent?.id ?? "?");
      });
      return { text: readout.textContent.trim(), active: readout.classList.contains("active"), lit };
    }, target, { timeoutMs: 3000 });

    // Every lit mesh must belong to one part id: two ids means a mirrored twin lit up as well.
    const ids = [...new Set(sel.lit)];
    results.select = {
      ...results.select,
      ok: sel.active && sel.text.length > 0 && ids.length === 1,
      // `aim` is the part whose origin sits nearest the viewport centre; `hit` is what the ray actually
      // found under that pixel. They can differ when one part is in front of another, and only the
      // second one tells you whether the click landed on a single part.
      hit: ids[0] ?? null,
      readout: sel.text,
      litParts: ids,
      active: sel.active,
    };
    await snap("02-select");
  } else {
    results.select.ok = false;
  }

  // A click that hits no part has to clear the highlight: a stale selection keeps one shell blue for
  // the rest of the run and leaves the readout describing something the user is no longer pointing at.
  const cleared = await tab.playwright.evaluate(() => {
    const c = document.getElementById("view");
    const mk = (t) => new PointerEvent(t, {
      clientX: 1100, clientY: 640, bubbles: true, pointerId: 1, pointerType: "mouse",
      buttons: t === "pointerup" ? 0 : 1,
    });
    c.dispatchEvent(mk("pointerdown"));
    c.dispatchEvent(mk("pointerup"));
    return { active: document.getElementById("readout").classList.contains("active") };
  }, null, { timeoutMs: 3000 });
  results.deselect = { ok: !cleared.active, activeAfterEmptyClick: cleared.active };
  if (results.select.ok) results.select.ok = results.deselect.ok;

  // ---------- 3. explode ----------
  const camDist = () => tab.playwright.evaluate(() => {
    const d = window.__demo;
    return +d.camera.position.distanceTo(d.controls.target).toFixed(4);
  }, null, { timeoutMs: 3000 });
  const camBefore = await camDist();
  await clickById(tab, "#btn-explode");
  // The viewer eases its camera out to keep the exploded assembly in frame; let that land first.
  await tab.playwright.waitForTimeout(700);
  // Screenshots force frames in a throttled tab, which is what advances the explode tween.
  await snap("03-explode");
  await tab.playwright.waitForTimeout(900);
  const camAfter = await camDist();
  const explode = await tab.playwright.evaluate(() => {
    const d = window.__demo;
    let travel = 0;
    for (const p of d.parts) travel = Math.max(travel, p.node.position.distanceTo(p.base));
    return { travel: +travel.toFixed(4), on: document.getElementById("btn-explode").classList.contains("on") };
  }, null, { timeoutMs: 3000 });
  // The camera has to pull back while the parts travel out, otherwise the outer shells leave the frame
  // and the screenshot shows a half-assembly.
  const camGrew = camAfter > camBefore * 1.05;
  results.explode = { ok: explode.on && explode.travel > 0 && camGrew, camBefore, camAfter, camGrew, ...explode };

  // ---------- 4. wireframe ----------
  await clickById(tab, "#btn-explode"); // put the assembly back before judging topology
  await clickById(tab, "#btn-wire");
  await tab.playwright.waitForTimeout(250);
  const wire = await tab.playwright.evaluate(() => {
    let meshes = 0;
    let wired = 0;
    window.__demo.model.traverse((o) => {
      if (!o.isMesh) return;
      meshes += 1;
      if (o.material && o.material.wireframe) wired += 1;
    });
    return { meshes, wired, on: document.getElementById("btn-wire").classList.contains("on") };
  }, null, { timeoutMs: 3000 });
  results.wireframe = { ok: wire.on && wire.meshes > 0 && wire.wired === wire.meshes, ...wire };
  await snap("04-wire");
  await clickById(tab, "#btn-wire");

// ---------- 5. auto-rotate ----------
  // rAF is throttled in a background tab, so the render loop may not tick at all. Pump the same
  // controls.update() the loop calls and read the azimuth: that tests the wiring, not the frame rate.
  //
  // Both phases need a warm-up before the measured window. OrbitControls runs with damping, so leftover
  // velocity from the drag above keeps moving the camera for a while; measuring straight after the
  // toggle reads that tail as rotation and made this assertion pass or fail on timing alone.
  const pump = (n) => tab.playwright.evaluate((k) => {
    const c = window.__demo.controls;
    const a0 = c.getAzimuthalAngle();
    for (let i = 0; i < k; i += 1) c.update();
    return { a0: +a0.toFixed(4), a1: +c.getAzimuthalAngle().toFixed(4) };
  }, n, { timeoutMs: 3000 });

  await clickById(tab, "#btn-rotate");
  await pump(60); // settle into a steady spin rate
  const onState = await pump(60);
  await clickById(tab, "#btn-rotate");
  await tab.playwright.waitForTimeout(300);
  await pump(240); // let the damping tail decay to nothing
  const offState = await pump(60);
  const onDelta = Math.abs(onState.a1 - onState.a0);
  const offDelta = Math.abs(offState.a1 - offState.a0);
  results.autoRotate = {
    ok: onDelta > 0.05 && offDelta < onDelta * 0.05,
    onDelta: +onDelta.toFixed(4),
    offDelta: +offDelta.toFixed(4),
    note: "pumped manually because rAF is throttled in a background tab; damping allowed to settle first",
  };

  // ---------- verdict ----------
  results.shots = shots;
  results.shotSources = shotSources;
  results.failed = Object.entries(results)
    .filter(([, v]) => v && typeof v === "object" && "ok" in v && !v.ok)
    .map(([k]) => k);
  return results;
}

if (isMain(import.meta.url)) {
  const argv = process.argv.slice(2);
  const url = argOf(argv, "url");
  if (!url) {
    console.error("--url is required (when run directly; inside the app runtime, import testInteractions instead)");
    process.exit(2);
  }
  const { tab, browser, driver } = await openPage(url, {
    driver: argOf(argv, "driver", process.env.DEMO_DRIVER ?? "playwright"),
    agent: globalThis.agent,
  });
  await goto(tab, url);
  if (!(await waitReady(tab))) {
    console.error("page never reported __IMG2THREEJS_READY__");
    await browser?.close?.();
    process.exit(1);
  }
  const results = await testInteractions(tab, {
    outDir: argOf(argv, "out", "captures"),
    prefix: argOf(argv, "prefix", "interaction"),
  });
  results.url = url;
  results.driver = driver;
  console.log(JSON.stringify(results, null, 1));
  await browser?.close?.();
  process.exit(results.failed.length ? 1 : 0);
}