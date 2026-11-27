// Oyun interaksiyaları: toplar (futbol, basketbol) və ulduzlar
import * as THREE from 'three';

export const BALL_G = 12; // serverdəki ilə eyni

function ballTexture(kind) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  if (kind === 'basketball') {
    g.fillStyle = '#d9762b'; g.fillRect(0, 0, 256, 128);
    for (let i = 0; i < 3000; i++) { g.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.05)'; g.fillRect(Math.random() * 256, Math.random() * 128, 2, 2); }
    g.strokeStyle = '#1a1a1a'; g.lineWidth = 4;
    g.beginPath(); g.moveTo(0, 64); g.lineTo(256, 64); g.stroke();
    for (const x of [64, 192]) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 128); g.stroke(); }
    for (const x of [0, 128, 256]) { g.beginPath(); g.ellipse(x, 64, 34, 64, 0, 0, Math.PI * 2); g.stroke(); }
  } else if (kind === 'volleyball') {
    // ağ-sarı-göy panellər
    const cols = ['#f5f5f0', '#f2c230', '#2f6fd1'];
    for (let i = 0; i < 6; i++) { g.fillStyle = cols[i % 3]; g.fillRect((i * 256) / 6, 0, 256 / 6 + 1, 128); }
    g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 2;
    for (let i = 0; i <= 6; i++) { g.beginPath(); g.moveTo((i * 256) / 6, 0); g.lineTo((i * 256) / 6, 128); g.stroke(); }
    g.beginPath(); g.moveTo(0, 64); g.lineTo(256, 64); g.stroke();
  } else {
    g.fillStyle = '#f7f7f7'; g.fillRect(0, 0, 256, 128);
    g.fillStyle = '#1b1b1b';
    const spots = [[32, 32], [96, 20], [160, 34], [224, 22], [0, 96], [64, 100], [128, 92], [192, 104], [256, 96], [128, 64 - 4]];
    for (const [x, y] of spots) {
      g.beginPath();
      for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2 - Math.PI / 2; g.lineTo(x + Math.cos(a) * 15, y + Math.sin(a) * 13); }
      g.fill();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function starGeometry() {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2, r = i % 2 ? 0.2 : 0.46;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (i) s.lineTo(x, y); else s.moveTo(x, y);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.12, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 2 });
  g.center();
  return g;
}

export class Play {
  constructor(scene, campus, sfx) {
    this.scene = scene;
    this.campus = campus;
    this.sfx = sfx;
    this.balls = new Map();
    for (const b of campus.balls || []) {
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(b.r, 20, 14), new THREE.MeshLambertMaterial({ map: ballTexture(b.kind) }));
      mesh.castShadow = true;
      mesh.position.set(b.x, b.r, b.z);
      scene.add(mesh);
      this.balls.set(b.id, { cfg: b, mesh, px: b.x, py: b.r, pz: b.z, vx: 0, vy: 0, vz: 0, hold: false });
    }
    this.stars = new Map();
    this.starGeo = starGeometry();
    this.starMat = new THREE.MeshLambertMaterial({ color: '#ffd23f', emissive: '#c48a00', emissiveIntensity: 0.55 });
    this.pending = new Set();
  }

  // ---- toplar ----
  setBalls(rows) {
    for (const [id, px, py, pz, vx, vy, vz, hold] of rows) {
      const b = this.balls.get(id);
      if (!b) continue;
      b.hold = !!hold;
      const err = Math.hypot(px - b.px, py - b.py, pz - b.pz);
      const k = err > 1.5 ? 1 : 0.4; // böyük fərqdə birbaşa, kiçikdə yumşaq düzəliş
      b.px += (px - b.px) * k; b.py += (py - b.py) * k; b.pz += (pz - b.pz) * k;
      b.vx = vx; b.vy = vy; b.vz = vz;
    }
  }
  nearestBall(pos) {
    let best = null, bd = Infinity;
    for (const b of this.balls.values()) {
      const d = Math.hypot(b.px - pos.x, b.pz - pos.z);
      if (d < bd) { bd = d; best = b; }
    }
    return best ? { ball: best, dist: bd } : null;
  }
  stepBall(b, dt, listenerPos) {
    const c = b.cfg;
    if (b.hold) return;
    const prev = b.pz, prevY = b.py;
    const vy0 = b.vy;
    b.vy -= BALL_G * dt;
    b.px += b.vx * dt; b.py += ((vy0 + b.vy) / 2) * dt; b.pz += b.vz * dt; // serverlə eyni inteqrasiya
    const n = c.net;
    if (n && (prev - n.z) * (b.pz - n.z) < 0 && b.px > n.x1 && b.px < n.x2 && Math.min(prevY, b.py) < n.top) {
      b.pz = n.z + Math.sign(prev - n.z) * (c.r + 0.02);
      b.vz = -b.vz * 0.3; b.vx *= 0.6;
    }
    if (b.py < c.r) {
      const hit = -b.vy;
      b.py = c.r;
      if (b.vy < 0) b.vy = -b.vy * (c.kind === 'basketball' ? 0.72 : c.kind === 'volleyball' ? 0.6 : 0.55);
      if (b.vy < 0.8) b.vy = 0;
      const f = Math.max(0, 1 - (c.kind === 'basketball' ? 1.6 : 1.1) * dt);
      b.vx *= f; b.vz *= f;
      if (hit > 2.5) this.sfx.bounce(Math.max(0, 1 - Math.hypot(b.px - listenerPos.x, b.pz - listenerPos.z) / 40) * Math.min(1, hit / 8));
    }
    const bd = c.bounds;
    if (b.px < bd.minX + c.r) { b.px = bd.minX + c.r; b.vx = Math.abs(b.vx) * 0.5; }
    if (b.px > bd.maxX - c.r) { b.px = bd.maxX - c.r; b.vx = -Math.abs(b.vx) * 0.5; }
    if (b.pz < bd.minZ + c.r) { b.pz = bd.minZ + c.r; b.vz = Math.abs(b.vz) * 0.5; }
    if (b.pz > bd.maxZ - c.r) { b.pz = bd.maxZ - c.r; b.vz = -Math.abs(b.vz) * 0.5; }
  }

  // ---- ulduzlar ----
  setStars(list) {
    for (const s of this.stars.values()) this.scene.remove(s.mesh);
    this.stars.clear();
    for (const s of list) this.addStar(s);
  }
  addStar(s) {
    const mesh = new THREE.Mesh(this.starGeo, this.starMat);
    mesh.position.set(s.x, 1.1, s.z);
    mesh.castShadow = true;
    this.scene.add(mesh);
    this.stars.set(s.id, { ...s, mesh, phase: Math.random() * 6 });
  }
  removeStar(id) {
    const s = this.stars.get(id);
    if (s) this.scene.remove(s.mesh);
    this.stars.delete(id);
    this.pending.delete(id);
  }

  update(dt, t, playerPos, canCollect, send) {
    for (const b of this.balls.values()) {
      this.stepBall(b, dt, playerPos);
      const sp = Math.hypot(b.vx, b.vz);
      if (sp > 0.01 && b.py <= b.cfg.r + 0.02) {
        const axis = new THREE.Vector3(b.vz / sp, 0, -b.vx / sp);
        b.mesh.rotateOnWorldAxis(axis, (sp * dt) / b.cfg.r);
      }
      b.mesh.position.set(b.px, b.py, b.pz);
    }
    for (const s of this.stars.values()) {
      s.mesh.rotation.y += dt * 2.2;
      s.mesh.position.y = 1.1 + Math.sin(t * 2.5 + s.phase) * 0.15;
      if (canCollect && !this.pending.has(s.id) && Math.hypot(s.x - playerPos.x, s.z - playerPos.z) < 1.4) {
        this.pending.add(s.id);
        send({ t: 'collect', id: s.id });
        setTimeout(() => this.pending.delete(s.id), 2000);
      }
    }
  }
}
