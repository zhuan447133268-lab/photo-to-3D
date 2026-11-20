// Mesh rig: the second model source for this viewer.
//
// `build_pass.sh` compiles a hand-written spec into primitives. This file is the other door: it takes a
// reconstructed mesh — anything a neural image-to-3D model (Hunyuan3D, Tripo, Meshy, a photogrammetry
// export) produces as glTF/GLB — and gives it the same delivery surface: addressable parts, per-part
// picking, explode, wireframe, capture modes, six interaction assertions.
//
// The hard part is that a reconstructed GLB is usually ONE primitive: a single triangle soup with no
// named parts, so "click a part to inspect it" has nothing to click and explode has nothing to separate.
// Three segmentations are available, in increasing order of assumption:
//
//   components  edge-connected pieces. Exact: two pieces are separate iff they share no edge. Right for a
//               GLB exported by a DCC tool or a generator that emits per-part nodes.
//   angle       the same graph, cut where the dihedral angle exceeds a threshold. This is what separates
//               a spoke from a rim on a merged mechanical mesh: the surface is continuous but the normal
//               turns sharply at the junction.
//   spatial      k-means over triangle centroids. Assumes nothing about the surface and keeps every
//               triangle; it produces chunks, not parts, so the page labels them as chunks.
//
// `auto` runs angle segmentation and falls back to spatial when the result is degenerate — under two
// patches (nothing was cut) or far too many (the mesh is noise, and thousands of shards are worse than
// honest chunks). Every path keeps all triangles: a part is never dropped, so the silhouette a reviewer
// signed off on still matches the wireframe.
//
// No material invention: if the GLB carries materials, they are reused (cloned per part so a highlight
// cannot leak to a neighbour). If it carries none, every part gets the same neutral clay — the shape is
// what was reconstructed, not the colour.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export type Partition = 'auto' | 'components' | 'angle' | 'spatial';

export interface MeshLoadOptions {
  /** Keep at most this many parts. 0 = keep every patch the segmentation produced. */
  maxParts?: number;
  /** Segmentation strategy; see the header comment. */
  partition?: Partition;
  /** Dihedral threshold in degrees for `angle` / `auto`. 180 is equivalent to `components`. */
  dihedralDegrees?: number;
  /**
   * Only shells with at least this many triangles are crease-segmented. A cylinder has sharp edges too,
   * but cutting there yields its two caps, not two parts; the threshold keeps small solids whole while
   * still letting a merged star/gear split at its tooth roots.
   */
  minSegmentTriangles?: number;
  /** Prefix for generated part ids. */
  idPrefix?: string;
}

type AttrSpec = { name: string; itemSize: number; normalized: boolean };

function attrSpecs(geo: THREE.BufferGeometry): AttrSpec[] {
  return Object.keys(geo.attributes).map((name) => {
    const attr = geo.getAttribute(name) as THREE.BufferAttribute;
    return { name, itemSize: attr.itemSize, normalized: attr.normalized };
  });
}

function readComponent(attr: THREE.BufferAttribute, index: number, component: number): number {
  if ((attr as any).isInterleavedBufferAttribute) return (attr as any).getComponent(index, component);
  return (attr.array as ArrayLike<number>)[index * attr.itemSize + component];
}

/** Flat corner list (3 per triangle) for a geometry, indexed or not. */
function corners(geo: THREE.BufferGeometry): Uint32Array {
  const index = geo.getIndex();
  if (index) {
    const out = new Uint32Array(index.count);
    for (let i = 0; i < index.count; i += 1) out[i] = index.getX(i);
    return out;
  }
  const count = geo.getAttribute('position').count;
  const out = new Uint32Array(count);
  for (let i = 0; i < count; i += 1) out[i] = i;
  return out;
}

/**
 * Canonical vertex id per corner, welded by position.
 *
 * Index-based connectivity is only valid when the exporter keeps an index buffer. A merged export
 * (mergeGeometries, many GLB writers, most slicers) is a non-indexed triangle soup: every triangle owns
 * its three vertices, so "shares a vertex index" is false for all neighbours and the whole model reads as
 * one part per triangle. Welding positions first restores the real adjacency.
 */
function weldCorners(position: THREE.BufferAttribute, corner: Uint32Array): { ids: Uint32Array; count: number } {
  const vertexCount = position.count;
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  for (let i = 0; i < vertexCount; i += 1) {
    v.set(readComponent(position, i, 0), readComponent(position, i, 1), readComponent(position, i, 2));
    box.expandByPoint(v);
  }
  const diagonal = box.isEmpty() ? 1 : box.getSize(v).length() || 1;
  // A relative epsilon: exports carry the same float twice for a shared vertex, so equality is exact in
  // practice; the quantisation only has to absorb the last bit of a transform round-trip.
  const epsilon = Math.max(diagonal * 1e-6, 1e-9);

  const buckets = new Map<number, number[]>();
  const quantised: number[] = [];
  const ids = new Uint32Array(corner.length);
  let next = 0;

  for (let k = 0; k < corner.length; k += 1) {
    const source = corner[k];
    const qx = Math.round(readComponent(position, source, 0) / epsilon);
    const qy = Math.round(readComponent(position, source, 1) / epsilon);
    const qz = Math.round(readComponent(position, source, 2) / epsilon);
    // 32-bit multiply-xor hash; collisions are resolved by comparing the quantised triple, so a collision
    // costs a comparison and never merges two different vertices.
    const hash = (Math.imul(qx, 73856093) ^ Math.imul(qy, 19349663) ^ Math.imul(qz, 83492791)) | 0;
    const bucket = buckets.get(hash);
    if (bucket) {
      let found = -1;
      for (const id of bucket) {
        if (quantised[id * 3] === qx && quantised[id * 3 + 1] === qy && quantised[id * 3 + 2] === qz) {
          found = id;
          break;
        }
      }
      if (found >= 0) { ids[k] = found; continue; }
    }
    const id = next;
    next += 1;
    quantised[id * 3] = qx; quantised[id * 3 + 1] = qy; quantised[id * 3 + 2] = qz;
    ids[k] = id;
    if (bucket) bucket.push(id); else buckets.set(hash, [id]);
  }
  return { ids, count: next };
}

function triangleNormals(position: THREE.BufferAttribute, corner: Uint32Array): Float32Array {
  const triCount = corner.length / 3;
  const out = new Float32Array(triCount * 3);
  const ax = new THREE.Vector3(); const bx = new THREE.Vector3(); const ab = new THREE.Vector3();
  const pick = (i: number, target: THREE.Vector3) => target.set(
    readComponent(position, i, 0), readComponent(position, i, 1), readComponent(position, i, 2));
  for (let t = 0; t < triCount; t += 1) {
    pick(corner[t * 3], ax); pick(corner[t * 3 + 1], bx);
    ab.copy(bx).sub(ax);
    pick(corner[t * 3 + 2], bx); bx.sub(ax);
    ab.cross(bx).normalize();
    out[t * 3] = ab.x; out[t * 3 + 1] = ab.y; out[t * 3 + 2] = ab.z;
  }
  return out;
}

/**
 * Patch ids over triangles. Adjacent triangles (sharing an edge) join the same patch when the angle
 * between their normals is within `cosLimit`; every other edge is a cut. cosLimit = -1 therefore unions
 * everything that is edge-connected, which is exactly the `components` strategy.
 */
function segmentByAngle(
  position: THREE.BufferAttribute,
  corner: Uint32Array,
  cosLimit: number,
): { patchOf: Int32Array; patchCount: number } {
  const triCount = corner.length / 3;
  const normals = triangleNormals(position, corner);
  const welded = weldCorners(position, corner);
  const ids = welded.ids;
  const vertexCount = welded.count;
  const parent = new Int32Array(triCount);
  for (let i = 0; i < triCount; i += 1) parent[i] = i;
  const find = (x: number): number => {
    let root = x;
    while (parent[root] !== root) root = parent[root];
    while (parent[x] !== root) { const next = parent[x]; parent[x] = root; x = next; }
    return root;
  };
  const union = (a: number, b: number) => {
    const ra = find(a); const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  // One pass over edges: the first triangle to claim an edge stores itself, the second decides whether
  // the two sides stay stitched.
  const owner = new Map<number, number>();
  for (let t = 0; t < triCount; t += 1) {
    for (let e = 0; e < 3; e += 1) {
      const a = ids[t * 3 + e];
      const b = ids[t * 3 + ((e + 1) % 3)];
      const key = a < b ? a * vertexCount + b : b * vertexCount + a;
      const first = owner.get(key);
      if (first === undefined) { owner.set(key, t); continue; }
      if (first < 0) continue;
      if (first === t) continue;
      const dot = normals[first * 3] * normals[t * 3]
        + normals[first * 3 + 1] * normals[t * 3 + 1]
        + normals[first * 3 + 2] * normals[t * 3 + 2];
      if (dot >= cosLimit) union(first, t);
    }
  }

  // Renumber dense, in first-appearance order, so ids are stable for a given file.
  const lookup = new Map<number, number>();
  const patchOf = new Int32Array(triCount);
  for (let t = 0; t < triCount; t += 1) {
    const root = find(t);
    let id = lookup.get(root);
    if (id === undefined) { id = lookup.size; lookup.set(root, id); }
    patchOf[t] = id;
  }
  return { patchOf, patchCount: lookup.size };
}

/** k-means over triangle centroids: complete, assumption-free chunks for unstructured meshes. */
function segmentSpatial(
  position: THREE.BufferAttribute,
  corner: Uint32Array,
  k: number,
): { patchOf: Int32Array; patchCount: number } {
  const triCount = corner.length / 3;
  const centroids = new Float32Array(triCount * 3);
  for (let t = 0; t < triCount; t += 1) {
    for (let axis = 0; axis < 3; axis += 1) {
      centroids[t * 3 + axis] = (
        readComponent(position, corner[t * 3], axis)
        + readComponent(position, corner[t * 3 + 1], axis)
        + readComponent(position, corner[t * 3 + 2], axis)) / 3;
    }
  }

  const clusterCount = Math.max(1, Math.min(k, triCount));
  const centers = new Float32Array(clusterCount * 3);
  // Farthest-point seeding: deterministic, and it spreads the seeds over the whole surface instead of
  // drawing them from one corner the way random init would.
  centers[0] = centroids[0]; centers[1] = centroids[1]; centers[2] = centroids[2];
  const nearest = new Float32Array(triCount).fill(Infinity);
  for (let c = 1; c < clusterCount; c += 1) {
    let best = 0; let bestDistance = -1;
    for (let t = 0; t < triCount; t += 1) {
      const dx = centroids[t * 3] - centers[(c - 1) * 3];
      const dy = centroids[t * 3 + 1] - centers[(c - 1) * 3 + 1];
      const dz = centroids[t * 3 + 2] - centers[(c - 1) * 3 + 2];
      const d = dx * dx + dy * dy + dz * dz;
      if (d < nearest[t]) nearest[t] = d;
      if (nearest[t] > bestDistance) { bestDistance = nearest[t]; best = t; }
    }
    centers[c * 3] = centroids[best * 3];
    centers[c * 3 + 1] = centroids[best * 3 + 1];
    centers[c * 3 + 2] = centroids[best * 3 + 2];
  }

  const patchOf = new Int32Array(triCount);
  const sums = new Float64Array(clusterCount * 3);
  const counts = new Int32Array(clusterCount);
  for (let iteration = 0; iteration < 8; iteration += 1) {
    sums.fill(0); counts.fill(0);
    for (let t = 0; t < triCount; t += 1) {
      let bestCluster = 0; let bestDistance = Infinity;
      for (let c = 0; c < clusterCount; c += 1) {
        const dx = centroids[t * 3] - centers[c * 3];
        const dy = centroids[t * 3 + 1] - centers[c * 3 + 1];
        const dz = centroids[t * 3 + 2] - centers[c * 3 + 2];
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bestDistance) { bestDistance = d; bestCluster = c; }
      }
      patchOf[t] = bestCluster;
      sums[bestCluster * 3] += centroids[t * 3];
      sums[bestCluster * 3 + 1] += centroids[t * 3 + 1];
      sums[bestCluster * 3 + 2] += centroids[t * 3 + 2];
      counts[bestCluster] += 1;
    }
    for (let c = 0; c < clusterCount; c += 1) {
      if (!counts[c]) continue;
      centers[c * 3] = sums[c * 3] / counts[c];
      centers[c * 3 + 1] = sums[c * 3 + 1] / counts[c];
      centers[c * 3 + 2] = sums[c * 3 + 2] / counts[c];
    }
  }
  return { patchOf, patchCount: clusterCount };
}

/** Fold the smallest patches into their nearest kept patch, so nothing is lost and the count fits. */
function capPatches(patchOf: Int32Array, patchCount: number, centroids: Float32Array, limit: number): Int32Array {
  if (patchCount <= limit) return patchOf;
  const sizes = new Int32Array(patchCount);
  const sums = new Float64Array(patchCount * 3);
  for (let t = 0; t < patchOf.length; t += 1) {
    const p = patchOf[t];
    sizes[p] += 1;
    sums[p * 3] += centroids[t * 3];
    sums[p * 3 + 1] += centroids[t * 3 + 1];
    sums[p * 3 + 2] += centroids[t * 3 + 2];
  }
  const order = Array.from({ length: patchCount }, (_, i) => i).sort((a, b) => sizes[b] - sizes[a]);
  const kept = order.slice(0, Math.max(1, limit));
  const keptSet = new Set(kept);
  const remap = new Int32Array(patchCount).fill(-1);
  kept.forEach((p, i) => { remap[p] = i; });
  for (const p of order.slice(kept.length)) {
    const cx = sums[p * 3] / sizes[p]; const cy = sums[p * 3 + 1] / sizes[p]; const cz = sums[p * 3 + 2] / sizes[p];
    let best = 0; let bestDistance = Infinity;
    for (let i = 0; i < kept.length; i += 1) {
      const q = kept[i];
      const qx = sums[q * 3] / sizes[q]; const qy = sums[q * 3 + 1] / sizes[q]; const qz = sums[q * 3 + 2] / sizes[q];
      const d = (cx - qx) ** 2 + (cy - qy) ** 2 + (cz - qz) ** 2;
      if (d < bestDistance) { bestDistance = d; best = i; }
    }
    remap[p] = best;
  }
  const out = new Int32Array(patchOf.length);
  for (let t = 0; t < patchOf.length; t += 1) out[t] = remap[patchOf[t]];
  return out;
}

function patchCentroids(corner: Uint32Array, patchOf: Int32Array, position: THREE.BufferAttribute, patchCount: number): Float32Array {
  const out = new Float32Array(patchCount * 3);
  const counts = new Int32Array(patchCount);
  for (let t = 0; t < patchOf.length; t += 1) {
    const p = patchOf[t];
    for (let axis = 0; axis < 3; axis += 1) {
      out[p * 3 + axis] += (
        readComponent(position, corner[t * 3], axis)
        + readComponent(position, corner[t * 3 + 1], axis)
        + readComponent(position, corner[t * 3 + 2], axis)) / 3;
    }
    counts[p] += 1;
  }
  for (let p = 0; p < patchCount; p += 1) {
    if (!counts[p]) continue;
    out[p * 3] /= counts[p]; out[p * 3 + 1] /= counts[p]; out[p * 3 + 2] /= counts[p];
  }
  return out;
}

/** Rebuild one patch as its own geometry, keeping every attribute the source had. */
function buildPatchGeometry(
  geo: THREE.BufferGeometry,
  specs: AttrSpec[],
  corner: Uint32Array,
  patchOf: Int32Array,
  vertices: Uint32Array,
): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  for (const spec of specs) {
    const src = geo.getAttribute(spec.name) as THREE.BufferAttribute;
    const dst = new Float32Array(vertices.length * spec.itemSize);
    for (let k = 0; k < vertices.length; k += 1) {
      const from = vertices[k];
      for (let c = 0; c < spec.itemSize; c += 1) {
        dst[k * spec.itemSize + c] = readComponent(src, from, c);
      }
    }
    out.setAttribute(spec.name, new THREE.BufferAttribute(dst, spec.itemSize, spec.normalized));
  }
  if (!out.getAttribute('normal')) out.computeVertexNormals();
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

interface Patch {
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[] | undefined;
  name: string;
  triangles: number;
}

/**
 * Parts as components, with creases resolved only inside large shells. A closed solid is one part however
 * many sharp edges it has; a merged surface (a star profile, a mechanical casting) splits where the normal
 * turns. The two labels compose: an angle patch never spans two components, so intersecting them is safe.
 */
function segmentComponentsThenCreases(
  position: THREE.BufferAttribute,
  corner: Uint32Array,
  cosLimit: number,
  minSegmentTriangles: number,
): { patchOf: Int32Array; patchCount: number; creaseSplit: boolean } {
  const components = segmentByAngle(position, corner, -1);
  // Deliberately no early return when there is a single component: a one-shell mesh (an extruded gear, a
  // cast bracket) is exactly the case crease segmentation exists for.
  const creases = segmentByAngle(position, corner, cosLimit);
  const componentSize = new Int32Array(components.patchCount);
  for (let t = 0; t < components.patchOf.length; t += 1) componentSize[components.patchOf[t]] += 1;

  // A mesh smaller than the threshold has nothing for the threshold to protect: with the default 1200, a
  // 400-triangle gear would never be crease-split and would fall through to spatial chunks. Clamp it, so a
  // small mesh still gets its creases while the protection still applies to small shells inside a large one.
  const totalTriangles = corner.length / 3;
  const effectiveMin = Math.min(minSegmentTriangles, Math.max(totalTriangles, 1));

  const lookup = new Map<number, number>();
  const patchOf = new Int32Array(components.patchOf.length);
  let creaseSplit = false;
  for (let t = 0; t < components.patchOf.length; t += 1) {
    const c = components.patchOf[t];
    const segmentable = componentSize[c] >= effectiveMin;
    const a = segmentable ? creases.patchOf[t] : -1;
    if (a >= 0 && creases.patchCount > components.patchCount) creaseSplit = true;
    const key = a < 0 ? c : components.patchCount * 1e6 + a;
    let id = lookup.get(key);
    if (id === undefined) { id = lookup.size; lookup.set(key, id); }
    patchOf[t] = id;
  }
  return { patchOf, patchCount: lookup.size, creaseSplit };
}

function segmentGeometry(
  geo: THREE.BufferGeometry,
  material: THREE.Material | THREE.Material[] | undefined,
  name: string,
  options: Required<Pick<MeshLoadOptions, 'partition' | 'maxParts' | 'dihedralDegrees' | 'minSegmentTriangles'>>,
): { patches: Patch[]; strategy: Partition; rawPatches: number } {
  const specs = attrSpecs(geo);
  const corner = corners(geo);
  const position = geo.getAttribute('position') as THREE.BufferAttribute;
  const triCount = corner.length / 3;
  if (!triCount) return { patches: [], strategy: 'components', rawPatches: 0 };

  const target = options.maxParts > 0 ? options.maxParts : 64;
  const cosLimit = Math.cos((options.dihedralDegrees * Math.PI) / 180);
  let strategy: Partition = options.partition;
  let patchOf: Int32Array;
  let patchCount: number;

  const runAngle = () => segmentByAngle(position, corner, cosLimit);
  const runComponents = () => segmentByAngle(position, corner, -1);
  const runHybrid = () => segmentComponentsThenCreases(position, corner, cosLimit, options.minSegmentTriangles);
  const runSpatial = () => segmentSpatial(position, corner, target);

  if (strategy === 'components') {
    ({ patchOf, patchCount } = runComponents());
  } else if (strategy === 'spatial') {
    ({ patchOf, patchCount } = runSpatial());
  } else if (strategy === 'angle') {
    ({ patchOf, patchCount } = runAngle());
  } else {
    // auto: components, creases inside big shells, and spatial only when the mesh is noise (one blob that
    // cannot be cut, or so many shards that the part tree would be unreadable).
    ({ patchOf, patchCount } = runHybrid());
    if (patchCount < 2 || patchCount > target * 4) {
      strategy = 'spatial';
      ({ patchOf, patchCount } = runSpatial());
    } else {
      strategy = 'angle';
    }
  }

  const centroids = patchCentroids(corner, patchOf, position, Math.max(patchCount, 1));
  if (options.maxParts > 0) {
    patchOf = capPatches(patchOf, patchCount, centroids, options.maxParts);
    patchCount = Math.min(patchCount, options.maxParts);
  }

  // Group corners by patch, preserving triangle order so each patch is a contiguous slice.
  const byPatch = new Map<number, number[]>();
  for (let t = 0; t < patchOf.length; t += 1) {
    const p = patchOf[t];
    let list = byPatch.get(p);
    if (!list) { list = []; byPatch.set(p, list); }
    list.push(corner[t * 3], corner[t * 3 + 1], corner[t * 3 + 2]);
  }

  const patches: Patch[] = [];
  for (const vertices of byPatch.values()) {
    patches.push({
      geometry: buildPatchGeometry(geo, specs, corner, patchOf, Uint32Array.from(vertices)),
      material,
      name,
      triangles: vertices.length / 3,
    });
  }
  return { patches, strategy, rawPatches: patchCount };
}

/**
 * Decode a GLB from a data URL (the single-file build embeds it) and return a group whose children are
 * one mesh per patch, each stamped for the viewer's part system.
 */
export async function loadMeshDataUrl(url: string, options: MeshLoadOptions = {}): Promise<THREE.Group> {
  const {
    maxParts = 64,
    partition = 'auto',
    dihedralDegrees = 32,
    minSegmentTriangles = 1200,
    idPrefix = 'mesh',
  } = options;

  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(url);
  gltf.scene.updateMatrixWorld(true);

  type Raw = { geometry: THREE.BufferGeometry; material: THREE.Material | THREE.Material[] | undefined; name: string };
  const raw: Raw[] = [];
  gltf.scene.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    // Bake the node transform into the geometry so every patch lives in one coordinate space. Without
    // this, a GLB whose pieces hang off rotated nodes reports bboxes in mixed frames and explode axes
    // point in the wrong direction.
    const geometry = mesh.geometry.clone();
    geometry.applyMatrix4(mesh.matrixWorld);
    raw.push({ geometry, material: mesh.material, name: mesh.name || 'mesh' });
  });
  if (!raw.length) throw new Error('GLB contains no mesh primitives');

  const segOptions = { partition, maxParts, dihedralDegrees, minSegmentTriangles } as const;
  let patches: Patch[] = [];
  let strategy: Partition = partition;
  let rawPatches = 0;
  for (const entry of raw) {
    const result = segmentGeometry(entry.geometry, entry.material, entry.name, segOptions);
    patches = patches.concat(result.patches);
    strategy = result.strategy;
    rawPatches += result.rawPatches;
  }
  const triangles = patches.reduce((sum, p) => sum + p.triangles, 0);
  if (!patches.length) throw new Error('GLB mesh has no triangles');

  // Largest first so any later cap keeps structure rather than specks.
  const diagonal = (geo: THREE.BufferGeometry) => geo.boundingBox!.getSize(new THREE.Vector3()).length();
  for (const patch of patches) patch.geometry.computeBoundingBox();
  patches.sort((a, b) => diagonal(b.geometry) - diagonal(a.geometry));

  // Normalise: centre on the origin and scale the longest dimension to 1. The viewer derives camera
  // distance, ground size and explode travel from the bounding sphere, so a mesh authored in millimetres
  // and one authored in metres behave identically after this step.
  const total = new THREE.Box3();
  for (const patch of patches) total.union(patch.geometry.boundingBox!);
  const center = total.getCenter(new THREE.Vector3());
  const extent = total.getSize(new THREE.Vector3());
  const longest = Math.max(extent.x, extent.y, extent.z) || 1;
  const scale = 1 / longest;

  const root = new THREE.Group();
  root.name = 'reconstructed-mesh';

  const clay = new THREE.MeshStandardMaterial({
    name: 'clay-neutral',
    color: new THREE.Color(0x9aa1a8),
    roughness: 0.55,
    metalness: 0.15,
  });

  patches.forEach((patch, index) => {
    const geometry = patch.geometry;
    const local = geometry.boundingBox!.getCenter(new THREE.Vector3());
    geometry.translate(-center.x, -center.y, -center.z);
    geometry.scale(scale, scale, scale);
    // Re-centre the geometry on its own origin and move the offset into the node position: that is what
    // gives the explode pass a per-part direction.
    geometry.translate(-local.x * scale, -local.y * scale, -local.z * scale);

    const source = Array.isArray(patch.material) ? patch.material[0] : patch.material;
    const material = source ? (source as THREE.Material).clone() : clay.clone();
    const hasColor = !!geometry.getAttribute('color');
    if ('vertexColors' in material) (material as THREE.MeshStandardMaterial).vertexColors = hasColor;

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `${patch.name}_part_${index + 1}`;
    mesh.position.set((local.x - center.x) * scale, (local.y - center.y) * scale, (local.z - center.z) * scale);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.sculptComponent = {
      id: `${idPrefix}-${String(index + 1).padStart(3, '0')}`,
      name: `${patch.name} #${index + 1}`,
      level: strategy === 'spatial' ? 'spatial-chunk' : 'mesh-part',
      material: source?.name?.trim() || 'clay-neutral',
      triangles: patch.triangles,
    };
    root.add(mesh);
  });

  root.userData.meshStats = {
    source: 'glb',
    partition: strategy,
    rawPatches,
    parts: patches.length,
    triangles,
    normalizedExtent: 1,
  };

  return root;
}

/** Neutral studio rig, sized in model units like the factory's; the viewer re-fits shadows per model. */
export function defaultLights(mode: 'neutral' | 'grazing' | 'reference' = 'reference'): THREE.Object3D {
  const group = new THREE.Group();
  group.name = 'mesh-default-lights';

  const hemi = new THREE.HemisphereLight(0xd7e3f2, 0x1b1d20, mode === 'neutral' ? 0.7 : 0.45);
  group.add(hemi);

  const key = new THREE.DirectionalLight(0xffffff, mode === 'grazing' ? 2.6 : 1.9);
  key.position.set(2.2, 3.0, 1.9);
  key.castShadow = true;
  group.add(key);

  const rim = new THREE.DirectionalLight(0xbfd8ff, 0.9);
  rim.position.set(-2.4, 1.4, -2.2);
  group.add(rim);

  const fill = new THREE.DirectionalLight(0xffe9cf, 0.5);
  fill.position.set(-1.6, 0.4, 2.6);
  group.add(fill);

  return group;
}

export function defaultRendererSetup(renderer: THREE.WebGLRenderer): void {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}

export function defaultEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const texture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  return texture;
}

export function defaultControls(camera: THREE.Camera, domElement: HTMLElement): OrbitControls {
  const controls = new OrbitControls(camera, domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.screenSpacePanning = true;
  return controls;
}