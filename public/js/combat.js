// Döyüş effektləri: güllə izi, alov, qığılcım, zərər rəqəmləri, səslər, nişan şüası
import * as THREE from 'three';

// ---------------- Səslər (WebAudio ilə sintez — fayl lazım deyil) ----------------
class Sfx {
  constructor() { this.ctx = null; this.noise = null; }
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    const len = this.ctx.sampleRate * 0.5;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(this.ctx.destination);
  }
  env(node, vol, attack, decay) {
    const g = this.ctx.createGain();
    const t = this.ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    node.connect(g);
    g.connect(this.master);
    return t + attack + decay + 0.05;
  }
  noiseBurst(vol, freq, decay, type = 'lowpass') {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    src.connect(f);
    const end = this.env(f, vol, 0.002, decay);
    src.start();
    src.stop(end);
  }
  tone(vol, f0, f1, decay, type = 'sine') {
    const o = this.ctx.createOscillator();
    o.type = type;
    const t = this.ctx.currentTime;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + decay);
    const end = this.env(o, vol, 0.002, decay);
    o.start();
    o.stop(end);
  }
  shot(vol = 1) {
    if (!this.ctx || vol <= 0.01) return;
    this.noiseBurst(0.9 * vol, 3200, 0.2);
    this.noiseBurst(0.5 * vol, 900, 0.35);
    this.tone(0.7 * vol, 160, 40, 0.12, 'triangle');
  }
  punch(vol = 1) {
    if (!this.ctx || vol <= 0.01) return;
    this.tone(0.8 * vol, 120, 50, 0.12);
    this.noiseBurst(0.35 * vol, 700, 0.08);
  }
  hit(head) {
    if (!this.ctx) return;
    this.tone(0.35, head ? 1800 : 1300, head ? 1500 : 1000, 0.05, 'square');
  }
  hurt() {
    if (!this.ctx) return;
    this.tone(0.5, 220, 90, 0.18, 'sawtooth');
  }
  empty() {
    if (!this.ctx) return;
    this.tone(0.3, 2400, 2000, 0.03, 'square');
  }
  kick(vol = 1) {
    if (!this.ctx || vol <= 0.01) return;
    this.tone(0.9 * vol, 180, 70, 0.09, 'sine');
    this.noiseBurst(0.3 * vol, 1500, 0.05);
  }
  bounce(vol = 1) {
    if (!this.ctx || vol <= 0.02) return;
    this.tone(0.4 * vol, 140, 90, 0.06, 'sine');
  }
  chime() {
    if (!this.ctx) return;
    [880, 1175, 1568].forEach((f, i) => setTimeout(() => this.tone(0.25, f, f * 1.01, 0.18, 'triangle'), i * 70));
  }
  cheer() {
    if (!this.ctx) return;
    [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this.tone(0.3, f, f, 0.22, 'square'), i * 110));
    this.noiseBurst(0.25, 2500, 1.2, 'bandpass');
  }
  reload() {
    if (!this.ctx) return;
    this.tone(0.3, 900, 700, 0.04, 'square');
    setTimeout(() => this.tone(0.35, 1400, 1100, 0.05, 'square'), 700);
  }
}
export const sfx = new Sfx();

// ---------------- Vizual effektlər ----------------
function glowTexture(inner, outer) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, inner); gr.addColorStop(0.35, outer); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Fx {
  constructor(scene) {
    this.scene = scene;
    this.items = [];
    this.flashTex = glowTexture('rgba(255,255,230,1)', 'rgba(255,170,40,0.8)');
    this.tracerGeo = new THREE.CylinderGeometry(0.012, 0.012, 1, 5, 1, true);
    this.tracerGeo.rotateX(Math.PI / 2);
    this.tracerGeo.translate(0, 0, 0.5);
    this.sparkGeo = new THREE.BoxGeometry(0.05, 0.05, 0.05);
  }
  add(obj, life, update) {
    this.scene.add(obj);
    this.items.push({ obj, life, max: life, update });
  }
  tracer(from, to) {
    const m = new THREE.Mesh(this.tracerGeo, new THREE.MeshBasicMaterial({ color: '#ffe9a8', transparent: true, opacity: 0.9, depthWrite: false }));
    m.position.copy(from);
    m.lookAt(to);
    m.scale.set(1, 1, from.distanceTo(to));
    this.add(m, 0.09, (it, k) => { m.material.opacity = 0.9 * k; });
  }
  flash(at) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.flashTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    s.position.copy(at);
    s.scale.setScalar(0.55 + Math.random() * 0.2);
    s.material.rotation = Math.random() * 6;
    this.add(s, 0.06, (it, k) => { s.material.opacity = k; });
  }
  sparks(at, blood = false) {
    const n = blood ? 10 : 7;
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(this.sparkGeo, new THREE.MeshBasicMaterial({ color: blood ? '#c1121f' : i % 2 ? '#ffd166' : '#bbbbbb', transparent: true }));
      m.position.copy(at);
      const v = new THREE.Vector3((Math.random() - 0.5) * 4, Math.random() * 3 + 0.5, (Math.random() - 0.5) * 4);
      m.scale.setScalar(blood ? 1.2 : 0.8);
      this.add(m, 0.35 + Math.random() * 0.2, (it, k, dt) => {
        v.y -= 12 * dt;
        m.position.addScaledVector(v, dt);
        m.material.opacity = k;
      });
    }
  }
  damageNumber(at, text, color = '#ffffff') {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 64;
    const g = c.getContext('2d');
    g.font = 'bold 44px system-ui, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 7; g.strokeStyle = 'rgba(0,0,0,0.75)';
    g.strokeText(text, 64, 34);
    g.fillStyle = color;
    g.fillText(text, 64, 34);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false }));
    s.position.copy(at);
    s.position.x += (Math.random() - 0.5) * 0.4;
    s.scale.set(0.9, 0.45, 1);
    s.renderOrder = 10;
    this.add(s, 0.9, (it, k, dt) => { s.position.y += dt * 1.2; s.material.opacity = Math.min(1, k * 2); });
  }
  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.life -= dt;
      if (it.life <= 0) {
        this.scene.remove(it.obj);
        it.obj.material?.map?.dispose?.();
        it.obj.material?.dispose?.();
        this.items.splice(i, 1);
        continue;
      }
      it.update?.(it, it.life / it.max, dt);
    }
  }
}

// ---------------- Can zolağı (başın üstündə) ----------------
export function makeHpBar() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 18;
  const g = c.getContext('2d');
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthWrite: false }));
  s.scale.set(0.9, 0.13, 1);
  s.visible = false;
  s.userData.set = (hp) => {
    g.clearRect(0, 0, 128, 18);
    g.fillStyle = 'rgba(0,0,0,0.6)';
    g.fillRect(0, 0, 128, 18);
    const k = Math.max(0, Math.min(1, hp / 100));
    g.fillStyle = k > 0.5 ? '#4cd964' : k > 0.25 ? '#ffcc00' : '#ff3b30';
    g.fillRect(3, 3, 122 * k, 12);
    t.needsUpdate = true;
    s.visible = hp > 0 && hp < 100;
  };
  return s;
}

// ---------------- Nişan: kameranın mərkəzindən şüa ----------------
const ray = new THREE.Raycaster();
const tmpDir = new THREE.Vector3();
/** Kameranın baxdığı nöqtəni tapır (binalar, yer, digər xarakterlər) */
export function aimPoint(camera, world, others, maxDist = 100) {
  camera.getWorldDirection(tmpDir);
  const o = camera.position;
  let best = maxDist;
  ray.set(o, tmpDir);
  ray.far = maxDist;
  const h = ray.intersectObjects(world.blockers, false)[0];
  if (h) best = Math.min(best, h.distance);
  if (tmpDir.y < -1e-4) best = Math.min(best, -o.y / tmpDir.y);
  for (const ot of others.values()) {
    if (ot.dead) continue;
    const p = ot.char.root.position;
    const t = rayCylinder(o, tmpDir, p, 0.4, ot.char.height);
    if (t !== null && t < best) best = t;
  }
  return o.clone().addScaledVector(tmpDir, best);
}
export function rayCylinder(o, d, base, r, h) {
  const ox = o.x - base.x, oz = o.z - base.z;
  const a = d.x * d.x + d.z * d.z;
  if (a < 1e-9) return null;
  const b = 2 * (ox * d.x + oz * d.z), c = ox * ox + oz * oz - r * r;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  for (const t of [(-b - sq) / (2 * a), (-b + sq) / (2 * a)]) {
    if (t < 0) continue;
    const y = o.y + d.y * t;
    if (y >= base.y && y <= base.y + h) return t;
  }
  return null;
}
