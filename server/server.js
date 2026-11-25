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
const DATA_DIR = path.join(ROOT, 'data');
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
      e.emote = r < 0.2 ? 1 : r < 0.3 ? 2 : r < 0.36 ? 3 : 0;
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
  serveFile(res, PUBLIC, url === '/' ? 'index.html' : url.slice(1));
});

// ---------- WebSocket ----------
const wss = new WebSocketServer({ server, maxPayload: 16 * 1024 });

function send(ws, msg) { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); }
function broadcast(msg, except) {
  const s = JSON.stringify(msg);
  for (const ws of wss.clients) if (ws !== except && ws.readyState === 1 && ws.inGame) ws.send(s);
}

// ---------- Dar ağacı ----------
const G = CAMPUS.gallows;
// Real oyunçular dar ağacına çəkilmir. Oyunçular uydurma adlı "məhkum" NPC yaradıb göndərir.
const DUMMY_TIME = 120_000;      // məhkum neçə ms qalır
const DUMMY_COOLDOWN = 15_000;   // eyni oyunçu neçə ms-dən bir məhkum göndərə bilər
const DUMMY_NAMES = new Set(OPTIONS.dummyNames);
const slots = new Array(G.slots).fill(null); // { id, name, appearance, until, by }
let dummySeq = 0;
const nearGallows = (e) => Math.hypot(e.x - G.x, e.z - (G.z + 3)) < 9;

function gallowsState() {
  return {
    t: 'gallows',
    slots: slots.map((d) => d && { id: d.id, name: d.name, appearance: d.appearance, by: d.by, left: Math.max(0, d.until - Date.now()) }),
  };
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

const vec3 = (v) => Array.isArray(v) && v.length === 3 && v.every((n) => Number.isFinite(Number(n))) ? v.map(Number) : null;

wss.on('connection', (ws) => {
  ws.key = null;
  ws.inGame = false;

  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m.t !== 'string') return;

    if (m.t === 'login') {
      const name = String(m.name || '').trim();
      const pin = String(m.pin || '');
      if (!/^[\p{L}\p{N}_. -]{3,16}$/u.test(name)) return send(ws, { t: 'loginErr', msg: 'Ad 3-16 simvol olmalıdır (hərf, rəqəm, _ . -).' });
      if (!/^\d{4,8}$/.test(pin)) return send(ws, { t: 'loginErr', msg: 'PIN 4-8 rəqəm olmalıdır.' });
      const key = name.toLowerCase();
      let acc = db.accounts[key];
      let isNew = false;
      if (!acc) {
        const salt = crypto.randomBytes(16).toString('hex');
        acc = db.accounts[key] = { name, salt, hash: hashPin(pin, salt), appearance: null, level: 1, xp: 0, pos: null, createdAt: Date.now() };
        isNew = true;
        scheduleSave();
      } else if (!crypto.timingSafeEqual(Buffer.from(hashPin(pin, acc.salt), 'hex'), Buffer.from(acc.hash, 'hex'))) {
        return send(ws, { t: 'loginErr', msg: 'PIN yanlışdır.' });
      }
      // Eyni hesab başqa yerdə açıqdırsa — köhnəni çıxart
      const old = sockets.get(key);
      if (old && old !== ws) { send(old, { t: 'kicked', msg: 'Bu hesabla başqa yerdən daxil olundu.' }); old.key = null; old.close(); }
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
      if (!actor) return;
      if (!nearGallows(actor)) return send(ws, { t: 'error', msg: 'Əvvəlcə dar ağacına yaxınlaş.' });
      const name = String(m.name || '');
      if (!DUMMY_NAMES.has(name)) return send(ws, { t: 'error', msg: 'Adı siyahıdan seç.' });
      const appearance = validAppearance(m.appearance);
      if (!appearance) return send(ws, { t: 'error', msg: 'Görünüş yanlışdır.' });
      const wait = DUMMY_COOLDOWN - (now - (ws.lastDummy || 0));
      if (wait > 0) return send(ws, { t: 'error', msg: `Bir az gözlə: ${Math.ceil(wait / 1000)} san.` });
      // boş yer yoxdursa, ən köhnə məhkumu əvəz et
      let i = slots.indexOf(null);
      if (i < 0) i = slots.reduce((best, d, j) => (d.until < slots[best].until ? j : best), 0);
      slots[i] = { id: `d${++dummySeq}`, name, appearance, until: now + DUMMY_TIME, by: acc.name };
      ws.lastDummy = now;
      broadcast(gallowsState());
      broadcast({ t: 'sys', msg: `⚖ ${acc.name} "${name}" adlı məhkumu dar ağacına gətirdi.` });
      return;
    }

    if (m.t === 'gallowsRemove' && ws.inGame) {
      const actor = entities.get(ws.key);
      const i = slots.findIndex((d) => d && d.id === m.id);
      if (!actor || i < 0) return;
      if (!nearGallows(actor)) return send(ws, { t: 'error', msg: 'Əvvəlcə dar ağacına yaxınlaş.' });
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
      e.x = Math.min(b.maxX, Math.max(b.minX, x));
      e.z = Math.min(b.maxZ, Math.max(b.minZ, z));
      e.y = Math.min(10, Math.max(0, y));
      e.ry = ry;
      e.moving = !!m.m;
      e.emote = [0, 1, 2, 3].includes(m.e) ? m.e : 0;
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
    const e = entities.get(key);
    if (e && ws.inGame) {
      e.online = false;
      e.w = 0;
      if (!e.dead) startAI(e); // ölüdürsə, yenidən doğulanda AI başlayır
      broadcast({ t: 'entity', e: publicEntity(e) });
      broadcast({ t: 'sys', msg: `${e.name} oyundan çıxdı — xarakteri kampusda gəzməyə davam edir.` });
      scheduleSave();
    }
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
  slots.forEach((d, i) => { if (d && now > d.until) { slots[i] = null; changed = true; } });
  if (changed) broadcast(gallowsState());
  const snap = [];
  for (const e of entities.values()) {
    snap.push([e.key, +e.x.toFixed(2), +e.y.toFixed(2), +e.z.toFixed(2), +e.ry.toFixed(2), e.moving ? 1 : 0, e.emote || 0,
      e.w || 0, e.dead ? 1 : 0]);
  }
  broadcast({ t: 'snap', e: snap });
  // NPC mövqelərini arabir yadda saxla
  if (++tick % 100 === 0) {
    for (const e of entities.values()) if (!e.online) db.accounts[e.key].pos = { x: e.x, z: e.z, ry: e.ry };
    scheduleSave();
  }
}, 100);

server.listen(PORT, () => {
  console.log(`BMU Online serveri işləyir: http://localhost:${PORT}`);
});
