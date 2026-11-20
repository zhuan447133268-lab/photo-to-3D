// Preview harness: everything the generated factory does not ship.
//
// The factory gives you geometry, materials and a light rig. This file adds the things every
// interactive product page needs — orbit, click-to-select with a hierarchy readout, explode, wireframe,
// auto-rotate, a reference card — plus the capture contract the review gates pull evidence through.
//
// Placeholders are filled by assets/viewer/render_viewer.py. Anything that depends on the object's size
// is derived from the model's bounding sphere at runtime, so a new product needs no number editing;
// only exposure and environment intensity are authored values, and both have to be calibrated by
// measuring the render against the reference (see references/pipeline.md, lighting-pass).
import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
// Two model sources share this shell: the spec-compiled factory (`build_pass.sh`) and a reconstructed
// mesh (`build_mesh.sh`). render_viewer.py writes the matching import block, so the rest of the file
// never knows which one it is looking at.
__MODEL_IMPORT__

async function boot() {
  const STAGE = 0x0e1013;

  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  __RENDERER_SETUP__(renderer);
  // Calibrated, not eyeballed: measure the object region's mean luminance in the reference, then in the
  // render, and set the exposure from the ratio. On a dark product a by-eye exposure turns black plastic
  // into grey plastic, and the lighting review cannot tell material error from exposure error.
  renderer.toneMappingExposure = __EXPOSURE__;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(STAGE);
  scene.environment = __ENV__(renderer);
  scene.environmentIntensity = __ENV_INTENSITY__;

  const camera = new THREE.PerspectiveCamera(32, window.innerWidth / window.innerHeight, 0.001, 100);

  // The factory asks TextureLoader for bare filenames, which works while the page sits next to the maps.
  // A single-file build carries them as data URIs and publishes this table before the bundle runs; the
  // preview build leaves it undefined so every load falls through to the filename untouched.
  const embeddedMaps: Record<string, string> = (window as any).__EMBEDDED_MAPS__ ?? {};
  if (Object.keys(embeddedMaps).length) {
    const load = THREE.TextureLoader.prototype.load;
    THREE.TextureLoader.prototype.load = function (this: THREE.TextureLoader, url: string, ...rest: unknown[]) {
      const target = embeddedMaps[url] ?? url;
      return (load as (...args: unknown[]) => THREE.Texture).call(this, target, ...rest);
    };
  }

  // Factory mode evaluates to a synchronous Object3D; mesh mode awaits a decoded GLB. boot() exists
  // because a GLB needs an await, and an iife bundle forbids top-level await.
  const model = __MODEL_SETUP__;
  scene.add(model);

  const bounds = new THREE.Box3().setFromObject(model);
  const sphere = bounds.getBoundingSphere(new THREE.Sphere());
  // Every length below that used to be a hand-tuned constant is a multiple of this radius. The rig the
  // generator ships is authored for a metre-scale subject; multiplications keep the same look at any size.
  const RADIUS = sphere.radius;
  const CENTER = sphere.center.clone();

  const lightMode = (new URLSearchParams(location.search).get('lights') ?? 'reference') as 'neutral' | 'grazing' | 'reference';
  const lights = __LIGHTS__(lightMode);
  scene.add(lights);

  RectAreaLightUniformsLib.init();
  // `?softbox=0` renders the rig without the camera-side area fills, so a surface review is not credited
  // with relief that only appears once those fills are on.
  if (new URLSearchParams(location.search).get('softbox') !== '0') {
    const fillA = new THREE.RectAreaLight(0xfff4e2, 4.0, RADIUS * 2.0, RADIUS * 0.95);
    fillA.position.set(2.9, -1.0, -1.2).multiplyScalar(RADIUS).add(CENTER);
    fillA.lookAt(CENTER);
    scene.add(fillA);
    const fillB = new THREE.RectAreaLight(0xffe9c8, 2.2, RADIUS * 1.3, RADIUS * 0.53);
    fillB.position.set(3.6, -1.4, -0.5).multiplyScalar(RADIUS).add(CENTER);
    fillB.lookAt(CENTER);
    scene.add(fillB);
  }

  // Shadow setup is where a generated rig most often fails on a small subject, and the failure is silent.
  // Two independent misfits have to be fixed together:
  //   1. the ortho frustum is authored for a metre-scale subject, so on a small object every texel covers
  //      a visible patch of curved surface and self-shadowing reads as blotches;
  //   2. near/far are fitted to a light standing ~1.6 units out, but the rig may place its key ten units
  //      out — everything meant to cast then sits in front of near, the shadow map comes out empty, and
  //      the object floats with a perfectly clean ground.
  // Fit both to the object and to the light's real standoff.
  lights.traverse((node) => {
    const light = node as THREE.Light & { shadow?: THREE.LightShadow };
    if (!light.shadow) return;
    light.shadow.mapSize.set(1024, 1024);
    light.shadow.normalBias = RADIUS * 0.015;
    light.shadow.bias = -RADIUS * 0.0012;
    const cam = light.shadow.camera as THREE.OrthographicCamera;
    const reach = RADIUS * 0.95;
    cam.left = -reach; cam.right = reach; cam.top = reach; cam.bottom = -reach;
    const standoff = light.getWorldPosition(new THREE.Vector3()).distanceTo(CENTER);
    cam.near = Math.max(0.001, standoff * 0.5);
    cam.far = standoff * 2.0;
    cam.updateProjectionMatrix();
  });

  // Contact shadow catcher. It has to sit a hair below the lowest point or it z-fights with the object.
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(RADIUS * 3.2, 64),
    new THREE.ShadowMaterial({ opacity: 0.4 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(CENTER.x, bounds.min.y - RADIUS * 0.008, CENTER.z);
  ground.receiveShadow = true;
  scene.add(ground);

  const controls = __CONTROLS__(camera, renderer.domElement);
  // The generated controls ship minDistance = 1.0 for a metre-scale subject; on a small model every
  // framing request gets clamped outward and lands outside the far plane.
  controls.minDistance = RADIUS * 0.5;
  controls.maxDistance = RADIUS * 12;

  const HERO_AZIMUTH = (__HERO_AZIMUTH__ * Math.PI) / 180;
  const viewDir = new THREE.Vector3(Math.sin(HERO_AZIMUTH), 0.17, Math.cos(HERO_AZIMUTH)).normalize();

  type Pose = { pos: THREE.Vector3; target: THREE.Vector3; near: number; far: number };

  // Frame from the bounding sphere and set the clip planes last: the generated frameCamera() derives
  // near/far from a distance that OrbitControls then recomputes, which can leave the model beyond far.
  function poseForBox(box: THREE.Box3, dir: THREE.Vector3): Pose | null {
    if (box.isEmpty()) return null;
    const s = box.getBoundingSphere(new THREE.Sphere());
    const fov = (camera.fov * Math.PI) / 180;
    const dist = (s.radius / Math.sin(fov / 2)) * 1.08;
    const target = s.center.clone();
    target.y -= s.radius * 0.06;
    return {
      pos: s.center.clone().addScaledVector(dir, dist),
      target,
      near: Math.max(0.0005, dist * 0.05),
      far: dist * 6,
    };
  }

  function applyPose(p: Pose) {
    controls.target.copy(p.target);
    camera.position.copy(p.pos);
    camera.lookAt(p.target);
    controls.update();
    camera.near = p.near;
    camera.far = p.far;
    camera.updateProjectionMatrix();
  }

  function frame() {
    const pose = poseForBox(new THREE.Box3().setFromObject(model), viewDir);
    if (pose) applyPose(pose);
  }
  frame();

  // ---------- collect addressable parts ----------
  type Part = {
    id: string; name: string; level: string; material: string;
    node: THREE.Object3D; base: THREE.Vector3; dir: THREE.Vector3;
  };

  const parts: Part[] = [];
  model.traverse((node) => {
    const sculpt = (node as any).userData?.sculptComponent;
    if (!sculpt) return;
    parts.push({
      id: sculpt.id,
      name: sculpt.name ?? sculpt.id,
      level: sculpt.level ?? 'meso',
      material: sculpt.material ?? '',
      node,
      base: node.position.clone(),
      dir: new THREE.Vector3(node.position.x - CENTER.x, node.position.y - CENTER.y, node.position.z - CENTER.z).normalize(),
    });
  });

  // ---------- selection highlight ----------
  const overlay = document.querySelector('#readout') as HTMLElement;
  let selected: Part | null = null;
  // The factory emits one material instance per material id, so mirrored parts share it. Writing emissive
  // into that instance lights the twin up as well, and restoring only the intensity leaves the blue colour
  // behind. Swap in a per-mesh clone instead of mutating the shared material.
  const swappedMaterial = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  const HIGHLIGHT = new THREE.Color(0x3b82f6);

  function clearSelection() {
    for (const [mesh, original] of swappedMaterial) mesh.material = original;
    swappedMaterial.clear();
    selected = null;
    overlay.classList.remove('active');
  }

  function select(part: Part) {
    clearSelection();
    selected = part;
    part.node.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh || !mesh.material || Array.isArray(mesh.material)) return;
      const clone = (mesh.material as THREE.MeshStandardMaterial).clone();
      clone.emissive = HIGHLIGHT.clone();
      clone.emissiveIntensity = 0.55;
      swappedMaterial.set(mesh, mesh.material);
      mesh.material = clone;
    });
    overlay.innerHTML = `<b>${part.name}</b><span>${part.id} · ${part.level} · ${part.material}</span>`;
    overlay.classList.add('active');
  }

  // ---------- picking ----------
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let downAt = { x: 0, y: 0 };

  renderer.domElement.addEventListener('pointerdown', (e) => { downAt = { x: e.clientX, y: e.clientY }; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 5) return; // a drag is not a click
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObject(model, true);
    if (!hits.length) { clearSelection(); return; }
    let node: THREE.Object3D | null = hits[0].object;
    while (node && !(node as any).userData?.sculptComponent) node = node.parent;
    const part = parts.find((p) => p.node === node);
    if (part) select(part);
  });

  // ---------- explode ----------
  let explodeTarget = 0;
  let explodeNow = 0;

  // Parts move along their own outward axis so the explosion reads as an assembly coming apart rather
  // than a random scatter; the small downward bias keeps pieces from overlapping on the way out.
  function applyExplode(amount: number) {
    const e = amount * RADIUS * 0.32;
    for (const part of parts) {
      part.node.position.set(
        part.base.x + part.dir.x * e,
        part.base.y + (part.dir.y || -0.25) * e,
        part.base.z + part.dir.z * e,
      );
    }
  }

  // Bounds of the assembly at a given explode amount, without leaving the model in that state.
  function boundsAtExplode(amount: number): THREE.Box3 {
    const saved = explodeNow;
    applyExplode(amount);
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    applyExplode(saved);
    model.updateMatrixWorld(true);
    return box;
  }

  // Exploded parts travel outward, so a camera fitted to the assembled model loses the outer shells off
  // the edge of the frame. Refit on toggle, eased, so it reads as a move rather than a cut.
  let camTween: { from: Pose; to: Pose; t: number; dur: number } | null = null;

  // ---------- ui ----------
  const byId = (id: string) => document.getElementById(id)!;
  const btnExplode = byId('btn-explode');
  const btnWire = byId('btn-wire');
  const btnRotate = byId('btn-rotate');
  const btnReset = byId('btn-reset');
  const btnRef = byId('btn-ref');

  let explodeOn = false;
  let wireOn = false;

  btnExplode.addEventListener('click', () => {
    explodeOn = !explodeOn;
    explodeTarget = explodeOn ? 1 : 0;
    btnExplode.classList.toggle('on', explodeOn);
    const dir = camera.position.clone().sub(controls.target).normalize();
    const pose = poseForBox(boundsAtExplode(explodeTarget), dir);
    if (pose) {
      camTween = {
        from: { pos: camera.position.clone(), target: controls.target.clone(), near: camera.near, far: camera.far },
        to: pose,
        t: 0,
        dur: 0.45,
      };
      // Cover both ends for the whole tween, then snap to the target's clip planes when it lands.
      camera.near = Math.min(camera.near, pose.near);
      camera.far = Math.max(camera.far, pose.far);
      camera.updateProjectionMatrix();
    }
  });

  btnWire.addEventListener('click', () => {
    wireOn = !wireOn;
    btnWire.classList.toggle('on', wireOn);
    model.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      for (const m of (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as THREE.MeshStandardMaterial[]) {
        if ('wireframe' in m) m.wireframe = wireOn;
      }
    });
  });

  btnRotate.addEventListener('click', () => {
    controls.autoRotate = !controls.autoRotate;
    controls.autoRotateSpeed = 1.2;
    btnRotate.classList.toggle('on', controls.autoRotate);
  });

  btnReset.addEventListener('click', () => {
    clearSelection();
    camTween = null;
    if (explodeOn) {
      explodeOn = false;
      explodeTarget = 0;
      explodeNow = 0;
      applyExplode(0);
      btnExplode.classList.remove('on');
    }
    frame();
  });

  btnRef.addEventListener('click', () => {
    byId('refcard').classList.toggle('show');
  });

  // ---------- loop ----------
  const clock = new THREE.Clock();
  const fpsEl = document.getElementById('fps');
  let frames = 0;
  let fpsClock = 0;

  function tick() {
    requestAnimationFrame(tick);
    const dt = Math.min(clock.getDelta(), 0.05);
    explodeNow += (explodeTarget - explodeNow) * Math.min(1, dt * 6);
    applyExplode(explodeNow);

    if (camTween) {
      camTween.t = Math.min(1, camTween.t + dt / camTween.dur);
      const k = camTween.t * camTween.t * (3 - 2 * camTween.t);
      camera.position.lerpVectors(camTween.from.pos, camTween.to.pos, k);
      controls.target.lerpVectors(camTween.from.target, camTween.to.target, k);
      if (camTween.t >= 1) {
        camera.near = camTween.to.near;
        camera.far = camTween.to.far;
        camera.updateProjectionMatrix();
        camTween = null;
      }
    }

    controls.update();
    renderer.render(scene, camera);

    frames += 1;
    fpsClock += dt;
    if (fpsClock >= 0.5 && fpsEl) {
      fpsEl.textContent = String(Math.round(frames / fpsClock));
      frames = 0; fpsClock = 0;
    }
  }
  tick();

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // exposed for the browser test harness (assets/build/test_interactions.mjs)
  (window as any).__demo = {
    model, parts, scene, camera, controls,
    select: (id: string) => { const p = parts.find((x) => x.id === id); if (p) select(p); return !!p; },
    explode: (v: boolean) => { if (v !== explodeOn) btnExplode.click(); },
  };

  // ---------- capture contract ----------
  // The review gates pull evidence through these two hooks instead of trusting a screenshot taken by
  // some other path, so evidence frames and the page you look at can never disagree.
  const overrides = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  const modeGroup = new THREE.Group();
  scene.add(modeGroup);
  const modeMaterials: Record<string, THREE.Material> = {};

  function partKey(id: string) {
    let h = 0;
    for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) | 0;
    const c = new THREE.Color();
    c.setHSL(((h >>> 0) % 360) / 360, 0.72, 0.55);
    return c;
  }

  function applyMode(mode: string) {
    const original = (mesh: THREE.Mesh) => {
      if (!overrides.has(mesh)) overrides.set(mesh, mesh.material);
      return mesh;
    };
    const restore = () => {
      overrides.forEach((mat, mesh) => { mesh.material = mat; });
      overrides.clear();
      ground.visible = true;
      scene.background = new THREE.Color(STAGE);
    };
    restore();
    if (!mode || mode === 'beauty') return;

    scene.background = new THREE.Color(0x000000);
    ground.visible = false;
    model.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      const sculpt = (mesh as any).userData?.sculptComponent;
      original(mesh);
      if (mode === 'alpha-silhouette') {
        mesh.material = modeMaterials.silhouette ??= new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
      } else if (mode === 'map-stripped') {
        // unlit and map-free: the gate uses this to judge built form without letting an albedo map or a
        // light rig flatter geometry that is not actually there
        mesh.material = modeMaterials.clay ??= new THREE.MeshBasicMaterial({ color: 0xbfbfbf });
      } else if (mode === 'semantic-id') {
        const key = 'sem' + (sculpt?.id ?? 'unknown');
        modeMaterials[key] = modeMaterials[key] ?? new THREE.MeshBasicMaterial({ color: partKey(sculpt?.id ?? 'unknown') });
        mesh.material = modeMaterials[key];
      } else if (mode === 'depth') {
        mesh.material = modeMaterials.depth ??= new THREE.MeshDepthMaterial({ depthPacking: THREE.BasicDepthPacking });
      } else if (mode === 'normal') {
        mesh.material = modeMaterials.normal ??= new THREE.MeshNormalMaterial();
      } else if (mode === 'roughness-material-id') {
        const src = (mesh.material as THREE.MeshStandardMaterial).roughness ?? 0.5;
        const shade = Math.round(Math.min(1, Math.max(0, src)) * 255);
        mesh.material = modeMaterials['rough' + shade] ??= new THREE.MeshBasicMaterial({ color: new THREE.Color(`rgb(${shade},${shade},${shade})`) });
      }
    });
  }

  (window as any).__IMG2THREEJS_CAPTURE__ = {
    async setCamera(spec: any) {
      const { azimuthDegrees = 0, elevationDegrees = 0, target = CENTER.toArray(), distance, fovDegrees, near, far, rollDegrees = 0 } = spec ?? {};
      const box = new THREE.Box3().setFromObject(model);
      const s = box.getBoundingSphere(new THREE.Sphere());
      const fov = fovDegrees ?? camera.fov;
      camera.fov = fov;
      const dist = distance ?? (s.radius / Math.sin((fov * Math.PI) / 360)) * 1.05;
      const az = (azimuthDegrees * Math.PI) / 180;
      const el = (elevationDegrees * Math.PI) / 180;
      const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
      const t = new THREE.Vector3(target[0], target[1], target[2]);
      controls.target.copy(t);
      camera.position.copy(t).addScaledVector(dir, dist);
      camera.up.set(0, 1, 0);
      camera.lookAt(t);
      controls.update();
      // A single product photo rarely has the horizon level. Rolling after controls.update() keeps the
      // orbit solve untouched and only spins the frame; rolling earlier gets overwritten because
      // OrbitControls re-derives the orientation from camera.up on every update.
      if (rollDegrees) camera.rotateZ((rollDegrees * Math.PI) / 180);
      camera.near = near ?? Math.max(0.0005, dist * 0.05);
      camera.far = far ?? dist * 6;
      camera.updateProjectionMatrix();
      return { ok: true, distance: dist };
    },
    async capturePass({ passId, mode, background }: any) {
      applyMode(mode ?? passId ?? 'beauty');
      if (background != null) {
        scene.background = new THREE.Color(background);
        ground.visible = false;
      }
      // Evidence frames must be the render alone. This variant leaves the page ready for a compositor
      // grab, so the HUD is hidden here and restored on the next draw of a beauty frame.
      document.querySelectorAll<HTMLElement>('.hud').forEach((el) => { el.style.display = 'none'; });
      renderer.render(scene, camera);
      return { ok: true, selector: '#view' };
    },
    // Same frame as capturePass, returned as pixels. Reading the GL canvas in the same task as the draw
    // needs no preserveDrawingBuffer and works even when the shell cannot prepare a screenshot surface.
    // The HUD is DOM and never lands in these pixels, so it has to be neither hidden nor restored here.
    captureDataUrl({ passId, mode, background, keepGround }: any) {
      applyMode(mode ?? passId ?? 'beauty');
      if (background != null) {
        scene.background = new THREE.Color(background);
        // keepGround exists for the contact-shadow frame: the shadow catcher is the only thing that shows
        // the object sitting on a surface, so a silhouette-match background must not hide it.
        ground.visible = !!keepGround;
      }
      renderer.render(scene, camera);
      return { ok: true, dataUrl: canvas.toDataURL('image/png') };
    },
  };
  window.__IMG2THREEJS_READY__ = true;
}

// A failed model load must be visible in the page, not just the console: an empty stage with a
// blank readout is indistinguishable from a camera bug during a review.
boot().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error('[photo-to-3d] boot failed:', err);
  const readout = document.getElementById('readout');
  if (readout) readout.textContent = 'model load failed: ' + message;
});
