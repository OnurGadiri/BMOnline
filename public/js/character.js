// Stilizə edilmiş xarakter modeli (toon shading).
// Görünüş (appearance) obyektindən 3D model + animasiya skeleti qurur.
import * as THREE from 'three';
import { bakeGeometry, mergeGeometries } from './merge.js';

let DEFAULTS = {};
export function setCharacterDefaults(d) { DEFAULTS = { ...d }; }

// ---------------- Materiallar ----------------
const toonGradient = (() => {
  const t = new THREE.DataTexture(new Uint8Array([110, 190, 255]), 3, 1, THREE.RedFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
})();
const matCache = new Map();
function mat(color, opacity = 1) {
  const k = color + '|' + opacity;
  if (!matCache.has(k)) {
    matCache.set(k, new THREE.MeshToonMaterial({
      color, gradientMap: toonGradient, transparent: opacity < 1, opacity, depthWrite: opacity >= 1,
    }));
  }
  return matCache.get(k);
}
function shade(hex, amt) {
  const c = new THREE.Color(hex);
  if (amt >= 0) c.lerp(new THREE.Color('#ffffff'), amt);
  else c.multiplyScalar(1 + amt);
  return '#' + c.getHexString();
}

// Paltar üzərində naxış (yalnız ön tərəf, zolaqlı isə hər tərəf)
const patternCache = new Map();
function patternMat(base, ink, pattern) {
  const k = `${base}|${ink}|${pattern}`;
  if (patternCache.has(k)) return patternCache.get(k);
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, 128, 128);
  g.fillStyle = ink; g.strokeStyle = ink;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  switch (pattern) {
    case 'stripes':
      for (let y = 6; y < 128; y += 26) g.fillRect(0, y, 128, 11);
      break;
    case 'logo':
      g.font = 'bold 40px system-ui, sans-serif';
      g.fillText('BMU', 64, 58);
      g.fillRect(30, 82, 68, 5);
      break;
    case 'number':
      g.font = 'bold 64px system-ui, sans-serif';
      g.fillText('07', 64, 66);
      break;
    case 'star': {
      g.beginPath();
      for (let i = 0; i < 10; i++) {
        const ang = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 14 : 34;
        g.lineTo(64 + Math.cos(ang) * r, 62 + Math.sin(ang) * r);
      }
      g.fill();
      break;
    }
    case 'heart':
      g.beginPath();
      g.moveTo(64, 92);
      g.bezierCurveTo(20, 62, 36, 26, 64, 46);
      g.bezierCurveTo(92, 26, 108, 62, 64, 92);
      g.fill();
      break;
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.MeshToonMaterial({ color: '#ffffff', map: t, gradientMap: toonGradient });
  patternCache.set(k, m);
  return m;
}

// ---------------- Həndəsə ----------------
const geoCache = new Map();
function cached(k, make) {
  if (!geoCache.has(k)) geoCache.set(k, make());
  return geoCache.get(k);
}
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Yumru künclü qutu; tt/tb — üst/alt enin nisbəti (konusvari forma üçün) */
function roundBox(w, h, d, r = 0.03, tt = 1, tb = 1) {
  return cached(`rb|${w.toFixed(3)}|${h.toFixed(3)}|${d.toFixed(3)}|${r}|${tt.toFixed(3)}|${tb.toFixed(3)}`, () => {
    r = Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3);
    const g = new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
    const p = g.attributes.position, n = g.attributes.normal;
    const half = [w / 2, h / 2, d / 2], inner = [w / 2 - r, h / 2 - r, d / 2 - r];
    const v = new THREE.Vector3(), c = new THREE.Vector3(), dir = new THREE.Vector3();
    const remap = (u, i) => {
      const s = Math.sign(u), a = Math.abs(u);
      return s * (a <= 0.25 ? (a / 0.25) * inner[i] : inner[i] + ((a - 0.25) / 0.25) * (half[i] - inner[i]));
    };
    for (let i = 0; i < p.count; i++) {
      v.set(remap(p.getX(i), 0), remap(p.getY(i), 1), remap(p.getZ(i), 2));
      c.set(clamp(v.x, -inner[0], inner[0]), clamp(v.y, -inner[1], inner[1]), clamp(v.z, -inner[2], inner[2]));
      dir.subVectors(v, c);
      if (dir.lengthSq() < 1e-12) dir.set(n.getX(i), n.getY(i), n.getZ(i));
      dir.normalize();
      v.copy(c).addScaledVector(dir, r);
      const t = (v.y + h / 2) / h;
      v.x *= tb + (tt - tb) * t;
      p.setXYZ(i, v.x, v.y, v.z);
      n.setXYZ(i, dir.x, dir.y, dir.z);
    }
    g.computeBoundingSphere();
    return g;
  });
}
const capsule = (r, len) => cached(`cap|${r.toFixed(3)}|${len.toFixed(3)}`, () => new THREE.CapsuleGeometry(r, Math.max(0.001, len - 2 * r), 3, 10));
const sphere = (r) => cached(`sph|${r.toFixed(3)}`, () => new THREE.SphereGeometry(r, 12, 9));
const cyl = (rt, rb, h, s = 12) => cached(`cyl|${rt.toFixed(3)}|${rb.toFixed(3)}|${h.toFixed(3)}|${s}`, () => new THREE.CylinderGeometry(rt, rb, h, s));
const torus = (r, t) => cached(`tor|${r}|${t}`, () => new THREE.TorusGeometry(r, t, 6, 18));
const cone = (r, h) => cached(`cone|${r}|${h}`, () => new THREE.ConeGeometry(r, h, 6));

function add(parent, geo, material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = true;
  parent.add(m);
  return m;
}
function group(parent, x = 0, y = 0, z = 0) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

// ---------------- Xarakter ----------------
export function buildCharacter(input) {
  const a = { ...DEFAULTS, ...input };
  const fem = a.body === 'f';
  const W = a.build, M = a.muscle, L = a.legLen;

  const root = new THREE.Group();
  root.rotation.order = 'YXZ'; // yıxılma (x) xarakterin öz istiqamətində olsun
  const body = group(root);
  body.scale.setScalar(a.height);

  const skin = mat(a.skin), skinShade = mat(shade(a.skin, -0.12));
  const hairM = mat(a.hairColor);
  const topM = mat(a.topColor), top2M = mat(a.topColor2);
  const botM = mat(a.bottomColor), accM = mat(a.accColor), shoeM = mat(a.shoes);
  const gold = mat('#e8c15a'), black = mat('#141414'), white = mat('#ffffff');

  const isDress = a.top === 'dress';
  const sleeves = { tank: 0, tshirt: 1, dress: fem ? 0 : 1 }[a.top] ?? 2; // 0 yoxdur, 1 qısa, 2 uzun
  const usePattern = a.pattern !== 'plain' && a.top !== 'jacket';

  // ---- Ölçülər (kişi və qadın arasında aydın fərq) ----
  const thighLen = (fem ? 0.46 : 0.44) * L, shinLen = (fem ? 0.43 : 0.42) * L;
  const ankleY = 0.06;
  const hipY = ankleY + thighLen + shinLen;
  // Çəki (W) əsasən bel, qarın, omba və əzaların qalınlığına təsir edir — çiyin eni demək olar ki, dəyişmir
  const thighR = (fem ? 0.088 : 0.08) * Math.pow(W, 0.9) * (1 + 0.12 * M);
  const shinR = (fem ? 0.06 : 0.066) * Math.pow(W, 0.7) * (1 + 0.1 * M);
  const hipW = (fem ? 0.38 : 0.32) * Math.pow(W, 0.8);
  const legX = hipW / 2 - thighR * 0.9;
  const torsoH = fem ? 0.48 : 0.54;
  const shoulderW = (fem ? 0.33 : 0.44 + 0.08 * M) * Math.pow(W, 0.15);
  const waistW = (fem ? 0.25 : 0.34) * Math.pow(W, 1.5);
  const depth = (fem ? 0.2 : 0.23) * (0.6 + 0.4 * W) * (1 + 0.12 * M);
  const belly = Math.max(0, W - 1.02); // dolu bədəndə qarın

  // ---- Ayaqlar ----
  const legUpper = isDress || a.bottom.includes('skirt') ? skin : botM;
  const legLower = a.bottom === 'jeans' || a.bottom === 'pants' ? (isDress ? skin : botM) : skin;
  const legs = [], knees = [];
  for (const side of [1, -1]) {
    const hip = group(body, side * legX, hipY, 0);
    add(hip, capsule(thighR, thighLen + thighR), legUpper, 0, -thighLen / 2, 0);
    const knee = group(hip, 0, -thighLen, 0);
    add(knee, capsule(shinR, shinLen + shinR * 0.6), legLower, 0, -shinLen / 2, 0);
    if (a.bottom === 'jeans' && !isDress) add(knee, cyl(shinR * 1.12, shinR * 1.15, 0.05, 10), mat(shade(a.bottomColor, 0.25)), 0, -shinLen + 0.06, 0);
    if (a.bottom === 'shorts' && !isDress) add(hip, cyl(thighR * 1.15, thighR * 1.2, 0.22, 10), botM, 0, -thighLen * 0.55, 0);
    const foot = group(knee, 0, -shinLen, 0.0);
    buildShoe(foot, a, shoeM, fem);
    legs.push(hip); knees.push(knee);
  }

  // ---- Omba ----
  const hipsMat = isDress ? topM : botM;
  add(body, roundBox(hipW, 0.18, depth * 1.02, 0.07), hipsMat, 0, hipY, 0);
  if (!isDress && a.bottom !== 'skirt' && a.bottom !== 'longskirt') {
    add(body, roundBox(hipW * 1.01, 0.035, depth * 1.04, 0.015), mat(shade(a.bottomColor, -0.35)), 0, hipY + 0.07, 0); // kəmər
  }
  if (a.bottom === 'skirt' && !isDress) add(body, cyl(hipW * 0.55, hipW * 0.82, 0.3, 12), botM, 0, hipY - 0.1, 0);
  if (a.bottom === 'longskirt' && !isDress) add(body, cyl(hipW * 0.55, hipW * 0.9, thighLen + shinLen * 0.7, 12), botM, 0, hipY - (thighLen + shinLen * 0.7) / 2 + 0.06, 0);
  if (isDress) add(body, cyl(hipW * 0.55, hipW * (fem ? 0.95 : 0.8), thighLen * 1.05, 12), topM, 0, hipY - thighLen * 0.5 + 0.06, 0);

  // ---- Bel / gövdə ----
  const spine = group(body, 0, hipY + 0.04, 0);
  const frontMat = usePattern ? patternMat(a.topColor, a.topColor2, a.pattern) : topM;
  const sideMat = usePattern && a.pattern === 'stripes' ? frontMat : topM;
  const torsoMats = [sideMat, sideMat, topM, topM, frontMat, sideMat];
  let chestY;
  if (fem) {
    // Qum saatı forması: dar bel, enli omba, sinə
    const lowH = torsoH * 0.45, upH = torsoH * 0.62;
    add(spine, roundBox(hipW * 0.86, lowH, depth, 0.06, waistW / (hipW * 0.86), 1), torsoMats, 0, lowH / 2, 0);
    chestY = torsoH - upH / 2;
    // sinə hissəsi daha qalın və yumru — yandan qadın siluetini verir, öndəki naxışı örtmür
    add(spine, roundBox(shoulderW, upH, depth * 1.22, 0.085, 1, waistW * 1.02 / shoulderW), torsoMats, 0, chestY, 0.012);
  } else {
    // V-forması: enli çiyin, düz bel
    chestY = torsoH / 2;
    add(spine, roundBox(shoulderW, torsoH, depth, 0.07, 1, waistW / shoulderW), torsoMats, 0, chestY, 0);
    if (M > 0.6 && a.top === 'tank') add(spine, roundBox(shoulderW * 0.7, 0.12, 0.04, 0.03), topM, 0, torsoH * 0.68, depth / 2 - 0.01);
  }
  if (belly > 0) {
    const bm = usePattern && a.pattern === 'stripes' ? frontMat : topM;
    add(spine, roundBox(waistW * 0.85, torsoH * 0.42, 0.1 + belly * 0.35, 0.05 + belly * 0.1), bm, 0, torsoH * 0.27, depth / 2 - 0.02);
  }
  const shoulderY = torsoH - 0.05;

  // Üst geyim detalları
  if (a.top === 'hoodie') {
    add(spine, roundBox(shoulderW * 0.72, 0.2, 0.12, 0.06), mat(shade(a.topColor, -0.12)), 0, torsoH + 0.02, -depth / 2 - 0.02);
    add(spine, roundBox(shoulderW * 0.55, 0.11, 0.03, 0.02), mat(shade(a.topColor, -0.1)), 0, torsoH * 0.25, depth / 2 + 0.005);
    for (const s of [-1, 1]) add(spine, roundBox(0.012, 0.14, 0.012, 0.005), white, s * 0.04, torsoH - 0.1, depth / 2 + 0.01);
  }
  if (a.top === 'jacket') {
    add(spine, roundBox(shoulderW * 0.3, torsoH * 0.92, 0.02, 0.008), top2M, 0, torsoH * 0.5, depth / 2 + 0.002);
    for (const s of [-1, 1]) {
      add(spine, roundBox(0.05, torsoH * 0.4, 0.02, 0.01), mat(shade(a.topColor, -0.15)), s * shoulderW * 0.17, torsoH * 0.74, depth / 2 + 0.01, 0, 0, s * 0.35);
    }
  }
  if (a.top === 'shirt') {
    for (const s of [-1, 1]) add(spine, roundBox(0.07, 0.04, 0.05, 0.01), mat(shade(a.topColor, 0.3)), s * 0.05, torsoH + 0.005, depth / 2 - 0.03, 0, 0, s * 0.4);
    for (let i = 0; i < 4; i++) add(spine, sphere(0.009), mat(shade(a.topColor, -0.3)), 0, torsoH - 0.07 - i * 0.1, depth / 2 + 0.005);
  }
  if (a.top === 'sweater') add(spine, torus(fem ? 0.06 : 0.075, 0.022), mat(shade(a.topColor, -0.12)), 0, torsoH + 0.005, 0, Math.PI / 2);

  // ---- Qollar ----
  const upperLen = fem ? 0.27 : 0.29, foreLen = fem ? 0.25 : 0.27;
  const upperR = (fem ? 0.045 : 0.054 + 0.018 * M) * Math.pow(W, 0.8);
  const foreR = (fem ? 0.04 : 0.047 + 0.012 * M) * Math.pow(W, 0.6);
  const arms = [], elbows = [], hands = [];
  for (const side of [1, -1]) {
    const sh = group(spine, side * (shoulderW / 2 + upperR * 0.4), shoulderY, 0);
    add(sh, sphere(upperR * 1.25), sleeves ? topM : skin, 0, -0.01, 0); // çiyin
    add(sh, capsule(upperR, upperLen + upperR), sleeves === 2 ? topM : skin, 0, -upperLen / 2, 0);
    if (sleeves === 1) add(sh, cyl(upperR * 1.3, upperR * 1.35, upperLen * 0.5, 10), topM, 0, -upperLen * 0.25, 0);
    const el = group(sh, 0, -upperLen, 0);
    add(el, capsule(foreR, foreLen + foreR), sleeves === 2 ? topM : skin, 0, -foreLen / 2, 0);
    if (a.top === 'sweater' || a.top === 'hoodie') add(el, cyl(foreR * 1.2, foreR * 1.2, 0.04, 10), mat(shade(a.topColor, -0.15)), 0, -foreLen + 0.03, 0);
    // əl
    const hand = group(el, 0, -foreLen - 0.03, 0);
    add(hand, roundBox(fem ? 0.06 : 0.075, fem ? 0.08 : 0.09, fem ? 0.045 : 0.05, 0.02), skin, 0, -0.02, 0);
    add(hand, roundBox(0.025, 0.05, 0.03, 0.01), skin, side * -0.03, -0.01, 0.025, 0, 0, side * 0.4); // baş barmaq
    arms.push(sh); elbows.push(el); hands.push(hand);
  }

  // ---- Boyun və baş ----
  const neckR = fem ? 0.045 : 0.058 + 0.012 * M;
  add(spine, cyl(neckR, neckR * 1.1, 0.12, 10), skin, 0, torsoH + 0.04, 0);
  const head = group(spine, 0, torsoH + 0.08, 0);
  head.scale.setScalar(a.headSize * (fem ? 0.95 : 1));

  const shapes = {
    oval: { w: 0.28, h: 0.33, r: 0.1, tb: 0.82 },
    round: { w: 0.31, h: 0.31, r: 0.13, tb: 0.95 },
    square: { w: 0.31, h: 0.32, r: 0.06, tb: 0.98 },
  };
  const sh = shapes[a.faceShape] || shapes.oval;
  const hw = sh.w * (fem ? 0.95 : 1), hh = sh.h, hd = 0.3;
  const jaw = sh.tb * (fem ? 0.9 : 1);
  add(head, roundBox(hw, hh, hd, sh.r, 1, jaw), skin, 0, hh / 2, 0);
  const fz = hd / 2;

  // qulaqlar
  for (const s of [-1, 1]) add(head, roundBox(0.035, 0.075, 0.055, 0.015), skin, s * (hw / 2 + 0.006), hh * 0.5, 0);

  // gözlər
  const eyes = [];
  const eyeY = hh * 0.55;
  const eyeSpec = {
    normal: { w: 0.064, h: 0.05, iw: 0.034, ih: 0.042 },
    big: { w: 0.072, h: 0.066, iw: 0.042, ih: 0.054 },
    narrow: { w: 0.07, h: 0.03, iw: 0.034, ih: 0.028 },
    sleepy: { w: 0.066, h: 0.05, iw: 0.034, ih: 0.042 },
  }[a.eyeShape];
  for (const s of [-1, 1]) {
    const ex = s * hw * 0.23;
    const eg = group(head, ex, eyeY, fz);
    add(eg, roundBox(eyeSpec.w, eyeSpec.h, 0.02, 0.012), white, 0, 0, -0.004);
    add(eg, roundBox(eyeSpec.iw, eyeSpec.ih, 0.012, 0.008), mat(a.eyes), s * -0.004, -0.002, 0.004);
    add(eg, roundBox(eyeSpec.iw * 0.45, eyeSpec.ih * 0.45, 0.01, 0.004), black, s * -0.004, -0.002, 0.009);
    add(eg, roundBox(0.01, 0.01, 0.006, 0.003), white, s * -0.012, 0.01, 0.013);
    if (a.eyeShape === 'sleepy') add(eg, roundBox(eyeSpec.w + 0.008, 0.026, 0.026, 0.01), skinShade, 0, eyeSpec.h / 2 - 0.006, 0);
    if (fem) {
      // kirpiklər
      add(eg, roundBox(eyeSpec.w + 0.01, 0.012, 0.014, 0.004), black, 0, eyeSpec.h / 2 + 0.002, 0.004, 0, 0, s * -0.1);
      add(eg, roundBox(0.022, 0.01, 0.012, 0.004), black, s * (eyeSpec.w / 2 + 0.006), eyeSpec.h / 2 + 0.008, 0.004, 0, 0, s * 0.6);
    }
    eyes.push(eg);
  }
  // qaşlar
  const browM = mat(shade(a.hairColor, -0.15));
  const brow = { thin: [0.068, 0.011], normal: [0.074, 0.02], thick: [0.084, 0.032], angry: [0.076, 0.024] }[a.brows];
  for (const s of [-1, 1]) {
    const rz = a.brows === 'angry' ? s * 0.32 : fem ? s * -0.12 : 0;
    add(head, roundBox(brow[0], brow[1], 0.016, Math.min(0.008, brow[1] / 2 - 0.001)), browM, s * hw * 0.23, eyeY + eyeSpec.h / 2 + (fem ? 0.032 : 0.026), fz + 0.004, 0, 0, rz);
  }
  // burun
  const noseM = mat(shade(a.skin, -0.06));
  const noseY = hh * 0.4;
  if (a.nose === 'pointy') add(head, cone(0.026, 0.07), noseM, 0, noseY, fz + 0.03, Math.PI / 2);
  else {
    const n = { small: [0.032, 0.036, 0.026], normal: [0.042, 0.06, 0.04], big: [0.058, 0.08, 0.056] }[a.nose];
    add(head, roundBox(n[0] * (fem ? 0.9 : 1), n[1], n[2], 0.012), noseM, 0, noseY, fz + n[2] / 2 - 0.006);
  }
  // ağız
  const mouthY = hh * 0.22;
  const lipM = fem ? mat(a.lipColor) : mat(shade(a.lipColor, -0.25));
  const dark = mat('#3a1515');
  const mz = fz + 0.006;
  switch (a.mouth) {
    case 'open':
      add(head, roundBox(0.08, 0.045, 0.012, 0.012), dark, 0, mouthY, mz);
      add(head, roundBox(0.066, 0.014, 0.012, 0.004), white, 0, mouthY + 0.011, mz + 0.002);
      if (fem) add(head, roundBox(0.086, 0.012, 0.012, 0.005), lipM, 0, mouthY - 0.026, mz);
      break;
    case 'neutral':
      add(head, roundBox(0.066, fem ? 0.02 : 0.014, 0.012, 0.005), lipM, 0, mouthY, mz);
      break;
    case 'smirk':
      add(head, roundBox(0.06, fem ? 0.02 : 0.014, 0.012, 0.005), lipM, 0.005, mouthY, mz, 0, 0, 0.18);
      break;
    default: // smile
      add(head, roundBox(0.05, fem ? 0.022 : 0.015, 0.012, 0.006), lipM, 0, mouthY - 0.004, mz);
      for (const s of [-1, 1]) add(head, roundBox(0.022, fem ? 0.018 : 0.014, 0.012, 0.005), lipM, s * 0.032, mouthY + 0.004, mz, 0, 0, s * 0.55);
  }
  if (fem && a.mouth !== 'open') add(head, roundBox(0.04, 0.014, 0.012, 0.005), mat(shade(a.lipColor, 0.12)), 0, mouthY - 0.016, mz - 0.001);
  // yanaqlar
  if (a.cheeks === 'blush') for (const s of [-1, 1]) add(head, roundBox(0.055, 0.028, 0.006, 0.01), mat('#ff7f8a', 0.5), s * hw * 0.3, hh * 0.38, fz - 0.003);
  if (a.cheeks === 'freckles') {
    const fm = mat(shade(a.skin, -0.32));
    for (const s of [-1, 1]) for (const [dx, dy] of [[0, 0], [0.018, 0.012], [0.03, -0.006], [0.012, -0.014]]) {
      add(head, roundBox(0.008, 0.008, 0.006, 0.002), fm, s * (hw * 0.22 + dx), hh * 0.42 + dy, fz - 0.002);
    }
  }
  // saqqal
  const beardM = mat(a.hairColor);
  if (a.beard === 'stubble') add(head, roundBox(hw + 0.006, hh * 0.36, hd + 0.006, sh.r * 0.8, 1, jaw), mat(a.hairColor, 0.3), 0, hh * 0.18, 0);
  if (a.beard === 'full') add(head, roundBox(hw + 0.02, hh * 0.4, hd + 0.016, sh.r * 0.8, 1, jaw), beardM, 0, hh * 0.18, -0.004);
  if (a.beard === 'goatee' || a.beard === 'full') add(head, roundBox(0.07, 0.07, 0.04, 0.02), beardM, 0, hh * 0.06, fz - 0.004);
  if (a.beard !== 'none' && a.beard !== 'stubble') add(head, roundBox(0.1, 0.026, 0.03, 0.012), beardM, 0, mouthY + 0.03, fz + 0.004);

  // ---- Saç ----
  const hatOn = a.hat === 'cap' || a.hat === 'beanie' || a.hat === 'fedora';
  const hijab = a.hat === 'hijab';
  if (!hijab) buildHair(head, a.hair, hairM, { hw, hh, hd, fz, hatOn, fem, r: sh.r });

  // ---- Baş geyimi ----
  if (hijab) {
    const hm = accM, fold = mat(shade(a.accColor, -0.14));
    // başı arxadan, yuxarıdan və yanlardan saran örtük — üz açıq qalır
    add(head, roundBox(hw + 0.06, hh + 0.08, hd + 0.02, Math.min(0.14, sh.r + 0.04), 1, Math.max(0.88, jaw)), hm, 0, hh / 2 + 0.03, -0.035);
    add(head, roundBox(hw + 0.04, 0.065, 0.045, 0.03), hm, 0, hh * 0.88, fz - 0.016); // alın xətti
    for (const s of [-1, 1]) add(head, roundBox(0.035, hh * 0.62, 0.06, 0.017), hm, s * (hw / 2 * 0.97), hh * 0.4, fz - 0.04, 0, 0, s * -0.06);
    add(head, roundBox(hw * 0.88, 0.1, hd * 0.75, 0.045), hm, 0, -0.01, -0.01); // çənə altı
    // boynu örtüb çiyinlərə düşən hissə
    add(spine, cyl(neckR + 0.075, shoulderW * 0.5, 0.25, 16), hm, 0, torsoH - 0.03, 0);
    add(spine, roundBox(shoulderW * 0.5, 0.24, 0.05, 0.02, 0.8, 1), fold, 0, torsoH - 0.12, -depth / 2 - 0.01);
    add(spine, roundBox(0.14, 0.16, 0.03, 0.015, 1, 0.6), fold, 0.04, torsoH - 0.1, depth / 2 + 0.01, 0, 0, 0.15);
  } else if (a.hat === 'cap') {
    add(head, roundBox(hw + 0.05, hh * 0.34, hd + 0.05, 0.1), accM, 0, hh * 0.88, -0.005);
    add(head, roundBox(hw * 0.9, 0.022, 0.15, 0.01), accM, 0, hh * 0.74, fz + 0.06);
    add(head, sphere(0.018), mat(shade(a.accColor, -0.2)), 0, hh * 1.05, 0);
  } else if (a.hat === 'beanie') {
    add(head, roundBox(hw + 0.055, hh * 0.46, hd + 0.055, 0.12), accM, 0, hh * 0.9, -0.005);
    add(head, roundBox(hw + 0.07, 0.065, hd + 0.07, 0.03), mat(shade(a.accColor, -0.15)), 0, hh * 0.71, -0.005);
    add(head, sphere(0.05), mat(shade(a.accColor, 0.4)), 0, hh * 1.17, 0);
  } else if (a.hat === 'fedora') {
    add(head, cyl(hw * 0.48, hw * 0.56, 0.15, 12), accM, 0, hh + 0.04, 0);
    add(head, cyl(hw * 0.98, hw * 0.98, 0.016, 18), accM, 0, hh * 0.86, 0);
    add(head, cyl(hw * 0.565, hw * 0.565, 0.035, 12), black, 0, hh * 0.9, 0);
  } else if (a.hat === 'headband') {
    add(head, roundBox(hw + 0.035, 0.04, hd + 0.035, 0.02), accM, 0, hh * 0.8, 0);
  }

  // ---- Eynək ----
  if (a.glasses !== 'none') {
    const frame = a.glasses === 'sun' ? black : mat('#1a1a1a');
    const lens = a.glasses === 'sun' ? mat('#18222c', 0.92) : mat('#bfe3ff', 0.35);
    const gz = fz + 0.03;
    for (const s of [-1, 1]) {
      const x = s * hw * 0.23;
      if (a.glasses === 'round') {
        add(head, cyl(0.046, 0.046, 0.01, 16), frame, x, eyeY, gz - 0.004, Math.PI / 2);
        add(head, cyl(0.038, 0.038, 0.012, 16), lens, x, eyeY, gz - 0.002, Math.PI / 2);
      } else {
        add(head, roundBox(0.092, 0.068, 0.01, 0.012), frame, x, eyeY, gz - 0.004);
        add(head, roundBox(0.078, 0.054, 0.012, 0.01), lens, x, eyeY, gz - 0.002);
      }
      add(head, roundBox(0.01, 0.012, hd * 0.55, 0.004), frame, s * (hw / 2 + 0.004), eyeY + 0.01, fz - hd * 0.24);
    }
    add(head, roundBox(0.04, 0.012, 0.01, 0.004), frame, 0, eyeY + 0.012, gz - 0.002);
  }

  // ---- Sırğalar ----
  if (hijab) { /* sırğalar hicabın altında görünmür */ } else if (a.earrings === 'studs') for (const s of [-1, 1]) add(head, sphere(0.014), gold, s * (hw / 2 + 0.022), hh * 0.44, 0.012);
  if (!hijab && a.earrings === 'hoops') for (const s of [-1, 1]) add(head, torus(0.026, 0.005), gold, s * (hw / 2 + 0.022), hh * 0.38, 0.01, 0, Math.PI / 2);

  // ---- Boyun aksesuarları ----
  if (a.neck === 'scarf') {
    add(spine, torus(neckR + 0.03, 0.035), accM, 0, torsoH + 0.02, 0, Math.PI / 2);
    add(spine, roundBox(0.075, 0.24, 0.035, 0.015), accM, 0.06, torsoH - 0.12, depth / 2 + 0.02, 0.1, 0, 0.08);
  } else if (a.neck === 'chain') {
    add(spine, torus(neckR + 0.04, 0.007), gold, 0, torsoH - 0.03, 0.025, Math.PI / 2 - 0.5);
    add(spine, sphere(0.02), gold, 0, torsoH - 0.1, depth / 2 + 0.008);
  } else if (a.neck === 'tie') {
    add(spine, roundBox(0.04, 0.04, 0.02, 0.008), accM, 0, torsoH - 0.03, depth / 2 + 0.008);
    add(spine, roundBox(0.06, 0.28, 0.015, 0.008, 0.65, 1), accM, 0, torsoH - 0.2, depth / 2 + 0.012);
  }

  // ---- Çanta ----
  if (a.bag === 'backpack') {
    add(spine, roundBox(shoulderW * 0.78, torsoH * 0.72, 0.15, 0.05), accM, 0, torsoH * 0.5, -depth / 2 - 0.07);
    add(spine, roundBox(shoulderW * 0.55, torsoH * 0.28, 0.06, 0.03), mat(shade(a.accColor, 0.2)), 0, torsoH * 0.32, -depth / 2 - 0.16);
    for (const s of [-1, 1]) add(spine, roundBox(0.035, torsoH * 0.75, 0.02, 0.008), mat(shade(a.accColor, -0.25)), s * shoulderW * 0.26, torsoH * 0.55, depth / 2 + 0.006);
  } else if (a.bag === 'shoulder') {
    const strap = mat(shade(a.accColor, -0.25));
    add(spine, roundBox(0.035, torsoH * 1.25, 0.015, 0.006), strap, 0, torsoH * 0.5, depth / 2 + 0.01, 0, 0, -0.62);
    add(spine, roundBox(0.035, torsoH * 1.25, 0.015, 0.006), strap, 0, torsoH * 0.5, -depth / 2 - 0.01, 0, 0, 0.62);
    add(body, roundBox(0.22, 0.17, 0.08, 0.03), accM, -(hipW / 2 + 0.06), hipY - 0.02, 0.02);
  }

  const rig = {
    body, spine, head, eyes,
    legL: legs[0], legR: legs[1], kneeL: knees[0], kneeR: knees[1],
    armL: arms[0], armR: arms[1], elbowL: elbows[0], elbowR: elbows[1], handR: hands[1],
    phase: Math.random() * 6, t: Math.random() * 10, blink: 2 + Math.random() * 3,
  };
  mergeRig(root);
  const top = hipY + 0.04 + torsoH + 0.08 + hh * a.headSize + 0.08;
  return { root, rig, height: top * a.height, headY: (hipY + torsoH + 0.25) * a.height };
}

// Hər sümük qrupunun sadə rəngli hissələrini bir mesh-ə birləşdirir (xarakter başına ~54 → ~15 çəkiliş)
const toonVertexMat = new THREE.MeshToonMaterial({ color: '#ffffff', gradientMap: toonGradient, vertexColors: true });
function mergeRig(root) {
  const groups = [];
  root.traverse((o) => { if (!o.isMesh && !o.isSprite) groups.push(o); });
  for (const g of groups) {
    const parts = g.children.filter((c) => c.isMesh && c.material.isMeshToonMaterial && !c.material.map && !c.material.transparent && !c.material.vertexColors);
    if (parts.length < 2) continue;
    const geos = parts.map((p) => { p.updateMatrix(); return bakeGeometry(p.geometry, p.matrix, p.material.color); });
    for (const p of parts) g.remove(p);
    const mesh = new THREE.Mesh(mergeGeometries(geos, false), toonVertexMat);
    mesh.castShadow = true;
    g.add(mesh);
  }
}

function buildShoe(foot, a, shoeM, fem) {
  const sole = mat(a.shoes === '#ffffff' ? '#d9d9d9' : '#f2f2f2');
  const darkSole = mat('#222222');
  const w = fem ? 0.095 : 0.11;
  if (a.shoeType === 'boots') {
    add(foot, roundBox(w + 0.015, 0.17, 0.14, 0.04), shoeM, 0, 0.04, 0);
    add(foot, roundBox(w + 0.015, 0.08, 0.24, 0.035), shoeM, 0, -0.02, 0.04);
    add(foot, roundBox(w + 0.02, 0.03, 0.25, 0.01), darkSole, 0, -0.05, 0.04);
  } else if (a.shoeType === 'formal') {
    add(foot, roundBox(w, 0.07, 0.23, 0.03), shoeM, 0, -0.015, 0.04);
    add(foot, roundBox(w + 0.004, 0.02, 0.235, 0.008), darkSole, 0, -0.052, 0.04);
  } else {
    add(foot, roundBox(w + 0.005, 0.085, 0.23, 0.035), shoeM, 0, -0.01, 0.035);
    add(foot, roundBox(w + 0.012, 0.035, 0.245, 0.012), sole, 0, -0.046, 0.04);
    add(foot, roundBox(w * 0.6, 0.01, 0.06, 0.004), sole, 0, 0.03, 0.08);
  }
}

function buildHair(head, style, m, o) {
  const { hw, hh, hd, fz, hatOn } = o;
  const cap = (thick, fringe = true) => {
    if (!hatOn) add(head, roundBox(hw + 0.03, hh * 0.3 + thick, hd + 0.03, Math.min(0.12, o.r + 0.02)), m, 0, hh - hh * 0.15 + thick / 2, -0.003);
    if (fringe && !hatOn) add(head, roundBox(hw * 0.86, 0.05, 0.04, 0.02), m, 0, hh * 0.84, fz - 0.005);
  };
  const back = (len = 0.72) => add(head, roundBox(hw + 0.03, hh * len, 0.1, 0.04), m, 0, hh * (1 - len / 2) - 0.01, -hd / 2 + 0.03);
  const sides = (len = 0.35) => {
    for (const s of [-1, 1]) add(head, roundBox(0.03, hh * len, hd * 0.6, 0.012), m, s * (hw / 2 + 0.008), hh * (1 - len / 2) - 0.03, -hd * 0.15);
  };
  switch (style) {
    case 'buzz':
      cap(0, false); back(0.6); sides(0.3);
      break;
    case 'short':
      cap(0.035); back(); sides();
      break;
    case 'side':
      cap(0.045, false); back(); sides();
      if (!hatOn) add(head, roundBox(hw * 0.75, 0.075, 0.05, 0.025), m, hw * 0.12, hh * 0.86, fz - 0.002, 0, 0, -0.22);
      break;
    case 'spiky':
      cap(0.02, false); back(); sides();
      if (!hatOn) for (const [x, z, rx, rz] of [[0, 0.06, 0.4, 0], [-0.08, 0.03, 0.2, 0.35], [0.08, 0.03, 0.2, -0.35], [0, -0.05, -0.2, 0], [-0.09, -0.07, -0.3, 0.4], [0.09, -0.07, -0.3, -0.4], [0, 0.11, 0.9, 0]]) {
        add(head, cone(0.05, 0.14), m, x, hh + 0.06, z, rx, 0, rz);
      }
      break;
    case 'curly':
      back(0.75); sides(0.4);
      for (let ix = -2; ix <= 2; ix++) for (let iz = -2; iz <= 2; iz++) {
        if (hatOn && iz > -2) continue;
        if (Math.abs(ix) === 2 && Math.abs(iz) === 2) continue;
        add(head, sphere(0.058), m, ix * 0.058, hh + 0.01 - (Math.abs(ix) + Math.abs(iz)) * 0.012, iz * 0.06 - 0.01);
      }
      break;
    case 'afro':
      if (!hatOn) {
        add(head, roundBox(hw + 0.17, hh * 0.62, hd + 0.16, 0.17), m, 0, hh * 1.02, -0.04);
        add(head, sphere(0.2), m, 0, hh * 0.75, -hd * 0.35);
      } else back(0.85);
      sides(0.45);
      break;
    case 'long':
      cap(0.03); sides(0.3);
      add(head, roundBox(hw + 0.05, hh * 1.45, 0.1, 0.045), m, 0, hh * 0.3, -hd / 2 + 0.02);
      for (const s of [-1, 1]) add(head, roundBox(0.05, hh * 1.05, hd * 0.55, 0.02), m, s * (hw / 2 + 0.025), hh * 0.42, -hd * 0.12);
      break;
    case 'ponytail':
      cap(0.02); back(); sides(0.3);
      add(head, sphere(0.04), mat('#c0392b'), 0, hh * 0.72, -hd / 2 - 0.035);
      add(head, capsule(0.05, 0.34), m, 0, hh * 0.45, -hd / 2 - 0.07, 0.25);
      break;
    case 'bun':
      cap(0.02); back(); sides(0.3);
      add(head, sphere(0.085), m, 0, hatOn ? hh * 0.6 : hh + 0.05, hatOn ? -hd / 2 - 0.06 : -hd * 0.22);
      break;
    case 'bob':
      cap(0.035, false);
      add(head, roundBox(hw + 0.05, hh * 0.85, 0.1, 0.045), m, 0, hh * 0.55, -hd / 2 + 0.02);
      for (const s of [-1, 1]) add(head, roundBox(0.055, hh * 0.72, hd * 0.75, 0.025), m, s * (hw / 2 + 0.028), hh * 0.58, -0.01);
      if (!hatOn) add(head, roundBox(hw * 0.95, 0.075, 0.05, 0.025), m, 0, hh * 0.85, fz - 0.005);
      break;
    case 'braids':
      cap(0.02); back(); sides(0.3);
      for (const s of [-1, 1]) {
        for (let i = 0; i < 5; i++) add(head, sphere(0.042 - i * 0.003), m, s * (hw * 0.48), hh * 0.32 - i * 0.075, -0.02 + i * 0.012);
        add(head, sphere(0.022), mat('#c0392b'), s * (hw * 0.48), hh * 0.32 - 5 * 0.075 + 0.02, 0.04);
      }
      break;
    case 'mohawk':
      back(0.5);
      if (!hatOn) add(head, roundBox(0.07, 0.15, hd * 0.95, 0.03), m, 0, hh + 0.05, -0.01);
      break;
    case 'bald':
    default:
      break;
  }
}

// ---------------- Animasiya ----------------
// emote: 0 yoxdur, 1 əl yelləmək, 2 rəqs, 3 sevinc
export function animateRig(r, dt, speed, opt = {}) {
  const air = !!opt.air, emote = opt.emote || 0;
  r.t += dt;
  const t = r.t;
  const moving = speed > 0.05 && !air;
  if (moving) r.phase += dt * (4.4 + speed * 3);
  const p = r.phase;
  const amp = moving ? Math.min(1.05, 0.5 + speed * 0.28) : 0;
  const s = Math.sin(p), c = Math.cos(p);

  // hədəf vəziyyət
  const T = {
    legL: 0, legR: 0, kneeL: 0, kneeR: 0,
    armLx: 0.04, armRx: 0.04, armLz: 0.09, armRz: -0.09,
    elbowL: -0.15, elbowR: -0.15, elbowLz: 0, elbowRz: 0,
    spineX: 0, spineY: 0, spineZ: 0, bodyY: Math.sin(t * 1.8) * 0.004,
    headX: 0, headY: Math.sin(t * 0.45) * 0.18,
  };
  if (moving) {
    T.legL = -s * amp; T.legR = s * amp;
    T.kneeL = Math.max(0, c) * amp * 1.3 + 0.05; T.kneeR = Math.max(0, -c) * amp * 1.3 + 0.05;
    T.armLx = s * amp * 0.75; T.armRx = -s * amp * 0.75;
    T.armLz = 0.07; T.armRz = -0.07;
    T.elbowL = T.elbowR = -(0.3 + speed * 0.35);
    T.spineX = speed > 1.3 ? 0.16 : 0.04;
    T.spineY = s * 0.09 * amp;
    T.bodyY = Math.abs(c) * 0.045 * amp;
    T.headY = -s * 0.05 * amp;
  } else if (air) {
    T.legL = -0.6; T.kneeL = 1.0; T.legR = 0.15; T.kneeR = 0.45;
    T.armLz = 0.7; T.armRz = -0.7; T.armLx = -0.3; T.armRx = -0.3;
    T.elbowL = T.elbowR = -0.5;
  } else if (emote === 4) {
    // dar ağacında: əllər arxada bağlı, baş aşağı; çırpınanda yırğalanır
    const st = opt.struggle ? Math.sin(t * 22) : 0;
    T.armLx = 0.5; T.armRx = 0.5; T.armLz = -0.12; T.armRz = 0.12;
    T.elbowL = T.elbowR = -0.7;
    T.headX = 0.32 + st * 0.08; T.headY = Math.sin(t * 0.7) * 0.25 + st * 0.3;
    T.spineZ = st * 0.12; T.spineX = 0.05;
    T.legL = st * 0.15; T.legR = -st * 0.15;
  } else if (emote === 1) {
    T.armRz = -2.75; T.armRx = 0; T.elbowR = -0.25; T.elbowRz = Math.sin(t * 10) * 0.45;
    T.headX = -0.08; T.headY = -0.15; T.spineZ = 0.04;
  } else if (emote === 2) {
    const b = Math.sin(t * 6);
    T.bodyY = Math.abs(b) * 0.06;
    T.spineZ = Math.sin(t * 3) * 0.14; T.spineY = Math.sin(t * 3) * 0.2;
    T.armLz = 1.5 + Math.sin(t * 6) * 0.5; T.armRz = -1.5 + Math.sin(t * 6) * 0.5;
    T.elbowL = T.elbowR = -1.1;
    T.legL = -Math.max(0, b) * 0.35; T.kneeL = Math.max(0, b) * 0.6;
    T.legR = -Math.max(0, -b) * 0.35; T.kneeR = Math.max(0, -b) * 0.6;
    T.headX = Math.sin(t * 6) * 0.1; T.headY = 0;
  } else if (emote === 3) {
    const b = Math.abs(Math.sin(t * 7));
    T.bodyY = b * 0.14;
    T.armLz = 2.75; T.armRz = -2.75; T.armLx = Math.sin(t * 14) * 0.15; T.armRx = -Math.sin(t * 14) * 0.15;
    T.elbowL = T.elbowR = -0.2;
    T.kneeL = T.kneeR = (1 - b) * 0.4; T.legL = T.legR = -(1 - b) * 0.2;
    T.headX = -0.2; T.headY = 0;
  }

  // ---- Döyüş pozaları (yeriş üzərinə yazılır) ----
  if (opt.dead) {
    T.armLz = 1.2; T.armRz = -1.2; T.armLx = -0.3; T.armRx = -0.3; T.elbowL = T.elbowR = -0.3;
    T.legL = -0.15; T.legR = 0.1; T.kneeL = 0.3; T.kneeR = 0.1; T.headX = -0.2; T.headY = 0.4;
    T.spineX = 0; T.spineY = 0; T.spineZ = 0; T.bodyY = 0;
  } else if (opt.weapon === 1) {
    // tapança: sağ qol irəli, sol qol dəstək verir; baxış bucağına görə qalxıb-enir
    const p = opt.aim || 0;
    T.armRx = -1.5 + p * 0.9; T.armRz = 0.12; T.elbowR = -0.05; T.elbowRz = 0;
    T.armLx = -1.3 + p * 0.9; T.armLz = -0.55; T.elbowL = -0.55; T.elbowLz = 0;
    T.headX = p * 0.6; T.headY = 0;
    T.spineY = moving ? 0 : 0.12;
  }
  if (opt.punch > 0) {
    // yumruq: sağ qol sürətlə irəli
    const s2 = Math.sin(Math.PI * Math.min(1, opt.punch));
    T.armRx = -1.55 * s2; T.armRz = 0.25 * s2; T.elbowR = -1.3 * (1 - s2) - 0.05;
    T.armLx = -0.5; T.armLz = 0.25; T.elbowL = -1.6;
    T.spineY = -0.35 * s2;
  }

  const k = Math.min(1, dt * (opt.punch > 0 ? 30 : moving ? 14 : opt.weapon === 1 ? 16 : 9));
  const L = (o, prop, v) => { o[prop] += (v - o[prop]) * k; };
  L(r.legL.rotation, 'x', T.legL); L(r.legR.rotation, 'x', T.legR);
  L(r.kneeL.rotation, 'x', T.kneeL); L(r.kneeR.rotation, 'x', T.kneeR);
  L(r.armL.rotation, 'x', T.armLx); L(r.armR.rotation, 'x', T.armRx);
  L(r.armL.rotation, 'z', T.armLz); L(r.armR.rotation, 'z', T.armRz);
  L(r.elbowL.rotation, 'x', T.elbowL); L(r.elbowR.rotation, 'x', T.elbowR);
  L(r.elbowL.rotation, 'z', T.elbowLz); L(r.elbowR.rotation, 'z', T.elbowRz);
  L(r.spine.rotation, 'x', T.spineX); L(r.spine.rotation, 'y', T.spineY); L(r.spine.rotation, 'z', T.spineZ);
  L(r.body.position, 'y', T.bodyY);
  L(r.head.rotation, 'x', T.headX); L(r.head.rotation, 'y', T.headY);
  // nəfəs
  r.spine.scale.set(1 + Math.sin(t * 1.8) * 0.008, 1, 1 + Math.sin(t * 1.8) * 0.012);

  // göz qırpma
  r.blink -= dt;
  const closed = r.blink < 0.12 && r.blink > 0;
  for (const e of r.eyes) e.scale.y = closed ? 0.1 : 1;
  if (r.blink <= 0) r.blink = 2.5 + Math.random() * 3.5;
}

// ---------------- Tapança modeli ----------------
// Əlin -y oxu boyunca (qol irəli olanda lülə irəli baxır)
export function makePistol() {
  const g = new THREE.Group();
  const dark = mat('#1d1f22'), metal = mat('#4a4f57'), grip = mat('#5a3a20');
  add(g, roundBox(0.04, 0.2, 0.055, 0.01), dark, 0, -0.1, 0.0);        // gövdə + lülə
  add(g, roundBox(0.042, 0.13, 0.02, 0.006), metal, 0, -0.08, 0.03);  // sürgü
  add(g, roundBox(0.036, 0.05, 0.1, 0.01), grip, 0, -0.025, -0.055);  // dəstək
  add(g, roundBox(0.012, 0.04, 0.03, 0.004), dark, 0, -0.06, -0.035); // tətik qoruyucu
  g.position.set(0, -0.03, 0.02);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, -0.21, 0);
  g.add(muzzle);
  g.userData.muzzle = muzzle;
  return g;
}

// ---------------- Danışıq balonu ----------------
export function makeSpeechBubble(text) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 192;
  const g = c.getContext('2d');
  g.font = 'bold 54px system-ui, "Segoe UI", sans-serif';
  const tw = Math.min(460, g.measureText(text).width);
  const w = tw + 70, h = 110, x = (512 - w) / 2, y = 14;
  g.shadowColor = 'rgba(0,0,0,0.35)';
  g.shadowBlur = 14;
  g.shadowOffsetY = 4;
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.roundRect(x, y, w, h, 40);
  g.moveTo(236, y + h - 2); g.lineTo(256, y + h + 40); g.lineTo(282, y + h - 2);
  g.fill();
  g.shadowColor = 'transparent';
  g.fillStyle = '#1b2838';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 256, y + h / 2 + 3, 460);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
  sp.scale.set(2.4, 0.9, 1);
  sp.center.set(0.5, 0);
  return sp;
}

// ---------------- Ad lövhəsi ----------------
export function makeNameTag(text, sub, color = '#ffffff') {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  g.font = 'bold 46px system-ui, sans-serif';
  const w = Math.min(500, Math.max(g.measureText(text).width, sub ? g.measureText(sub).width * 0.6 : 0) + 40);
  g.fillStyle = 'rgba(0,0,0,0.45)';
  g.beginPath();
  g.roundRect((512 - w) / 2, sub ? 8 : 30, w, sub ? 112 : 68, 18);
  g.fill();
  g.fillStyle = color;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 256, sub ? 46 : 64, 480);
  if (sub) {
    g.font = '30px system-ui, sans-serif';
    g.fillStyle = '#d0d0d0';
    g.fillText(sub, 256, 92, 480);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
  sp.scale.set(1.6, 0.4, 1);
  return sp;
}
