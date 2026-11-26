// Kampus xəritəsi — public/data/campus.json əsasında qurulur
import * as THREE from 'three';
import { buildSky, buildClouds, addDecor } from './decor.js';
import { mergeStatic, mergeGroup } from './merge.js';

const markDynamic = (o) => o.traverse((c) => { c.userData.dynamic = true; });

// Sabit toxumlu təsadüfi ədəd (hər kəsdə eyni düzüm olsun)
function rng(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
const lambert = (c) => new THREE.MeshLambertMaterial({ color: c });

// Yer səthi qatları: üst-üstə düşən düz səthlər bu sıra ilə çəkilir (z-fighting / titrəmə olmasın)
const L = {
  grass: 0, meadow: 1, garden: 2, asphalt: 3, paving: 3, parking: 4, field: 4, court: 4,
  junctionPave: 5, road: 6, roadPatch: 7, sidewalk: 8, path: 10, pathPatch: 11,
};
const layerY = (layer) => 0.004 + layer * 0.004;
function groundMat(mat, layer) {
  if (layer > 0) {
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -layer;
    mat.polygonOffsetUnits = -layer * 4;
  }
  return mat;
}
const repeatTex = (t, rx, ry) => {
  const c = t.clone();
  c.wrapS = c.wrapT = THREE.RepeatWrapping;
  c.repeat.set(rx, ry);
  c.needsUpdate = true;
  return c;
};

function speckle(g, w, h, R, n, colors, size = 3) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = colors[Math.floor(R() * colors.length)];
    g.fillRect(R() * w, R() * h, 1 + R() * size, 1 + R() * size);
  }
}

// ======================= Toxumalar =======================

function brickPattern(g, w, h, R) {
  const bh = 7, bw = 20;
  for (let row = 0; row * bh < h; row++) {
    const off = (row % 2) * (bw / 2);
    for (let x = -bw; x < w + bw; x += bw) {
      g.fillStyle = `rgba(${R() < 0.5 ? '0,0,0' : '255,200,170'},${(R() * 0.12).toFixed(3)})`;
      g.fillRect(x + off, row * bh, bw - 1.5, bh - 1.5);
    }
    g.fillStyle = 'rgba(235,215,195,0.35)';
    g.fillRect(0, row * bh + bh - 1.5, w, 1.5);
  }
}

function glassPanel(g, x, y, ww, wh, step = 26) {
  const gr = g.createLinearGradient(0, y, 0, y + wh);
  gr.addColorStop(0, '#9cd0dc'); gr.addColorStop(0.5, '#4f8ea3'); gr.addColorStop(1, '#2a5466');
  g.fillStyle = gr;
  g.fillRect(x, y, ww, wh);
  g.fillStyle = 'rgba(255,255,255,0.18)';
  g.beginPath(); g.moveTo(x, y + wh * 0.25); g.lineTo(x + ww * 0.6, y); g.lineTo(x + ww, y); g.lineTo(x, y + wh * 0.7); g.fill();
  g.fillStyle = '#1e3440';
  for (let i = 0; i <= ww; i += step) g.fillRect(x + i - 1.5, y, 3, wh);
  for (let j = 0; j <= wh; j += step * 1.3) g.fillRect(x, y + j - 1.5, ww, 3);
}

function drawWindow(g, x, y, ww, wh, frame, R, panes = 'cross') {
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.fillRect(x - 3, y - 3, ww + 9, wh + 9);
  g.fillStyle = frame;
  g.fillRect(x - 5, y - 5, ww + 10, wh + 10);
  const lit = R() < 0.1;
  const gr = g.createLinearGradient(0, y, 0, y + wh);
  if (lit) { gr.addColorStop(0, '#fff1c4'); gr.addColorStop(1, '#f2c879'); }
  else { gr.addColorStop(0, '#b6d8ee'); gr.addColorStop(0.55, '#6894b8'); gr.addColorStop(1, '#38597a'); }
  g.fillStyle = gr;
  g.fillRect(x, y, ww, wh);
  if (R() < 0.25) {
    g.globalAlpha = 0.7;
    g.fillStyle = ['#efe3c2', '#ffffff', '#d9c6a5', '#c9d6df'][Math.floor(R() * 4)];
    g.fillRect(x, y, ww, wh * (0.25 + R() * 0.4));
    g.globalAlpha = 1;
  }
  g.fillStyle = 'rgba(255,255,255,0.25)';
  g.beginPath(); g.moveTo(x + ww * 0.15, y); g.lineTo(x + ww * 0.42, y); g.lineTo(x + ww * 0.1, y + wh); g.lineTo(x, y + wh); g.closePath(); g.fill();
  g.fillStyle = frame;
  if (panes === 'cross') { g.fillRect(x + ww / 2 - 2, y, 4, wh); g.fillRect(x, y + wh * 0.4, ww, 4); }
  else { for (let i = 1; i < 3; i++) g.fillRect(x + (ww * i) / 3 - 2, y, 4, wh); }
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.fillRect(x - 7, y + wh + 5, ww + 14, 4);
}

const STYLE_BASE = {
  brick: '#9a4a35', brickglass: '#9a4a35', pinkstripe: '#f4d9cf', modern: '#efe6d6',
  cream: '#e8e1d4', resi: '#e7dccb', concrete: '#5a5e64',
};

/** Fasad toxuması: üslub + mərtəbə sayı + sütun sayı */
function facadeTexture(style, o, floors, cols, R) {
  const H = floors > 6 ? 1024 : 512;
  return canvasTex(512, H, (g, w, h) => {
    const fh = h / floors, cw = w / cols;
    g.fillStyle = o.color || STYLE_BASE[style];
    g.fillRect(0, 0, w, h);
    if (style === 'brick' || style === 'brickglass') brickPattern(g, w, h, R);
    else speckle(g, w, h, R, 2500, ['rgba(0,0,0,0.035)', 'rgba(255,255,255,0.06)'], 6);

    if (style === 'concrete') {
      for (let f = 0; f < floors; f++) {
        g.fillStyle = '#7a7e84';
        g.fillRect(0, f * fh + fh - 8, w, 8);
        for (let c = 0; c < cols; c++) {
          g.fillStyle = R() < 0.6 ? '#22262b' : '#3a3f45';
          g.fillRect(c * cw + cw * 0.12, f * fh + fh * 0.15, cw * 0.76, fh * 0.65);
        }
      }
      return;
    }
    if (style === 'pinkstripe') {
      g.fillStyle = '#a6cde0';
      for (let c = 0; c <= cols; c++) g.fillRect(c * cw - 8, 0, 16, h);
      g.fillStyle = '#d9773a';
      g.fillRect(0, h - fh - 4, w, 12);
    }
    if (style === 'resi') {
      g.fillStyle = o.accent || '#5e4535';
      for (let c = 0; c < cols; c++) if (c % 3 === 1) g.fillRect(c * cw, 0, cw, h);
    }
    // mərtəbə xətləri
    for (let f = 1; f < floors; f++) {
      g.fillStyle = style === 'modern' ? (o.accent || '#c8743a') : 'rgba(0,0,0,0.13)';
      g.fillRect(0, f * fh - (style === 'modern' ? fh * 0.16 : 5), w, style === 'modern' ? fh * 0.16 : 5);
    }
    const mid = Math.floor(cols / 2);
    for (let f = 0; f < floors; f++) {
      for (let c = 0; c < cols; c++) {
        if (style === 'brickglass' && c === mid) continue;
        if (style === 'modern' && o.glass && (c === 1 || c === 2)) continue;
        const spec = {
          brick: [0.22, 0.22, 0.56, 0.56, '#e3d3a9', 'cross'],
          brickglass: [0.22, 0.22, 0.56, 0.56, '#e3d3a9', 'cross'],
          pinkstripe: [0.26, 0.22, 0.48, 0.52, '#ffffff', 'cross'],
          modern: [0.1, 0.16, 0.8, 0.52, '#dfe3e6', 'vert'],
          cream: [0.18, 0.2, 0.64, 0.56, '#f3f0ea', 'cross'],
          resi: [0.22, 0.24, 0.56, 0.5, '#d6ccbc', 'vert'],
        }[style] || [0.18, 0.2, 0.64, 0.56, '#f3f0ea', 'cross'];
        drawWindow(g, c * cw + cw * spec[0], f * fh + fh * spec[1], cw * spec[2], fh * spec[3], spec[4], R, spec[5]);
      }
    }
    if (style === 'brickglass') glassPanel(g, mid * cw + cw * 0.08, h * 0.05, cw * 0.84, h * 0.93);
    if (style === 'modern' && o.glass) glassPanel(g, cw + 10, h * 0.03, cw * 2 - 20, h * 0.95, 30);
  });
}

/** Rektorluğun ön fasadı (fotoya görə) */
function rectorateFront(R) {
  return canvasTex(768, 544, (g, w, h) => {
    g.fillStyle = '#9a4a35';
    g.fillRect(0, 0, w, h);
    brickPattern(g, w, h, R);
    // yuxarıda yazılar
    g.fillStyle = '#ffffff';
    g.shadowColor = 'rgba(0,0,0,0.45)';
    g.shadowBlur = 4;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    // mərkəzdəki şüşə zolağa (w*0.475..0.525) toxunmasın
    g.font = 'bold 30px Georgia, "Times New Roman", serif';
    const maxW = w * 0.4;
    g.fillText('BAKI MÜHƏNDİSLİK', w * 0.25, h * 0.05, maxW);
    g.fillText('UNİVERSİTETİ', w * 0.25, h * 0.115, maxW);
    g.fillText('BAKU ENGINEERING', w * 0.75, h * 0.05, maxW);
    g.fillText('UNIVERSITY', w * 0.75, h * 0.115, maxW);
    g.shadowBlur = 0;
    // pəncərələr (4 mərtəbə, hər tərəfdə 2 sütun)
    for (let f = 0; f < 4; f++) {
      for (const cx of [0.1, 0.25, 0.67, 0.82]) {
        drawWindow(g, w * cx, h * (0.19 + f * 0.2), w * 0.1, h * 0.12, '#e3d3a9', R, 'cross');
      }
    }
    // mərkəzdə dar şüşə zolaq və aşağıda geniş şüşə blok
    glassPanel(g, w * 0.475, h * 0.0, w * 0.05, h * 0.42, 18);
    g.fillStyle = '#2d2d2d';
    g.fillRect(w * 0.36, h * 0.4, w * 0.28, h * 0.6);
    glassPanel(g, w * 0.375, h * 0.43, w * 0.25, h * 0.57, 32);
  });
}

function labelTexture(text, bg = '#1d3557') {
  return canvasTex(1024, 160, (g, w, h) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#ffd166';
    g.lineWidth = 8;
    g.strokeRect(6, 6, w - 12, h - 12);
    g.fillStyle = '#ffffff';
    g.font = 'bold 76px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2 + 4, w - 40);
  });
}

function grassTexture(base = '#78ad5f', shades = ['#6c9f55', '#85b96b', '#71a65a']) {
  const t = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    const R = rng(77);
    speckle(g, w, h, R, 5000, shades, 3);
    for (let i = 0; i < 40; i++) {
      g.fillStyle = R() < 0.5 ? 'rgba(60,90,40,0.045)' : 'rgba(150,190,110,0.04)';
      g.beginPath(); g.arc(R() * w, R() * h, 6 + R() * 18, 0, Math.PI * 2); g.fill();
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
function meadowTexture() {
  const t = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#8f9a5a';
    g.fillRect(0, 0, w, h);
    const R = rng(91);
    speckle(g, w, h, R, 6000, ['#7d8a4d', '#a39a63', '#97a560', '#8a7f55', '#6f8a49'], 4);
    for (let i = 0; i < 30; i++) {
      g.fillStyle = R() < 0.5 ? 'rgba(120,95,60,0.18)' : 'rgba(80,110,50,0.15)';
      g.beginPath(); g.arc(R() * w, R() * h, 8 + R() * 34, 0, Math.PI * 2); g.fill();
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
function asphaltTexture() {
  const t = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#62656a';
    g.fillRect(0, 0, w, h);
    speckle(g, w, h, rng(13), 3000, ['#585b60', '#6d7075', '#5f6267'], 2);
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
/** Yol: asfalt + kənar xətləri + qırıq orta xətt (u — en, v — uzunluq; 1 təkrar = 12 m) */
function roadTexture() {
  const t = canvasTex(128, 256, (g, w, h) => {
    g.fillStyle = '#62656a';
    g.fillRect(0, 0, w, h);
    speckle(g, w, h, rng(17), 3000, ['#585b60', '#6d7075', '#5f6267'], 2);
    g.fillStyle = '#f2f2f2';
    g.fillRect(6, 0, 3, h);
    g.fillRect(w - 9, 0, 3, h);
    g.fillRect(w / 2 - 2, 0, 4, h * 0.55);
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
function pavingTexture() {
  const t = canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#c9c3b6';
    g.fillRect(0, 0, w, h);
    const R = rng(5);
    const bh = 16, bw = 32;
    for (let row = 0; row < h / bh; row++) {
      for (let col = -1; col < w / bw + 1; col++) {
        const x = col * bw + (row % 2) * (bw / 2), y = row * bh;
        const s = 190 + Math.floor(R() * 25);
        g.fillStyle = `rgb(${s + 8},${s + 4},${s - 6})`;
        g.fillRect(x + 1, y + 1, bw - 2, bh - 2);
      }
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
function parkingTexture() {
  // bir yer: 2.8 m en; toxuma 4 yer = 11.2 m
  const t = canvasTex(256, 128, (g, w, h) => {
    g.fillStyle = '#5f6267';
    g.fillRect(0, 0, w, h);
    speckle(g, w, h, rng(23), 2500, ['#565a5f', '#6a6d72'], 2);
    g.fillStyle = '#e9e9e9';
    for (let i = 0; i <= 4; i++) {
      g.fillRect((i * w) / 4 - 2, 0, 4, h * 0.42);
      g.fillRect((i * w) / 4 - 2, h * 0.58, 4, h * 0.42);
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
function pitchTexture() {
  const t = canvasTex(900, 560, (g, w, h) => {
    for (let i = 0; i < 12; i++) { g.fillStyle = i % 2 ? '#2f8a45' : '#36964d'; g.fillRect((i * w) / 12, 0, w / 12, h); }
    g.strokeStyle = '#ffffff'; g.lineWidth = 6;
    g.strokeRect(24, 24, w - 48, h - 48);
    g.beginPath(); g.moveTo(w / 2, 24); g.lineTo(w / 2, h - 24); g.stroke();
    g.beginPath(); g.arc(w / 2, h / 2, 64, 0, Math.PI * 2); g.stroke();
    g.strokeRect(24, h / 2 - 120, 120, 240);
    g.strokeRect(w - 144, h / 2 - 120, 120, 240);
  });
  t.center.set(0.5, 0.5);
  t.rotation = Math.PI / 2;
  return t;
}
function courtTexture() {
  return canvasTex(512, 400, (g, w, h) => {
    g.fillStyle = '#b5644a'; g.fillRect(0, 0, w, h);
    for (const x0 of [16, w / 2 + 8]) {
      g.fillStyle = '#3f7fb0'; g.fillRect(x0, 16, w / 2 - 24, h - 32);
      g.strokeStyle = '#ffffff'; g.lineWidth = 4;
      g.strokeRect(x0 + 16, 36, w / 2 - 56, h - 72);
      g.beginPath(); g.moveTo(x0 + 16, h / 2); g.lineTo(x0 + w / 2 - 40, h / 2); g.stroke();
      g.beginPath(); g.moveTo(x0 + (w / 2 - 24) / 2, 36); g.lineTo(x0 + (w / 2 - 24) / 2, h - 36); g.stroke();
    }
  });
}
function azFlagTexture() {
  return canvasTex(300, 150, (g) => {
    g.fillStyle = '#00b5e2'; g.fillRect(0, 0, 300, 50);
    g.fillStyle = '#ef3340'; g.fillRect(0, 50, 300, 50);
    g.fillStyle = '#509e2f'; g.fillRect(0, 100, 300, 50);
    g.fillStyle = '#ffffff';
    g.beginPath(); g.arc(140, 75, 18, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ef3340';
    g.beginPath(); g.arc(146, 75, 15, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ffffff';
    g.beginPath();
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2, r = i % 2 ? 4.5 : 10;
      g.lineTo(170 + Math.cos(a) * r, 75 + Math.sin(a) * r);
    }
    g.fill();
  });
}
function beuFlagTexture() {
  return canvasTex(300, 150, (g) => {
    g.fillStyle = '#1d4e9e'; g.fillRect(0, 0, 300, 150);
    g.fillStyle = '#ffffff';
    g.font = 'bold 56px Georgia, serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('BEU', 150, 70);
    g.font = '16px system-ui, sans-serif';
    g.fillText('BAKU ENGINEERING UNIVERSITY', 150, 118);
  });
}

// ======================= Kömək edən modellər =======================

const CAR_COLORS = ['#e63946', '#f1faee', '#1d3557', '#222222', '#8d99ae', '#ffd166', '#c0c4c9', '#ffffff', '#5a6b7c'];
function makeCar(color, lit = false) {
  const car = new THREE.Group();
  const cm = new THREE.MeshLambertMaterial({ color });
  const lower = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.75, 4.3), cm);
  lower.position.y = 0.6;
  const upper = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.6, 2.3), cm);
  upper.position.set(0, 1.25, -0.2);
  const glass = new THREE.Mesh(new THREE.BoxGeometry(1.77, 0.45, 2.1), lambert('#22313f'));
  glass.position.set(0, 1.27, -0.2);
  const lights = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.18, 0.05),
    lit ? new THREE.MeshLambertMaterial({ color: '#fff6d0', emissive: '#fff0b0', emissiveIntensity: 0.5 }) : lambert('#f4ecd0'));
  lights.position.set(0, 0.75, 2.16);
  car.add(lower, upper, glass, lights);
  const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.28, 12);
  const wm = lambert('#111111');
  for (const wx of [-1, 1]) for (const wz of [-1.35, 1.35]) {
    const wh = new THREE.Mesh(wheelGeo, wm);
    wh.rotation.z = Math.PI / 2;
    wh.position.set(wx * 0.92, 0.34, wz);
    car.add(wh);
  }
  car.traverse((o) => { o.castShadow = true; });
  return car;
}

function makeBench(scene, x, z, ry, circles) {
  const bench = new THREE.Group();
  const wood = lambert('#8b5a2b'), metal = lambert('#2d3238');
  const seat = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.1, 0.6), wood); seat.position.y = 0.5;
  const back = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.5, 0.08), wood); back.position.set(0, 0.82, -0.28);
  const l1 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.5, 0.55), metal); l1.position.set(-0.95, 0.25, 0);
  const l2 = l1.clone(); l2.position.x = 0.95;
  bench.add(seat, back, l1, l2);
  bench.traverse((o) => { o.castShadow = true; });
  bench.position.set(x, 0, z);
  bench.rotation.y = ry;
  scene.add(bench);
  circles.push({ x, z, r: 1.1 });
}

// ======================= Dünya =======================

export function buildWorld(scene, campus, quality = 'high') {
  const colliders = [];   // AABB: {minX,maxX,minZ,maxZ,h}
  const circles = [];     // {x,z,r}
  const blockers = [];    // kameranın keçə bilmədiyi meshlər
  const before = new Set(scene.children); // birləşdirmə yalnız dünyaya aid obyektlərə tətbiq olunsun
  const R = rng(20261126);
  const b = campus.bounds;
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;

  // --- Torpaq ---
  const gSize = 1600;
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(gSize, gSize), new THREE.MeshLambertMaterial({ map: repeatTex(grassTexture(), gSize / 6, gSize / 6) }));
  grass.rotation.x = -Math.PI / 2;
  grass.position.set(cx, 0, cz);
  grass.receiveShadow = true;
  scene.add(grass);

  // --- Sahələr (çəmənlik, asfalt, bağ, dayanacaq, meydança) ---
  const tex = {
    meadow: meadowTexture(), garden: grassTexture('#6aa553', ['#5e9a4a', '#77b35f', '#629f4e']),
    asphalt: asphaltTexture(), paving: pavingTexture(), parking: parkingTexture(),
  };
  const hardAreas = [];
  for (const a of campus.areas || []) {
    let mat;
    if (a.type === 'field') mat = new THREE.MeshLambertMaterial({ map: pitchTexture() });
    else if (a.type === 'court') mat = new THREE.MeshLambertMaterial({ map: courtTexture() });
    else if (a.type === 'parking') {
      const along = a.rows === 'z' ? a.d : a.w, across = a.rows === 'z' ? a.w : a.d;
      const t = repeatTex(tex.parking, along / 11.2, 1);
      if (a.rows === 'z') { t.center.set(0.5, 0.5); t.rotation = Math.PI / 2; t.repeat.set(along / 11.2, across / 12); }
      mat = new THREE.MeshLambertMaterial({ map: t });
    } else {
      const s = a.type === 'paving' ? 3.4 : 8;
      mat = new THREE.MeshLambertMaterial({ map: repeatTex(tex[a.type] || tex.asphalt, a.w / s, a.d / s) });
    }
    const layer = L[a.type] ?? L.asphalt;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(a.w, a.d), groundMat(mat, layer));
    m.rotation.x = -Math.PI / 2;
    m.position.set(a.x, layerY(layer), a.z);
    m.receiveShadow = true;
    scene.add(m);
    if (['asphalt', 'paving', 'parking', 'field', 'court'].includes(a.type)) hardAreas.push(a);

    if (a.type === 'garden') {
      // bordür
      const curb = lambert('#b9b2a4');
      for (const [w, d, x, z] of [[a.w, 0.3, a.x, a.z - a.d / 2], [a.w, 0.3, a.x, a.z + a.d / 2], [0.3, a.d, a.x - a.w / 2, a.z], [0.3, a.d, a.x + a.w / 2, a.z]]) {
        const c = new THREE.Mesh(new THREE.BoxGeometry(w, 0.18, d), curb);
        c.position.set(x, 0.09, z);
        scene.add(c);
      }
    }
    if (a.type === 'parking') {
      // maşınlar
      const along = a.rows === 'z' ? a.d : a.w;
      for (const side of [-1, 1]) {
        for (let s = 1.4; s < along - 1; s += 2.8) {
          if (R() < 0.3) continue;
          const car = makeCar(CAR_COLORS[Math.floor(R() * CAR_COLORS.length)]);
          const off = side * (a.rows === 'z' ? a.w : a.d) * 0.25;
          if (a.rows === 'z') {
            car.position.set(a.x + off, 0, a.z - a.d / 2 + s);
            car.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
            colliders.push({ minX: car.position.x - 2.15, maxX: car.position.x + 2.15, minZ: car.position.z - 0.95, maxZ: car.position.z + 0.95, h: 1.6 });
          } else {
            car.position.set(a.x - a.w / 2 + s, 0, a.z + off);
            car.rotation.y = side > 0 ? Math.PI : 0;
            colliders.push({ minX: car.position.x - 0.95, maxX: car.position.x + 0.95, minZ: car.position.z - 2.15, maxZ: car.position.z + 2.15, h: 1.6 });
          }
          scene.add(car);
        }
      }
    }
    if (a.type === 'field') {
      // qapılar (uzun tərəf z oxu boyuncadır) və alçaq hasar
      const gm = lambert('#ffffff');
      for (const side of [-1, 1]) {
        const gz = a.z + side * (a.d / 2 - 2);
        for (const dx of [-3.6, 3.6]) {
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2.4, 0.2), gm);
          post.position.set(a.x + dx, 1.2, gz);
          post.castShadow = true;
          scene.add(post);
          circles.push({ x: a.x + dx, z: gz, r: 0.3 });
        }
        const bar = new THREE.Mesh(new THREE.BoxGeometry(7.4, 0.2, 0.2), gm);
        bar.position.set(a.x, 2.4, gz);
        scene.add(bar);
      }
      const netMat = new THREE.MeshLambertMaterial({ color: '#2d5a3a', transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false });
      for (const [w, d, x, z, ry] of [[a.w + 4, 0, a.x, a.z - a.d / 2 - 2, 0], [a.w + 4, 0, a.x, a.z + a.d / 2 + 2, 0], [a.d + 4, 0, a.x - a.w / 2 - 2, a.z, Math.PI / 2], [a.d + 4, 0, a.x + a.w / 2 + 2, a.z, Math.PI / 2]]) {
        const net = new THREE.Mesh(new THREE.PlaneGeometry(w, 4), netMat);
        net.position.set(x, 2, z);
        net.rotation.y = ry;
        scene.add(net);
      }
    }
    if (a.type === 'court') {
      for (const dx of [-a.w / 4, a.w / 4]) {
        const net = new THREE.Mesh(new THREE.BoxGeometry(a.w / 2 - 4, 0.9, 0.05), lambert('#eeeeee'));
        net.position.set(a.x + dx, 0.45, a.z);
        scene.add(net);
      }
    }
  }

  // --- Yol şəbəkəsi: asfalt yollar, səkilər, bordürlər, cığırlar ---
  // Qovşaqlarda heç bir zolaq başqa yolun içinə girmir; hər yer qatının öz sırası var (titrəmə olmasın).
  const nodes = campus.nodes;
  const roadTex = roadTexture(), paveTex = pavingTexture(), asphTex = asphaltTexture();
  const curbMat = lambert('#a39c8e');
  const edges = campus.edges.map(([a, c, type = 'path']) => {
    const [x1, z1] = nodes[a], [x2, z2] = nodes[c];
    const len = Math.hypot(x2 - x1, z2 - z1);
    const dx = (x2 - x1) / len, dz = (z2 - z1) / len;
    // rx,rz — yolun sağ tərəfi (mesh-in lokal +x oxu)
    return { a, c, x1, z1, x2, z2, len, dx, dz, rx: dz, rz: -dx, road: type === 'road', half: type === 'road' ? 6.7 : 1.9 };
  });
  const inc = {};
  for (const e of edges) {
    (inc[e.a] ||= []).push({ e, ux: e.dx, uz: e.dz });
    (inc[e.c] ||= []).push({ e, ux: -e.dx, uz: -e.dz });
  }
  const roadDeg = (n) => inc[n].filter((o) => o.e.road).length;
  const straightRoad = (n) => {
    const r = inc[n].filter((o) => o.e.road);
    return r.length === 2 && r[0].ux * r[1].ux + r[0].uz * r[1].uz < -0.95;
  };
  /** Qovşaqda bu kənarın (s tərəfdəki) zolağı neçə metr kəsilməlidir ki, başqa yola girməsin */
  const trimAt = (node, e, ux, uz, s, offs, filter, otherHalf) => {
    const [nx, nz] = nodes[node];
    const others = inc[node].filter((o) => o.e !== e && filter(o.e) && o.ux * ux + o.uz * uz > -0.95);
    if (!others.length) return 0;
    for (let t = 0; t <= 30; t += 0.25) {
      const clear = offs.every((o) => {
        const px = nx + ux * t + e.rx * s * o, pz = nz + uz * t + e.rz * s * o;
        return others.every((ot) => segDist(px, pz, ot.e) >= otherHalf(ot.e));
      });
      if (clear) return t;
    }
    return 30;
  };
  const strip = (e, t0, t1, offset, width, layer, mat) => {
    const L = t1 - t0;
    if (L <= 0.05) return;
    const geo = new THREE.PlaneGeometry(width, L);
    geo.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, groundMat(mat, layer));
    const mid = (t0 + t1) / 2;
    m.position.set(e.x1 + e.dx * mid + e.rx * offset, layerY(layer), e.z1 + e.dz * mid + e.rz * offset);
    m.rotation.y = Math.atan2(e.dx, e.dz);
    m.receiveShadow = true;
    scene.add(m);
  };
  const curb = (e, t0, t1, offset) => {
    const L = t1 - t0;
    if (L <= 0.1) return;
    const c = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.14, L), curbMat);
    const mid = (t0 + t1) / 2;
    c.position.set(e.x1 + e.dx * mid + e.rx * offset, 0.07, e.z1 + e.dz * mid + e.rz * offset);
    c.rotation.y = Math.atan2(e.dx, e.dz);
    c.receiveShadow = true;
    scene.add(c);
  };
  const disc = (x, z, r, layer, mat) => {
    const m = new THREE.Mesh(new THREE.CircleGeometry(r, 28), groundMat(mat, layer));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, layerY(layer), z);
    m.receiveShadow = true;
    scene.add(m);
  };
  const isRoad = (e) => e.road;
  edges.forEach((e, i) => {
    const ends = [[e.a, e.dx, e.dz], [e.c, -e.dx, -e.dz]];
    if (e.road) {
      // asfalt: qovşaqda dayanır, dalanda bir az uzanır
      const ext = ends.map(([n]) => (roadDeg(n) === 1 ? 4.5 : 0));
      strip(e, -ext[0], e.len + ext[1], 0, 9, L.road, new THREE.MeshLambertMaterial({ map: repeatTex(roadTex, 1, (e.len + ext[0] + ext[1]) / 12) }));
      for (const s of [-1, 1]) {
        const tw = ends.map(([n, ux, uz]) => trimAt(n, e, ux, uz, s, [4.5, 5.6, 6.7], isRoad, () => 4.6));
        const tc = ends.map(([n, ux, uz]) => trimAt(n, e, ux, uz, s, [4.55], isRoad, () => 4.5));
        const t0 = roadDeg(e.a) === 1 ? -4.5 : tw[0], t1 = e.len - (roadDeg(e.c) === 1 ? -4.5 : tw[1]);
        strip(e, t0, t1, s * 5.6, 2.2, L.sidewalk + (i % 6) * 0.2, new THREE.MeshLambertMaterial({ map: repeatTex(paveTex, 0.65, (t1 - t0) / 3.4) }));
        curb(e, roadDeg(e.a) === 1 ? -4.5 : tc[0], e.len - (roadDeg(e.c) === 1 ? -4.5 : tc[1]), s * 4.55);
      }
    } else {
      // cığır: yola çatanda asfaltın kənarında dayanır, başqa cığırla qovşaqda birləşir
      const tr = ends.map(([n, ux, uz]) => {
        if (inc[n].length === 1) return -1.7;
        return trimAt(n, e, ux, uz, 1, [-1.7, 0, 1.7], isRoad, () => 4.6);
      });
      strip(e, tr[0], e.len - tr[1], 0, 3.4, L.path + (i % 4) * 0.2, new THREE.MeshLambertMaterial({ map: repeatTex(paveTex, 1, (e.len - tr[0] - tr[1]) / 3.4) }));
      for (const s of [-1, 1]) {
        const tc = ends.map(([n, ux, uz]) => (inc[n].length === 1 ? -1.7 : trimAt(n, e, ux, uz, s, [1.75], () => true, (o) => (o.road ? 6.7 : 1.8))));
        curb(e, tc[0], e.len - tc[1], s * 1.75);
      }
    }
  });
  // qovşaq örtükləri
  for (const n of Object.keys(inc)) {
    const [x, z] = nodes[n];
    if (roadDeg(n) >= 2 && !straightRoad(n)) {
      disc(x, z, 7.2, L.junctionPave, new THREE.MeshLambertMaterial({ map: repeatTex(paveTex, 4, 4) }));
      disc(x, z, 6.4, L.roadPatch, new THREE.MeshLambertMaterial({ map: repeatTex(asphTex, 1.6, 1.6) }));
    } else if (roadDeg(n) === 0 && inc[n].length >= 2) {
      disc(x, z, 2.45, L.pathPatch, new THREE.MeshLambertMaterial({ map: repeatTex(paveTex, 1.4, 1.4) }));
    }
  }

  // --- Binalar ---
  for (const bd of campus.buildings) {
    buildBuilding(scene, bd, R, colliders, blockers);
  }

  // --- Rektorluq meydanı: bayraqlar, BEU hərfləri, lövhə, abidə, skamyalar ---
  const pd = campus.plazaDecor || {};
  const flags = [];
  (pd.flags || []).forEach(([fx, fz], i) => {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 11, 8), lambert('#d8d8d8'));
    pole.position.set(fx, 5.5, fz);
    pole.castShadow = true;
    scene.add(pole);
    circles.push({ x: fx, z: fz, r: 0.25 });
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.2, 10, 1),
      new THREE.MeshLambertMaterial({ map: i === 1 ? beuFlagTexture() : azFlagTexture(), side: THREE.DoubleSide }));
    flag.position.set(fx, 10.2, fz - 1.2);
    flag.rotation.y = Math.PI / 2;
    scene.add(flag);
    flags.push(flag);
  });
  if (pd.letters) buildLetters(scene, pd.letters, colliders);
  if (pd.billboard) {
    const bb = pd.billboard;
    const g = new THREE.Group();
    const board = new THREE.Mesh(new THREE.BoxGeometry(4.2, 2.8, 0.15), [lambert('#333'), lambert('#333'), lambert('#333'), lambert('#333'),
      new THREE.MeshLambertMaterial({ map: azFlagTexture() }), lambert('#444')]);
    board.position.y = 3.6;
    for (const dx of [-1.6, 1.6]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.15, 2.4, 0.15), lambert('#555'));
      leg.position.set(dx, 1.2, -0.05);
      g.add(leg);
    }
    g.add(board);
    g.traverse((o) => { o.castShadow = true; });
    g.position.set(bb.x, 0, bb.z);
    g.rotation.y = bb.ry || 0;
    scene.add(g);
    circles.push({ x: bb.x, z: bb.z, r: 1.5 });
  }
  if (pd.monument) {
    const mo = pd.monument;
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ color: '#b08a5a', flatShading: true }));
    rock.scale.set(1.1, 1.9, 0.9);
    rock.position.set(mo.x, 1.7, mo.z);
    rock.castShadow = true;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.5, 0.4, 10), lambert('#9a9389'));
    base.position.set(mo.x, 0.2, mo.z);
    scene.add(rock, base);
    circles.push({ x: mo.x, z: mo.z, r: 1.5 });
  }
  for (const [bx, bz, ry] of pd.benches || []) makeBench(scene, bx, bz, ry, circles);

  // --- Dar ağacı ---
  if (campus.gallows) buildGallows(scene, campus.gallows, colliders);

  // --- Hasar və darvaza ---
  const fenceMat = lambert('#4a4f57');
  const g = campus.gate;
  const addFence = (x1, z1, x2, z2) => {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.15, 2, len), fenceMat);
    m.position.set((x1 + x2) / 2, 1, (z1 + z2) / 2);
    m.rotation.y = Math.atan2(x2 - x1, z2 - z1);
    scene.add(m);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, len), fenceMat);
    rail.position.copy(m.position).setY(2.05);
    rail.rotation.y = m.rotation.y;
    scene.add(rail);
  };
  addFence(b.minX, b.maxZ, b.maxX, b.maxZ);
  addFence(b.minX, b.minZ, b.minX, b.maxZ);
  addFence(b.maxX, b.minZ, b.maxX, b.maxZ);
  addFence(b.minX, b.minZ, g.x - 9, b.minZ);
  addFence(g.x + 9, b.minZ, b.maxX, b.minZ);
  for (const side of [-1, 1]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(1.4, 6.5, 1.4), lambert('#e9e4da'));
    pillar.position.set(g.x + side * 8, 3.25, g.z);
    pillar.castShadow = true;
    scene.add(pillar);
    colliders.push({ minX: g.x + side * 8 - 0.7, maxX: g.x + side * 8 + 0.7, minZ: g.z - 0.7, maxZ: g.z + 0.7, h: 6.5 });
  }
  const arch = new THREE.Mesh(new THREE.BoxGeometry(17.4, 1.4, 0.5), new THREE.MeshLambertMaterial({ map: labelTexture('BAKI MÜHƏNDİSLİK UNİVERSİTETİ', '#1d4e9e') }));
  arch.position.set(g.x, 6.6, g.z);
  scene.add(arch);

  // --- Kampusdan kənar: yaşayış qüllələri, kran, evlər, prospekt ---
  buildTowers(scene, campus, R);
  const crane = campus.crane ? buildCrane(scene, campus.crane) : null;
  buildHouses(scene, campus.houses, R);
  const traffic = campus.highway ? buildHighway(scene, campus.highway, R) : null;

  // --- Ağaclar (instanced) ---
  const blocked = (x, z, m = 0) =>
    x < b.minX + 2 || x > b.maxX - 2 || z < b.minZ + 2 || z > b.maxZ - 2 ||
    colliders.some((c) => x > c.minX - m && x < c.maxX + m && z > c.minZ - m && z < c.maxZ + m) ||
    hardAreas.some((a) => Math.abs(x - a.x) < a.w / 2 + m && Math.abs(z - a.z) < a.d / 2 + m) ||
    edges.some((e) => segDist(x, z, e) < e.half + m) ||
    (campus.gallows && Math.abs(x - campus.gallows.x) < 6 + m && Math.abs(z - campus.gallows.z) < 6 + m) ||
    circles.some((c) => Math.hypot(x - c.x, z - c.z) < c.r + m);
  plantTrees(scene, campus, edges, blocked, circles, R);

  // --- Hərəkətsiz obyektləri birləşdir (çəkiliş sayı azalsın) ---
  const stats = mergeStatic(scene, scene.children.filter((c) => !before.has(c)));
  console.info(`[world] ${stats.merged} mesh → ${stats.meshes} birləşmiş mesh`);

  // --- Səma, buludlar, kollar, çiçəklər, fənərlər, ot ---
  const sky = buildSky(scene);
  const updateClouds = buildClouds(scene, R);
  addDecor(scene, campus, { colliders, circles, edges, blocked, hardAreas }, R, quality);

  const update = (t, dt = 0.016, cam = null) => {
    if (cam) sky.position.copy(cam.position);
    updateClouds(dt);
    for (const flag of flags) {
      const pos = flag.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        pos.setZ(i, Math.sin(x * 2 + t * 4) * 0.12 * ((x + 1.2) / 2.4));
      }
      pos.needsUpdate = true;
    }
    if (crane) crane.rotation.y = Math.sin(t * 0.05) * 1.2;
    traffic?.(dt);
  };

  return { colliders, circles, blockers, bounds: b, update };
}

function segDist(x, z, e) {
  const dx = e.x2 - e.x1, dz = e.z2 - e.z1;
  const t = Math.max(0, Math.min(1, ((x - e.x1) * dx + (z - e.z1) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(x - (e.x1 + t * dx), z - (e.z1 + t * dz));
}

// ======================= Binalar =======================

function buildBuilding(scene, bd, R, colliders, blockers) {
  const style = bd.style || 'cream';
  const floors = Math.max(1, Math.round(bd.h / 3.7));
  const cols = style === 'brickglass' ? 3 : 4;
  const base = facadeTexture(style, bd, floors, cols, R);
  const side = (len) => {
    const t = base.clone();
    t.wrapS = THREE.RepeatWrapping;
    t.repeat.set(Math.max(1, Math.round(len / (cols * 3.6))), 1);
    t.needsUpdate = true;
    return new THREE.MeshLambertMaterial({ map: t });
  };
  const roof = lambert(bd.roof || '#8a8f96');
  // BoxGeometry tərəf sırası: +x, -x, +y, -y, +z, -z
  const mats = [side(bd.d), side(bd.d), roof, roof, side(bd.w), side(bd.w)];
  if (bd.special === 'rectorate') mats[1] = new THREE.MeshLambertMaterial({ map: rectorateFront(R) });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(bd.w, bd.h, bd.d), mats);
  mesh.position.set(bd.x, bd.h / 2, bd.z);
  mesh.castShadow = mesh.receiveShadow = true;
  scene.add(mesh);
  blockers.push(mesh);
  colliders.push({ minX: bd.x - bd.w / 2, maxX: bd.x + bd.w / 2, minZ: bd.z - bd.d / 2, maxZ: bd.z + bd.d / 2, h: bd.h });

  // bünövrə, kornis, dam kənarı
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(bd.w + 0.4, 0.6, bd.d + 0.4), lambert(style.startsWith('brick') ? '#6f6a62' : '#9a948a'));
  plinth.position.set(bd.x, 0.3, bd.z);
  plinth.receiveShadow = true;
  scene.add(plinth);
  const parapet = new THREE.Mesh(new THREE.BoxGeometry(bd.w + 0.5, 0.6, bd.d + 0.5), lambert(style.startsWith('brick') ? '#7c3a2a' : '#d9d4cb'));
  parapet.position.set(bd.x, bd.h + 0.3, bd.z);
  parapet.castShadow = true;
  scene.add(parapet);
  if (bd.h > 6) {
    const units = Math.max(1, Math.round((bd.w * bd.d) / 350));
    for (let i = 0; i < units; i++) {
      const u = R() < 0.8 ? new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.1, 1.2), lambert('#c9ccd1'))
        : new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 1.8, 12), lambert('#e4e4e4'));
      u.position.set(bd.x + (R() - 0.5) * (bd.w - 4), bd.h + 0.6 + (u.geometry.type === 'CylinderGeometry' ? 0.9 : 0.55), bd.z + (R() - 0.5) * (bd.d - 4));
      u.castShadow = true;
      scene.add(u);
    }
  }

  if (bd.special === 'rectorate') {
    // daş portal "REKTORLUQ" + şüşə qapı + pilləkən
    const front = bd.x - bd.w / 2;
    const portalTex = canvasTex(256, 256, (g, w, h) => {
      g.fillStyle = '#8b8378'; g.fillRect(0, 0, w, h);
      speckle(g, w, h, rng(3), 1500, ['rgba(0,0,0,0.08)', 'rgba(255,255,255,0.08)'], 4);
      g.fillStyle = '#f2efe8';
      g.font = 'bold 22px system-ui, sans-serif';
      g.textAlign = 'center';
      g.fillText('REKTORLUQ', w / 2, 34);
      g.fillStyle = '#1c2a33'; g.fillRect(w * 0.22, h * 0.24, w * 0.56, h * 0.76);
      glassPanel(g, w * 0.26, h * 0.28, w * 0.48, h * 0.72, 40);
    });
    const portal = new THREE.Mesh(new THREE.BoxGeometry(1.4, 5, 5.2), [lambert('#8b8378'), new THREE.MeshLambertMaterial({ map: portalTex }), lambert('#7d766c'), lambert('#7d766c'), lambert('#8b8378'), lambert('#8b8378')]);
    portal.position.set(front - 0.7, 2.5, bd.z);
    portal.castShadow = true;
    scene.add(portal);
    const steps = new THREE.Mesh(new THREE.BoxGeometry(3, 0.3, 8), lambert('#5b5f63'));
    steps.position.set(front - 2, 0.15, bd.z);
    scene.add(steps);
    colliders.push({ minX: front - 1.4, maxX: front, minZ: bd.z - 2.6, maxZ: bd.z + 2.6, h: 5 });
    return;
  }

  if (bd.special === 'arches') {
    // Dillər korpusu: iki hündür tağlı giriş
    const front = bd.labelSide === 'w' ? bd.x - bd.w / 2 : bd.x + bd.w / 2;
    const dir = bd.labelSide === 'w' ? -1 : 1;
    const archTex = canvasTex(256, 512, (g, w, h) => {
      g.fillStyle = '#f1ebe3'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#b9734a';
      g.beginPath(); g.moveTo(30, h); g.lineTo(30, 150); g.arc(w / 2, 150, w / 2 - 30, Math.PI, 0); g.lineTo(w - 30, h); g.closePath(); g.fill();
      g.fillStyle = '#dcd6cd';
      g.beginPath(); g.moveTo(46, h); g.lineTo(46, 156); g.arc(w / 2, 156, w / 2 - 46, Math.PI, 0); g.lineTo(w - 46, h); g.closePath(); g.fill();
      glassPanel(g, w * 0.3, h * 0.45, w * 0.4, h * 0.55, 30);
    });
    for (const dz of [-7, 7]) {
      const a = new THREE.Mesh(new THREE.BoxGeometry(2.4, 11, 7), [lambert('#f1ebe3'), lambert('#f1ebe3'), lambert('#e6e0d7'), lambert('#e6e0d7'), lambert('#f1ebe3'), lambert('#f1ebe3')]);
      a.material[dir > 0 ? 0 : 1] = new THREE.MeshLambertMaterial({ map: archTex });
      a.position.set(front + dir * 1.2, 5.5, bd.z + dz);
      a.castShadow = true;
      scene.add(a);
      colliders.push({ minX: a.position.x - 1.2, maxX: a.position.x + 1.2, minZ: a.position.z - 3.5, maxZ: a.position.z + 3.5, h: 11 });
    }
    const steps = new THREE.Mesh(new THREE.BoxGeometry(3, 0.5, 22), lambert('#d9cfbf'));
    steps.position.set(front + dir * 3.6, 0.25, bd.z);
    scene.add(steps);
  }

  if (bd.name && bd.labelSide) {
    const s = { s: [0, 1], n: [0, -1], e: [1, 0], w: [-1, 0] }[bd.labelSide];
    const half = s[0] ? bd.w / 2 : bd.d / 2;
    const small = bd.h < 7;
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(small ? 6 : 10, small ? 0.9 : 1.6), new THREE.MeshBasicMaterial({ map: labelTexture(bd.name) }));
    const sy = small ? bd.h - 0.55 : Math.min(5.4, bd.h - 2);
    sign.position.set(bd.x + s[0] * (half + 0.06), sy, bd.z + s[1] * (half + 0.06));
    sign.rotation.y = Math.atan2(s[0], s[1]);
    scene.add(sign);
    if (bd.special !== 'arches') {
      const door = new THREE.Mesh(new THREE.BoxGeometry(3.6, 2.9, 0.3), new THREE.MeshLambertMaterial({ color: '#3d6680', emissive: '#10263a', emissiveIntensity: 0.4 }));
      door.position.set(bd.x + s[0] * half, 1.45, bd.z + s[1] * half);
      door.rotation.y = sign.rotation.y;
      scene.add(door);
      if (!small) {
        const canopy = new THREE.Mesh(new THREE.BoxGeometry(6, 0.3, 2), lambert('#555a60'));
        canopy.position.set(bd.x + s[0] * (half + 1), 3.4, bd.z + s[1] * (half + 1));
        canopy.rotation.y = sign.rotation.y;
        canopy.castShadow = true;
        scene.add(canopy);
      }
    }
  }
}

/**
 * "I ❤ BEU" — fotolardakı kimi: qalın, ağ, yumru kənarlı 3D hərflər, qırmızı ürək,
 * hamısı alçaq daş postament üstündə düz dayanır.
 */
function buildLetters(scene, L, colliders) {
  const H = 1.75;   // hərf hündürlüyü
  const T = 0.32;   // hərf xəttinin qalınlığı
  const shapes = [];

  // I
  const I = new THREE.Shape();
  roundedRect(I, 0, 0, 0.42, H, 0.08);
  shapes.push({ shape: I, w: 0.42 });

  // ❤ (ucu aşağıda)
  const hw = 1.38, hh = 1.5;
  const heart = new THREE.Shape();
  heart.moveTo(hw / 2, 0);
  heart.bezierCurveTo(hw * 0.38, hh * 0.18, 0, hh * 0.42, 0, hh * 0.7);
  heart.bezierCurveTo(0, hh * 0.92, hw * 0.14, hh, hw * 0.27, hh);
  heart.bezierCurveTo(hw * 0.4, hh, hw / 2, hh * 0.92, hw / 2, hh * 0.8);
  heart.bezierCurveTo(hw / 2, hh * 0.92, hw * 0.6, hh, hw * 0.73, hh);
  heart.bezierCurveTo(hw * 0.86, hh, hw, hh * 0.92, hw, hh * 0.7);
  heart.bezierCurveTo(hw, hh * 0.42, hw * 0.62, hh * 0.18, hw / 2, 0);
  shapes.push({ shape: heart, w: hw, red: true });

  // B — iki qövs və iki deşik
  const r1 = H * 0.25, bx = 0.5;
  const B = new THREE.Shape();
  B.moveTo(0, 0);
  B.lineTo(0, H);
  B.lineTo(bx, H);
  B.absarc(bx, H - r1, r1, Math.PI / 2, -Math.PI / 2, true);
  B.absarc(bx + 0.06, r1, r1, Math.PI / 2, -Math.PI / 2, true);
  B.lineTo(0, 0);
  // deşiklər: orta xətt də digər xətlər qədər (T) qalın olsun
  for (const [yb, yt, cx] of [[H / 2 + T / 2, H - T, 0.44], [T, H / 2 - T / 2, 0.5]]) {
    const rho = (yt - yb) / 2;
    const hole = new THREE.Path();
    hole.moveTo(T, yb);
    hole.lineTo(cx, yb);
    hole.absarc(cx, yb + rho, rho, -Math.PI / 2, Math.PI / 2, false);
    hole.lineTo(T, yt);
    hole.lineTo(T, yb);
    B.holes.push(hole);
  }
  shapes.push({ shape: B, w: bx + 0.06 + r1 });

  // E
  const ew = 0.95;
  const E = new THREE.Shape();
  [[0, 0], [ew, 0], [ew, T], [T, T], [T, H / 2 - T / 2], [ew * 0.86, H / 2 - T / 2], [ew * 0.86, H / 2 + T / 2],
    [T, H / 2 + T / 2], [T, H - T], [ew, H - T], [ew, H], [0, H]].forEach(([x, y], i) => (i ? E.lineTo(x, y) : E.moveTo(x, y)));
  shapes.push({ shape: E, w: ew });

  // U
  const uw = 1.05, ur = uw / 2;
  const U = new THREE.Shape();
  U.moveTo(0, H);
  U.lineTo(0, ur);
  U.absarc(ur, ur, ur, Math.PI, 0, false);
  U.lineTo(uw, H);
  U.lineTo(uw - T, H);
  U.lineTo(uw - T, ur);
  U.absarc(ur, ur, ur - T, 0, Math.PI, true);
  U.lineTo(T, H);
  U.lineTo(0, H);
  shapes.push({ shape: U, w: uw });

  const extrude = { depth: 0.34, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.045, bevelSegments: 3, curveSegments: 14 };
  const white = new THREE.MeshLambertMaterial({ color: '#f4f4f2' });
  const red = new THREE.MeshLambertMaterial({ color: '#d0202e' });
  const gap = 0.14;
  const total = shapes.reduce((s, o) => s + o.w, 0) + gap * (shapes.length - 1);
  const grp = new THREE.Group();
  let x = -total / 2;
  for (const o of shapes) {
    const geo = new THREE.ExtrudeGeometry(o.shape, extrude);
    geo.translate(0, 0, -0.17);
    const m = new THREE.Mesh(geo, o.red ? red : white);
    // ürək bir az aşağıda və hərflərdən bir az kiçikdir (fotodakı kimi)
    m.position.set(x, o.red ? 0.3 : 0.3, 0);
    m.castShadow = m.receiveShadow = true;
    grp.add(m);
    x += o.w + gap;
  }
  // alçaq ağ daş postament
  const base = new THREE.Mesh(new THREE.BoxGeometry(total + 0.8, 0.3, 1.1), new THREE.MeshLambertMaterial({ color: '#e6e3dc' }));
  base.position.y = 0.15;
  base.castShadow = base.receiveShadow = true;
  grp.add(base);
  grp.position.set(L.x, 0, L.z);
  grp.rotation.y = L.ry ?? 0;   // 180°: hərflər girişə (-z) baxır, soldan sağa -x boyunca oxunur
  scene.add(grp);
  // toqquşma (qrup fırlanmış ola bilər — dünya koordinatında qutu)
  const halfL = (total + 0.8) / 2, halfD = 0.55;
  const along = Math.abs(Math.sin(grp.rotation.y)) > 0.5;
  colliders.push(along
    ? { minX: L.x - halfD, maxX: L.x + halfD, minZ: L.z - halfL, maxZ: L.z + halfL, h: 2.1 }
    : { minX: L.x - halfL, maxX: L.x + halfL, minZ: L.z - halfD, maxZ: L.z + halfD, h: 2.1 });
}

function roundedRect(shape, x, y, w, h, r) {
  shape.moveTo(x + r, y);
  shape.lineTo(x + w - r, y);
  shape.quadraticCurveTo(x + w, y, x + w, y + r);
  shape.lineTo(x + w, y + h - r);
  shape.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  shape.lineTo(x + r, y + h);
  shape.quadraticCurveTo(x, y + h, x, y + h - r);
  shape.lineTo(x, y + r);
  shape.quadraticCurveTo(x, y, x + r, y);
}

// ======================= Kampusdan kənar =======================

function buildTowers(scene, campus, R) {
  for (const t of campus.towers || []) {
    const style = t.style === 'concrete' ? 'concrete' : 'resi';
    const floors = Math.round(t.h / 3.1);
    const base = facadeTexture(style, { color: style === 'resi' ? ['#e7dccb', '#efe7da', '#e2d3bd'][Math.floor(R() * 3)] : null }, floors, 6, R);
    const mat = new THREE.MeshLambertMaterial({ map: base });
    const roof = lambert(style === 'resi' ? '#4b3a30' : '#4a4d52');
    const w = 22, d = 22;
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, t.h, d), [mat, mat, roof, roof, mat, mat]);
    m.position.set(t.x, t.h / 2, t.z);
    m.castShadow = true;
    scene.add(m);
    if (style === 'resi') {
      const top = new THREE.Mesh(new THREE.BoxGeometry(w + 0.8, 1.2, d + 0.8), lambert('#4b3a30'));
      top.position.set(t.x, t.h + 0.6, t.z);
      scene.add(top);
      const base2 = new THREE.Mesh(new THREE.BoxGeometry(w + 6, 4.5, d + 6), lambert('#b9a48e'));
      base2.position.set(t.x, 2.25, t.z);
      scene.add(base2);
    }
  }
}

function buildCrane(scene, c) {
  const yellow = lambert('#e0a11b');
  const mast = new THREE.Mesh(new THREE.BoxGeometry(1.6, c.h, 1.6), yellow);
  mast.position.set(c.x, c.h / 2, c.z);
  mast.castShadow = true;
  scene.add(mast);
  const top = new THREE.Group();
  top.position.set(c.x, c.h, c.z);
  const jib = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.1, 42), yellow);
  jib.position.set(0, 0.6, 16);
  const counter = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.1, 12), yellow);
  counter.position.set(0, 0.6, -10);
  const weight = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2, 3), lambert('#7a7d82'));
  weight.position.set(0, -0.2, -14);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), lambert('#e9e9e9'));
  cab.position.set(1.6, -0.6, 0.5);
  const peak = new THREE.Mesh(new THREE.ConeGeometry(0.8, 6, 4), yellow);
  peak.position.set(0, 4, 0);
  const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 18, 4), lambert('#222'));
  cable.position.set(0, -8.4, 28);
  const hook = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), lambert('#333'));
  hook.position.set(0, -17.4, 28);
  top.add(jib, counter, weight, cab, peak, cable, hook);
  top.traverse((o) => { o.castShadow = true; });
  mergeGroup(top);
  markDynamic(top);
  scene.add(top);
  return top;
}

function buildHouses(scene, h, R) {
  if (!h) return;
  const walls = [], roofs = [];
  for (let tries = 0; tries < h.count * 6 && walls.length < h.count; tries++) {
    const x = h.minX + R() * (h.maxX - h.minX), z = h.minZ + R() * (h.maxZ - h.minZ);
    const a = h.avoid;
    if (a && x > a.minX - 15 && x < a.maxX + 15 && z > a.minZ - 15 && z < a.maxZ + 15) continue;
    const w = 7 + R() * 6, d = 7 + R() * 6, ht = 4 + R() * 4;
    walls.push({ x, z, w, d, ht, c: ['#efe3cf', '#e8d8c3', '#f2ece1', '#dccbb4'][Math.floor(R() * 4)] });
    roofs.push({ x, z, w, d, y: ht, c: ['#b5452e', '#a43d2a', '#c25a3c'][Math.floor(R() * 3)] });
  }
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  const wm = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), lambert('#ffffff'), walls.length);
  walls.forEach((o, i) => {
    dummy.position.set(o.x, o.ht / 2, o.z); dummy.scale.set(o.w, o.ht, o.d); dummy.rotation.set(0, 0, 0); dummy.updateMatrix();
    wm.setMatrixAt(i, dummy.matrix); wm.setColorAt(i, col.set(o.c));
  });
  const roofGeo = new THREE.ConeGeometry(0.75, 1, 4);
  roofGeo.rotateY(Math.PI / 4);
  const rm = new THREE.InstancedMesh(roofGeo, new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true }), roofs.length);
  roofs.forEach((o, i) => {
    dummy.position.set(o.x, o.y + 1.4, o.z); dummy.scale.set(o.w, 2.8, o.d); dummy.updateMatrix();
    rm.setMatrixAt(i, dummy.matrix); rm.setColorAt(i, col.set(o.c));
  });
  wm.castShadow = rm.castShadow = true;
  scene.add(wm, rm);
}

function buildHighway(scene, hw, R) {
  const len = hw.maxX - hw.minX;
  const geo = new THREE.PlaneGeometry(hw.w, len);
  geo.rotateX(-Math.PI / 2);
  const road = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: repeatTex(roadTexture(), 2, len / 12) }));
  road.rotation.y = Math.PI / 2;
  road.position.set((hw.minX + hw.maxX) / 2, 0.04, hw.z);
  road.receiveShadow = true;
  scene.add(road);
  const cars = [];
  for (let i = 0; i < 12; i++) {
    const dir = i % 2 ? 1 : -1;
    const car = mergeGroup(makeCar(CAR_COLORS[Math.floor(R() * CAR_COLORS.length)], true));
    markDynamic(car);
    car.position.set(hw.minX + R() * len, 0, hw.z + dir * 2.5);
    car.rotation.y = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    Object.assign(car.userData, { dir, speed: 12 + R() * 8 });
    scene.add(car);
    cars.push(car);
  }
  return (dt) => {
    for (const c of cars) {
      c.position.x += c.userData.dir * c.userData.speed * dt;
      if (c.position.x > hw.maxX) c.position.x = hw.minX;
      if (c.position.x < hw.minX) c.position.x = hw.maxX;
    }
  };
}

// ======================= Ağaclar (instanced) =======================

function plantTrees(scene, campus, edges, blocked, circles, R) {
  const trunks = [], blobs = [], cones = [];
  const greens = ['#3f7d3a', '#4d8f42', '#5a9c4a', '#356f34', '#6aa84f'];
  const darks = ['#2f5a32', '#2c5030', '#365f36', '#28492b'];
  const add = (type, x, z, s) => {
    if (type === 'pine') {
      trunks.push([x, z, 0.9 * s, 2.2 * s]);
      const c = darks[Math.floor(R() * darks.length)];
      cones.push([x, 1.6 * s, z, 2 * s, 2.8 * s, c], [x, 3.1 * s, z, 1.5 * s, 2.4 * s, c], [x, 4.4 * s, z, 0.95 * s, 2 * s, c]);
    } else if (type === 'cypress') {
      trunks.push([x, z, 0.6 * s, 0.9 * s]);
      cones.push([x, 0.5 * s, z, 0.95 * s, 6.5 * s, darks[Math.floor(R() * darks.length)]]);
    } else if (type === 'juniper') {
      blobs.push([x, 1.1 * s, z, 1.5 * s, 1.2 * s, darks[Math.floor(R() * darks.length)]]);
    } else {
      trunks.push([x, z, 1 * s, 2.2 * s]);
      const c = greens[Math.floor(R() * greens.length)];
      blobs.push([x, 3.2 * s, z, 1.8 * s, 1.6 * s, c]);
      for (let k = 0; k < 2; k++) blobs.push([x + (R() - 0.5) * 2 * s, 3.6 * s + R() * s, z + (R() - 0.5) * 2 * s, 1.15 * s, 1.05 * s, c]);
    }
    circles.push({ x, z, r: type === 'juniper' ? 1.2 * s : 0.4 * s });
  };
  const tryAdd = (type, x, z, s, margin = 1.5) => {
    if (blocked(x, z, margin)) return false;
    add(type, x, z, s);
    return true;
  };

  // yolların kənarında cərgələr (fotolardakı kimi şam və sərv)
  edges.forEach((e, idx) => {
    if (!e.road) return;
    const len = Math.hypot(e.x2 - e.x1, e.z2 - e.z1);
    const ux = (e.x2 - e.x1) / len, uz = (e.z2 - e.z1) / len;
    const type = idx % 3 === 0 ? 'cypress' : 'pine';
    for (let d = 6; d < len - 4; d += 10) {
      for (const sd of [-1, 1]) {
        if (R() < 0.2) continue;
        const off = 9.5 + R() * 1.5;
        tryAdd(R() < 0.75 ? type : 'round', e.x1 + ux * d - uz * off * sd, e.z1 + uz * d + ux * off * sd, 0.85 + R() * 0.35, 1);
      }
    }
  });
  // bağlarda sıx ağaclar
  for (const a of campus.areas || []) {
    if (a.type !== 'garden') continue;
    let n = Math.round((a.w * a.d) / 70);
    const types = ['cypress', 'pine', 'round', 'juniper', 'juniper'];
    for (let i = 0; i < 300 && n > 0; i++) {
      if (tryAdd(types[Math.floor(R() * types.length)], a.x + (R() - 0.5) * (a.w - 3), a.z + (R() - 0.5) * (a.d - 3), 0.7 + R() * 0.4, 1.2)) n--;
    }
  }
  // çəmənlikdə səpələnmiş ağaclar
  for (const a of campus.areas || []) {
    if (a.type !== 'meadow') continue;
    let n = Math.round((a.w * a.d) / 1400);
    for (let i = 0; i < n * 4 && n > 0; i++) {
      if (tryAdd(R() < 0.5 ? 'pine' : R() < 0.5 ? 'round' : 'juniper', a.x + (R() - 0.5) * a.w, a.z + (R() - 0.5) * a.d, 0.7 + R() * 0.6, 2)) n--;
    }
  }
  // hasar boyunca sərv cərgəsi
  const b = campus.bounds;
  for (const [x1, z1, x2, z2] of [[b.minX + 5, b.maxZ - 5, b.maxX - 5, b.maxZ - 5], [b.minX + 5, b.minZ + 5, b.minX + 5, b.maxZ - 5], [b.maxX - 6, b.minZ + 5, b.maxX - 6, b.maxZ - 5]]) {
    const len = Math.hypot(x2 - x1, z2 - z1);
    for (let d = 0; d < len; d += 9) tryAdd('cypress', x1 + ((x2 - x1) * d) / len, z1 + ((z2 - z1) * d) / len, 0.8 + R() * 0.3, 1);
  }
  // ümumi ərazidə əlavə ağaclar
  for (let i = 0, n = 0; i < 600 && n < 120; i++) {
    if (tryAdd(R() < 0.4 ? 'round' : 'pine', b.minX + R() * (b.maxX - b.minX), b.minZ + R() * (b.maxZ - b.minZ), 0.8 + R() * 0.5, 3)) n++;
  }

  // instanced meshlər
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  const trunkGeo = new THREE.CylinderGeometry(0.16, 0.26, 1, 6);
  trunkGeo.translate(0, 0.5, 0);
  const tm = new THREE.InstancedMesh(trunkGeo, lambert('#6b4a2b'), trunks.length);
  trunks.forEach(([x, z, s, h], i) => {
    dummy.position.set(x, 0, z); dummy.scale.set(s, h, s); dummy.rotation.set(0, 0, 0); dummy.updateMatrix();
    tm.setMatrixAt(i, dummy.matrix);
  });
  const blobGeo = new THREE.IcosahedronGeometry(1, 1);
  const bm = new THREE.InstancedMesh(blobGeo, new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true }), blobs.length);
  blobs.forEach(([x, y, z, r, ry, c], i) => {
    dummy.position.set(x, y, z); dummy.scale.set(r, ry, r); dummy.rotation.set(0, (x * 7 + z) % 6, 0); dummy.updateMatrix();
    bm.setMatrixAt(i, dummy.matrix); bm.setColorAt(i, col.set(c));
  });
  const coneGeo = new THREE.ConeGeometry(1, 1, 7);
  coneGeo.translate(0, 0.5, 0);
  const cm = new THREE.InstancedMesh(coneGeo, new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true }), cones.length);
  cones.forEach(([x, y, z, r, h, c], i) => {
    dummy.position.set(x, y, z); dummy.scale.set(r, h, r); dummy.rotation.set(0, (x * 3 + z) % 6, 0); dummy.updateMatrix();
    cm.setMatrixAt(i, dummy.matrix); cm.setColorAt(i, col.set(c));
  });
  for (const m of [tm, bm, cm]) { m.castShadow = true; m.receiveShadow = true; scene.add(m); }
}

// ======================= Dar ağacı =======================

/** Dar ağacı məhkumunun yeri (server də eyni hesablamanı edir) */
export function gallowsSlot(g, i) {
  return { x: g.x + (i - (g.slots - 1) / 2) * g.slotGap, y: g.platformH, z: g.z };
}

function buildGallows(scene, g, colliders) {
  const wood = new THREE.MeshLambertMaterial({ color: '#7a5230' });
  const woodDark = new THREE.MeshLambertMaterial({ color: '#5a3a20' });
  const rope = new THREE.MeshLambertMaterial({ color: '#c8a96a' });
  const grp = new THREE.Group();
  grp.position.set(g.x, 0, g.z);
  scene.add(grp);
  const box = (w, h, d, m, x, y, z, rz = 0) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    b.position.set(x, y, z);
    b.rotation.z = rz;
    b.castShadow = b.receiveShadow = true;
    grp.add(b);
    return b;
  };
  const H = g.platformH;
  const W = g.slots * g.slotGap + 1.2, D = 3.2;
  box(W, H, D, wood, 0, H / 2, 0);
  for (let i = 0; i < 9; i++) box(W + 0.02, 0.02, 0.05, woodDark, 0, H + 0.005, -D / 2 + 0.2 + i * 0.35);
  for (let i = 0; i < g.slots; i++) {
    const s = gallowsSlot({ ...g, x: 0, z: 0 }, i);
    box(1.1, 0.03, 1.1, woodDark, s.x, H + 0.01, 0);
  }
  const steps = 4;
  for (let i = 0; i < steps; i++) {
    const h = (H * (i + 1)) / steps;
    box(2, h, 0.45, wood, 0, h / 2, D / 2 + 0.45 * (steps - i) - 0.2);
  }
  const postH = 3.6;
  for (const sx of [-1, 1]) {
    box(0.32, postH, 0.32, woodDark, sx * (W / 2 - 0.3), H + postH / 2, -0.2);
    box(0.16, 1.3, 0.16, woodDark, sx * (W / 2 - 0.75), H + postH - 0.55, -0.2, sx * 0.785);
  }
  const beamY = H + postH - 0.12;
  box(W - 0.1, 0.3, 0.3, woodDark, 0, beamY, -0.2);
  for (let i = 0; i < g.slots; i++) {
    const s = gallowsSlot({ ...g, x: 0, z: 0 }, i);
    const topY = beamY - 0.15, loopY = H + 1.55;
    const len = topY - loopY;
    const r = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, len, 6), rope);
    r.position.set(s.x, loopY + len / 2, -0.16);
    grp.add(r);
    const loop = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.03, 6, 14), rope);
    loop.position.set(s.x, loopY - 0.05, -0.03);
    loop.rotation.x = Math.PI / 2 - 0.4;
    grp.add(loop);
  }
  const signTex = canvasTex(512, 128, (c, w, h) => {
    c.fillStyle = '#3b2412'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#c8a96a'; c.lineWidth = 8; c.strokeRect(6, 6, w - 12, h - 12);
    c.fillStyle = '#f0d9a8'; c.font = 'bold 64px Georgia, serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('DAR AĞACI', w / 2, h / 2 + 4);
  });
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.65), new THREE.MeshLambertMaterial({ map: signTex }));
  sign.position.set(0, beamY + 0.55, -0.04);
  grp.add(sign);
  box(0.1, 0.5, 0.1, woodDark, -0.9, beamY + 0.3, -0.2);
  box(0.1, 0.5, 0.1, woodDark, 0.9, beamY + 0.3, -0.2);
  colliders.push({ minX: g.x - W / 2, maxX: g.x + W / 2, minZ: g.z - D / 2, maxZ: g.z + D / 2, h: H + postH });
  colliders.push({ minX: g.x - 1, maxX: g.x + 1, minZ: g.z + D / 2, maxZ: g.z + D / 2 + 0.45 * steps, h: H });
}

// ======================= Toqquşma =======================

/** Oyunçunu binalardan, ağaclardan, sərhəddən kənarda saxlayır */
export function resolveCollisions(pos, radius, world) {
  const b = world.bounds;
  pos.x = Math.min(b.maxX - radius - 0.3, Math.max(b.minX + radius + 0.3, pos.x));
  pos.z = Math.min(b.maxZ - radius - 0.3, Math.max(b.minZ + radius + 0.3, pos.z));
  for (const c of world.colliders) {
    if (pos.y >= c.h) continue;
    const cx = Math.max(c.minX, Math.min(pos.x, c.maxX));
    const cz = Math.max(c.minZ, Math.min(pos.z, c.maxZ));
    const dx = pos.x - cx, dz = pos.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 < radius * radius) {
      if (d2 > 1e-6) {
        const d = Math.sqrt(d2);
        pos.x = cx + (dx / d) * radius;
        pos.z = cz + (dz / d) * radius;
      } else {
        const pushes = [[c.minX - radius - pos.x, 0], [c.maxX + radius - pos.x, 0], [0, c.minZ - radius - pos.z], [0, c.maxZ + radius - pos.z]];
        pushes.sort((p, q) => Math.abs(p[0] + p[1]) - Math.abs(q[0] + q[1]));
        pos.x += pushes[0][0];
        pos.z += pushes[0][1];
      }
    }
  }
  for (const c of world.circles) {
    const dx = pos.x - c.x, dz = pos.z - c.z;
    const d = Math.hypot(dx, dz);
    const min = c.r + radius;
    if (d < min && d > 1e-6) {
      pos.x = c.x + (dx / d) * min;
      pos.z = c.z + (dz / d) * min;
    }
  }
}
