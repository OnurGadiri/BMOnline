// Meshləri birləşdirmək: çəkiliş (draw call) sayını azaldır, FPS-i artırır.
// Rəng hər təpəyə yazılır, beləliklə müxtəlif rəngli hissələr bir mesh-də birləşə bilir.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const tmpV = new THREE.Vector3();

/** Mesh-in həndəsəsini verilmiş matrislə çevirib, rəngini təpələrə yazır (yalnız position/normal/color) */
export function bakeGeometry(geometry, matrix, color) {
  const src = geometry.index ? geometry.toNonIndexed() : geometry;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', src.getAttribute('position').clone());
  if (src.getAttribute('normal')) g.setAttribute('normal', src.getAttribute('normal').clone());
  else g.computeVertexNormals();
  g.applyMatrix4(matrix);
  if (color) {
    const n = g.getAttribute('position').count;
    const c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { c[i * 3] = color.r; c[i * 3 + 1] = color.g; c[i * 3 + 2] = color.b; }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  }
  return g;
}

/** Birləşdirilə bilən sadə rəngli Lambert mesh-i */
function mergeableLambert(o) {
  if (!o.isMesh || o.isInstancedMesh || o.userData.dynamic) return false;
  const m = o.material;
  return !Array.isArray(m) && m.isMeshLambertMaterial && !m.map && !m.transparent && m.opacity === 1 &&
    !m.polygonOffset && !m.vertexColors && (!m.emissive || m.emissive.getHex() === 0);
}

/**
 * Statik səhnə obyektlərini xəritə hüceyrələri üzrə birləşdirir (frustum culling işləməyə davam etsin).
 * roots: yoxlanacaq kök obyektlər. Hərəkət edən obyektlərə userData.dynamic = true qoyulmalıdır.
 */
export function mergeStatic(scene, roots, cell = 110) {
  scene.updateMatrixWorld(true);
  const buckets = new Map();
  const removed = [];
  for (const root of roots) {
    root.traverse((o) => {
      if (!mergeableLambert(o)) return;
      tmpV.setFromMatrixPosition(o.matrixWorld);
      const m = o.material;
      const key = `${Math.floor(tmpV.x / cell)}|${Math.floor(tmpV.z / cell)}|${m.flatShading ? 1 : 0}|${m.side}|${o.castShadow ? 1 : 0}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(bakeGeometry(o.geometry, o.matrixWorld, m.color));
      removed.push(o);
    });
  }
  for (const o of removed) o.parent?.remove(o);
  for (const [key, geos] of buckets) {
    const [, , flat, side, cast] = key.split('|');
    const mesh = new THREE.Mesh(mergeGeometries(geos, false),
      new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: flat === '1', side: Number(side) }));
    mesh.castShadow = cast === '1';
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
  return { merged: removed.length, meshes: buckets.size };
}

/** Bir qrupun (məs. maşının) sadə rəngli hissələrini qrupun öz koordinatlarında bir mesh-ə birləşdirir */
export function mergeGroup(group) {
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const geos = [], removed = [];
  let cast = false;
  group.traverse((o) => {
    if (o === group || !mergeableLambert(o)) return;
    const local = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    geos.push(bakeGeometry(o.geometry, local, o.material.color));
    cast ||= o.castShadow;
    removed.push(o);
  });
  if (geos.length < 2) return group;
  for (const o of removed) o.parent?.remove(o);
  const mesh = new THREE.Mesh(mergeGeometries(geos, false), new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.castShadow = cast;
  mesh.receiveShadow = true;
  group.add(mesh);
  return group;
}

export { mergeGeometries };
