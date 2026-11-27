// BMU Online — oyun serveri
// Statik faylları paylayır, WebSocket ilə oyunçuları idarə edir,
// oflayn oyunçuların xarakterlərini NPC kimi gəzdirir.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT) || 3000;
const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const VENDOR = path.join(ROOT, 'node_modules', 'three', 'build');
const ADDONS = path.join(ROOT, 'node_modules', 'three', 'examples', 'jsm');
// BMU_DATA_DIR — testlər üçün ayrıca məlumat qovluğu (əsl oyunçu məlumatlarına toxunmasın)
const DATA_DIR = process.env.BMU_DATA_DIR ? path.resolve(process.env.BMU_DATA_DIR) : path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'players.json');

const OPTIONS = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'data', 'options.json'), 'utf8'));
const CAMPUS = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'data', 'campus.json'), 'utf8'));

// ---------- Saxlama ----------
let db = { accounts: {} };
try { db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch { /* ilk işə salma */ }
let saveTimer = null;
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db, null, 1));
    fs.renameSync(tmp, DATA_FILE);
  }, 2000);
}

function hashPin(pin, salt) {
  return crypto.scryptSync(pin, salt, 32).toString('hex');
}

// Yanlış və ya çatışmayan sahələr standart dəyərlə doldurulur (köhnə xarakterlər də işləsin)
function validAppearance(a) {
  if (!a || typeof a !== 'object') return null;
  const d = OPTIONS.default;
  const out = {};
  for (const [k, list] of Object.entries(OPTIONS.enums)) out[k] = list.includes(a[k]) ? a[k] : d[k];
  for (const k of OPTIONS.colors) out[k] = typeof a[k] === 'string' && /^#[0-9a-f]{6}$/i.test(a[k]) ? a[k].toLowerCase() : d[k];
  for (const [k, [lo, hi]] of Object.entries(OPTIONS.ranges)) {
    const v = Number(a[k]);
    out[k] = Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d[k];
  }
  return out;
}

const xpForLevel = (lvl) => 50 * lvl; // növbəti levelə keçmək üçün XP

// ---------- Kampus qrafı (NPC gəzintisi üçün) ----------
const nodes = CAMPUS.nodes;
const adj = {};
for (const [a, b] of CAMPUS.edges) {
  (adj[a] ||= []).push(b);
  (adj[b] ||= []).push(a);
}
const nodeIds = Object.keys(nodes);

function segHitsBox(x1, z1, x2, z2, b, pad = 1) {
  const minX = b.x - b.w / 2 - pad, maxX = b.x + b.w / 2 + pad;
  const minZ = b.z - b.d / 2 - pad, maxZ = b.z + b.d / 2 + pad;
  let t0 = 0, t1 = 1;
  const dx = x2 - x1, dz = z2 - z1;
  for (const [p, q] of [[-dx, x1 - minX], [dx, maxX - x1], [-dz, z1 - minZ], [dz, maxZ - z1]]) {
    if (p === 0) { if (q < 0) return false; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
    else { if (r < t0) return false; if (r < t1) t1 = r; }
  }
  return true;
}
/** Mövqe xəritənin içindədir və heç bir binanın içində deyil */
function validPos(x, z) {
  const b = CAMPUS.bounds;
  if (!(x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ)) return false;
  return !CAMPUS.buildings.some((bd) => Math.abs(x - bd.x) < bd.w / 2 + 0.5 && Math.abs(z - bd.z) < bd.d / 2 + 0.5);
}
// ---------- Otaqlar (ayrıca qapalı məkanlar, məs. Kapital Bank Room) ----------
const ROOMS = (CAMPUS.rooms || []).map((r) => ({ ...r, rect: { minX: r.x - r.w / 2, maxX: r.x + r.w / 2, minZ: r.z - r.d / 2, maxZ: r.z + r.d / 2 } }));
const roomAt = (x, z, m = 1) => ROOMS.find((r) => x > r.rect.minX - m && x < r.rect.maxX + m && z > r.rect.minZ - m && z < r.rect.maxZ + m) || null;
function clearLine(x1, z1, x2, z2) {
  return !CAMPUS.buildings.some((b) => segHitsBox(x1, z1, x2, z2, b));
}

// ---------- Varlıqlar (online oyunçular + oflayn NPC-lər) ----------
// entities: accountKey -> { key, name, appearance, x, y, z, ry, moving, online, ai }
const entities = new Map();
const sockets = new Map(); // accountKey -> ws

function publicEntity(e) {
  return { id: e.key, name: e.name, appearance: e.appearance, online: e.online, level: db.accounts[e.key].level,
    x: e.x, y: e.y, z: e.z, ry: e.ry, hp: Math.round(e.hp), dead: !!e.dead };
}

/** XP əlavə edir, lazım olsa level qaldırır və oyunçuya bildirir */
function addXp(key, amount) {
  const acc = db.accounts[key];
  if (!acc || amount <= 0) return;
  acc.xp += amount;
  let leveled = false;
  while (acc.xp >= xpForLevel(acc.level)) { acc.xp -= xpForLevel(acc.level); acc.level++; leveled = true; }
  const ws = sockets.get(key);
  if (ws) send(ws, { t: 'xp', xp: acc.xp, level: acc.level, xpNext: xpForLevel(acc.level), leveled });
  if (leveled) {
    const e = entities.get(key);
    if (e) broadcast({ t: 'entity', e: publicEntity(e) });
    broadcast({ t: 'sys', msg: `${acc.name} ${acc.level}-ci levelə çatdı!` });
  }
  scheduleSave();
}

function startAI(e) {
  // Ən yaxın, birbaşa gedilə bilən nöqtəni tap
  let best = null, bestD = Infinity;
  for (const id of nodeIds) {
    const [nx, nz] = nodes[id];
    const d = Math.hypot(nx - e.x, nz - e.z);
    if (d < bestD && clearLine(e.x, e.z, nx, nz)) { best = id; bestD = d; }
  }
  if (!best) { // heç biri görünmürsə — ən yaxına köçür
    best = nodeIds.reduce((a, b) => (Math.hypot(nodes[a][0] - e.x, nodes[a][1] - e.z) < Math.hypot(nodes[b][0] - e.x, nodes[b][1] - e.z) ? a : b));
    e.x = nodes[best][0]; e.z = nodes[best][1];
  }
  e.y = 0;
  e.ai = { target: best, prev: null, wait: 1 + Math.random() * 3 };
}

function stepAI(e, dt) {
  const ai = e.ai;
  const panic = Date.now() < (e.panicUntil || 0); // vurulan NPC qaçır
  if (panic) { ai.wait = 0; e.emote = 0; }
  if (ai.wait > 0) { ai.wait -= dt; e.moving = false; if (ai.wait <= 0) e.emote = 0; return; }
  const [tx, tz] = nodes[ai.target];
  const dx = tx - e.x, dz = tz - e.z;
  const dist = Math.hypot(dx, dz);
  const speed = panic ? 6 : 1.4;
  if (dist < 0.3) {
    const options = (adj[ai.target] || []).filter((n) => n !== ai.prev);
    const pool = options.length ? options : adj[ai.target] || [ai.target];
    ai.prev = ai.target;
    ai.target = pool[Math.floor(Math.random() * pool.length)];
    if (!panic && Math.random() < 0.35) { // bir az dayanır, bəzən əl yelləyir və ya rəqs edir
      ai.wait = 2 + Math.random() * 6;
      const r = Math.random();
      e.emote = r < 0.15 ? 1 : r < 0.22 ? 2 : r < 0.27 ? 3 : r < 0.32 ? 7 : r < 0.37 ? 9 : r < 0.41 ? 10 : 0;
    }
    return;
  }
  const s = Math.min(dist, speed * dt);
  e.x += (dx / dist) * s;
  e.z += (dz / dist) * s;
  e.ry = Math.atan2(dx, dz);
  e.moving = true;
}

// Serverdə saxlanan bütün xarakterlər NPC kimi yüklənir
for (const [key, acc] of Object.entries(db.accounts)) {
  if (!acc.appearance) continue;
  acc.appearance = validAppearance(acc.appearance); // köhnə formatı yenilə
  if (acc.pos && !validPos(acc.pos.x, acc.pos.z)) acc.pos = null; // xəritə dəyişibsə — girişdən başla
  const e = { key, name: acc.name, appearance: acc.appearance, x: acc.pos?.x ?? CAMPUS.spawn.x, y: 0,
    z: acc.pos?.z ?? CAMPUS.spawn.z, ry: acc.pos?.ry ?? 0, moving: false, online: false, ai: null, hp: 100 };
  startAI(e);
  entities.set(key, e);
}

// ---------- HTTP ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

function serveFile(res, base, rel) {
  const file = path.normalize(path.join(base, rel));
  if (!file.startsWith(base)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Tapılmadı'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (url.startsWith('/vendor/')) return serveFile(res, VENDOR, url.slice('/vendor/'.length));
  if (url.startsWith('/addons/')) return serveFile(res, ADDONS, url.slice('/addons/'.length));
  serveFile(res, PUBLIC, url === '/' ? 'index.html' : url.slice(1));
});

// ---------- WebSocket ----------
const wss = new WebSocketServer({ server, maxPayload: 16 * 1024 });

function send(ws, msg) { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); }
function broadcast(msg, except) {
  const s = JSON.stringify(msg);
  for (const ws of wss.clients) if (ws !== except && ws.readyState === 1 && ws.inGame) ws.send(s);
}

// ---------- Dar ağacı və çarmıx ----------
// Real oyunçular buraya çəkilmir. Oyunçular uydurma adlı "məhkum" NPC yaradıb göndərir.
const DUMMY_TIME = 120_000;      // məhkum neçə ms qalır
const DUMMY_COOLDOWN = 15_000;   // eyni oyunçu neçə ms-dən bir məhkum göndərə bilər
const DUMMY_NAMES = new Set(OPTIONS.dummyNames);
let dummySeq = 0;
// hər yer: konfiqurasiya, məhkum yerləri, yaxınlıq nöqtəsi, mesaj sözləri
const SITES = {};
if (CAMPUS.gallows) SITES.gallows = { cfg: CAMPUS.gallows, slots: new Array(CAMPUS.gallows.slots).fill(null), front: 3, icon: '⚖', where: 'dar ağacına' };
if (CAMPUS.crucifix) SITES.crucifix = { cfg: CAMPUS.crucifix, slots: new Array(CAMPUS.crucifix.slots).fill(null), front: 2.5, icon: '✝', where: 'çarmıxa' };
const nearSite = (site, e) => site && Math.hypot(e.x - site.cfg.x, e.z - (site.cfg.z + site.front)) < 10;

function gallowsState() {
  const pack = (slots) => slots.map((d) => d && { id: d.id, name: d.name, appearance: d.appearance, by: d.by, left: Math.max(0, d.until - Date.now()) });
  return { t: 'gallows', slots: pack(SITES.gallows?.slots || []), crucifix: pack(SITES.crucifix?.slots || []) };
}

// ---------- Döyüş ----------
const W = {
  pistol: { dmg: 22, head: 55, range: 70, cooldown: 230, mag: 12, reload: 1500 },
  fist: { dmg: 12, range: 1.9, cooldown: 450 },
};
const RESPAWN_PLAYER = 6000, RESPAWN_NPC = 12000, PROTECT = 3000;
const REGEN_DELAY = 5000, REGEN_RATE = 8; // can/san

const charHeight = (e) => 1.9 * (e.appearance?.height || 1);

/** Şüa ilə 3D qutunun kəsişməsi (slab üsulu) — ən yaxın t və ya Infinity */
function rayBox(o, d, minX, maxX, minY, maxY, minZ, maxZ) {
  let t0 = 0, t1 = Infinity;
  for (const [oo, dd, lo, hi] of [[o[0], d[0], minX, maxX], [o[1], d[1], minY, maxY], [o[2], d[2], minZ, maxZ]]) {
    if (Math.abs(dd) < 1e-9) { if (oo < lo || oo > hi) return Infinity; continue; }
    let a = (lo - oo) / dd, b = (hi - oo) / dd;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, b);
    if (t0 > t1) return Infinity;
  }
  return t0;
}
function raycastWorld(o, d) {
  let t = Infinity;
  for (const b of CAMPUS.buildings) {
    t = Math.min(t, rayBox(o, d, b.x - b.w / 2, b.x + b.w / 2, 0, b.h, b.z - b.d / 2, b.z + b.d / 2));
  }
  if (d[1] < 0) t = Math.min(t, -o[1] / d[1]); // yer
  return t;
}
/** Şüa ilə xarakterlərin (şaquli silindr) kəsişməsi */
function raycastEntities(o, d, maxT, skipKey) {
  let best = null;
  for (const e of entities.values()) {
    if (e.key === skipKey || e.dead) continue;
    const r = 0.4, h = charHeight(e);
    const ox = o[0] - e.x, oz = o[2] - e.z;
    const a = d[0] * d[0] + d[2] * d[2];
    if (a < 1e-9) continue;
    const bb = 2 * (ox * d[0] + oz * d[2]);
    const c = ox * ox + oz * oz - r * r;
    const disc = bb * bb - 4 * a * c;
    if (disc < 0) continue;
    const sq = Math.sqrt(disc);
    for (const t of [(-bb - sq) / (2 * a), (-bb + sq) / (2 * a)]) {
      if (t < 0 || t > maxT) continue;
      const y = o[1] + d[1] * t;
      if (y < e.y || y > e.y + h) continue;
      if (!best || t < best.t) best = { e, t, head: y > e.y + h * 0.82 };
      break;
    }
  }
  return best;
}

function damage(target, amount, attacker, weapon) {
  const now = Date.now();
  if (target.dead || now < (target.protUntil || 0)) return null;
  target.hp = Math.max(0, target.hp - amount);
  target.lastHit = now;
  target.hpSent = Math.round(target.hp);
  if (!target.online) target.panicUntil = now + 7000;
  broadcast({ t: 'hp', id: target.key, hp: Math.round(target.hp) });
  if (target.hp > 0) return { kill: false };
  // ölüm
  target.dead = true;
  target.moving = false;
  target.emote = 0;
  target.respawnAt = now + (target.online ? RESPAWN_PLAYER : RESPAWN_NPC);
  target.killerPos = { x: attacker.x, z: attacker.z };
  const accA = db.accounts[attacker.key], accT = db.accounts[target.key];
  accA.kills = (accA.kills || 0) + 1;
  accT.deaths = (accT.deaths || 0) + 1;
  broadcast({ t: 'dead', id: target.key, by: attacker.name, weapon, respawn: target.respawnAt - now });
  broadcast({ t: 'sys', msg: `${weapon === 'pistol' ? '🔫' : '👊'} ${attacker.name} → ${target.name}${target.online ? '' : ' (NPC)'}` });
  addXp(attacker.key, target.online ? 25 : 10);
  return { kill: true };
}

function respawn(e) {
  // öldürəndən uzaq bir nöqtə seç
  const kp = e.killerPos || { x: e.x, z: e.z };
  const far = nodeIds.filter((id) => Math.hypot(nodes[id][0] - kp.x, nodes[id][1] - kp.z) > 45);
  const pool = far.length ? far : nodeIds;
  const [x, z] = nodes[pool[Math.floor(Math.random() * pool.length)]];
  Object.assign(e, { x: x + (Math.random() - 0.5) * 2, z: z + (Math.random() - 0.5) * 2, y: 0, hp: 100, hpSent: 100, dead: false, protUntil: Date.now() + PROTECT });
  const ws = sockets.get(e.key);
  if (ws) { ws.ammo = W.pistol.mag; send(ws, { t: 'ammo', ammo: ws.ammo }); }
  if (!e.online) startAI(e);
  broadcast({ t: 'respawn', id: e.key, x: e.x, z: e.z });
  broadcast({ t: 'hp', id: e.key, hp: 100 });
}

// ---------- Toplar (futbol, basketbol) — server fizikası ----------
const BALL_G = 12;
const balls = (CAMPUS.balls || []).map((b) => ({ ...b, px: b.x, py: b.r, pz: b.z, vx: 0, vy: 0, vz: 0, lastKick: null, resetAt: 0, hold: false, serve: null, dirty: true }));
const ballState = () => ({ t: 'balls', b: balls.map((b) => [b.id, ...[b.px, b.py, b.pz, b.vx, b.vy, b.vz].map((v) => +v.toFixed(3)), b.hold ? 1 : 0]) });

function stepBall(b, dt) {
  if (b.hold) return; // voleybolda servis gözləyir — havada dayanır
  const prev = { x: b.px, y: b.py, z: b.pz };
  // sabit cazibə üçün dəqiq inteqrasiya: mövqe orta sürətlə dəyişir
  const vy0 = b.vy;
  b.vy -= BALL_G * dt;
  b.px += b.vx * dt; b.py += ((vy0 + b.vy) / 2) * dt; b.pz += b.vz * dt;
  const bounce = b.kind === 'basketball' ? 0.72 : b.kind === 'volleyball' ? 0.6 : 0.55;
  // voleybol toru: top torun altından/içindən keçə bilməz
  const n = b.net;
  if (n && (prev.z - n.z) * (b.pz - n.z) < 0 && b.px > n.x1 && b.px < n.x2 && Math.min(prev.y, b.py) < n.top) {
    b.pz = n.z + Math.sign(prev.z - n.z) * (b.r + 0.02);
    b.vz = -b.vz * 0.3; b.vx *= 0.6;
  }
  if (b.py < b.r && b.kind === 'volleyball' && b.vy < -1 && !b.resetAt) volleyLanded(b);
  if (b.py < b.r) {
    b.py = b.r;
    if (b.vy < 0) b.vy = -b.vy * bounce;
    if (b.vy < 0.8) b.vy = 0;
    const f = Math.max(0, 1 - (b.kind === 'basketball' ? 1.6 : 1.1) * dt);
    b.vx *= f; b.vz *= f;
  }
  // qol: top qapının ağzından xətti keçir
  for (const g of b.goals || []) {
    const crossed = (prev.z - g.z) * (b.pz - g.z) < 0;
    if (crossed && Math.abs(b.px - g.x) < g.half - b.r && b.py < g.h && !b.resetAt) score(b, 'goal', b.goals.indexOf(g));
  }
  // səbət: top halqanın içindən aşağı düşür
  const h = b.hoop;
  if (h && prev.y > h.y && b.py <= h.y && !b.resetAt) {
    // halqa müstəvisini keçdiyi dəqiq nöqtə (sürətli top bir addımda halqanı "atlamasın")
    const k = (prev.y - h.y) / (prev.y - b.py);
    const cx = prev.x + (b.px - prev.x) * k, cz = prev.z + (b.pz - prev.z) * k;
    if (Math.hypot(cx - h.x, cz - h.z) < h.r) score(b, 'basket');
  }
  // divarlar / torlar
  const bd = b.bounds;
  if (b.px < bd.minX + b.r) { b.px = bd.minX + b.r; b.vx = Math.abs(b.vx) * 0.5; }
  if (b.px > bd.maxX - b.r) { b.px = bd.maxX - b.r; b.vx = -Math.abs(b.vx) * 0.5; }
  if (b.pz < bd.minZ + b.r) { b.pz = bd.minZ + b.r; b.vz = Math.abs(b.vz) * 0.5; }
  if (b.pz > bd.maxZ - b.r) { b.pz = bd.maxZ - b.r; b.vz = -Math.abs(b.vz) * 0.5; }
  if (b.py <= b.r && Math.hypot(b.vx, b.vz) < 0.05) { b.vx = 0; b.vz = 0; }
  if (b.vx || b.vy || b.vz) b.dirty = true;
}

function score(b, kind, goalIdx = -1) {
  const mt = matchForBall(b);
  if (mt) return matchScore(mt, b, kind, goalIdx);
  b.resetAt = Date.now() + (kind === 'goal' ? 2500 : 0);
  const who = b.lastKick && db.accounts[b.lastKick];
  const name = who ? who.name : 'Kimsə';
  if (kind === 'goal') {
    broadcast({ t: 'score', kind, by: name, ball: b.id });
    broadcast({ t: 'sys', msg: `⚽ QOOOL! ${name} topu qapıya göndərdi! (+15 XP)` });
    if (who) { who.goals = (who.goals || 0) + 1; addXp(b.lastKick, 15); }
  } else {
    broadcast({ t: 'score', kind, by: name, ball: b.id });
    broadcast({ t: 'sys', msg: `🏀 ${name} səbətə saldı! (+10 XP)` });
    if (who) { who.baskets = (who.baskets || 0) + 1; addXp(b.lastKick, 10); }
    b.resetAt = 0;
  }
}

setInterval(() => {
  const dt = 1 / 30, now = Date.now();
  for (const b of balls) {
    if (b.resetAt && now > b.resetAt) {
      const sv = b.serve; // matçda voleybol: növbəti servisi vuran komandanın tərəfində havada dayanır
      Object.assign(b, { px: sv ? sv.x : b.x, py: sv ? 1.9 : b.r + 0.5, pz: sv ? sv.z : b.z, vx: 0, vy: 0, vz: 0, resetAt: 0, hold: !!sv, serve: null, dirty: true });
    }
    // futbol: üstündən qaçan oyunçu topu qabağına itələyir (dribl)
    if (b.kind === 'football' && b.py < 0.7) {
      for (const e of entities.values()) {
        if (!e.online || e.dead || !e.moving || !canTouchBall(e.key, b)) continue;
        const dx = b.px - e.x, dz = b.pz - e.z, d = Math.hypot(dx, dz);
        if (d < 0.75 && d > 0.01) {
          const sp = Math.hypot(b.vx, b.vz);
          if (sp < 5.5) { b.vx += (dx / d) * 3.2; b.vz += (dz / d) * 3.2; b.lastKick = e.key; }
        }
      }
    }
    stepBall(b, dt);
  }
}, 1000 / 30);

// ---------- Matçlar: futbol / basketbol / voleybol — 1v1 və 2v2 ----------
// Vəziyyətlər: idle → wait (komandalar yığılır) → count (5 san geri sayım) → play → end (6 san nəticə) → idle
const matches = (CAMPUS.matches || []).map((c) => ({ cfg: c, mode: 0, state: 'idle', A: [], B: [], score: { A: 0, B: 0 }, endsAt: 0, startAt: 0, endAt: 0, win: null }));
const matchById = (id) => matches.find((mt) => mt.cfg.id === id);
const teamOf = (mt, key) => (key && mt.A.includes(key) ? 'A' : key && mt.B.includes(key) ? 'B' : null);
const matchOf = (key) => matches.find((mt) => teamOf(mt, key));
const nameOf = (k) => db.accounts[k]?.name || '?';
const ballOf = (mt) => balls.find((x) => x.id === mt.cfg.ball);
function matchForBall(b) { return matches.find((mt) => mt.state === 'play' && mt.cfg.ball === b.id) || null; }
/** Matç gedəndə topa yalnız həmin matçın oyunçuları toxuna bilər */
function canTouchBall(key, b) {
  const mt = matches.find((x) => (x.state === 'play' || x.state === 'count') && x.cfg.ball === b.id);
  return !mt || !!teamOf(mt, key);
}
function matchState() {
  const now = Date.now();
  return {
    t: 'matches',
    m: matches.map((mt) => ({
      id: mt.cfg.id, mode: mt.mode, state: mt.state, A: mt.A.map(nameOf), B: mt.B.map(nameOf), kA: mt.A, kB: mt.B,
      score: mt.score, win: mt.win,
      left: mt.state === 'play' ? Math.max(0, (mt.endsAt - now) / 1000) : 0,
      start: mt.state === 'count' ? Math.max(0, (mt.startAt - now) / 1000) : 0,
    })),
  };
}
const pushMatches = () => broadcast(matchState());

function placeTeams(mt) {
  for (const side of ['A', 'B']) {
    mt[side].forEach((k, i) => {
      const e = entities.get(k);
      const sp = mt.cfg.spawns[side][i % mt.cfg.spawns[side].length];
      if (!e || e.dead) return;
      e.x = sp[0]; e.z = sp[1]; e.y = 0; e.emote = 0;
      const ws = sockets.get(k);
      if (ws) { ws.lastPosAt = Date.now(); send(ws, { t: 'correct', x: e.x, y: 0, z: e.z }); }
    });
  }
}
/** Voleybol servis nöqtəsi: komandanın öz yarısında, arxa xəttə yaxın */
function serveSpot(b, side) {
  const c = b.court, mid = b.net.z;
  return { x: (c.minX + c.maxX) / 2, z: side === 'A' ? Math.max(c.minZ + 1.5, mid - 6.5) : Math.min(c.maxZ - 1.5, mid + 6.5) };
}
function resetMatchBall(mt, serveSide) {
  const b = ballOf(mt);
  if (!b) return;
  if (b.kind === 'volleyball') {
    const s = serveSpot(b, serveSide);
    Object.assign(b, { px: s.x, py: 1.9, pz: s.z, hold: true });
  } else Object.assign(b, { px: b.x, py: b.r + 0.5, pz: b.z, hold: false });
  Object.assign(b, { vx: 0, vy: 0, vz: 0, resetAt: 0, serve: null, lastKick: null, dirty: true });
}
function joinMatch(ws, id, team, mode) {
  const mt = matchById(id), key = ws.key;
  if (!mt || (team !== 'A' && team !== 'B')) return;
  if (mt.state === 'play' || mt.state === 'count') return send(ws, { t: 'sys', msg: '⏳ Matç artıq başlayıb — bitəndə qoşula bilərsən.' });
  const e = entities.get(key);
  if (!e || e.dead) return;
  const cur = matchOf(key);
  if (cur && cur !== mt) leaveMatch(key, '', true);
  if (mt.state === 'idle' || mt.state === 'end') Object.assign(mt, { mode: mode === 2 ? 2 : 1, state: 'wait', A: [], B: [], score: { A: 0, B: 0 }, win: null });
  if (mt[team].includes(key)) return;
  if (mt[team].length >= mt.mode) return send(ws, { t: 'sys', msg: 'Bu komanda doludur — o biri komandaya qoşul.' });
  const other = team === 'A' ? 'B' : 'A';
  mt[other] = mt[other].filter((k) => k !== key);
  mt[team].push(key);
  if (mt.A.length === mt.mode && mt.B.length === mt.mode) {
    mt.state = 'count';
    mt.startAt = Date.now() + 5000;
    placeTeams(mt);
    resetMatchBall(mt, 'A');
    broadcast({ t: 'sys', msg: `${mt.cfg.title} ${mt.mode}v${mt.mode}: ${mt.A.map(nameOf).join(', ')} 🆚 ${mt.B.map(nameOf).join(', ')} — 5 saniyəyə başlayır!` });
  }
  pushMatches();
}
function leaveMatch(key, why = '', silent = false) {
  for (const mt of matches) {
    const side = teamOf(mt, key);
    if (!side) continue;
    mt[side] = mt[side].filter((k) => k !== key);
    if (mt.state === 'play' || mt.state === 'count') {
      // komandada kimsə qalmadısa — o biri komanda texniki qalib
      if (!mt[side].length) endMatch(mt, side === 'A' ? 'B' : 'A', `${nameOf(key)} ${why || 'matçdan çıxdı'}`);
    } else if (!mt.A.length && !mt.B.length) Object.assign(mt, { state: 'idle', mode: 0 });
    if (!silent) pushMatches();
  }
}
function matchScore(mt, b, kind, goalIdx) {
  let side = null;
  if (kind === 'goal') side = goalIdx === 0 ? 'B' : 'A'; // A komandası z=1 qapısını qoruyur
  else if (kind === 'basket') side = teamOf(mt, b.lastKick);
  else side = kind; // voleybol: xalı qazanan tərəf ('A' / 'B')
  const acc = b.lastKick && db.accounts[b.lastKick];
  if (kind === 'goal') {
    b.resetAt = Date.now() + 2000;
    if (acc && teamOf(mt, b.lastKick) === side) { acc.goals = (acc.goals || 0) + 1; addXp(b.lastKick, 10); }
  } else if (kind === 'basket') {
    b.resetAt = Date.now() + 600;
    if (acc && side) { acc.baskets = (acc.baskets || 0) + 1; addXp(b.lastKick, 6); }
  }
  if (!side) return;
  mt.score[side]++;
  broadcast({ t: 'mscore', id: mt.cfg.id, side, by: acc && teamOf(mt, b.lastKick) === side ? acc.name : '', kind, score: mt.score });
  if (mt.score[side] >= mt.cfg.target) endMatch(mt, side);
  pushMatches();
}
/** Voleybol topu yerə düşdü: meydançanın içinə düşübsə həmin tərəf xal itirir, kənara düşübsə son vuran komanda */
function volleyLanded(b) {
  const mt = matchForBall(b);
  if (!mt) return;
  const c = b.court;
  const inside = b.px >= c.minX && b.px <= c.maxX && b.pz >= c.minZ && b.pz <= c.maxZ;
  const landSide = b.pz < b.net.z ? 'A' : 'B';
  const hitter = teamOf(mt, b.lastKick);
  const loser = inside ? landSide : hitter || landSide;
  const winner = loser === 'A' ? 'B' : 'A';
  b.resetAt = Date.now() + 1800;
  b.serve = serveSpot(b, winner); // xalı qazanan servis vurur
  matchScore(mt, b, winner, -1);
}
function endMatch(mt, win, reason = '') {
  if (mt.state === 'end' || mt.state === 'idle') return;
  const t = mt.cfg.title, sc = `${mt.score.A}:${mt.score.B}`;
  if (win) {
    const lose = win === 'A' ? 'B' : 'A';
    for (const k of mt[win]) { const a = db.accounts[k]; if (a) { a.wins = (a.wins || 0) + 1; addXp(k, 40); } }
    for (const k of mt[lose]) addXp(k, 10);
    broadcast({ t: 'sys', msg: `🏆 ${t}: ${mt[win].map(nameOf).join(', ') || mt.cfg.names[win]} qalib gəldi (${sc})${reason ? ' — ' + reason : ''}! +40 XP` });
  } else {
    for (const k of [...mt.A, ...mt.B]) addXp(k, 15);
    broadcast({ t: 'sys', msg: `🤝 ${t}: heç-heçə (${sc}) — hər kəsə +15 XP` });
  }
  broadcast({ t: 'mend', id: mt.cfg.id, win, names: win ? mt[win].map(nameOf) : [], score: mt.score, kA: mt.A, kB: mt.B });
  Object.assign(mt, { state: 'end', endAt: Date.now() + 6000, win });
  const b = ballOf(mt);
  if (b) Object.assign(b, { serve: null, hold: false, resetAt: Date.now() + 2500, dirty: true });
  scheduleSave();
}
setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const mt of matches) {
    if (mt.state === 'count' && now >= mt.startAt) {
      Object.assign(mt, { state: 'play', endsAt: now + mt.cfg.time * 1000, score: { A: 0, B: 0 } });
      resetMatchBall(mt, 'A');
      broadcast({ t: 'mstart', id: mt.cfg.id });
      changed = true;
    } else if (mt.state === 'play' && now >= mt.endsAt) {
      endMatch(mt, mt.score.A > mt.score.B ? 'A' : mt.score.B > mt.score.A ? 'B' : null, 'vaxt bitdi');
      changed = true;
    } else if (mt.state === 'end' && now >= mt.endAt) {
      Object.assign(mt, { state: 'idle', mode: 0, A: [], B: [], win: null });
      changed = true;
    }
  }
  if (changed) pushMatches();
}, 250);

// ---------- Ulduzlar (toplanan bonuslar) ----------
const stars = new Map();
let starSeq = 0;
function spawnStar() {
  for (let i = 0; i < 80; i++) {
    const [a, c] = CAMPUS.edges[Math.floor(Math.random() * CAMPUS.edges.length)];
    const [x1, z1] = nodes[a], [x2, z2] = nodes[c];
    const t = Math.random(), len = Math.hypot(x2 - x1, z2 - z1) || 1;
    const off = (Math.random() < 0.5 ? -1 : 1) * (8 + Math.random() * 10);
    const x = x1 + (x2 - x1) * t + ((z2 - z1) / len) * off, z = z1 + (z2 - z1) * t - ((x2 - x1) / len) * off;
    if (!validPos(x, z)) continue;
    const id = `s${++starSeq}`;
    const s = { id, x: +x.toFixed(2), z: +z.toFixed(2) };
    stars.set(id, s);
    return s;
  }
  return null;
}
for (let i = 0; i < (CAMPUS.stars?.count || 0); i++) spawnStar();

/** Oyunçu çıxdı: xarakteri oflayn NPC-yə çevrilir və kampusda gəzməyə davam edir */
function goOffline(key) {
  const e = entities.get(key);
  if (!e || !e.online) return;
  e.online = false;
  e.w = 0;
  const rmOff = roomAt(e.x, e.z);
  if (rmOff) { e.x = rmOff.door.out[0]; e.z = rmOff.door.out[1]; }
  leaveMatch(key, 'oyundan çıxdı');
  if (!e.dead) startAI(e); // ölüdürsə, yenidən doğulanda AI başlayır
  broadcast({ t: 'entity', e: publicEntity(e) });
  broadcast({ t: 'sys', msg: `${e.name} oyundan çıxdı — xarakteri kampusda gəzməyə davam edir.` });
  scheduleSave();
}

const vec3 = (v) => Array.isArray(v) && v.length === 3 && v.every((n) => Number.isFinite(Number(n))) ? v.map(Number) : null;

// ---------- Giriş qoruması (PIN təxmin etməyə qarşı) ----------
// Qeyd: universitet Wi-Fi-ında hamı eyni IP ilə görünür, ona görə IP üzrə limit yüksəkdir,
// bir hesaba eyni IP-dən cəhdlər isə tez bloklanır.
const failByIpAcc = new Map();  // "IP|hesab" -> { first, n, lockUntil }
const failByIp = new Map();     // IP -> ... (çoxlu hesabı yoxlamağa qarşı)
const failByAcc = new Map();    // hesab -> ... (fərqli IP-lərdən hücuma qarşı)
const newAccByIp = new Map();   // IP -> yeni hesab sayı
function lockedFor(map, key) {
  const r = map.get(key);
  return r && r.lockUntil > Date.now() ? Math.ceil((r.lockUntil - Date.now()) / 60000) : 0;
}
function countHit(map, key, max, windowMs, lockMs) {
  const now = Date.now();
  let r = map.get(key);
  if (!r || now - r.first > windowMs) r = { first: now, n: 0, lockUntil: 0 };
  r.n++;
  if (r.n >= max) { r.lockUntil = now + lockMs; r.n = 0; r.first = now; }
  map.set(key, r);
}
setInterval(() => {
  const now = Date.now();
  for (const map of [failByIpAcc, failByIp, failByAcc, newAccByIp]) {
    for (const [k, r] of map) if (r.lockUntil < now && now - r.first > 3600_000) map.delete(k);
  }
}, 600_000);

/** Oyunçunun real IP-si. Cloudflare tuneli vasitəsilə gələndə CF-Connecting-IP başlığına yalnız lokal bağlantıda inanılır. */
function clientIp(req) {
  const remote = req.socket.remoteAddress || '';
  const local = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
  const cf = req.headers['cf-connecting-ip'];
  return local && typeof cf === 'string' && cf ? cf : remote;
}

wss.on('connection', (ws, req) => {
  ws.key = null;
  ws.inGame = false;
  ws.ip = clientIp(req);

  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m.t !== 'string') return;

    if (m.t === 'login') {
      if (Date.now() - (ws.lastLogin || 0) < 800) return send(ws, { t: 'loginErr', msg: 'Bir az yavaş 🙂' });
      ws.lastLogin = Date.now();
      const name = String(m.name || '').trim();
      const pin = String(m.pin || '');
      if (!/^[\p{L}\p{N}_. -]{3,16}$/u.test(name)) return send(ws, { t: 'loginErr', msg: 'Ad 3-16 simvol olmalıdır (hərf, rəqəm, _ . -).' });
      if (!/^\d{4,8}$/.test(pin)) return send(ws, { t: 'loginErr', msg: 'PIN 4-8 rəqəm olmalıdır.' });
      const key = name.toLowerCase();
      const wait = Math.max(lockedFor(failByIpAcc, `${ws.ip}|${key}`), lockedFor(failByIp, ws.ip), lockedFor(failByAcc, key));
      if (wait) return send(ws, { t: 'loginErr', msg: `Çox səhv cəhd. ${wait} dəqiqə sonra yenidən yoxla.` });
      let acc = db.accounts[key];
      let isNew = false;
      if (!acc) {
        if (lockedFor(newAccByIp, ws.ip)) return send(ws, { t: 'loginErr', msg: 'Bu şəbəkədən çox hesab yaradılıb. Bir az sonra yoxla.' });
        countHit(newAccByIp, ws.ip, 5, 3600_000, 3600_000);
        const salt = crypto.randomBytes(16).toString('hex');
        acc = db.accounts[key] = { name, salt, hash: hashPin(pin, salt), appearance: null, level: 1, xp: 0, pos: null, createdAt: Date.now() };
        isNew = true;
        scheduleSave();
      } else if (!crypto.timingSafeEqual(Buffer.from(hashPin(pin, acc.salt), 'hex'), Buffer.from(acc.hash, 'hex'))) {
        countHit(failByIpAcc, `${ws.ip}|${key}`, 5, 600_000, 600_000);
        countHit(failByIp, ws.ip, 25, 600_000, 600_000);
        countHit(failByAcc, key, 10, 900_000, 900_000);
        return send(ws, { t: 'loginErr', msg: 'PIN yanlışdır.' });
      }
      // Eyni hesab başqa yerdə açıqdırsa — köhnəni çıxart
      const old = sockets.get(key);
      if (old && old !== ws) {
        send(old, { t: 'kicked', msg: 'Bu hesabla başqa yerdən daxil olundu.' });
        // köhnə cihaz oyundadırsa, xarakter NPC-yə keçsin (yeni cihaz qoşulanda yenə onlayn olacaq)
        if (old.inGame) goOffline(key);
        old.key = null;
        old.inGame = false;
        old.close();
      }
      ws.key = key;
      sockets.set(key, ws);
      return send(ws, { t: 'loginOk', name: acc.name, isNew, appearance: acc.appearance, level: acc.level, xp: acc.xp, xpNext: xpForLevel(acc.level) });
    }

    if (!ws.key) return;
    const acc = db.accounts[ws.key];

    if (m.t === 'saveChar') {
      const a = validAppearance(m.appearance);
      if (!a) return send(ws, { t: 'error', msg: 'Xarakter məlumatı yanlışdır.' });
      acc.appearance = a;
      scheduleSave();
      let e = entities.get(ws.key);
      if (e) {
        e.appearance = a;
        broadcast({ t: 'entity', e: publicEntity(e) });
      }
      return send(ws, { t: 'charSaved', appearance: a });
    }

    if (m.t === 'join') {
      if (!acc.appearance) return send(ws, { t: 'error', msg: 'Əvvəlcə xarakter yarat.' });
      let e = entities.get(ws.key);
      if (!e) {
        e = { key: ws.key, name: acc.name, appearance: acc.appearance, x: CAMPUS.spawn.x, y: 0, z: CAMPUS.spawn.z,
          ry: CAMPUS.spawn.ry, moving: false, online: true, ai: null, hp: 100 };
        entities.set(ws.key, e);
      }
      // Oyunçu NPC-sinin olduğu yerdən davam edir
      e.online = true; e.ai = null; e.appearance = acc.appearance;
      if (!e.dead) e.protUntil = Date.now() + PROTECT;
      ws.inGame = true;
      ws.ammo = W.pistol.mag;
      ws.reloading = false;
      ws.lastPos = { x: e.x, z: e.z };
      send(ws, { t: 'welcome', you: publicEntity(e), entities: [...entities.values()].filter((o) => o.key !== ws.key).map(publicEntity) });
      broadcast({ t: 'entity', e: publicEntity(e) }, ws);
      broadcast({ t: 'sys', msg: `${acc.name} kampusa gəldi.` }, ws);
      send(ws, gallowsState());
      send(ws, ballState());
      send(ws, matchState());
      send(ws, { t: 'stars', s: [...stars.values()] });
      send(ws, { t: 'ammo', ammo: ws.ammo });
      if (e.dead) send(ws, { t: 'dead', id: e.key, by: '', weapon: '', respawn: Math.max(0, e.respawnAt - Date.now()) });
      return;
    }

    if (m.t === 'shoot' && ws.inGame) {
      const e = entities.get(ws.key);
      const now = Date.now();
      if (!e || e.dead || ws.reloading) return;
      if (now - (ws.lastShot || 0) < W.pistol.cooldown) return;
      if (ws.ammo <= 0) return send(ws, { t: 'ammo', ammo: 0 });
      let o = vec3(m.o), d = vec3(m.d);
      if (!o || !d) return;
      const len = Math.hypot(...d);
      if (len < 1e-6) return;
      d = d.map((v) => v / len);
      // atəş nöqtəsi oyunçunun yanında olmalıdır
      const eye = [e.x, e.y + 1.45, e.z];
      if (Math.hypot(o[0] - eye[0], o[1] - eye[1], o[2] - eye[2]) > 2.5) o = eye;
      ws.lastShot = now;
      ws.ammo--;
      e.emote = 0;
      const wallT = Math.min(W.pistol.range, raycastWorld(o, d));
      const hit = raycastEntities(o, d, wallT, e.key);
      const t = hit ? hit.t : wallT;
      const h = o.map((v, i) => +(v + d[i] * t).toFixed(2));
      broadcast({ t: 'shot', id: e.key, o: o.map((v) => +v.toFixed(2)), h, hit: !!hit }, ws);
      send(ws, { t: 'ammo', ammo: ws.ammo });
      if (hit) {
        const dmg = hit.head ? W.pistol.head : W.pistol.dmg;
        const r = damage(hit.e, dmg, e, 'pistol');
        if (r) send(ws, { t: 'hit', id: hit.e.key, dmg, head: hit.head, kill: r.kill, at: h });
      }
      return;
    }

    if (m.t === 'punch' && ws.inGame) {
      const e = entities.get(ws.key);
      const now = Date.now();
      if (!e || e.dead || now - (ws.lastPunch || 0) < W.fist.cooldown) return;
      ws.lastPunch = now;
      e.emote = 0;
      broadcast({ t: 'punch', id: e.key }, ws);
      // qarşıdakı ən yaxın hədəf (±65°)
      const fx = Math.sin(e.ry), fz = Math.cos(e.ry);
      let best = null, bestD = W.fist.range;
      for (const o of entities.values()) {
        if (o === e || o.dead || Math.abs(o.y - e.y) > 1.2) continue;
        const dx = o.x - e.x, dz = o.z - e.z, dist = Math.hypot(dx, dz);
        if (dist > bestD || dist < 1e-3) continue;
        if ((dx * fx + dz * fz) / dist < 0.42) continue;
        best = o; bestD = dist;
      }
      if (best) {
        const r = damage(best, W.fist.dmg, e, 'fist');
        if (r) send(ws, { t: 'hit', id: best.key, dmg: W.fist.dmg, head: false, kill: r.kill, at: [best.x, best.y + 1.4, best.z] });
      }
      return;
    }

    if (m.t === 'kick' && ws.inGame) {
      const e = entities.get(ws.key);
      const b = balls.find((x) => x.id === m.id);
      const now = Date.now();
      if (!e || e.dead || !b || b.resetAt || now - (ws.lastKick || 0) < 350) return;
      if (!canTouchBall(e.key, b)) return send(ws, { t: 'sys', msg: '⛔ Burada matç gedir — topa yalnız oyunçular toxuna bilər.' });
      const vb = b.kind === 'volleyball';
      if (Math.hypot(b.px - e.x, b.pz - e.z) > (vb ? 2.8 : 2.3) || Math.abs(b.py - (e.y + 0.9)) > (vb ? 2.8 : 2.4)) return;
      let v = vec3(m.v);
      if (!v) return;
      const sp = Math.hypot(...v), max = b.kind === 'basketball' ? 20 : 24;
      if (sp > max) v = v.map((c) => (c * max) / sp);
      ws.lastKick = now;
      [b.vx, b.vy, b.vz] = v;
      b.hold = false;
      if (b.py < b.r + 0.05) b.py = b.r + 0.05;
      b.lastKick = e.key;
      e.emote = 0;
      broadcast(ballState());
      broadcast({ t: 'kickFx', id: e.key, ball: b.id }, ws);
      return;
    }

    if (m.t === 'room' && ws.inGame) {
      const e = entities.get(ws.key);
      const r = ROOMS.find((x) => x.id === m.id);
      if (!e || e.dead || !r) return;
      let to = null;
      if (m.act === 'enter' && Math.hypot(e.x - r.door.x, e.z - r.door.z) < 4) to = r.spawn;
      else if (m.act === 'leave' && roomAt(e.x, e.z) === r && Math.hypot(e.x - r.exit.x, e.z - r.exit.z) < 3) to = r.door.out;
      if (!to) return;
      leaveMatch(ws.key, 'meydançanı tərk etdi');
      e.x = to[0]; e.z = to[1]; e.y = 0; e.emote = 0;
      ws.lastPosAt = Date.now();
      ws.examStart = 0;
      return send(ws, { t: 'correct', x: e.x, y: 0, z: e.z });
    }

    // C# imtahanı (kopya missiyası): server yalnız vaxtı və yeri yoxlayıb XP verir
    if (m.t === 'exam' && ws.inGame) {
      const e = entities.get(ws.key);
      if (!e || !roomAt(e.x, e.z)) return;
      const now = Date.now();
      if (m.act === 'start') { ws.examStart = now; return; }
      if (m.act !== 'done' || !ws.examStart) return;
      const took = now - ws.examStart;
      ws.examStart = 0;
      if (took < 20_000) return; // çox tez — saxta nəticə
      const acc = db.accounts[ws.key];
      const correct = Math.max(0, Math.min(5, Math.floor(Number(m.correct) || 0)));
      const caught = !!m.caught, cheated = !!m.cheated;
      const cool = now - (acc.lastExam || 0) < 180_000; // 3 dəqiqədə bir XP

      let xp = 0;
      if (!caught && !cool) xp = correct * 8 + (correct === 5 ? 10 : 0) + (!cheated && correct >= 3 ? 15 : 0);
      if (xp) { addXp(ws.key, xp); acc.lastExam = now; }
      acc.exams = (acc.exams || 0) + 1;
      broadcast({ t: 'sys', msg: caught ? `🚨 ${acc.name} C# imtahanında kopya çəkərkən tutuldu!`
        : `📝 ${acc.name} C# imtahanından ${correct}/5 aldı${cheated ? ' (kopya ilə 😏)' : ' — dürüst! 👏'}` });
      return send(ws, { t: 'examResult', xp, cool });
    }

    if (m.t === 'match' && ws.inGame) {
      if (m.act === 'join') joinMatch(ws, String(m.id), m.team, Number(m.mode));
      else if (m.act === 'leave') leaveMatch(ws.key, 'matçdan çıxdı');
      return;
    }

    if (m.t === 'collect' && ws.inGame) {
      const e = entities.get(ws.key);
      const s = stars.get(String(m.id || ''));
      if (!e || e.dead || !s || Math.hypot(s.x - e.x, s.z - e.z) > 2.6) return;
      stars.delete(s.id);
      acc.stars = (acc.stars || 0) + 1;
      broadcast({ t: 'starGone', id: s.id, by: acc.name });
      addXp(ws.key, 5);
      setTimeout(() => { const n = spawnStar(); if (n) broadcast({ t: 'star', s: n }); }, 45_000);
      return;
    }

    if (m.t === 'board' && ws.inGame) {
      const now = Date.now();
      if (now - (ws.lastBoard || 0) < 800) return;
      ws.lastBoard = now;
      const rows = Object.entries(db.accounts)
        .filter(([, a]) => a.appearance)
        .map(([k, a]) => ({ name: a.name, level: a.level, xp: a.xp, kills: a.kills || 0, deaths: a.deaths || 0, stars: a.stars || 0,
          goals: (a.goals || 0) + (a.baskets || 0), wins: a.wins || 0, online: !!entities.get(k)?.online, me: k === ws.key }))
        .sort((p, q) => q.level - p.level || q.xp - p.xp)
        .slice(0, 12);
      return send(ws, { t: 'board', rows });
    }

    if (m.t === 'reload' && ws.inGame) {
      if (ws.reloading || ws.ammo >= W.pistol.mag) return;
      ws.reloading = true;
      setTimeout(() => {
        ws.reloading = false;
        ws.ammo = W.pistol.mag;
        send(ws, { t: 'ammo', ammo: ws.ammo });
      }, W.pistol.reload);
      return;
    }

    if (m.t === 'gallowsDummy' && ws.inGame) {
      const actor = entities.get(ws.key);
      const now = Date.now();
      const site = SITES[m.site === 'crucifix' ? 'crucifix' : 'gallows'];
      if (!actor || !site) return;
      if (!nearSite(site, actor)) return send(ws, { t: 'error', msg: `Əvvəlcə ${site.where} yaxınlaş.` });
      const name = String(m.name || '');
      if (!DUMMY_NAMES.has(name)) return send(ws, { t: 'error', msg: 'Adı siyahıdan seç.' });
      const appearance = validAppearance(m.appearance);
      if (!appearance) return send(ws, { t: 'error', msg: 'Görünüş yanlışdır.' });
      const wait = DUMMY_COOLDOWN - (now - (ws.lastDummy || 0));
      if (wait > 0) return send(ws, { t: 'error', msg: `Bir az gözlə: ${Math.ceil(wait / 1000)} san.` });
      // boş yer yoxdursa, ən köhnə məhkumu əvəz et
      const slots = site.slots;
      let i = slots.indexOf(null);
      if (i < 0) i = slots.reduce((best, d, j) => (d.until < slots[best].until ? j : best), 0);
      slots[i] = { id: `d${++dummySeq}`, name, appearance, until: now + DUMMY_TIME, by: acc.name };
      ws.lastDummy = now;
      broadcast(gallowsState());
      broadcast({ t: 'sys', msg: `${site.icon} ${acc.name} "${name}" adlı məhkumu ${site.where} gətirdi.` });
      return;
    }

    if (m.t === 'gallowsRemove' && ws.inGame) {
      const actor = entities.get(ws.key);
      const site = Object.values(SITES).find((s) => s.slots.some((d) => d && d.id === m.id));
      if (!actor || !site) return;
      const slots = site.slots;
      const i = slots.findIndex((d) => d && d.id === m.id);
      if (!nearSite(site, actor)) return send(ws, { t: 'error', msg: `Əvvəlcə ${site.where} yaxınlaş.` });
      const d = slots[i];
      slots[i] = null;
      broadcast(gallowsState());
      broadcast({ t: 'sys', msg: `🕊 ${acc.name} "${d.name}" adlı məhkumu azad etdi.` });
      return;
    }

    if (m.t === 'pos' && ws.inGame) {
      const e = entities.get(ws.key);
      if (!e || e.dead) return; // ölü oyunçu hərəkət etmir
      const b = CAMPUS.bounds;
      const x = Number(m.x), y = Number(m.y), z = Number(m.z), ry = Number(m.ry);
      if (![x, y, z, ry].every(Number.isFinite)) return;
      // Teleport qoruması: qaçış sürətindən (7.5 m/s) xeyli sürətli hərəkət qəbul olunmur
      const nowP = Date.now();
      const dtp = Math.min(2, Math.max(0.05, (nowP - (ws.lastPosAt || nowP)) / 1000));
      ws.lastPosAt = nowP;
      if (Math.hypot(x - e.x, z - e.z) > 9.5 * dtp + 2.5) {
        return send(ws, { t: 'correct', x: e.x, y: e.y, z: e.z });
      }
      const rm = roomAt(x, z);
      const lim = rm ? rm.rect : b;
      e.x = Math.min(lim.maxX, Math.max(lim.minX, x));
      e.z = Math.min(lim.maxZ, Math.max(lim.minZ, z));
      e.y = Math.min(10, Math.max(0, y));
      e.ry = ry;
      e.moving = !!m.m;
      // 5 = oturub, 7–12 = yeni emosiyalar (4 və 6 yalnız dar ağacı/çarmıx məhkumları üçündür)
      e.emote = [0, 1, 2, 3, 5, 7, 8, 9, 10, 11, 12, 13].includes(m.e) ? m.e : 0;
      e.w = m.w === 1 ? 1 : 0;
      // Gəzməyə görə XP
      const d = Math.min(3, Math.hypot(e.x - ws.lastPos.x, e.z - ws.lastPos.z));
      ws.lastPos = { x: e.x, z: e.z };
      acc.pos = { x: e.x, z: e.z, ry: e.ry };
      acc.xpFrac = (acc.xpFrac || 0) + d * 0.2;
      if (acc.xpFrac >= 1) {
        const gain = Math.floor(acc.xpFrac);
        acc.xpFrac -= gain;
        addXp(ws.key, gain);
      }
      return;
    }

    if (m.t === 'chat' && ws.inGame) {
      const text = String(m.text || '').replace(/\s+/g, ' ').trim().slice(0, 200);
      if (!text) return;
      const now = Date.now();
      if (now - (ws.lastChat || 0) < 500) return;
      ws.lastChat = now;
      broadcast({ t: 'chat', name: acc.name, text });
    }
  });

  ws.on('close', () => {
    const key = ws.key;
    if (!key || sockets.get(key) !== ws) return;
    sockets.delete(key);
    if (ws.inGame) goOffline(key);
  });
});

// ---------- Oyun dövrü: NPC-lər + vəziyyət paylaşımı (10 Hz) ----------
let last = Date.now();
let tick = 0;
setInterval(() => {
  const now = Date.now();
  const dt = Math.min(0.5, (now - last) / 1000);
  last = now;
  for (const e of entities.values()) {
    if (e.dead) {
      if (now > e.respawnAt) respawn(e);
      continue;
    }
    if (!e.online && e.ai) stepAI(e, dt);
    // can bərpası
    if (e.hp < 100 && now - (e.lastHit || 0) > REGEN_DELAY) {
      e.hp = Math.min(100, e.hp + REGEN_RATE * dt);
      if (Math.abs(Math.round(e.hp) - (e.hpSent ?? 100)) >= 4 || e.hp >= 100) {
        e.hpSent = Math.round(e.hp);
        broadcast({ t: 'hp', id: e.key, hp: e.hpSent });
      }
    }
  }
  // vaxtı bitən məhkumlar yox olur
  let changed = false;
  for (const site of Object.values(SITES)) {
    site.slots.forEach((d, i) => { if (d && now > d.until) { site.slots[i] = null; changed = true; } });
  }
  if (changed) broadcast(gallowsState());
  const snap = [];
  for (const e of entities.values()) {
    snap.push([e.key, +e.x.toFixed(2), +e.y.toFixed(2), +e.z.toFixed(2), +e.ry.toFixed(2), e.moving ? 1 : 0, e.emote || 0,
      e.w || 0, e.dead ? 1 : 0]);
  }
  broadcast({ t: 'snap', e: snap });
  // toplar hərəkətdədirsə və ya saniyədə bir — vəziyyəti göndər
  if (balls.some((b) => b.dirty) || tick % 10 === 0) {
    broadcast(ballState());
    for (const b of balls) b.dirty = false;
  }
  // NPC mövqelərini arabir yadda saxla
  if (++tick % 100 === 0) {
    for (const e of entities.values()) if (!e.online) db.accounts[e.key].pos = { x: e.x, z: e.z, ry: e.ry };
    scheduleSave();
  }
}, 100);

server.listen(PORT, () => {
  console.log(`BMU Online serveri işləyir: http://localhost:${PORT}`);
});
