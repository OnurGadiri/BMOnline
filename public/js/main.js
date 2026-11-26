// BMU Online — əsas oyun faylı
import * as THREE from 'three';
import { buildCharacter, animateRig, makeNameTag, setCharacterDefaults } from './character.js';
import { buildWorld, resolveCollisions, gallowsSlot } from './world.js';
import { Creator } from './creator.js';
import { SUN_DIR } from './decor.js';
import { makeSpeechBubble, makePistol } from './character.js';
import { Fx, sfx, makeHpBar, aimPoint } from './combat.js';

const $ = (id) => document.getElementById(id);
const [OPTIONS, CAMPUS] = await Promise.all([
  fetch('/data/options.json').then((r) => r.json()),
  fetch('/data/campus.json').then((r) => r.json()),
]);
setCharacterDefaults(OPTIONS.default);

// ---------- Renderer ----------
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
function resize() { renderer.setSize(window.innerWidth, window.innerHeight, false); }
window.addEventListener('resize', resize);
resize();

const creator = new Creator(OPTIONS);
window.__bmu = { creator }; // konsoldan sazlama üçün

// ---------- Oyun səhnəsi ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color('#d8ecfb');
scene.fog = new THREE.Fog('#c3def3', 180, 700);
const camera = new THREE.PerspectiveCamera(62, 1, 0.25, 1500);
scene.add(new THREE.HemisphereLight('#d6ebff', '#5f7d45', 1.25));
const sun = new THREE.DirectionalLight('#fff0d4', 3.0);
sun.castShadow = true;
const SHADOW = { high: [4096, 60], low: [1024, 40] };
scene.add(sun, sun.target);
let world = null;
const fx = new Fx(scene);

// ---------- Vəziyyət ----------
const state = {
  mode: 'login', // login | creator | game
  name: '', appearance: null, level: 1, xp: 0, xpNext: 50,
  myId: null, inGame: false,
};
const player = {
  char: null, pos: new THREE.Vector3(), vy: 0, ry: 0, onGround: true, speed: 0, emote: 0,
  // döyüş
  hp: 100, weapon: 0, ammo: 12, reloading: false, dead: false, punchT: 0, lastShot: 0, lastPunch: 0, gun: null,
  deathEnd: 0, killer: '',
};
const MAG = 12;
const others = new Map(); // id -> { char, tag, target, ry, moving, emote, online, appKey, level, name }
const cam = { yaw: 0, pitch: 0.3, dist: 6, curDist: 6 };
const keys = new Set();
Object.assign(window.__bmu, { player, others, cam, renderer, scene, camera });

// ---------- Ayarlar ----------
const settings = Object.assign({ sens: 1, invert: false, lock: true, quality: 'high' }, JSON.parse(localStorage.getItem('bmu-settings') || '{}'));
{
  const [size, area] = SHADOW[settings.quality] || SHADOW.high;
  sun.shadow.mapSize.set(size, size);
  Object.assign(sun.shadow.camera, { left: -area, right: area, top: area, bottom: -area, near: 1, far: 260 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  if (settings.quality === 'low') renderer.setPixelRatio(1);
}
function saveSettings() { localStorage.setItem('bmu-settings', JSON.stringify(settings)); }
$('set-sens').value = settings.sens;
$('set-invert').checked = settings.invert;
$('set-lock').checked = settings.lock;
$('set-sens').oninput = (e) => { settings.sens = +e.target.value; saveSettings(); };
$('set-invert').onchange = (e) => { settings.invert = e.target.checked; saveSettings(); };
$('set-lock').onchange = (e) => { settings.lock = e.target.checked; saveSettings(); };
$('set-quality').value = settings.quality;
$('set-quality').onchange = (e) => { settings.quality = e.target.value; saveSettings(); toast('Səhifəni yeniləyəndə (F5) tətbiq olunacaq'); };

// Foto rejimi: interfeysi gizlədir — gözəl skrinşot üçün
function togglePhotoMode() {
  document.body.classList.toggle('photo');
  if (document.body.classList.contains('photo')) toast('📸 Foto rejimi — P ilə çıx');
}
$('btn-settings').onclick = () => { $('settings').hidden = !$('settings').hidden; };

// ---------- Şəbəkə ----------
let ws = null;
function connect() {
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);
  ws.onopen = () => { $('login-btn').disabled = false; };
  ws.onmessage = (ev) => handle(JSON.parse(ev.data));
  ws.onclose = () => {
    if (state.kicked) return;
    showOverlay('Serverlə bağlantı kəsildi.', true);
  };
}
function send(m) { if (ws?.readyState === 1) ws.send(JSON.stringify(m)); }

function handle(m) {
  switch (m.t) {
    case 'loginErr':
      $('login-err').textContent = m.msg;
      $('login-btn').disabled = false;
      break;
    case 'loginOk':
      Object.assign(state, { name: m.name, appearance: m.appearance, level: m.level, xp: m.xp, xpNext: m.xpNext });
      localStorage.setItem('bmu-name', m.name);
      $('login').hidden = true;
      if (!m.appearance) openCreator(true);
      else send({ t: 'join' });
      break;
    case 'charSaved':
      state.appearance = m.appearance;
      creator.close();
      if (!state.inGame) send({ t: 'join' });
      else { setPlayerModel(m.appearance); state.mode = 'game'; $('hud').hidden = false; toast('✔ Xarakter yadda saxlandı'); }
      break;
    case 'welcome': enterGame(m); break;
    case 'entity': upsertEntity(m.e); break;
    case 'snap':
      for (const [id, x, y, z, ry, mv, em, w, dead] of m.e) {
        if (id === state.myId) continue;
        const o = others.get(id);
        if (!o) continue;
        o.target.set(x, y, z);
        o.targetRy = ry;
        o.moving = !!mv;
        o.emote = em || 0;
        o.w = w || 0;
        o.dead = !!dead;
      }
      updateOnlineCount();
      break;
    case 'xp':
      Object.assign(state, { xp: m.xp, level: m.level, xpNext: m.xpNext });
      updateHud();
      if (m.leveled) toast(`🎉 Level ${m.level}!`);
      break;
    case 'chat': addChat(m.name, m.text); break;
    case 'sys': addChat(null, m.msg); break;
    case 'kicked':
      state.kicked = true;
      showOverlay(m.msg, true);
      break;
    case 'error': toast(m.msg); break;
    case 'gallows':
      gallows.slots = m.slots;
      gallows.at = performance.now();
      syncDummies();
      renderGallowsSlots();
      break;

    // ---- döyüş ----
    case 'hp':
      if (m.id === state.myId) {
        if (m.hp < player.hp) { hurtFlash((player.hp - m.hp) / 40); sfx.hurt(); }
        player.hp = m.hp;
        updateCombatHud();
      } else {
        const o = others.get(m.id);
        if (o) { o.hp = m.hp; o.hpBar?.userData.set(m.hp); }
      }
      break;
    case 'correct':
      // server mövqeyi qəbul etmədi (çox sürətli hərəkət) — serverin yerinə qayıt
      player.pos.set(m.x, m.y, m.z);
      player.vy = 0;
      break;
    case 'ammo':
      player.ammo = m.ammo;
      player.reloading = false;
      updateCombatHud();
      break;
    case 'shot': {
      const o = others.get(m.id);
      const from = o?.gunMesh ? o.gunMesh.userData.muzzle.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(...m.o);
      const to = new THREE.Vector3(...m.h);
      fx.tracer(from, to);
      fx.flash(from);
      fx.sparks(to, m.hit);
      sfx.shot(volumeAt(from));
      break;
    }
    case 'punch': {
      const o = others.get(m.id);
      if (o) { o.punchT = 0.001; sfx.punch(volumeAt(o.char.root.position) * 0.8); }
      break;
    }
    case 'hit':
      showHitmarker(m.kill || m.head);
      sfx.hit(m.head);
      fx.damageNumber(new THREE.Vector3(...m.at).add(new THREE.Vector3(0, 0.3, 0)), m.kill ? '💀' : `-${m.dmg}`, m.head ? '#ffd166' : '#ffffff');
      if (m.kill) toast(`💀 ${others.get(m.id)?.name || ''} məğlub oldu! +XP`);
      break;
    case 'dead':
      if (m.id === state.myId) {
        player.dead = true;
        player.hp = 0;
        player.weapon = 0;
        player.emote = 0;
        player.killer = m.by;
        player.deathEnd = performance.now() + (m.respawn ?? 6000);
        if (document.pointerLockElement) document.exitPointerLock();
        attachGun(player, false);
        updateCombatHud();
        $('death').hidden = false;
        $('death-by').textContent = m.by ? `${m.by} səni ${m.weapon === 'pistol' ? 'vurdu' : 'yumruqla yıxdı'}` : '';
      } else {
        const o = others.get(m.id);
        if (o) { o.dead = true; o.hpBar?.userData.set(0); }
      }
      break;
    case 'respawn':
      if (m.id === state.myId) {
        player.dead = false;
        player.hp = 100;
        player.pos.set(m.x, 0, m.z);
        player.vy = 0;
        $('death').hidden = true;
        updateCombatHud();
        toast('🛡 Yenidən doğuldun (3 san qorunursan)');
      } else {
        const o = others.get(m.id);
        if (o) {
          o.dead = false;
          o.target.set(m.x, 0, m.z);
          o.char.root.position.copy(o.target);
          o.char.root.rotation.x = 0;
        }
      }
      break;
  }
}

// ---------- Döyüş: köməkçilər ----------
function volumeAt(p) {
  return Math.max(0, 1 - p.distanceTo(player.pos) / 90);
}
function attachGun(holder, on) {
  // holder: player və ya others-dəki obyekt
  if (on && !holder.gunMesh) {
    holder.gunMesh = makePistol();
    holder.char.rig.handR.add(holder.gunMesh);
  } else if (!on && holder.gunMesh) {
    holder.gunMesh.parent?.remove(holder.gunMesh);
    holder.gunMesh = null;
  }
}
function setWeapon(w) {
  if (player.dead) return;
  player.weapon = w;
  player.emote = 0;
  attachGun(player, w === 1);
  updateCombatHud();
}
function reload() {
  if (player.weapon !== 1 || player.reloading || player.ammo >= MAG || player.dead) return;
  player.reloading = true;
  send({ t: 'reload' });
  sfx.reload();
  updateCombatHud();
}
function attack() {
  if (state.mode !== 'game' || player.dead || gallows.open) return;
  sfx.init();
  const now = performance.now();
  if (player.weapon === 0) {
    if (now - player.lastPunch < 450) return;
    player.lastPunch = now;
    player.punchT = 0.001;
    player.emote = 0;
    // yumruq vuranda kameranın baxdığı tərəfə dön
    player.ry = cam.yaw + Math.PI;
    send({ t: 'punch' });
    sfx.punch(0.7);
    return;
  }
  if (player.reloading || now - player.lastShot < 240) return;
  if (player.ammo <= 0) { sfx.empty(); reload(); return; }
  player.lastShot = now;
  player.ammo--;
  const aim = aimPoint(camera, world, others);
  const right = new THREE.Vector3(Math.cos(cam.yaw), 0, -Math.sin(cam.yaw));
  const origin = player.pos.clone().add(new THREE.Vector3(0, 1.45, 0)).addScaledVector(right, 0.3);
  const dir = aim.clone().sub(origin).normalize();
  send({ t: 'shoot', o: origin.toArray().map((v) => +v.toFixed(3)), d: dir.toArray().map((v) => +v.toFixed(4)) });
  const muzzle = player.gunMesh ? player.gunMesh.userData.muzzle.getWorldPosition(new THREE.Vector3()) : origin;
  fx.tracer(muzzle, aim);
  fx.flash(muzzle);
  fx.sparks(aim, false);
  sfx.shot(1);
  cam.pitch -= 0.018; // geri təpmə
  updateCombatHud();
  if (player.ammo <= 0) setTimeout(reload, 250);
}

Object.assign(window.__bmu, { attack, setWeapon });
let hurtT = 0;
function hurtFlash(k) { hurtT = Math.min(1, hurtT + 0.35 + k); }
let hitmarkT = 0;
function showHitmarker(big) {
  hitmarkT = 0.18;
  $('hitmark').classList.toggle('big', !!big);
}
function updateCombatHud() {
  const hp = Math.max(0, Math.round(player.hp));
  $('hud-hp').style.width = `${hp}%`;
  $('hud-hp').style.background = hp > 50 ? '' : hp > 25 ? '#ffcc00' : '#ff3b30';
  $('hud-hp-text').textContent = `❤ ${hp}`;
  $('w-icon').textContent = player.weapon === 1 ? '🔫' : '👊';
  $('w-name').textContent = player.weapon === 1 ? 'Tapança' : 'Yumruq';
  $('w-ammo').textContent = player.weapon === 1 ? (player.reloading ? 'doldurulur…' : `${player.ammo} / ${MAG}`) : '';
  document.body.classList.toggle('aiming', player.weapon === 1 && !player.dead);
}

// ---------- Dar ağacı (yalnız uydurma məhkum NPC-lər) ----------
const gallows = { slots: [], at: 0, open: false };
const G = CAMPUS.gallows;
const dummies = []; // slot -> { id, char }
function nearGallows() {
  return Math.hypot(player.pos.x - G.x, player.pos.z - (G.z + 3)) < 8;
}
function slotLeft(s) { return Math.max(0, Math.ceil((s.left - (performance.now() - gallows.at)) / 1000)); }

function syncDummies() {
  if (!world) return;
  gallows.slots.forEach((s, i) => {
    const cur = dummies[i];
    if (cur && (!s || cur.id !== s.id)) { scene.remove(cur.char.root); dummies[i] = null; }
    if (s && !dummies[i]) {
      const char = buildCharacter(s.appearance);
      const p = gallowsSlot(G, i);
      char.root.position.set(p.x, p.y, p.z);
      const tag = makeNameTag(s.name, 'məhkum', '#ffcf9a');
      tag.position.y = char.height + 0.35;
      char.root.add(tag);
      scene.add(char.root);
      dummies[i] = { id: s.id, char };
    }
  });
}
function animateDummies(dt) {
  for (const d of dummies) if (d) animateRig(d.char.rig, dt, 0, { emote: 4, struggle: Math.sin(d.char.rig.t * 0.8) > 0.92 });
}

function openGallowsPanel() {
  if (document.pointerLockElement) document.exitPointerLock();
  gallows.open = true;
  $('gallows-panel').hidden = false;
  renderGallowsSlots();
}
function closeGallowsPanel() {
  gallows.open = false;
  $('gallows-panel').hidden = true;
}
$('gp-close').onclick = closeGallowsPanel;
$('gp-create').onclick = () => { closeGallowsPanel(); openCreator(false, 'dummy'); };

function renderGallowsSlots() {
  if (!gallows.open) return;
  const box = $('gp-slots');
  box.replaceChildren();
  const taken = gallows.slots.filter(Boolean);
  if (!taken.length) {
    const d = document.createElement('div');
    d.className = 'gp-empty';
    d.textContent = `Hələ məhkum yoxdur (${G.slots} yer).`;
    box.append(d);
  }
  for (const s of taken) {
    const row = document.createElement('div');
    row.className = 'gp-row';
    const nm = document.createElement('span');
    nm.className = 'nm';
    nm.textContent = s.name;
    nm.title = `${s.by} gətirib`;
    const st = document.createElement('span');
    st.className = 'st';
    st.dataset.slot = s.id;
    st.textContent = `${slotLeft(s)} san`;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'free';
    b.textContent = '🕊 Azad et';
    b.onclick = () => send({ t: 'gallowsRemove', id: s.id });
    row.append(nm, st, b);
    box.append(row);
  }
}
function updateGallowsUi() {
  const near = nearGallows();
  $('prompt').hidden = !near || gallows.open;
  if (gallows.open && !near) closeGallowsPanel();
  if (gallows.open) for (const el of document.querySelectorAll('#gp-slots .st')) {
    const s = gallows.slots.find((x) => x && x.id === el.dataset.slot);
    if (s) el.textContent = `${slotLeft(s)} san`;
  }
}

// ---------- Giriş ----------
$('login-name').value = localStorage.getItem('bmu-name') || '';
$('login-form').onsubmit = (e) => {
  e.preventDefault();
  $('login-err').textContent = '';
  $('login-btn').disabled = true;
  send({ t: 'login', name: $('login-name').value, pin: $('login-pin').value });
};

// ---------- Xarakter redaktoru ----------
function openCreator(first, mode = 'player') {
  if (document.pointerLockElement) document.exitPointerLock();
  keys.clear();
  state.mode = 'creator';
  $('hud').hidden = true;
  creator.open(mode === 'dummy' ? null : state.appearance, { first, name: state.name, mode });
}
creator.onSave = (a, { mode, name }) => {
  if (mode === 'dummy') {
    send({ t: 'gallowsDummy', appearance: a, name });
    creator.close();
    state.mode = 'game';
    $('hud').hidden = false;
  } else send({ t: 'saveChar', appearance: a });
};
creator.onCancel = () => { creator.close(); state.mode = 'game'; $('hud').hidden = false; };
$('btn-customize').onclick = () => openCreator(false);

// ---------- Oyuna giriş ----------
function enterGame(m) {
  if (!world) {
    world = buildWorld(scene, CAMPUS, settings.quality);
    buildStaticNpcs();
  }
  state.myId = m.you.id;
  state.inGame = true;
  state.mode = 'game';
  $('hud').hidden = false;
  player.pos.set(m.you.x, 0, m.you.z);
  player.ry = m.you.ry;
  player.hp = m.you.hp ?? 100;
  player.dead = false;
  cam.yaw = player.ry + Math.PI;
  setPlayerModel(state.appearance);
  updateCombatHud();
  for (const o of others.values()) scene.remove(o.char.root);
  others.clear();
  for (const e of m.entities) upsertEntity(e);
  syncDummies();
  updateHud();
  addChat(null, 'Kampusa xoş gəldin! Siçanı basıb sürüşdürərək ətrafa bax.');
}

// Xəritədə sabit dayanan NPC-lər (məs. dar ağacının yanındakı Rəhman)
const staticNpcs = [];
function buildStaticNpcs() {
  for (const n of CAMPUS.npcs || []) {
    const c = buildCharacter(n.appearance);
    c.root.position.set(n.x, 0, n.z);
    c.root.rotation.y = n.ry || 0;
    const tag = makeNameTag(n.name, null);
    tag.position.y = c.height + 0.3;
    c.root.add(tag);
    let bubble = null;
    if (n.say) {
      bubble = makeSpeechBubble(n.say);
      bubble.position.y = c.height + 0.62;
      c.root.add(bubble);
    }
    scene.add(c.root);
    world.circles.push({ x: n.x, z: n.z, r: 0.45 });
    staticNpcs.push({ c, bubble, emoteT: 3 + Math.random() * 4, emote: 0 });
  }
}
function updateStaticNpcs(dt, t) {
  for (const n of staticNpcs) {
    // arabir əl yelləyir
    n.emoteT -= dt;
    if (n.emoteT <= 0) {
      n.emote = n.emote ? 0 : 1;
      n.emoteT = n.emote ? 2.2 : 6 + Math.random() * 5;
    }
    animateRig(n.c.rig, dt, 0, { emote: n.emote });
    if (n.bubble) n.bubble.position.y = n.c.height + 0.62 + Math.sin(t * 2.2) * 0.05;
  }
}

function setPlayerModel(a) {
  if (player.char) scene.remove(player.char.root);
  player.gunMesh = null;
  player.char = buildCharacter(a);
  scene.add(player.char.root);
  if (player.weapon === 1) attachGun(player, true);
}

function upsertEntity(e) {
  if (e.id === state.myId) return;
  let o = others.get(e.id);
  const appKey = JSON.stringify(e.appearance);
  if (!o) {
    o = { target: new THREE.Vector3(e.x, e.y, e.z), targetRy: e.ry, moving: false, emote: 0 };
    others.set(e.id, o);
  }
  if (o.appKey !== appKey) {
    const prev = o.char?.root;
    o.char = buildCharacter(e.appearance);
    o.char.root.position.copy(prev ? prev.position : o.target);
    o.char.root.rotation.y = prev ? prev.rotation.y : e.ry;
    if (prev) scene.remove(prev);
    scene.add(o.char.root);
    o.appKey = appKey;
    o.tagKey = null;
    o.tag = null;
    o.gunMesh = null;
    o.hpBar = makeHpBar();
    o.hpBar.position.y = o.char.height + 0.64;
    o.char.root.add(o.hpBar);
  }
  if (e.hp !== undefined) { o.hp = e.hp; o.hpBar.userData.set(e.hp); }
  if (e.dead !== undefined) o.dead = e.dead;
  o.online = e.online;
  o.name = e.name;
  o.level = e.level;
  const tagKey = `${e.name}|${e.level}|${e.online}`;
  if (o.tagKey !== tagKey) {
    if (o.tag) o.char.root.remove(o.tag);
    o.tag = makeNameTag(e.name, `Lv ${e.level}${e.online ? '' : ' · oflayn'}`, e.online ? '#ffffff' : '#b0b0b0');
    o.tag.position.y = o.char.height + 0.35;
    o.char.root.add(o.tag);
    o.tagKey = tagKey;
  }
  updateOnlineCount();
}

// ---------- İdarəetmə: klaviatura ----------
const chatInput = $('chat-input');
window.addEventListener('keydown', (e) => {
  if (state.mode !== 'game') return;
  if (document.activeElement === chatInput) {
    if (e.key === 'Enter') {
      const text = chatInput.value.trim();
      if (text) send({ t: 'chat', text });
      chatInput.value = '';
      chatInput.blur();
      $('chat').classList.remove('typing');
    } else if (e.key === 'Escape') { chatInput.blur(); $('chat').classList.remove('typing'); }
    return;
  }
  if (e.target.tagName === 'INPUT') return;
  if (e.key === 'Enter') {
    e.preventDefault();
    if (document.pointerLockElement) document.exitPointerLock();
    $('chat').classList.add('typing');
    chatInput.focus();
    return;
  }
  if (e.code === 'Escape' && gallows.open) { closeGallowsPanel(); return; }
  if (e.code === 'KeyF' && (nearGallows() || gallows.open)) { gallows.open ? closeGallowsPanel() : openGallowsPanel(); return; }
  if (e.code === 'KeyC') { openCreator(false); return; }
  if (e.code === 'KeyP') { togglePhotoMode(); return; }
  if (e.code === 'KeyG') { sfx.init(); setWeapon(player.weapon === 1 ? 0 : 1); return; }
  if (e.code === 'KeyR') { reload(); return; }
  if (e.code === 'Digit1' || e.code === 'Digit2' || e.code === 'Digit3') { setEmote(+e.code.slice(5)); return; }
  if (e.code === 'Space') e.preventDefault();
  keys.add(e.code);
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

function setEmote(n) {
  player.emote = player.emote === n ? 0 : n;
}
document.querySelectorAll('.emotes button').forEach((b) => { b.onclick = () => setEmote(+b.dataset.emote); });

// ---------- İdarəetmə: siçan / kamera ----------
// 1) Siçanı basıb sürüşdürmək həmişə işləyir (sol və ya sağ düymə)
// 2) Ayarlarda aktivdirsə, klik siçanı kilidləyir (GTA rejimi) — Esc ilə çıxılır
let drag = null;
function rotateCamera(dx, dy) {
  const s = 0.0028 * settings.sens;
  cam.yaw -= dx * s;
  cam.pitch += (settings.invert ? -dy : dy) * s;
  cam.pitch = Math.min(1.25, Math.max(-0.35, cam.pitch));
  $('look-hint').classList.add('gone');
}
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
  if (state.mode !== 'game' || document.pointerLockElement === canvas) return;
  drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0 };
  canvas.setPointerCapture(e.pointerId);
  document.body.classList.add('dragging-cam');
});
canvas.addEventListener('pointermove', (e) => {
  if (state.mode !== 'game') return;
  if (document.pointerLockElement === canvas) { rotateCamera(e.movementX, e.movementY); return; }
  if (!drag || drag.id !== e.pointerId) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  drag.x = e.clientX; drag.y = e.clientY;
  drag.moved += Math.abs(dx) + Math.abs(dy);
  rotateCamera(dx, dy);
});
function endDrag(e) {
  if (!drag || drag.id !== e.pointerId) return;
  const wasClick = drag.moved < 5;
  drag = null;
  document.body.classList.remove('dragging-cam');
  if (!wasClick || state.mode !== 'game' || e.button !== 0) return;
  sfx.init();
  if (settings.lock) {
    // ilk klik siçanı kilidləyir; kilidlənəndən sonra kliklər atəş açır
    try { canvas.requestPointerLock()?.catch?.(() => {}); } catch { /* brauzer icazə vermir */ }
  } else {
    attack(); // kilidsiz rejimdə sadə klik = atəş / yumruq
  }
}
// Siçan kilidlidirsə: sol düymə = atəş / yumruq
canvas.addEventListener('mousedown', (e) => {
  if (document.pointerLockElement === canvas && e.button === 0) attack();
});
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
document.addEventListener('pointerlockerror', () => {
  // kilid alınmadısa, kilidsiz rejimə keç ki, klik atəş açsın
  settings.lock = false;
  $('set-lock').checked = false;
  saveSettings();
  toast('Brauzer siçan kilidinə icazə vermədi — klik atəş açır, sürüşdürmək kameranı çevirir.');
});
canvas.addEventListener('wheel', (e) => {
  if (state.mode === 'game') cam.dist = Math.min(14, Math.max(2.2, cam.dist + Math.sign(e.deltaY) * 0.7));
}, { passive: true });

// ---------- HUD ----------
function updateHud() {
  $('hud-name').textContent = state.name;
  $('hud-level').textContent = `Level ${state.level}`;
  $('hud-xp').style.width = `${Math.min(100, (state.xp / state.xpNext) * 100)}%`;
  $('hud-xp-text').textContent = `${state.xp} / ${state.xpNext} XP`;
}
function updateOnlineCount() {
  let on = 1, off = 0;
  for (const o of others.values()) o.online ? on++ : off++;
  $('hud-online').textContent = `🟢 ${on} onlayn · 🚶 ${off} NPC`;
}
function addChat(name, text) {
  const line = document.createElement('div');
  if (name) {
    const b = document.createElement('b');
    b.textContent = name + ': ';
    line.append(b, document.createTextNode(text));
  } else {
    line.className = 'sys';
    line.textContent = text;
  }
  const log = $('chat-log');
  log.append(line);
  while (log.children.length > 60) log.firstChild.remove();
  log.scrollTop = log.scrollHeight;
}
let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2800);
}
function showOverlay(msg, reload) {
  $('overlay-msg').textContent = msg;
  $('overlay-btn').hidden = !reload;
  $('overlay').hidden = false;
}
$('overlay-btn').onclick = () => location.reload();

// ---------- Oyun dövrü ----------
const clock = new THREE.Clock();
let sendTimer = 0, lastSent = '', lastSentAt = 0;
const tmp = new THREE.Vector3();
const ray = new THREE.Raycaster();
const camDir = new THREE.Vector3();

function angleLerp(a, b, t) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function updatePlayer(dt) {
  const root = player.char.root;
  if (player.dead) {
    // yerə yıxılır, hərəkət etmir
    root.rotation.x += (-1.45 - root.rotation.x) * Math.min(1, dt * 6);
    root.position.set(player.pos.x, player.pos.y + 0.12, player.pos.z);
    animateRig(player.char.rig, dt, 0, { dead: true });
    const left = Math.max(0, Math.ceil((player.deathEnd - performance.now()) / 1000));
    $('death-time').textContent = left ? `${left} saniyə sonra yenidən doğulacaqsan…` : 'Yenidən doğulursan…';
    return;
  }
  root.rotation.x += (0 - root.rotation.x) * Math.min(1, dt * 8);
  const fwd = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
  const str = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
  const turn = (keys.has('KeyQ') ? 1 : 0) - (keys.has('KeyE') ? 1 : 0);
  if (turn) { cam.yaw += turn * 2.2 * dt; $('look-hint').classList.add('gone'); }
  const sprint = keys.has('ShiftLeft') || keys.has('ShiftRight');
  let mx = 0, mz = 0;
  if (fwd || str) {
    const fx = -Math.sin(cam.yaw), fz = -Math.cos(cam.yaw);
    const rx = Math.cos(cam.yaw), rz = -Math.sin(cam.yaw);
    mx = fx * fwd + rx * str;
    mz = fz * fwd + rz * str;
    const l = Math.hypot(mx, mz);
    mx /= l; mz /= l;
  }
  const target = (mx || mz) ? (sprint && player.weapon !== 1 ? 7.5 : player.weapon === 1 ? 3.6 : 4) : 0;
  // yumşaq sürətlənmə
  player.speed += (target - player.speed) * Math.min(1, dt * 10);
  if (mx || mz) { player.dirX = mx; player.dirZ = mz; }
  const sp = player.speed;
  if (sp > 0.01 && player.dirX !== undefined) {
    player.pos.x += player.dirX * sp * dt;
    player.pos.z += player.dirZ * sp * dt;
  }
  const aiming = player.weapon === 1;
  if (aiming) player.ry = angleLerp(player.ry, cam.yaw + Math.PI, Math.min(1, dt * 20)); // tapança ilə həmişə nişana baxır
  else if (mx || mz) player.ry = angleLerp(player.ry, Math.atan2(mx, mz), Math.min(1, dt * 12));
  if (player.punchT > 0) { player.punchT += dt / 0.32; if (player.punchT >= 1) player.punchT = 0; }

  if (keys.has('Space') && player.onGround) { player.vy = 7; player.onGround = false; }
  player.vy -= 20 * dt;
  player.pos.y += player.vy * dt;
  if (player.pos.y <= 0) { player.pos.y = 0; player.vy = 0; player.onGround = true; }
  if (target > 0 || !player.onGround) player.emote = 0; // hərəkət emosiyanı dayandırır

  resolveCollisions(player.pos, 0.4, world);
  player.char.root.position.copy(player.pos);
  player.char.root.rotation.y = player.ry;
  animateRig(player.char.rig, dt, sp / 4, {
    air: !player.onGround, emote: player.emote, weapon: player.weapon, aim: cam.pitch, punch: player.punchT,
  });

  sendTimer += dt;
  if (sendTimer >= 0.1) {
    sendTimer = 0;
    const msg = { t: 'pos', x: +player.pos.x.toFixed(2), y: +player.pos.y.toFixed(2), z: +player.pos.z.toFixed(2), ry: +player.ry.toFixed(2), m: target ? 1 : 0, e: player.emote, w: player.weapon };
    const k = JSON.stringify(msg);
    const now = performance.now();
    if (k !== lastSent || now - lastSentAt > 1000) { send(msg); lastSent = k; lastSentAt = now; }
  }
}

const aimOffset = new THREE.Vector3();
function updateCamera(dt) {
  // Tapança ilə: kamera sağ çiyin arxasına yaxınlaşır
  const aiming = player.weapon === 1 && !player.dead;
  const k = Math.min(1, dt * 8);
  aimOffset.lerp(aiming ? new THREE.Vector3(Math.cos(cam.yaw) * 0.65, 0.1, -Math.sin(cam.yaw) * 0.65) : new THREE.Vector3(), k);
  const target = tmp.set(player.pos.x, player.pos.y + 1.55, player.pos.z).add(aimOffset);
  const cp = Math.cos(cam.pitch);
  camDir.set(Math.sin(cam.yaw) * cp, Math.sin(cam.pitch), Math.cos(cam.yaw) * cp).normalize();
  // Kamera binanın içinə girməsin
  let want = aiming ? Math.min(cam.dist, 3.3) : cam.dist;
  ray.set(target, camDir);
  ray.far = want;
  const hit = ray.intersectObjects(world.blockers, false)[0];
  if (hit) want = Math.max(0.8, hit.distance - 0.35);
  cam.curDist += (want - cam.curDist) * Math.min(1, dt * (want < cam.curDist ? 20 : 5));
  camera.position.copy(target).addScaledVector(camDir, cam.curDist);
  if (camera.position.y < 0.3) camera.position.y = 0.3;
  camera.lookAt(target);
  camera.aspect = canvas.clientWidth / canvas.clientHeight;
  camera.updateProjectionMatrix();
  // kölgə kamerası oyunçunu izləyir
  sun.position.copy(player.pos).addScaledVector(SUN_DIR, 120);
  sun.target.position.copy(player.pos);
}

function updateOthers(dt) {
  const t = Math.min(1, dt * 10);
  for (const o of others.values()) {
    const r = o.char.root;
    const bx = r.position.x, bz = r.position.z;
    r.position.lerp(o.target, t);
    if (r.position.distanceTo(o.target) > 15) r.position.copy(o.target);
    r.rotation.y = angleLerp(r.rotation.y, o.targetRy, t);
    // ölüm: yerə yıxılır
    r.rotation.x += ((o.dead ? -1.45 : 0) - r.rotation.x) * Math.min(1, dt * 6);
    if (o.dead) r.position.y = o.target.y + 0.12;
    const wantGun = o.w === 1 && !o.dead;
    if (wantGun !== !!o.gunMesh) attachGun(o, wantGun);
    if (o.punchT > 0) { o.punchT += dt / 0.32; if (o.punchT >= 1) o.punchT = 0; }
    const v = Math.hypot(r.position.x - bx, r.position.z - bz) / Math.max(dt, 1e-3);
    animateRig(o.char.rig, dt, o.dead ? 0 : o.moving ? Math.max(0.35, v / 4) : 0, {
      air: !o.dead && r.position.y > 0.05, emote: o.emote, weapon: o.w, punch: o.punchT || 0, dead: o.dead,
    });
  }
}

function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, clock.getDelta());
  if (state.mode === 'creator') {
    creator.render(renderer, dt);
    return;
  }
  if (!state.inGame || !world) {
    renderer.setClearColor('#1b2838');
    renderer.clear();
    return;
  }
  updatePlayer(dt);
  updateOthers(dt);
  animateDummies(dt);
  updateStaticNpcs(dt, clock.elapsedTime);
  updateGallowsUi();
  updateCamera(dt);
  world.update(clock.elapsedTime, dt, camera);
  fx.update(dt);
  // zərər effekti və isabət işarəsi
  hurtT = Math.max(0, hurtT - dt * 1.6);
  $('hurt').style.opacity = Math.max(hurtT, player.dead ? 0.55 : player.hp < 30 ? 0.25 + Math.sin(clock.elapsedTime * 5) * 0.08 : 0);
  hitmarkT = Math.max(0, hitmarkT - dt);
  $('hitmark').style.opacity = hitmarkT > 0 ? 1 : 0;
  renderer.render(scene, camera);
}

connect();
loop();
