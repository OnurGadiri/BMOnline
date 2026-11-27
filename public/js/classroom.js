// Kapital Bank Room — sinif otağı (fotolara əsasən) və C# imtahanı üçün müəllim NPC-si.
// Otaq kampus sərhədindən kənarda ayrıca qapalı məkandır; qapıdan girəndə server oyunçunu bura köçürür.
import * as THREE from 'three';
import { buildCharacter, animateRig, makeNameTag, makeSpeechBubble } from './character.js';

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
const lam = (c) => new THREE.MeshLambertMaterial({ color: c });
function box(parent, w, h, d, x, y, z, mat, cast = false) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = cast;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}
function plane(parent, w, h, mat, x, y, z, rx = 0, ry = 0) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, 0);
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

// ---- teksturalar ----
const floorTex = (W, D) => {
  const t = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#e6d8bf'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2500; i++) { g.fillStyle = Math.random() < 0.5 ? 'rgba(150,120,80,0.06)' : 'rgba(255,255,255,0.08)'; g.fillRect(Math.random() * w, Math.random() * h, 3, 3); }
    g.strokeStyle = '#bfae90'; g.lineWidth = 3;
    for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(0, (i * h) / 4); g.lineTo(w, (i * h) / 4); g.stroke(); g.beginPath(); g.moveTo((i * w) / 4, 0); g.lineTo((i * w) / 4, h); g.stroke(); }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(W / 2.4, D / 2.4); // 0.6 m kafel
  return t;
};
/** Qırmızı divar: ağ xətlərlə məzun papağı, qələm və dalğalı xətlər; ön küncdə otağın adı */
const redWallTex = (len, H) => canvasTex(Math.round(len * 64), Math.round(H * 64), (g, w, h) => {
  g.fillStyle = '#d42a2f'; g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(255,255,255,0.92)'; g.lineWidth = 5; g.lineCap = 'round'; g.lineJoin = 'round';
  // dalğalı xətlər
  for (const [y0, a] of [[h * 0.18, 26], [h * 0.82, 20]]) {
    g.beginPath();
    for (let x = 0; x <= w; x += 8) { const y = y0 + Math.sin(x / 70) * a; x ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke();
  }
  // məzun papağı (perspektivdə romb + alt hissə + qotaz)
  const cx = w * 0.42, cy = h * 0.46, s = h * 0.24;
  g.beginPath(); g.moveTo(cx - s * 1.6, cy); g.lineTo(cx, cy - s * 0.55); g.lineTo(cx + s * 1.6, cy); g.lineTo(cx, cy + s * 0.55); g.closePath(); g.stroke();
  g.beginPath(); g.moveTo(cx - s * 0.9, cy + s * 0.3); g.lineTo(cx - s * 0.9, cy + s * 0.95); g.quadraticCurveTo(cx, cy + s * 1.35, cx + s * 0.9, cy + s * 0.95); g.lineTo(cx + s * 0.9, cy + s * 0.3); g.stroke();
  g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + s * 1.25, cy + s * 0.15); g.lineTo(cx + s * 1.25, cy + s * 1.05); g.stroke();
  g.beginPath(); g.arc(cx + s * 1.25, cy + s * 1.12, 7, 0, Math.PI * 2); g.stroke();
  // qələm
  const px = w * 0.8, py = h * 0.25;
  g.beginPath(); g.moveTo(px, py); g.lineTo(px + s * 0.9, py + s * 2.2); g.lineTo(px + s * 1.15, py + s * 2.1); g.lineTo(px + s * 0.25, py - s * 0.1); g.closePath(); g.stroke();
  // otağın adı (ön küncdə)
  g.fillStyle = '#ffffff';
  g.font = `bold ${Math.round(h * 0.075)}px Segoe UI, sans-serif`;
  g.fillText('Kapital Bank', w * 0.035, h * 0.36);
  g.font = `${Math.round(h * 0.055)}px Segoe UI, sans-serif`;
  g.fillText('Room', w * 0.035, h * 0.44);
});
/** Ekran: C# kodu */
const screenTex = () => canvasTex(512, 300, (g, w, h) => {
  g.fillStyle = '#1e1e2e'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#2b2b40'; g.fillRect(0, 0, w, 26);
  g.fillStyle = '#e6e6e6'; g.font = '14px Consolas, monospace'; g.fillText('Program.cs — Müasir proqramlaşdırma (C#)', 10, 18);
  const lines = [
    ['#569cd6', 'using', '#ddd', ' System;'],
    ['#569cd6', 'class', '#4ec9b0', ' Imtahan'],
    ['#ddd', '{', '', ''],
    ['#569cd6', '  static void', '#dcdcaa', ' Main(string[] args)'],
    ['#ddd', '  {', '', ''],
    ['#569cd6', '    var', '#ddd', ' bal = 0;'],
    ['#c586c0', '    if', '#ddd', ' (kopya) bal = 2;  // 🙂'],
    ['#ddd', '    Console.WriteLine(', '#ce9178', '$"Bal: {bal}");'],
    ['#ddd', '  }', '', ''],
    ['#ddd', '}', '', ''],
  ];
  g.font = '17px Consolas, monospace';
  lines.forEach(([c1, t1, c2, t2], i) => {
    const y = 52 + i * 24;
    g.fillStyle = '#6a6a80'; g.fillText(String(i + 1).padStart(2, ' '), 8, y);
    g.fillStyle = c1; g.fillText(t1, 40, y);
    g.fillStyle = c2 || '#ddd'; g.fillText(t2, 40 + g.measureText(t1).width, y);
  });
});
const boardTex = (text) => canvasTex(512, 256, (g, w, h) => {
  g.fillStyle = '#fbfbfb'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#2a4d9b'; g.font = 'bold 30px Segoe UI, sans-serif';
  text.forEach((t, i) => g.fillText(t, 24, 54 + i * 44));
});
const windowTex = () => canvasTex(128, 128, (g, w, h) => {
  const gr = g.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, '#cfe9ff'); gr.addColorStop(1, '#f4fbff');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(255,255,255,0.6)'; g.fillRect(w * 0.1, 0, w * 0.08, h);
});

/** Kampusda otağa aparan qapı (binanın divarında) */
export function buildRoomDoor(scene, cfg) {
  const d = cfg.door;
  const g = new THREE.Group();
  g.position.set(d.x - Math.sin(d.ry) * 0.27, 0, d.z - Math.cos(d.ry) * 0.27);
  g.rotation.y = d.ry;
  const glass = new THREE.MeshLambertMaterial({ color: '#2d4a63', emissive: '#0d2236' });
  box(g, 1.9, 2.5, 0.06, 0, 1.25, 0, lam('#c9ccd1'));
  box(g, 1.7, 2.35, 0.04, 0, 1.18, 0.03, glass);
  box(g, 0.04, 2.35, 0.05, 0, 1.18, 0.05, lam('#c9ccd1'));
  for (const s of [-1, 1]) box(g, 0.04, 0.5, 0.06, s * 0.15, 1.1, 0.09, lam('#e0e0e0'));
  const sign = canvasTex(512, 110, (q, w, h) => {
    q.fillStyle = '#d42a2f'; q.fillRect(0, 0, w, h);
    q.fillStyle = '#fff'; q.font = 'bold 50px Segoe UI, sans-serif'; q.fillText('Kapital Bank Room', 30, 72);
  });
  const sg = plane(g, 2.3, 0.5, new THREE.MeshBasicMaterial({ map: sign }), 0, 2.85, 0.05);
  sg.receiveShadow = false;
  scene.add(g);
}

/** Müəllim (uydurma personaj) */
const TEACHER_LOOK = {
  body: 'f', hair: 'bun', hairColor: '#2a1810', glasses: 'square', top: 'jacket', topColor: '#3b4a63', topColor2: '#ffffff',
  pattern: 'plain', bottom: 'longskirt', bottomColor: '#2b2d38', shoeType: 'formal', shoes: '#1d1d1d', earrings: 'studs',
  accColor: '#c9a227', mouth: 'neutral', brows: 'normal',
};

/**
 * Otağı qurur. ctx: { colliders, seats } — dünyanın massivlərinə əlavə olunur.
 * Qaytarır: otaq haqqında məlumat, müəllim və hər kadr çağırılan update.
 */
export function buildClassroom(scene, cfg, ctx) {
  const { x: cx, z: cz, w: W, d: D } = cfg;
  const H = cfg.h || 3.3;
  const x0 = cx - W / 2, x1 = cx + W / 2, z0 = cz - D / 2, z1 = cz + D / 2; // z0 — ön divar (lövhə), z1 — arxa
  const g = new THREE.Group();
  g.name = 'classroom';
  const white = lam('#f3f3f0');

  // döşəmə və tavan
  plane(g, W, D, new THREE.MeshLambertMaterial({ map: floorTex(W, D) }), cx, 0.012, cz, -Math.PI / 2);
  const blk = [];
  // tavan aşağı baxır — yarımkürə işığı onu yaşıl (yer rəngi) edərdi, ona görə işıqsız material
  blk.push(plane(g, W, D, new THREE.MeshBasicMaterial({ color: "#e4e4e0" }), cx, H, cz, Math.PI / 2));
  // tavan tirləri (eninə və uzununa) və LED panellər
  const beamMat = new THREE.MeshBasicMaterial({ color: "#f2f2ee" });
  for (let z = z0 + 4.5; z < z1 - 1; z += 4.5) box(g, W, 0.42, 0.34, cx, H - 0.21, z, beamMat);
  box(g, 0.34, 0.42, D, cx, H - 0.21, cz, beamMat);
  const led = new THREE.MeshBasicMaterial({ color: '#ffffff' });
  for (let z = z0 + 2.2; z < z1; z += 4.5) for (const dx of [-W / 4, W / 4]) plane(g, 0.62, 0.62, led, cx + dx, H - 0.01, z, Math.PI / 2);

  // sol divar: qırmızı (ön 2/3), arxası ağ
  const redLen = D * 0.68;
  blk.push(plane(g, redLen, H, new THREE.MeshLambertMaterial({ map: redWallTex(redLen, H) }), x0 + 0.01, H / 2, z0 + redLen / 2, 0, Math.PI / 2));
  blk.push(plane(g, D - redLen, H, white, x0 + 0.01, H / 2, z0 + redLen + (D - redLen) / 2, 0, Math.PI / 2));
  // ön divar (ağ) və narıncı sütun sağ küncdə
  blk.push(plane(g, W, H, white, cx, H / 2, z0 + 0.01));
  box(g, 0.5, H, 0.4, x1 - 0.25, H / 2, z0 + 0.2, lam('#f08a24'));
  // arxa divar
  blk.push(plane(g, W, H, white, cx, H / 2, z1 - 0.01, 0, Math.PI));
  { const back = plane(g, D, H, white, x1 + 0.02, H / 2, cz, 0, -Math.PI / 2); back.visible = false; blk.push(back); } // sağ divar: yalnız kamera toqquşması üçün
  // sağ divar: pəncərələr, aralarda narıncı və sarı hissələr
  const winMat = new THREE.MeshBasicMaterial({ map: windowTex() });
  const frame = lam('#f5f5f5');
  const nWin = 4, seg = D / nWin;
  for (let i = 0; i < nWin; i++) {
    const zc = z0 + seg * (i + 0.5);
    const col = i < 2 ? '#f08a24' : '#f6c21c';
    const wm = lam(col);
    plane(g, seg, 0.9, wm, x1 - 0.01, 0.45, zc, 0, -Math.PI / 2);               // pəncərə altı
    plane(g, seg, H - 2.55, wm, x1 - 0.01, (H + 2.55) / 2, zc, 0, -Math.PI / 2);  // pəncərə üstü
    plane(g, seg - 2.0, 1.65, wm, x1 - 0.01, 1.72, zc - seg / 2 + (seg - 2.0) / 2, 0, -Math.PI / 2);
    plane(g, 1.9, 1.6, winMat, x1 - 0.02, 1.72, zc + seg / 2 - 1.0, 0, -Math.PI / 2);
    box(g, 0.08, 1.7, 0.06, x1 - 0.05, 1.72, zc + seg / 2 - 1.0, frame);
    box(g, 0.25, 0.05, 2.0, x1 - 0.12, 0.92, zc + seg / 2 - 1.0, frame); // pəncərə altlığı
  }

  // ön divarda ekran və lövhə
  box(g, 1.75, 1.05, 0.06, cx - 1.6, 1.75, z0 + 0.04, lam('#111111'));
  plane(g, 1.62, 0.93, new THREE.MeshBasicMaterial({ map: screenTex() }), cx - 1.6, 1.75, z0 + 0.075);
  box(g, 2.5, 1.25, 0.04, cx + 1.7, 1.6, z0 + 0.03, lam('#cfcfcf'));
  plane(g, 2.42, 1.17, new THREE.MeshLambertMaterial({ map: boardTex(['İMTAHAN', 'Müasir proqramlaşdırma (C#)', 'Telefonlar söndürülsün!']) }), cx + 1.7, 1.6, z0 + 0.055);
  // arxa divarda kiçik lövhə və çıxış qapısı
  box(g, 2.0, 1.0, 0.04, cx + 1.5, 1.55, z1 - 0.03, lam('#d0d0d0'));
  plane(g, 1.92, 0.92, new THREE.MeshLambertMaterial({ map: boardTex(['class Student', '{ bool kopya; }']) }), cx + 1.5, 1.55, z1 - 0.055, 0, Math.PI);
  const door = cfg.exit;
  box(g, 1.1, 2.15, 0.08, door.x, 1.075, z1 - 0.05, lam('#8d97a3'));
  box(g, 0.1, 0.04, 0.06, door.x + 0.38, 1.05, z1 - 0.12, lam('#d9d9d9'));
  plane(g, 0.7, 0.24, new THREE.MeshBasicMaterial({ map: canvasTex(140, 48, (q, w, h) => { q.fillStyle = '#1f9d55'; q.fillRect(0, 0, w, h); q.fillStyle = '#fff'; q.font = 'bold 30px Segoe UI'; q.fillText('ÇIXIŞ', 22, 36); }) }),
    door.x, 2.4, z1 - 0.06, 0, Math.PI);
  // kondisioner və şkaf (arxa küncdə)
  box(g, 0.6, 1.8, 0.45, x1 - 0.6, 0.9, z1 - 0.35, lam('#e8e8e8'), true);

  // ---- partalar və stullar ----
  const topMat = lam('#f4f4f4'), legMat = lam('#3b4048'), seatMat = lam('#6f7d92'), seatDark = lam('#5b687c');
  const cols = [-W / 2 + 2.25, 0, W / 2 - 2.25];
  const rowZ = [];
  for (let r = 0; r < 7; r++) rowZ.push(z0 + 4.4 + r * 1.55);
  const deskW = 2.5, deskD = 0.55;
  const desks = [];
  for (const dz of rowZ) {
    for (const dx of cols) {
      const x = cx + dx;
      box(g, deskW, 0.04, deskD, x, 0.75, dz, topMat, true);
      box(g, deskW - 0.1, 0.25, 0.02, x, 0.6, dz - deskD / 2 + 0.03, lam('#e9e9e9'));   // ön lövhə
      for (const s of [-1, 1]) {
        box(g, 0.05, 0.73, 0.05, x + s * (deskW / 2 - 0.12), 0.365, dz, legMat, true);
        box(g, 0.05, 0.04, deskD - 0.05, x + s * (deskW / 2 - 0.12), 0.03, dz, legMat);
      }
      ctx.colliders.push({ minX: x - deskW / 2, maxX: x + deskW / 2, minZ: dz - deskD / 2, maxZ: dz + deskD / 2, h: 0.78 });
      // iki stul (partanın arxasında, lövhəyə baxır)
      for (const s of [-0.62, 0.62]) {
        const sx = x + s, sz = dz + 0.6;
        box(g, 0.44, 0.05, 0.42, sx, 0.46, sz, seatMat, true);
        box(g, 0.44, 0.4, 0.04, sx, 0.72, sz + 0.2, seatDark, true);
        for (const lx of [-0.18, 0.18]) for (const lz of [-0.17, 0.17]) box(g, 0.03, 0.46, 0.03, sx + lx, 0.23, sz + lz, legMat);
        const seat = { x: sx, z: sz, ry: Math.PI, out: [0, 0.75], room: cfg.id };
        ctx.seats.push(seat);
        desks.push(seat);
      }
    }
  }
  // müəllim masası və noutbuk
  const td = { x: cx + 2.6, z: z0 + 1.7 };
  box(g, 1.5, 0.04, 0.7, td.x, 0.76, td.z, topMat, true);
  box(g, 1.44, 0.7, 0.03, td.x, 0.4, td.z - 0.33, lam('#e4e4e4'));
  for (const s of [-1, 1]) box(g, 0.04, 0.74, 0.66, td.x + s * 0.72, 0.37, td.z, legMat);
  box(g, 0.36, 0.02, 0.25, td.x - 0.2, 0.79, td.z, lam('#b8bcc2'));
  const lid = box(g, 0.36, 0.24, 0.015, td.x - 0.2, 0.91, td.z - 0.13, lam('#c4c8cd'));
  lid.rotation.x = -0.25;
  ctx.colliders.push({ minX: td.x - 0.75, maxX: td.x + 0.75, minZ: td.z - 0.35, maxZ: td.z + 0.35, h: 0.8 });

  // divar kolliderləri
  const T = 0.4;
  ctx.colliders.push(
    { minX: x0 - T, maxX: x0, minZ: z0 - T, maxZ: z1 + T, h: 10 },
    { minX: x1, maxX: x1 + T, minZ: z0 - T, maxZ: z1 + T, h: 10 },
    { minX: x0 - T, maxX: x1 + T, minZ: z0 - T, maxZ: z0, h: 10 },
    { minX: x0 - T, maxX: x1 + T, minZ: z1, maxZ: z1 + T, h: 10 },
  );
  scene.add(g);
  ctx.blockers?.push(...blk);

  // ---- müəllim ----
  const teacher = buildCharacter(TEACHER_LOOK);
  teacher.root.position.set(cx + 1.2, 0, z0 + 1.4);
  const tag = makeNameTag(cfg.teacher || 'Müəllim', 'C# · imtahan', '#ffd166');
  tag.position.y = teacher.height + 0.3;
  teacher.root.add(tag);
  scene.add(teacher.root);
  let bubble = null;
  const say = (text, sec = 2.2) => {
    if (bubble) teacher.root.remove(bubble);
    bubble = makeSpeechBubble(text);
    bubble.position.y = teacher.height + 0.62;
    teacher.root.add(bubble);
    bubble.userData.until = performance.now() + sec * 1000;
  };
  const tch = { pos: teacher.root.position, ry: Math.PI, emote: 0, speed: 0, path: null };
  const aisleX = [cx + (cols[0] + cols[1]) / 2, cx + (cols[1] + cols[2]) / 2];

  return {
    cfg, bounds: { minX: x0, maxX: x1, minZ: z0, maxZ: z1 }, frontZ: z0, rowZ, cols: cols.map((c) => cx + c), aisleX, desks, teacherDesk: td,
    teacher, tch, say,
    /** müəllimi hədəfə doğru apar; çatdısa true */
    walkTo(x, z, dt, speed = 1.3) {
      const dx = x - tch.pos.x, dz = z - tch.pos.z, d = Math.hypot(dx, dz);
      if (d < 0.08) { tch.speed = 0; return true; }
      const step = Math.min(d, speed * dt);
      tch.pos.x += (dx / d) * step; tch.pos.z += (dz / d) * step;
      tch.ry = Math.atan2(dx, dz);
      tch.speed = speed;
      return false;
    },
    update(dt) {
      const r = teacher.root;
      let diff = tch.ry - r.rotation.y;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      r.rotation.y += diff * Math.min(1, dt * 7);
      animateRig(teacher.rig, dt, tch.speed > 0 ? 0.45 : 0, { emote: tch.emote });
      if (bubble && performance.now() > bubble.userData.until) { r.remove(bubble); bubble = null; }
    },
  };
}
