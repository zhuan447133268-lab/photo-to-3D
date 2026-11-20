#!/usr/bin/env node
// Make two small GLB fixtures for the mesh route, with no modelling tool and no network.
//
// Why this exists: the mesh backend claims "any reconstructed mesh becomes an addressable part tree".
// That claim needs a fixture anyone can regenerate, and the two fixtures probe the two shapes a delivery
// actually receives:
//
//   spoked-wheel.glb  one geometry, many disjoint pieces (rim, 24 spokes, hub, 24 rivets, axle). This is
//                     what a CAD/DCC export looks like: the parts are separate islands in the buffer.
//   gear.glb          one connected surface with sharp creases at the tooth roots. This is what a
//                     reconstruction model emits after remeshing: nothing is disjoint, so parts have to
//                     come from the dihedral-angle segmentation.
//
// Usage (the three dependency comes from a workspace, not from this repo):
//   node assets/build/make_sample_mesh.mjs --modules <work>/build/node_modules --out <dir>
//
// Regenerating is deterministic: same three version, same bytes.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const args = process.argv.slice(2);
const get = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const modulesDir = path.resolve(get('--modules', path.join(process.cwd(), 'node_modules')));
const outDir = path.resolve(get('--out', 'demo/fixtures'));

// GLTFExporter's binary path reads a Blob through FileReader, which Node does not define. A 10-line
// shim is enough and keeps this script free of a DOM emulation package.
globalThis.FileReader = class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((buf) => { this.result = buf; setTimeout(() => this.onloadend?.(), 0); });
  }
  readAsDataURL(blob) {
    blob.arrayBuffer().then((buf) => {
      this.result = 'data:application/octet-stream;base64,' + Buffer.from(buf).toString('base64');
      setTimeout(() => this.onloadend?.(), 0);
    });
  }
};

const requireFromModules = createRequire(path.join(modulesDir, 'noop.cjs'));
const THREE = await import(pathToFileURL(requireFromModules.resolve('three')).href);
const { GLTFExporter } = await import(
  pathToFileURL(requireFromModules.resolve('three/examples/jsm/exporters/GLTFExporter.js')).href);
const { mergeGeometries } = await import(
  pathToFileURL(requireFromModules.resolve('three/examples/jsm/utils/BufferGeometryUtils.js')).href);

const material = new THREE.MeshStandardMaterial({
  name: 'sample-metal', color: 0x8d97a3, roughness: 0.42, metalness: 0.65,
});

function part(geometry, { position = [0, 0, 0], rotation = [0, 0, 0] } = {}) {
  const g = geometry.clone();
  g.rotateX(rotation[0]); g.rotateY(rotation[1]); g.rotateZ(rotation[2]);
  g.translate(position[0], position[1], position[2]);
  g.deleteAttribute('uv');
  return g;
}

function spokedWheel() {
  const RIM_RADIUS = 1.0;
  const SPOKES = 24;
  const RIVETS = 24;
  const pieces = [];

  // Rim: a torus, so the silhouette reads as a wheel from any orbit angle.
  pieces.push(part(new THREE.TorusGeometry(RIM_RADIUS, 0.085, 16, 128)));
  // Hub and axle, both along +Z.
  pieces.push(part(new THREE.CylinderGeometry(0.15, 0.15, 0.20, 40), { rotation: [Math.PI / 2, 0, 0] }));
  pieces.push(part(new THREE.CylinderGeometry(0.052, 0.052, 0.42, 24), { rotation: [Math.PI / 2, 0, 0] }));

  // Spokes: a cylinder laid along +Y, then rotated about Z to its slot. Length stops just inside the rim
  // so the union is unambiguous at the ends.
  const spokeLength = RIM_RADIUS - 0.20;
  for (let i = 0; i < SPOKES; i += 1) {
    const angle = (i / SPOKES) * Math.PI * 2;
    const mid = 0.14 + spokeLength / 2;
    pieces.push(part(new THREE.CylinderGeometry(0.021, 0.026, spokeLength, 10), {
      position: [Math.cos(angle) * mid, Math.sin(angle) * mid, 0],
      rotation: [0, 0, angle - Math.PI / 2],
    }));
  }

  // Rivets: small heads on the outboard face of the rim, one per spoke. These are the parts that never
  // come out of a primitive spec assembled by hand — here they are just islands in the buffer.
  for (let i = 0; i < RIVETS; i += 1) {
    const angle = (i / RIVETS) * Math.PI * 2 + Math.PI / RIVETS;
    pieces.push(part(new THREE.CylinderGeometry(0.032, 0.038, 0.045, 12), {
      position: [Math.cos(angle) * RIM_RADIUS, Math.sin(angle) * RIM_RADIUS, 0.075],
      rotation: [Math.PI / 2, 0, 0],
    }));
  }

  const merged = mergeGeometries(pieces, false);
  merged.computeBoundingBox();
  return {
    scene: (() => { const s = new THREE.Scene(); const m = new THREE.Mesh(merged, material); m.name = 'wheel'; s.add(m); return s; })(),
    stats: { pieces: pieces.length, spokes: SPOKES, rivets: RIVETS },
  };
}

function gear() {
  const TEETH = 18;
  const shape = new THREE.Shape();
  const rootRadius = 0.72;
  const tipRadius = 0.95;
  const step = (Math.PI * 2) / (TEETH * 2);
  for (let i = 0; i < TEETH * 2; i += 1) {
    const r = i % 2 === 0 ? tipRadius : rootRadius;
    const angle = i * step;
    const x = Math.cos(angle) * r;
    const y = Math.sin(angle) * r;
    if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
  }
  shape.closePath();
  const hole = new THREE.Path();
  hole.absarc(0, 0, 0.22, 0, Math.PI * 2, true);
  shape.holes.push(hole);

  // No bevel: the point of this fixture is the sharp crease at every tooth root, which is what the
  // dihedral segmentation is supposed to find.
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.22, bevelEnabled: false, curveSegments: 32 });
  geometry.center();
  geometry.deleteAttribute('uv');
  geometry.computeVertexNormals();
  const scene = new THREE.Scene();
  const m = new THREE.Mesh(geometry, material); m.name = 'gear'; scene.add(m);
  return { scene, stats: { teeth: TEETH } };
}

async function exportGlb(scene, file) {
  const exporter = new GLTFExporter();
  const buffer = await exporter.parseAsync(scene, { binary: true, onlyVisible: false });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(buffer));
  return buffer.byteLength;
}

fs.mkdirSync(outDir, { recursive: true });
const wheel = spokedWheel();
const wheelBytes = await exportGlb(wheel.scene, path.join(outDir, 'spoked-wheel.glb'));
const gearModel = gear();
const gearBytes = await exportGlb(gearModel.scene, path.join(outDir, 'gear.glb'));

console.log(JSON.stringify({
  out: outDir,
  'spoked-wheel.glb': { bytes: wheelBytes, ...wheel.stats },
  'gear.glb': { bytes: gearBytes, ...gearModel.stats },
}, null, 1));