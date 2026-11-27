import * as THREE from 'three';

// Kampus üzərində dövrə vuran quş dəstələri — 2 draw call (sol/sağ qanadlar InstancedMesh)
export function buildBirds(scene, center, count = 18) {
  const wing = new THREE.BufferGeometry();
  // üçbucaq qanad: gövdə xəttindən (x=0) yana açılır
  wing.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.22, 0, 0, -0.18, 0.75, 0, -0.05], 3));
  wing.computeVertexNormals();
  const wingR = wing.clone();
  wingR.scale(-1, 1, 1);
  const mat = new THREE.MeshBasicMaterial({ color: '#2b2f36', side: THREE.DoubleSide, fog: true });
  const L = new THREE.InstancedMesh(wing, mat, count);
  const R = new THREE.InstancedMesh(wingR, mat, count);
  L.frustumCulled = R.frustumCulled = false;
  scene.add(L, R);

  const flocks = [0, 1, 2].map((i) => ({
    cx: center.x + (i - 1) * 60, cz: center.z + (i - 1) * 40,
    r: 55 + i * 25, h: 32 + i * 9, speed: (i % 2 ? -1 : 1) * (0.09 + i * 0.02), a: i * 2.1,
  }));
  const birds = Array.from({ length: count }, (_, i) => ({
    f: flocks[i % 3], off: new THREE.Vector3((Math.random() - 0.5) * 9, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 9),
    ph: Math.random() * 6, rate: 9 + Math.random() * 4,
  }));

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
  return function update(t, dt) {
    for (const f of flocks) f.a += f.speed * dt;
    birds.forEach((b, i) => {
      const f = b.f, a = f.a + i * 0.02;
      p.set(f.cx + Math.cos(a) * f.r, f.h + Math.sin(t * 0.5 + b.ph) * 1.5, f.cz + Math.sin(a) * f.r).add(b.off);
      const heading = Math.atan2(-Math.sin(a) * Math.sign(f.speed), Math.cos(a) * Math.sign(f.speed));
      // arabir süzülür (qanad çalmır)
      const glide = Math.sin(t * 0.35 + b.ph) > 0.4;
      const flap = glide ? 0.12 : Math.sin(t * b.rate + b.ph) * 0.7;
      e.set(0, heading, flap); q.setFromEuler(e);
      L.setMatrixAt(i, m.compose(p, q, s));
      e.set(0, heading, -flap); q.setFromEuler(e);
      R.setMatrixAt(i, m.compose(p, q, s));
    });
    L.instanceMatrix.needsUpdate = R.instanceMatrix.needsUpdate = true;
  };
}
