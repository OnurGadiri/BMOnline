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
  const sky = new THREE.Mesh(new THREE.SphereGeometry(450, 32, 16), mat);
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
  for (let i = 0; i < 18; i++) {
    const c = new THREE.Group();
    const n = 4 + Math.floor(R() * 4);
    for (let j = 0; j < n; j++) {
      const m = new THREE.Mesh(geo, mat);
      const s = 6 + R() * 7;
      m.scale.set(s * 1.3, s * 0.75, s);
      m.position.set((j - n / 2) * 7 + R() * 4, R() * 3, R() * 6 - 3);
      c.add(m);
    }
    const ang = R() * Math.PI * 2, rad = 120 + R() * 260;
    c.position.set(Math.cos(ang) * rad, 75 + R() * 45, Math.sin(ang) * rad);
    c.rotation.y = R() * Math.PI;
    c.userData.speed = 1 + R() * 1.5;
    group.add(c);
    clouds.push(c);
  }
  scene.add(group);
  return (dt) => {
    for (const c of clouds) {
      c.position.x += c.userData.speed * dt;
      if (c.position.x > 420) c.position.x = -420;
    }
  };
}

/** Ot, kollar, çiçəklər, fənərlər, daşlar */
export function addDecor(scene, campus, ctx, R, quality) {
  const { colliders, circles } = ctx;
  const nodes = campus.nodes;
  const edges = campus.edges.map(([a, b]) => [nodes[a], nodes[b]]);
  const b = campus.bounds, fd = campus.field, pk = campus.parking, gl = campus.gallows;

  const pathDist = (x, z) => {
    let best = Infinity;
    for (const [[x1, z1], [x2, z2]] of edges) {
      const dx = x2 - x1, dz = z2 - z1;
      const t = Math.max(0, Math.min(1, ((x - x1) * dx + (z - z1) * dz) / (dx * dx + dz * dz)));
      best = Math.min(best, Math.hypot(x - (x1 + t * dx), z - (z1 + t * dz)));
    }
    return best;
  };
  const inBox = (x, z, m) => colliders.some((c) => x > c.minX - m && x < c.maxX + m && z > c.minZ - m && z < c.maxZ + m);
  const inSpecial = (x, z, m = 0) =>
    Math.hypot(x, z) < 27 + m ||
    (Math.abs(x - fd.x) < fd.w / 2 + 1 + m && Math.abs(z - fd.z) < fd.d / 2 + 1 + m) ||
    (Math.abs(x - pk.x) < pk.w / 2 + 1 + m && Math.abs(z - pk.z) < pk.d / 2 + 1 + m) ||
    (gl && Math.abs(x - gl.x) < 5 + m && Math.abs(z - gl.z) < 5 + m);
  const inside = (x, z, m) => x > b.minX + m && x < b.maxX - m && z > b.minZ + m && z < b.maxZ - m;
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();

  // ---- Fənərlər (yolların kənarında + meydanın ətrafında) ----
  const lampSpots = [];
  for (const [[x1, z1], [x2, z2]] of edges) {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const ux = (x2 - x1) / len, uz = (z2 - z1) / len;
    let side = 1;
    for (let d = 8; d < len - 4; d += 17) {
      const x = x1 + ux * d - uz * 3.2 * side, z = z1 + uz * d + ux * 3.2 * side;
      side = -side;
      if (inBox(x, z, 1) || Math.hypot(x, z) < 29 || !inside(x, z, 2)) continue;
      lampSpots.push([x, z]);
    }
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    lampSpots.push([Math.sin(a) * 24.5, Math.cos(a) * 24.5]);
  }
  const poleGeo = new THREE.CylinderGeometry(0.07, 0.11, 4.2, 8);
  poleGeo.translate(0, 2.1, 0);
  const headGeo = new THREE.CylinderGeometry(0.28, 0.18, 0.45, 8);
  headGeo.translate(0, 4.35, 0);
  const capGeo = new THREE.ConeGeometry(0.36, 0.25, 8);
  capGeo.translate(0, 4.68, 0);
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

  // ---- Kollar (yolların kənarı boyunca) ----
  const bushSpots = [];
  for (const [[x1, z1], [x2, z2]] of edges) {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const ux = (x2 - x1) / len, uz = (z2 - z1) / len;
    for (let d = 4; d < len - 3; d += 4.5) {
      for (const side of [-1, 1]) {
        if (R() < 0.45) continue;
        const off = 3.6 + R() * 0.8;
        const x = x1 + ux * d - uz * off * side, z = z1 + uz * d + ux * off * side;
        if (inBox(x, z, 1.2) || inSpecial(x, z) || !inside(x, z, 2) || pathDist(x, z) < 3) continue;
        if (lampSpots.some(([lx, lz]) => Math.hypot(lx - x, lz - z) < 1.6)) continue;
        bushSpots.push([x, z, 0.55 + R() * 0.55]);
      }
    }
  }
  const bushGeo = new THREE.IcosahedronGeometry(1, 1);
  const bushes = new THREE.InstancedMesh(bushGeo, new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true }), bushSpots.length);
  const greens = ['#3f7d3a', '#4d8f42', '#5c9e48', '#356f34', '#6aa84f'];
  bushSpots.forEach(([x, z, s], i) => {
    dummy.position.set(x, s * 0.55, z);
    dummy.scale.set(s * 1.25, s * 0.85, s * 1.1);
    dummy.rotation.set(0, R() * 6, 0);
    dummy.updateMatrix();
    bushes.setMatrixAt(i, dummy.matrix);
    bushes.setColorAt(i, col.set(greens[Math.floor(R() * greens.length)]));
    circles.push({ x, z, r: s * 1.0 });
  });
  bushes.castShadow = true;
  bushes.receiveShadow = true;
  scene.add(bushes);

  // ---- Çiçəklər: meydanın ətrafında və binaların önündə ----
  const flowerSpots = [];
  for (let i = 0; i < 520; i++) {
    const a = R() * Math.PI * 2, r = 26.2 + R() * 1.6;
    flowerSpots.push([Math.sin(a) * r, Math.cos(a) * r]);
  }
  for (const bd of campus.buildings) {
    if (!bd.labelSide) continue;
    const side = { s: [0, 1], n: [0, -1], e: [1, 0], w: [-1, 0] }[bd.labelSide];
    const along = side[0] ? bd.d : bd.w;
    for (let i = 0; i < 160; i++) {
      const t = (R() - 0.5) * (along - 2);
      if (Math.abs(t) < 4) continue; // giriş qapısının önü boş qalsın
      const off = (side[0] ? bd.w : bd.d) / 2 + 1.2 + R() * 1.2;
      const x = bd.x + side[0] * off + (side[0] ? 0 : t), z = bd.z + side[1] * off + (side[0] ? t : 0);
      if (pathDist(x, z) < 2.4 || inBox(x, z, 0.2)) continue;
      flowerSpots.push([x, z]);
    }
  }
  const flowerGeo = new THREE.IcosahedronGeometry(0.11, 0);
  const flowers = new THREE.InstancedMesh(flowerGeo, new THREE.MeshLambertMaterial({ color: '#ffffff' }), flowerSpots.length);
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
  // çiçək ləkləri (torpaq)
  const bedMat = new THREE.MeshLambertMaterial({ color: '#6b4a2b' });
  const bed = new THREE.Mesh(new THREE.RingGeometry(26, 28, 64), bedMat);
  bed.rotation.x = -Math.PI / 2;
  bed.position.y = 0.035;
  bed.receiveShadow = true;
  scene.add(bed);

  // ---- Ot dəstələri ----
  if (quality !== 'low') {
    const count = 14000;
    const tuftGeo = new THREE.ConeGeometry(0.045, 0.24, 3);
    tuftGeo.translate(0, 0.12, 0);
    const tufts = new THREE.InstancedMesh(tuftGeo, new THREE.MeshLambertMaterial({ color: '#ffffff' }), count);
    const grassCols = ['#6fa85a', '#7fb069', '#5e9a4c', '#8cbf6e', '#679e52'];
    let n = 0;
    for (let tries = 0; tries < count * 3 && n < count; tries++) {
      const x = b.minX + R() * (b.maxX - b.minX), z = b.minZ + R() * (b.maxZ - b.minZ);
      if (inBox(x, z, 0.4) || inSpecial(x, z, 0.5) || pathDist(x, z) < 2.4) continue;
      dummy.position.set(x, 0, z);
      const s = 0.7 + R() * 0.9;
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
  const rockGeo = new THREE.DodecahedronGeometry(1, 0);
  const rocks = new THREE.InstancedMesh(rockGeo, new THREE.MeshLambertMaterial({ color: '#9a9a94', flatShading: true }), 40);
  let rn = 0;
  for (let tries = 0; tries < 400 && rn < 40; tries++) {
    const x = b.minX + 3 + R() * (b.maxX - b.minX - 6), z = b.minZ + 3 + R() * (b.maxZ - b.minZ - 6);
    if (inBox(x, z, 2) || inSpecial(x, z, 2) || pathDist(x, z) < 4) continue;
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
