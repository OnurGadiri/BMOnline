// Vizual detallar: səma, buludlar, ot, kollar, çiçəklər, fənərlər, daşlar
import * as THREE from 'three';

export const SUN_DIR = new THREE.Vector3(0.45, 0.72, 0.28).normalize();

/** Qradiyentli səma + günəş parıltısı. Hər kadrda kameranın mövqeyinə köçürülür. */
export function buildSky(scene) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color('#0f5cc4') },
      horizon: { value: new THREE.Color('#bcdcf5') },
      bottom: { value: new THREE.Color('#c4dcee') },
      sunDir: { value: SUN_DIR },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; uniform vec3 sunDir;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 c = h > 0.0 ? mix(horizon, top, pow(h, 0.38)) : mix(horizon, bottom, min(1.0, -h * 4.0));
        float s = max(dot(d, sunDir), 0.0);
        c += vec3(1.0, 0.9, 0.7) * (pow(s, 900.0) * 3.0 + pow(s, 40.0) * 0.35 + pow(s, 6.0) * 0.12);
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(700, 32, 16), mat);
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  scene.add(sky);
  return sky;
}

/** Low-poly buludlar — yavaş-yavaş sürüşür */
export function buildClouds(scene, R) {
  const group = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#c9d9ea', emissiveIntensity: 0.35, flatShading: true, fog: false });
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const clouds = [];
  for (let i = 0; i < 24; i++) {
    const c = new THREE.Group();
    const n = 4 + Math.floor(R() * 4);
    for (let j = 0; j < n; j++) {
      const m = new THREE.Mesh(geo, mat);
      const s = 7 + R() * 8;
      m.scale.set(s * 1.3, s * 0.75, s);
      m.position.set((j - n / 2) * 8 + R() * 4, R() * 3, R() * 6 - 3);
      c.add(m);
    }
    const ang = R() * Math.PI * 2, rad = 150 + R() * 400;
    c.position.set(Math.cos(ang) * rad, 95 + R() * 60, Math.sin(ang) * rad + 80);
    c.rotation.y = R() * Math.PI;
    c.userData.speed = 1 + R() * 1.5;
    group.add(c);
    clouds.push(c);
  }
  scene.add(group);
  return (dt) => {
    for (const c of clouds) {
      c.position.x += c.userData.speed * dt;
      if (c.position.x > 650) c.position.x = -650;
    }
  };
}

/**
 * Kollar, çiçəklər, fənərlər, ot, daşlar.
 * ctx: { colliders, circles, edges: [{x1,z1,x2,z2,half,road}], blocked(x,z,margin), hardAreas }
 */
export function addDecor(scene, campus, ctx, R, quality) {
  const { circles, edges, blocked } = ctx;
  const b = campus.bounds;
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  const along = (e, d, off) => {
    const len = Math.hypot(e.x2 - e.x1, e.z2 - e.z1);
    const ux = (e.x2 - e.x1) / len, uz = (e.z2 - e.z1) / len;
    return [e.x1 + ux * d - uz * off, e.z1 + uz * d + ux * off];
  };

  // ---- Fənərlər (yolların kənarında, səkidə) ----
  const lampSpots = [];
  for (const e of edges) {
    const len = Math.hypot(e.x2 - e.x1, e.z2 - e.z1);
    const off = e.road ? 6.2 : 2.3;
    const step = e.road ? 22 : 16;
    let side = 1;
    for (let d = 8; d < len - 4; d += step) {
      const [x, z] = along(e, d, off * side);
      side = e.road ? side : -side;
      if (ctx.colliders.some((c) => x > c.minX - 1 && x < c.maxX + 1 && z > c.minZ - 1 && z < c.maxZ + 1)) continue;
      if (lampSpots.some(([lx, lz]) => Math.hypot(lx - x, lz - z) < 8)) continue;
      lampSpots.push([x, z]);
      if (e.road) {
        const [x2, z2] = along(e, d + step / 2, -off);
        if (!lampSpots.some(([lx, lz]) => Math.hypot(lx - x2, lz - z2) < 8)) lampSpots.push([x2, z2]);
      }
    }
  }
  const poleGeo = new THREE.CylinderGeometry(0.07, 0.11, 4.6, 8);
  poleGeo.translate(0, 2.3, 0);
  const headGeo = new THREE.CylinderGeometry(0.28, 0.18, 0.45, 8);
  headGeo.translate(0, 4.75, 0);
  const capGeo = new THREE.ConeGeometry(0.36, 0.25, 8);
  capGeo.translate(0, 5.08, 0);
  const poles = new THREE.InstancedMesh(poleGeo, new THREE.MeshLambertMaterial({ color: '#2d3640' }), lampSpots.length);
  const heads = new THREE.InstancedMesh(headGeo, new THREE.MeshLambertMaterial({ color: '#fff4cf', emissive: '#ffe39a', emissiveIntensity: 0.6 }), lampSpots.length);
  const caps = new THREE.InstancedMesh(capGeo, new THREE.MeshLambertMaterial({ color: '#2d3640' }), lampSpots.length);
  lampSpots.forEach(([x, z], i) => {
    dummy.position.set(x, 0, z);
    dummy.updateMatrix();
    poles.setMatrixAt(i, dummy.matrix);
    heads.setMatrixAt(i, dummy.matrix);
    caps.setMatrixAt(i, dummy.matrix);
    circles.push({ x, z, r: 0.25 });
  });
  poles.castShadow = caps.castShadow = true;
  scene.add(poles, heads, caps);

  // ---- Kollar: yolların kənarında və bağlarda (fotolardakı kimi qırxılmış kollar) ----
  const bushSpots = [];
  for (const e of edges) {
    const len = Math.hypot(e.x2 - e.x1, e.z2 - e.z1);
    const off = e.road ? 7.6 : 3.1;
    for (let d = 4; d < len - 3; d += e.road ? 3.2 : 4.5) {
      for (const side of [-1, 1]) {
        if (R() < (e.road ? 0.35 : 0.55)) continue;
        const [x, z] = along(e, d, (off + R() * 0.6) * side);
        if (blocked(x, z, 0.6)) continue;
        bushSpots.push([x, z, 0.5 + R() * 0.45]);
      }
    }
  }
  for (const a of campus.areas || []) {
    if (a.type !== 'garden') continue;
    // bağın kənarı boyunca kol cərgəsi
    for (let t = 1.5; t < a.w - 1; t += 2.2) {
      for (const sz of [-1, 1]) {
        const x = a.x - a.w / 2 + t, z = a.z + sz * (a.d / 2 - 1.2);
        if (!blocked(x, z, 0.2)) bushSpots.push([x, z, 0.5 + R() * 0.2]);
      }
    }
  }
  const bushes = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true }), bushSpots.length);
  const greens = ['#3f7d3a', '#4d8f42', '#5c9e48', '#356f34', '#6aa84f', '#7a9e3a'];
  bushSpots.forEach(([x, z, s], i) => {
    dummy.position.set(x, s * 0.55, z);
    dummy.scale.set(s * 1.25, s * 0.85, s * 1.1);
    dummy.rotation.set(0, R() * 6, 0);
    dummy.updateMatrix();
    bushes.setMatrixAt(i, dummy.matrix);
    bushes.setColorAt(i, col.set(greens[Math.floor(R() * greens.length)]));
    circles.push({ x, z, r: s * 1.0 });
  });
  bushes.castShadow = bushes.receiveShadow = true;
  scene.add(bushes);

  // ---- Çiçəklər: bağlarda və binaların önündə ----
  const flowerSpots = [];
  for (const a of campus.areas || []) {
    if (a.type !== 'garden') continue;
    for (let i = 0; i < (a.w * a.d) / 4; i++) {
      const x = a.x + (R() - 0.5) * (a.w - 1), z = a.z + (R() - 0.5) * (a.d - 1);
      if (!blocked(x, z, 0.1)) flowerSpots.push([x, z]);
    }
  }
  for (const bd of campus.buildings) {
    if (!bd.labelSide && bd.style !== 'pinkstripe') continue;
    const sides = bd.labelSide ? [bd.labelSide] : ['w'];
    for (const sideKey of sides) {
      const side = { s: [0, 1], n: [0, -1], e: [1, 0], w: [-1, 0] }[sideKey];
      const len = side[0] ? bd.d : bd.w;
      for (let i = 0; i < len * 4; i++) {
        const t = (R() - 0.5) * (len - 2);
        if (Math.abs(t) < 4 && bd.labelSide) continue; // girişin önü boş qalsın
        const off = (side[0] ? bd.w : bd.d) / 2 + 1 + R() * 1.4;
        const x = bd.x + side[0] * off + (side[0] ? 0 : t), z = bd.z + side[1] * off + (side[0] ? t : 0);
        if (!blocked(x, z, 0.1)) flowerSpots.push([x, z]);
      }
    }
  }
  const flowers = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.11, 0), new THREE.MeshLambertMaterial({ color: '#ffffff' }), flowerSpots.length);
  const petals = ['#ff5d73', '#ffd166', '#ffffff', '#b388eb', '#ff8fab', '#ff9f1c'];
  flowerSpots.forEach(([x, z], i) => {
    dummy.position.set(x, 0.18 + R() * 0.12, z);
    dummy.scale.setScalar(0.8 + R() * 0.6);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    flowers.setMatrixAt(i, dummy.matrix);
    flowers.setColorAt(i, col.set(petals[Math.floor(R() * petals.length)]));
  });
  scene.add(flowers);

  // ---- Ot dəstələri ----
  if (quality !== 'low') {
    const count = 26000;
    const tuftGeo = new THREE.ConeGeometry(0.045, 0.26, 3);
    tuftGeo.translate(0, 0.13, 0);
    const tufts = new THREE.InstancedMesh(tuftGeo, new THREE.MeshLambertMaterial({ color: '#ffffff' }), count);
    const grassCols = ['#6fa85a', '#7fb069', '#5e9a4c', '#8cbf6e', '#9aa565', '#8a9a55'];
    let n = 0;
    for (let tries = 0; tries < count * 3 && n < count; tries++) {
      const x = b.minX + R() * (b.maxX - b.minX), z = b.minZ + R() * (b.maxZ - b.minZ);
      if (ctx.colliders.some((c) => x > c.minX - 0.3 && x < c.maxX + 0.3 && z > c.minZ - 0.3 && z < c.maxZ + 0.3)) continue;
      if (ctx.hardAreas.some((a) => Math.abs(x - a.x) < a.w / 2 + 0.3 && Math.abs(z - a.z) < a.d / 2 + 0.3)) continue;
      if (edges.some((e) => segDist(x, z, e) < e.half + 0.3)) continue;
      dummy.position.set(x, 0, z);
      const s = 0.7 + R() * 1;
      dummy.scale.set(s, s * (0.8 + R() * 0.6), s);
      dummy.rotation.set((R() - 0.5) * 0.4, R() * 6, (R() - 0.5) * 0.4);
      dummy.updateMatrix();
      tufts.setMatrixAt(n, dummy.matrix);
      tufts.setColorAt(n, col.set(grassCols[Math.floor(R() * grassCols.length)]));
      n++;
    }
    tufts.count = n;
    scene.add(tufts);
  }

  // ---- Daşlar ----
  const rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ color: '#9a9a94', flatShading: true }), 80);
  let rn = 0;
  for (let tries = 0; tries < 800 && rn < 80; tries++) {
    const x = b.minX + 3 + R() * (b.maxX - b.minX - 6), z = b.minZ + 3 + R() * (b.maxZ - b.minZ - 6);
    if (blocked(x, z, 2)) continue;
    const s = 0.3 + R() * 0.6;
    dummy.position.set(x, s * 0.3, z);
    dummy.scale.set(s * 1.3, s * 0.8, s);
    dummy.rotation.set(R(), R() * 6, R());
    dummy.updateMatrix();
    rocks.setMatrixAt(rn++, dummy.matrix);
  }
  rocks.count = rn;
  rocks.castShadow = rocks.receiveShadow = true;
  scene.add(rocks);
}

function segDist(x, z, e) {
  const dx = e.x2 - e.x1, dz = e.z2 - e.z1;
  const t = Math.max(0, Math.min(1, ((x - e.x1) * dx + (z - e.z1) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(x - (e.x1 + t * dx), z - (e.z1 + t * dz));
}
