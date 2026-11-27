// BMU Online — əsas oyun faylı
import * as THREE from 'three';
import { buildCharacter, animateRig, makeNameTag, setCharacterDefaults } from './character.js';
import { buildWorld, resolveCollisions, gallowsSlot, crucifixSlot } from './world.js';
import { Creator } from './creator.js';
import { SUN_DIR } from './decor.js';
import { makeSpeechBubble, makePistol, makeCigarette } from './character.js';
import { Fx, sfx, makeHpBar, aimPoint } from './combat.js';
import { Minimap } from './minimap.js';
import { Play, BALL_G } from './play.js';
import { initTouch, touchInput, isTouchDevice } from './touch.js';
import { buildBirds } from './birds.js';
import { buildClassroom, buildRoomDoor } from './classroom.js';
import { initExam } from './exam.js';

const TOUCH = isTouchDevice();

const $ = (id) => document.getElementById(id);
const [OPTIONS, CAMPUS] = await Promise.all([
  fetch('/data/options.json').then((r) => r.json()),
  fetch('/data/campus.json').then((r) => r.json()),
]);
setCharacterDefaults(OPTIONS.default);
const minimap = new Minimap(CAMPUS, document.getElementById('minimap'));

// ---------- Renderer ----------
const canvas = $('view');
// Keyfiyyət əvvəlcədən oxunur (renderer yaradılarkən antialias lazımdır)
const LOW = (JSON.parse(localStorage.getItem('bmu-settings') || '{}').quality || (TOUCH ? 'low' : 'high')) === 'low';
// telefonda MSAA çox bahalıdır — onun yerinə piksel sıxlığı adaptiv idarə olunur
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !LOW && !TOUCH, powerPreference: 'high-performance' });
const DPR_MAX = LOW ? (TOUCH ? Math.min(1.25, window.devicePixelRatio) : 1) : Math.min(2, window.devicePixelRatio);
let dpr = DPR_MAX;
renderer.setPixelRatio(dpr);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = LOW ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
// uzaqdakı personajlar: gizlət / seyrək animasiya (metr)
const LOD = LOW ? { hide: 90, slow: 45 } : { hide: 160, slow: 70 };
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
let rooms = []; // sinif otağı nüsxələri (classroom.js)
let exam = null; // çoxoyunçulu C# imtahanı (exam.js)
let play = null; // toplar, ulduzlar
let updateBirds = null;
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
const cam = { yaw: 0, pitch: 0.3, dist: 6, curDist: 6, fp: false };
const keys = new Set();
Object.assign(window.__bmu, { player, others, cam, renderer, scene, camera });

// ---------- Ayarlar ----------
// telefonda: siçan kilidi yoxdur, keyfiyyət aşağı (istifadəçi ayarlarda dəyişə bilər)
const settings = Object.assign({ sens: 1, invert: false, lock: !TOUCH, quality: TOUCH ? 'low' : 'high' }, JSON.parse(localStorage.getItem('bmu-settings') || '{}'));
if (TOUCH) settings.lock = false;
// köhnə versiya brauzer xətasında kilidi həmişəlik söndürüb yadda saxlayırdı — bir dəfəlik geri qaytarırıq
if (!settings.lockFix) { settings.lock = !TOUCH; settings.lockFix = 1; localStorage.setItem('bmu-settings', JSON.stringify(settings)); }
{
  const [size, area] = SHADOW[settings.quality] || SHADOW.high;
  sun.shadow.mapSize.set(size, size);
  Object.assign(sun.shadow.camera, { left: -area, right: area, top: area, bottom: -area, near: 1, far: 260 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  if (LOW) {
    // aşağı keyfiyyət: kölgə hər kadr yox, iki kadrdan bir yenilənir; görmə məsafəsi qısalır
    sun.shadow.autoUpdate = false;
    camera.far = 650; scene.fog.near = 140; scene.fog.far = 520;
  }
}
// Adaptiv çözünürlük: FPS düşəndə piksel sıxlığı azalır, düzələndə geri qalxır
const perf = { acc: 0, n: 0, frame: 0, slowFor: 0, fastFor: 0 };
function adaptResolution(rawDt) {
  perf.acc += rawDt; perf.n++;
  if (perf.acc < 1) return;
  const fps = perf.n / perf.acc; perf.acc = 0; perf.n = 0;
  if (document.hidden) return;
  if (fps < 40) { perf.slowFor++; perf.fastFor = 0; } else if (fps > 56) { perf.fastFor++; perf.slowFor = 0; } else { perf.slowFor = perf.fastFor = 0; }
  let next = dpr;
  if (perf.slowFor >= 2) { next = Math.max(0.6, dpr - 0.15); perf.slowFor = 0; }
  else if (perf.fastFor >= 4) { next = Math.min(DPR_MAX, dpr + 0.1); perf.fastFor = 0; }
  if (Math.abs(next - dpr) > 0.01) { dpr = next; renderer.setPixelRatio(dpr); resize(); }
  window.__bmu.fps = Math.round(fps); window.__bmu.dpr = dpr;
  if (settings.fps) $('fps').textContent = `${Math.round(fps)} FPS · ${dpr.toFixed(2)}x`;
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
  if (!document.body.classList.contains('photo')) return;
  toast(TOUCH ? '📸 Foto rejimi — çıxmaq üçün ekrana iki dəfə toxun' : '📸 Foto rejimi — P ilə çıx');
  if (TOUCH) {
    // telefonda bütün düymələr gizlənir — iki dəfə toxunmaqla çıxılır
    let last = 0;
    const exit = () => {
      const now = performance.now();
      if (now - last < 350) { document.body.classList.remove('photo'); window.removeEventListener('touchend', exit); }
      last = now;
    };
    setTimeout(() => window.addEventListener('touchend', exit), 400);
  }
}
$('btn-settings').onclick = () => { $('settings').hidden = !$('settings').hidden; };
$('btn-safe').onclick = (ev) => { ev.currentTarget.blur(); toggleSafe(); };

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
      showAuthError(m.msg, m.code);
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
    case 'loggedOut': backToLogin(); break;
    case 'kicked':
      state.kicked = true;
      showOverlay(m.msg, true);
      break;
    case 'error': toast(m.msg); break;
    case 'gallows':
      if (SITES.gallows) SITES.gallows.slots = m.slots || [];
      if (SITES.crucifix) SITES.crucifix.slots = m.crucifix || [];
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
    // ---- interaksiyalar ----
    case 'balls':
      play?.setBalls(m.b);
      break;
    case 'safe':
      if (m.err) toast(m.err);
      else if (!!m.on !== !!player.safe) toast(m.on ? '🛡 Təhlükəsiz rejim AÇIQDIR — səni heç kim vura bilməz, sən də heç kimi vura bilməzsən.' : '⚔ Təhlükəsiz rejim söndürüldü — artıq vurula bilərsən.');
      player.safe = !!m.on;
      if (player.safe && player.weapon) setWeapon(0);
      updateCombatHud();
      break;
    case 'combatOff':
      if (player.weapon) setWeapon(0);
      shieldToast(m.why);
      break;
    case 'tpOk':
      toggleTeleport(false);
      toast(`🧭 ${m.name}`);
      sfx.chime?.(0.5);
      break;
    case 'tpErr':
      toast(m.msg);
      break;
    case 'xlist': case 'xstart': case 'xs': case 'xreveal': case 'xsay': case 'xout': case 'xend':
      exam?.onMsg(m);
      break;
    case 'matches':
      setMatches(m.m);
      break;
    case 'mstart': {
      const mm = matchList.find((x) => x.id === m.id);
      if (mySide(mm)) { bigBanner('▶ BAŞLA!'); sfx.cheer(); closeMatchPanel(); }
      break;
    }
    case 'mscore': {
      const mm = matchList.find((x) => x.id === m.id);
      if (mm) mm.score = m.score;
      if (mySide(mm) || venuesHere().some((c) => c.id === m.id)) {
        const c = MATCHES.find((x) => x.id === m.id);
        const team = c?.names?.[m.side] || m.side;
        sfx.cheer();
        bigBanner(`${c?.title.split(' ')[0] || ''} ${m.by || team}  ${m.score.A} : ${m.score.B}`);
      }
      updateMatchHud(true);
      break;
    }
    case 'mend': {
      const side = m.kA.includes(state.myId) ? 'A' : m.kB.includes(state.myId) ? 'B' : null;
      const near = venuesHere().some((c) => c.id === m.id);
      if (side || near) {
        bigBanner(!m.win ? `🤝 Heç-heçə ${m.score.A}:${m.score.B}`
          : side === m.win ? `🏆 QALİB GƏLDİN! ${m.score.A}:${m.score.B}`
          : side ? `😞 Uduzdun ${m.score.A}:${m.score.B}` : `🏆 ${m.names.join(', ')} qalib`);
        if (side === m.win || !side) sfx.cheer();
      }
      break;
    }
    case 'kickFx': {
      const o = others.get(m.id);
      if (o) { o.punchT = 0.001; sfx.kick(volumeAt(o.char.root.position)); }
      const kb = play?.balls.get(m.ball);
      if (kb) { kb.kickBy = m.id; kb.kickAt = performance.now(); }
      break;
    }
    case 'kickoff': {
      if (!m.side) { kickoffs.delete(m.ball); break; }
      kickoffs.set(m.ball, { side: m.side, until: performance.now() + 8000 });
      const mm = matchList.find((x) => x.id === m.id);
      const c = MATCHES.find((x) => x.id === m.id);
      if (mm && (mySide(mm) || venuesHere().some((v) => v.id === m.id))) {
        const team = c?.names?.[m.side] || m.side;
        const mine = mySide(mm) === m.side;
        toast(c?.ball === 'volley' ? `🏐 Servis: ${team}${mine ? ' — sən vur!' : ''}` : `${mine ? '▶ Topu SİZ başlayırsınız' : `⏳ Topu ${team} başlayır`}`);
      }
      break;
    }
    case 'score':
      sfx.cheer();
      bigBanner(m.kind === 'goal' ? `⚽ QOOOL! — ${m.by}` : `🏀 SƏBƏT! — ${m.by}`);
      break;
    case 'stars':
      play?.setStars(m.s);
      break;
    case 'star':
      play?.addStar(m.s);
      break;
    case 'starGone':
      play?.removeStar(m.id);
      if (m.by === state.name) { sfx.chime(); toast('⭐ Ulduz tapdın! +5 XP'); }
      break;
    case 'board':
      renderBoard(m.rows);
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
      if (m.by) killFeed(m.by, m.id === state.myId ? state.name : others.get(m.id)?.name, m.weapon);
      if (m.id === state.myId) {
        player.dead = true;
        player.hp = 0;
        player.weapon = 0;
        player.emote = 0;
        player.sitting = null;
        inter.charging = false;
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
        toast('🛡 Yenidən doğuldun (3 san qorunursan) · 🧭 T — sürətli yol');
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
// ---------- 🚬 Tüstüxana: siqaret yalnız Prefabrik 1-in yanındakı zonada (server də yoxlayır) ----------
const SMOKE_ZONE = CAMPUS.smokeArea?.zone || null;
const inSmokeZone = (p) => !!SMOKE_ZONE && Math.hypot(p.x - SMOKE_ZONE.x, p.z - SMOKE_ZONE.z) < SMOKE_ZONE.r;
function toggleSmoke() {
  if (state.mode !== 'game' || player.dead) return;
  if (player.smoking) return stopSmoking('🚬 Siqareti söndürdün.');
  if (!inSmokeZone(player.pos)) return toast('🚬 Siqareti yalnız Tüstüxanada (Prefabrik 1-in yanında) çəkmək olar.');
  if (player.weapon) setWeapon(0);
  player.smoking = true;
  player.emote = player.sitting ? 15 : player.speed > 0.3 ? 0 : 14;
  toast('🚬 Siqaret yandırdın — K ilə söndür.');
}
function stopSmoking(msg) {
  player.smoking = false;
  if (player.emote === 14) player.emote = 0;
  if (player.emote === 15) player.emote = 5;
  if (msg) toast(msg);
}
function updateSmoking(dt) {
  if (player.smoking) {
    if (player.dead || !inSmokeZone(player.pos)) stopSmoking(player.dead ? '' : '🚬 Tüstüxanadan çıxdın — siqareti söndürdün.');
    else if (player.sitting) { if (player.emote === 5) player.emote = 15; }
    else if (player.emote === 0 && player.speed < 0.3 && player.onGround) player.emote = 14; // dayananda yenə çəkir
  }
  smokeHolder(player, player.dead ? 0 : player.emote, dt, true);
  updateSmokeFx(dt);
  const chip = $('smoke-chip');
  const show = state.mode === 'game' && !player.dead && (player.smoking || inSmokeZone(player.pos));
  if (chip.hidden === show) chip.hidden = !show;
  const txt = player.smoking ? '🚬 Söndür (K)' : '🚬 Siqaret çək (K)';
  if (show && chip.dataset.t !== txt) { chip.dataset.t = txt; chip.textContent = txt; }
}
// tüstü: yumşaq, yuxarı qalxıb genişlənən və sönən spraytlar (hovuzla)
const smokeTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  gr.addColorStop(0, 'rgba(240,240,240,0.95)');
  gr.addColorStop(1, 'rgba(240,240,240,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();
const smokeFx = { pool: [], live: [] };
function puff(pos, vx, vy, vz, size, life, alpha) {
  let sp = smokeFx.pool.pop();
  if (!sp) {
    if (smokeFx.live.length > 160) return;
    sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, transparent: true, depthWrite: false, color: '#c9c9c9' }));
  }
  sp.position.copy(pos);
  sp.userData = { vx, vy, vz, size, life, age: 0, alpha, ph: Math.random() * 6 };
  sp.scale.setScalar(size);
  sp.material.opacity = alpha;
  scene.add(sp);
  smokeFx.live.push(sp);
}
function updateSmokeFx(dt) {
  for (let i = smokeFx.live.length - 1; i >= 0; i--) {
    const sp = smokeFx.live[i], u = sp.userData;
    u.age += dt;
    if (u.age >= u.life) { scene.remove(sp); smokeFx.live.splice(i, 1); smokeFx.pool.push(sp); continue; }
    const k = u.age / u.life;
    sp.position.x += (u.vx + Math.sin(u.age * 2.6 + u.ph) * 0.06) * dt;
    sp.position.y += u.vy * dt;
    sp.position.z += (u.vz + Math.cos(u.age * 2.1 + u.ph) * 0.06) * dt;
    u.vx *= 1 - dt * 1.5; u.vz *= 1 - dt * 1.5;
    sp.scale.setScalar(u.size * (1 + k * 3.5));
    sp.material.opacity = u.alpha * (1 - k) * Math.min(1, u.age * 6);
  }
}
const smokeV = new THREE.Vector3(), smokeF = new THREE.Vector3();
/** Əldə siqaret (emosiya 14/15) və ondan çıxan tüstü; ağızdan vaxtaşırı tüstü buraxılır */
function smokeHolder(h, emote, dt, near) {
  const want = (emote === 14 || emote === 15) && near && !!h.char;
  if (want && !h.cigMesh) { h.cigMesh = makeCigarette(); h.char.rig.handR.add(h.cigMesh); }
  else if (!want && h.cigMesh) { h.cigMesh.parent?.remove(h.cigMesh); h.cigMesh = null; }
  if (!h.cigMesh) { h.lastU = undefined; return; }
  h.smokeAcc = (h.smokeAcc || 0) + dt;
  if (h.smokeAcc > 0.28) {
    h.smokeAcc = 0;
    h.cigMesh.userData.tip.getWorldPosition(smokeV);
    puff(smokeV, 0, 0.32, 0, 0.07, 2.4, 0.5);
  }
  const u = h.char.rig.smokeU ?? 0;
  if (h.lastU !== undefined && h.lastU < 2.15 && u >= 2.15) {
    // ağızdan tüstü buraxır
    h.char.rig.head.getWorldPosition(smokeV);
    const ry = h.char.root.rotation.y;
    smokeF.set(Math.sin(ry), 0, Math.cos(ry));
    smokeV.addScaledVector(smokeF, 0.14);
    smokeV.y += 0.02;
    for (let i = 0; i < 10; i++) puff(smokeV, smokeF.x * (0.35 + i * 0.07), 0.18 + i * 0.03, smokeF.z * (0.35 + i * 0.07), 0.14, 2.8, 0.7);
  }
  h.lastU = u;
}

// ---------- 🛡 Qoruma: təhlükəsiz rejim, matç, imtahan otağı (server də eyni qaydanı yoxlayır) ----------
const SHIELD_TEXT = {
  safe: { name: 'Təhlükəsiz rejim', msg: '🛡 Təhlükəsiz rejimdəsən — silah yoxdur (B ilə söndür).' },
  match: { name: 'Matç — döyüş yoxdur', msg: '⚽ Matç gedir — matç vaxtı döyüşmək olmur.' },
  room: { name: 'İmtahan — döyüş yoxdur', msg: '📝 İmtahan otağında döyüşmək olmur.' },
};
/** Mən qorunuram? 'safe' | 'match' | 'room' | null */
function myShield() {
  if (player.safe) return 'safe';
  if (activeMyMatch()) return 'match';
  if (roomHere()) return 'room';
  return null;
}
/** Başqa oyunçu qorunur? (vurmaq olmaz, güllə içindən keçir) */
function otherShielded(id, o) {
  if (o.safe) return true;
  if (matchList.some((m) => (m.state === 'play' || m.state === 'count') && (m.kA.includes(id) || m.kB.includes(id)))) return true;
  const p = o.char?.root.position;
  return !!p && rooms.some((r) => { const b = r.bounds; return p.x > b.minX - 1 && p.x < b.maxX + 1 && p.z > b.minZ - 1 && p.z < b.maxZ + 1; });
}
let shieldToastAt = 0;
function shieldToast(why) {
  const now = performance.now();
  if (now - shieldToastAt < 1500) return;
  shieldToastAt = now;
  toast(SHIELD_TEXT[why]?.msg || SHIELD_TEXT.safe.msg);
}
function toggleSafe() {
  if (state.mode !== 'game' || player.dead) return;
  send({ t: 'safe', on: !player.safe });
}
function setWeapon(w) {
  if (player.dead) return;
  const sh = w === 1 && myShield();
  if (sh) { shieldToast(sh); return; }
  if (w === 1 && player.smoking) stopSmoking('');
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
  const sh = myShield();
  if (sh) { shieldToast(sh); return; }
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
  // qorunan oyunçular hədəf deyil — güllə onların içindən keçir (server də belə hesablayır)
  const aim = aimPoint(camera, world, { values: () => [...others].filter(([id, o]) => !otherShielded(id, o)).map(([, o]) => o) });
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
  const sh = myShield();
  $('w-icon').textContent = sh ? '🛡' : player.weapon === 1 ? '🔫' : '👊';
  const ta = document.getElementById('tbtn-attack');
  if (ta) ta.textContent = sh ? '🛡' : player.weapon === 1 ? '🔫' : '👊';
  $('w-name').textContent = sh ? SHIELD_TEXT[sh].name : player.weapon === 1 ? 'Tapança' : 'Yumruq';
  $('w-ammo').textContent = !sh && player.weapon === 1 ? (player.reloading ? 'doldurulur…' : `${player.ammo} / ${MAG}`) : '';
  document.body.classList.toggle('aiming', player.weapon === 1 && !player.dead && !sh);
  document.body.classList.toggle('shielded', !!sh);
  const bs = document.getElementById('btn-safe');
  if (bs) { bs.textContent = player.safe ? '🛡 Təhlükəsiz rejim: AÇIQ (B)' : '🛡 Təhlükəsiz rejim: bağlı (B)'; bs.classList.toggle('on', !!player.safe); }
}

// ---------- Dar ağacı və çarmıx (yalnız uydurma məhkum NPC-lər) ----------
// Hər yer: konfiqurasiya, məhkum yerinin hesablanması, poza, başlıqlar
const SITES = {
  gallows: { cfg: CAMPUS.gallows, slotPos: gallowsSlot, emote: 4, front: 3, title: '⚖ Dar ağacı', where: 'dar ağacına', slots: [], dummies: [] },
  crucifix: { cfg: CAMPUS.crucifix, slotPos: crucifixSlot, emote: 6, front: 2.5, title: '✝ Çarmıx', where: 'çarmıxa', slots: [], dummies: [] },
};
for (const k of Object.keys(SITES)) if (!SITES[k].cfg) delete SITES[k];
const gallows = { at: 0, open: false, site: 'gallows', pendingSite: 'gallows' };
/** Oyunçu hansı yerin yanındadır ('gallows' | 'crucifix' | null) */
function nearSite() {
  let best = null, bd = 8;
  for (const [k, s] of Object.entries(SITES)) {
    const d = Math.hypot(player.pos.x - s.cfg.x, player.pos.z - (s.cfg.z + s.front));
    if (d < bd) { bd = d; best = k; }
  }
  return best;
}
const nearGallows = () => !!nearSite();
function slotLeft(s) { return Math.max(0, Math.ceil((s.left - (performance.now() - gallows.at)) / 1000)); }

function syncDummies() {
  if (!world) return;
  for (const site of Object.values(SITES)) {
    site.slots.forEach((s, i) => {
      const cur = site.dummies[i];
      if (cur && (!s || cur.id !== s.id)) { scene.remove(cur.char.root); site.dummies[i] = null; }
      if (s && !site.dummies[i]) {
        const char = buildCharacter(s.appearance);
        const p = site.slotPos(site.cfg, i);
        char.root.position.set(p.x, p.y, p.z);
        const tag = makeNameTag(s.name, 'məhkum', '#ffcf9a');
        tag.position.y = char.height + 0.35;
        char.root.add(tag);
        scene.add(char.root);
        site.dummies[i] = { id: s.id, char };
      }
    });
  }
}
function animateDummies(dt) {
  for (const site of Object.values(SITES)) {
    for (const d of site.dummies) {
      if (d) animateRig(d.char.rig, dt, 0, { emote: site.emote, struggle: Math.sin(d.char.rig.t * 0.8) > 0.92 });
    }
  }
}

function openGallowsPanel(siteKey) {
  if (document.pointerLockElement) document.exitPointerLock();
  gallows.site = siteKey;
  gallows.open = true;
  $('gp-title').textContent = SITES[siteKey].title;
  $('gallows-panel').hidden = false;
  renderGallowsSlots();
}
function closeGallowsPanel() {
  gallows.open = false;
  $('gallows-panel').hidden = true;
}
$('gp-close').onclick = closeGallowsPanel;
$('gp-create').onclick = () => { gallows.pendingSite = gallows.site; closeGallowsPanel(); openCreator(false, 'dummy'); };

function renderGallowsSlots() {
  if (!gallows.open) return;
  const site = SITES[gallows.site];
  const box = $('gp-slots');
  box.replaceChildren();
  const taken = site.slots.filter(Boolean);
  if (!taken.length) {
    const d = document.createElement('div');
    d.className = 'gp-empty';
    d.textContent = `Hələ məhkum yoxdur (${site.cfg.slots} yer).`;
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
  const near = nearSite();
  $('prompt').hidden = !near || gallows.open;
  if (near) $('prompt').innerHTML = `<b>F</b> ${SITES[near].title.slice(2)}`;
  if (gallows.open && near !== gallows.site) closeGallowsPanel();
  if (gallows.open) for (const el of document.querySelectorAll('#gp-slots .st')) {
    const s = SITES[gallows.site].slots.find((x) => x && x.id === el.dataset.slot);
    if (s) el.textContent = `${slotLeft(s)} san`;
  }
}

// ---------- Giriş və qeydiyyat (iki ayrı ekran, eyni kartda) ----------
let authMode = 'login';
function setAuthMode(mode) {
  authMode = mode;
  const reg = mode === 'register';
  $('login-form').dataset.mode = mode;
  $('tab-login').classList.toggle('on', !reg);
  $('tab-register').classList.toggle('on', reg);
  $('tab-login').setAttribute('aria-selected', String(!reg));
  $('tab-register').setAttribute('aria-selected', String(reg));
  $('pin2-row').hidden = !reg;
  $('login-pin2').required = reg;
  $('login-pin').autocomplete = reg ? 'new-password' : 'current-password';
  $('login-sub').textContent = reg ? 'Yeni hesab: ad seç və PIN-i iki dəfə yaz.' : 'Kampusa xoş gəldin! Adını və PIN-ini yaz.';
  $('login-btn').textContent = reg ? 'Qeydiyyatdan keç' : 'Daxil ol';
  $('switch-text').textContent = reg ? 'Hesabın var?' : 'Hesabın yoxdur?';
  $('switch-btn').textContent = reg ? 'Daxil ol' : 'Qeydiyyatdan keç';
  $('login-hint').textContent = reg ? 'PIN 4-8 rəqəmdir. Onu unutma — bərpa etmək olmur.' : 'PIN-i unutma — onu bərpa etmək olmur.';
  $('login-err').replaceChildren();
}
/** Xəta + lazım olsa digər ekrana keçid düyməsi (məs. "Belə hesab yoxdur" → Qeydiyyat) */
function showAuthError(msg, code) {
  const box = $('login-err');
  box.replaceChildren(document.createTextNode(msg));
  const go = code === 'noAcc' ? 'register' : code === 'taken' ? 'login' : null;
  if (go) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'linkbtn';
    b.textContent = go === 'register' ? 'Qeydiyyata keç →' : 'Daxil ol →';
    b.onclick = () => { setAuthMode(go); $('login-pin').focus(); };
    box.append(' ', b);
  }
}
$('tab-login').onclick = () => setAuthMode('login');
$('tab-register').onclick = () => setAuthMode('register');
$('switch-btn').onclick = () => setAuthMode(authMode === 'login' ? 'register' : 'login');
$('login-name').value = localStorage.getItem('bmu-name') || '';
// əvvəllər girməyibsə — qeydiyyat ekranı ilə başla
setAuthMode(localStorage.getItem('bmu-name') ? 'login' : 'register');
$('login-form').onsubmit = (e) => {
  e.preventDefault();
  $('login-err').replaceChildren();
  const name = $('login-name').value, pin = $('login-pin').value;
  if (authMode === 'register' && pin !== $('login-pin2').value) return showAuthError('PIN-lər eyni deyil.');
  $('login-btn').disabled = true;
  send(authMode === 'register' ? { t: 'register', name, pin, pin2: $('login-pin2').value } : { t: 'login', name, pin });
};

// ---------- Xarakter redaktoru ----------
function openCreator(first, mode = 'player') {
  if (document.pointerLockElement) document.exitPointerLock();
  keys.clear();
  touchCtl?.reset();
  state.mode = 'creator';
  $('hud').hidden = true;
  creator.open(mode === 'dummy' ? null : state.appearance, { first, name: state.name, mode });
}
creator.onSave = (a, { mode, name }) => {
  if (mode === 'dummy') {
    send({ t: 'gallowsDummy', appearance: a, name, site: gallows.pendingSite });
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
    play = new Play(scene, CAMPUS, sfx);
    window.__bmu.play = play;
    buildStaticNpcs();
    // ayrıca otaqlar (Kapital Bank Room) və kampusdakı qapıları
    world.rooms = [];
    rooms = [];
    for (const cfg of CAMPUS.rooms || []) {
      buildRoomDoor(scene, cfg);
      for (let k = 0; k < (cfg.instances || 1); k++) {
        const room = buildClassroom(scene, cfg, world, k);
        world.rooms.push(room.bounds);
        rooms.push(room);
      }
    }
    exam = initExam({ rooms, $, player, state, sit, stand, send, toast, bigBanner, sfx });
    Object.assign(window.__bmu, { rooms, exam });
    updateBirds = buildBirds(scene, CAMPUS.spawn, LOW ? 9 : 18);
  }
  state.myId = m.you.id;
  state.inGame = true;
  state.mode = 'game';
  $('hud').hidden = false;
  player.pos.set(m.you.x, 0, m.you.z);
  player.ry = m.you.ry;
  player.hp = m.you.hp ?? 100;
  player.dead = false;
  player.safe = !!m.you.safe;
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
  player.cigMesh = null;
  player.char = buildCharacter(a);
  scene.add(player.char.root);
  player.char.rig.head.visible = !cam.fp;
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
    o.cigMesh = null;
    o.hpBar = makeHpBar();
    o.hpBar.position.y = o.char.height + 0.64;
    o.char.root.add(o.hpBar);
  }
  if (e.hp !== undefined) { o.hp = e.hp; o.hpBar.userData.set(e.hp); }
  if (e.dead !== undefined) o.dead = e.dead;
  o.online = e.online;
  o.name = e.name;
  o.level = e.level;
  o.safe = !!e.safe;
  const tagKey = `${e.name}|${e.level}|${e.online}|${o.safe}`;
  if (o.tagKey !== tagKey) {
    if (o.tag) o.char.root.remove(o.tag);
    o.tag = makeNameTag(e.name, `${o.safe ? '🛡 ' : ''}Lv ${e.level}${e.online ? '' : ' · oflayn'}`, e.online ? '#ffffff' : '#b0b0b0');
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
  if (state.mode === 'game' && exam?.key(e.code, true)) { e.preventDefault(); return; }
  if (e.code === 'Escape' && gallows.open) { closeGallowsPanel(); return; }
  if (e.code === 'Escape' && mpanel.open) { closeMatchPanel(); return; }
  if (e.code === 'Escape' && !$('tp-panel').hidden) { toggleTeleport(false); return; }
  if (e.code === 'KeyF' && (nearGallows() || gallows.open)) { gallows.open ? closeGallowsPanel() : openGallowsPanel(nearSite()); return; }
  if (e.code === 'KeyF') { if (!e.repeat) interactDown(); return; }
  if (e.code === 'Tab') {
    e.preventDefault();
    if (!e.repeat) { send({ t: 'board' }); $('board').hidden = false; }
    return;
  }
  if (e.code === 'KeyC') { openCreator(false); return; }
  if (e.code === 'KeyP') { togglePhotoMode(); return; }
  if (e.code === 'KeyM') { minimap.toggle(); return; }
  if (e.code === 'KeyG') { sfx.init(); setWeapon(player.weapon === 1 ? 0 : 1); return; }
  if (e.code === 'KeyR') { reload(); return; }
  if (/^Digit[1-9]$/.test(e.code)) { const em = EMOTES[+e.code.slice(5) - 1]; if (em) setEmote(em.id); return; }
  if (e.code === 'KeyV') { toggleFirstPerson(); return; }
  if (e.code === 'KeyH') { setHelpHidden(!settings.hideHelp); return; }
  if (e.code === 'KeyU') { setMinimal(!document.body.classList.contains('minimal-ui')); return; }
  if (e.code === 'KeyT') { toggleTeleport(); return; }
  if (e.code === 'KeyB') { if (!e.repeat) toggleSafe(); return; }
  if (e.code === 'KeyK') { if (!e.repeat) toggleSmoke(); return; }
  if (e.code === 'Space') e.preventDefault();
  keys.add(e.code);
});
window.addEventListener('keyup', (e) => {
  keys.delete(e.code);
  if (exam?.key(e.code, false)) return;
  if (e.code === 'KeyF') interactUp();
  if (e.code === 'Tab') $('board').hidden = true;
});
window.addEventListener('blur', () => keys.clear());

// Emosiyalar: düymə 1–9 (id serverə gedir; 4/5/6 oturma və məhkum pozaları üçün ayrılıb)
const EMOTES = [
  { id: 1, icon: '👋', name: 'Salam' }, { id: 2, icon: '💃', name: 'Rəqs' }, { id: 3, icon: '🙌', name: 'Sevinc' },
  { id: 7, icon: '👏', name: 'Əl çal' }, { id: 8, icon: '🫡', name: 'Hərbi salam' }, { id: 9, icon: '🤔', name: 'Düşün' },
  { id: 10, icon: '😂', name: 'Gül' }, { id: 11, icon: '🤦', name: 'Üz-əl' }, { id: 12, icon: '💪', name: 'Şinav' },
];
function setEmote(n) {
  if (player.sitting || player.dead) return;
  if (player.smoking) stopSmoking('');
  player.emote = player.emote === n ? 0 : n;
  if (player.emote && player.weapon) setWeapon(0);
  updateEmoteBar();
}
{
  const list = $('emote-list');
  EMOTES.forEach((em, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.title = `${em.name} (${i + 1})`;
    b.dataset.emote = em.id;
    b.innerHTML = `<span></span><small></small>`;
    b.firstChild.textContent = em.icon;
    b.lastChild.textContent = String(i + 1);
    b.onclick = () => setEmote(em.id);
    list.append(b);
  });
  $('emote-toggle').onclick = () => document.body.classList.toggle('show-emotes');
}
function updateEmoteBar() {
  for (const b of $('emote-list').children) b.classList.toggle('on', +b.dataset.emote === player.emote);
}

// Kömək sətri və minimal interfeys (seçim yadda qalır)
function setHelpHidden(h) {
  settings.hideHelp = h;
  saveSettings();
  document.body.classList.toggle('hide-help', h);
  $('set-help').checked = !h;
}
function setMinimal(on) {
  settings.minimal = on;
  saveSettings();
  document.body.classList.toggle('minimal-ui', on);
  $('set-minimal').checked = on;
}
$('help-close').onclick = () => setHelpHidden(true);
$('set-help').onchange = (e) => setHelpHidden(!e.target.checked);
$('set-minimal').onchange = (e) => setMinimal(e.target.checked);
setHelpHidden(!!settings.hideHelp);
setMinimal(!!settings.minimal);
$('set-fps').checked = !!settings.fps;
$('fps').hidden = !settings.fps;
$('set-fps').onchange = (e) => { settings.fps = e.target.checked; saveSettings(); $('fps').hidden = !settings.fps; };

// Öldürmə lenti (sağ yuxarı): "A 🔫 B"
setTimeout(() => { window.__bmu.killFeed = killFeed; });
function killFeed(by, victim, weapon) {
  const row = document.createElement('div');
  const mine = by === state.name || victim === state.name;
  row.className = 'kf' + (mine ? ' mine' : '');
  const b = document.createElement('b'); b.textContent = by || '?';
  const v = document.createElement('b'); v.textContent = victim || '?';
  row.append(b, ` ${weapon === 'pistol' ? '🔫' : '👊'} `, v);
  const box = $('killfeed');
  box.prepend(row);
  while (box.children.length > 4) box.lastChild.remove();
  setTimeout(() => row.classList.add('out'), 5000);
  setTimeout(() => row.remove(), 5600);
}

// Sürətli yol (teleport) paneli — T və ya mobil 🧭
function toggleTeleport(on = $('tp-panel').hidden) {
  $('tp-panel').hidden = !on;
  if (!on) return;
  if (document.pointerLockElement) document.exitPointerLock();
  const box = $('tp-list');
  box.replaceChildren();
  for (const p of CAMPUS.teleports || []) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tp-btn';
    b.textContent = p.name;
    const d = Math.round(Math.hypot(p.x - player.pos.x, p.z - player.pos.z));
    const s = document.createElement('small');
    s.textContent = ` ${d} m`;
    b.append(s);
    b.onclick = () => send({ t: 'tp', id: p.id });
    box.append(b);
  }
}
$('tp-close').onclick = () => toggleTeleport(false);

// Birinci şəxs görünüşü
function toggleFirstPerson(on = !cam.fp) {
  cam.fp = on;
  fpInit = false;
  // üçüncü şəxsdəki "yuxarıdan baxış" birinci şəxsdə yerə baxmaq olardı — üfüqə yaxın başla
  if (on) cam.pitch = Math.min(cam.pitch, 0.08);
  else cam.pitch = Math.max(0.15, Math.min(1.25, cam.pitch));
  if (player.char) player.char.rig.head.visible = !on;
  document.body.classList.toggle('fp', on);
  toast(on ? '👁 Birinci şəxs (V — geri)' : '🎥 Üçüncü şəxs');
}

// ---------- İdarəetmə: siçan / kamera ----------
// 1) Siçanı basıb sürüşdürmək həmişə işləyir (sol və ya sağ düymə)
// 2) Ayarlarda aktivdirsə, klik siçanı kilidləyir (GTA rejimi) — Esc ilə çıxılır
let drag = null;
function rotateCamera(dx, dy) {
  const s = 0.0028 * settings.sens;
  cam.yaw -= dx * s;
  cam.pitch += (settings.invert ? -dy : dy) * s;
  cam.pitch = cam.fp ? Math.min(1.35, Math.max(-1.3, cam.pitch)) : Math.min(1.25, Math.max(-0.35, cam.pitch));
  $('look-hint').classList.add('gone');
}
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
  // toxunmaları touch.js idarə edir (joystik + kamera), burada yalnız siçan
  if (e.pointerType === 'touch' || state.mode !== 'game' || document.pointerLockElement === canvas) return;
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
    lockTries = 0;
    requestLock();
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
// ---------- Mobil idarəetmə ----------
const KEY_NAMES = { Space: ' ', Enter: 'Enter', Tab: 'Tab', Escape: 'Escape' };
const touchCtl = TOUCH ? initTouch({
  isGame: () => state.mode === 'game' && !gallows.open,
  rotateCamera: (dx, dy) => rotateCamera(dx, dy),
  attack: () => attack(),
  logout: () => askLogout(),
  key: (code, down) => window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, key: KEY_NAMES[code] || code.replace(/^Key|^Digit/, '').toLowerCase() })),
}) : null;

// Siçan kilidi. Brauzer Esc-dən sonra ~1 saniyə yenidən kilidləməyə icazə vermir (pointerlockerror) —
// əvvəllər bu xəta kilidi həmişəlik söndürürdü və kamera yalnız basıb sürüşdürməklə dönürdü.
// İndi ayar dəyişmir: bir az gözləyib yenidən cəhd edirik.
let lockTries = 0;
function requestLock() {
  if (state.mode !== 'game' || document.pointerLockElement === canvas) return;
  try { canvas.requestPointerLock()?.catch?.(() => {}); } catch { /* brauzer icazə vermir */ }
}
document.addEventListener('pointerlockerror', () => {
  if (++lockTries <= 2) { setTimeout(requestLock, 1100); return; }
  toast('Siçan kilidlənmədi — bir saniyə sonra ekrana yenidən klik et.');
});
function updateLockHint() {
  const show = settings.lock && !TOUCH && state.mode === 'game' && document.pointerLockElement !== canvas
    && !document.querySelector('.gpanel:not([hidden]), #settings:not([hidden])'); // panel açıqdırsa göstərmə
  $('lock-hint').hidden = !show;
}
document.addEventListener('pointerlockchange', updateLockHint);
setInterval(updateLockHint, 500);
canvas.addEventListener('wheel', (e) => {
  if (state.mode !== 'game') return;
  // tam yaxınlaşanda birinci şəxsə keçir, geri fırladanda üçüncü şəxsə qayıdır
  if (e.deltaY < 0 && cam.dist <= 2.2 && !cam.fp) { toggleFirstPerson(true); return; }
  if (e.deltaY > 0 && cam.fp) { toggleFirstPerson(false); cam.dist = 2.2; return; }
  cam.dist = Math.min(14, Math.max(2.2, cam.dist + Math.sign(e.deltaY) * 0.7));
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
// ---------- Çıxış (logout): təsdiq, sonra səhifəni yeniləmədən giriş ekranına ----------
function askLogout() {
  if (!state.inGame) return;
  if (document.pointerLockElement) document.exitPointerLock();
  $('settings').hidden = true;
  document.body.classList.remove('menu-open', 'show-emotes');
  $('logout-confirm').hidden = false;
}
$('btn-logout').onclick = askLogout;
$('logout-no').onclick = () => { $('logout-confirm').hidden = true; };
$('logout-yes').onclick = () => { $('logout-confirm').hidden = true; send({ t: 'logout' }); };
function backToLogin() {
  Object.assign(state, { inGame: false, mode: 'login', myId: null });
  keys.clear();
  inter.charging = false;
  if (document.pointerLockElement) document.exitPointerLock();
  Object.assign(player, { sitting: null, emote: 0, smoking: false, safe: false, dead: false, weapon: 0 });
  if (player.char) attachGun(player, false);
  exam?.reset();
  if (gallows.open) closeGallowsPanel();
  closeMatchPanel();
  toggleTeleport(false);
  for (const id of ['board', 'settings', 'logout-confirm']) $(id).hidden = true;
  for (const o of others.values()) scene.remove(o.char.root);
  others.clear();
  $('hud').hidden = true;
  document.body.classList.remove('in-room', 'shielded', 'aiming', 'in-exam', 'menu-open', 'show-emotes', 'photo');
  // ad yadda qalır, PIN yox
  $('login-pin').value = '';
  $('login-pin2').value = '';
  setAuthMode('login');
  $('login-name').value = localStorage.getItem('bmu-name') || state.name || '';
  $('login-btn').disabled = false;
  $('login').hidden = false;
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
  let fwd = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
  let str = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
  // mobil joystik: analoq dəyər (kiçik ölü zona ilə)
  let stickMag = 1;
  if (touchInput.active && Math.hypot(touchInput.mx, touchInput.my) > 0.15) {
    fwd = -touchInput.my;
    str = touchInput.mx;
    stickMag = Math.min(1, Math.hypot(fwd, str));
  }
  // skamyada oturub: hərəkət düyməsi basılana qədər yerində qalır
  if (player.sitting) {
    if (fwd || str || keys.has('Space')) stand();
    else {
      root.position.copy(player.pos);
      root.rotation.y = player.ry;
      animateRig(player.char.rig, dt, 0, { emote: player.emote === 13 || player.emote === 15 ? player.emote : 5 });
      sendPos(dt, false);
      return;
    }
  }
  const turn = (keys.has('KeyQ') ? 1 : 0) - (keys.has('KeyE') ? 1 : 0);
  if (turn) { cam.yaw += turn * 2.2 * dt; $('look-hint').classList.add('gone'); }
  const sprint = keys.has('ShiftLeft') || keys.has('ShiftRight') || (touchInput.active && touchInput.sprint);
  let mx = 0, mz = 0;
  if (fwd || str) {
    const fx = -Math.sin(cam.yaw), fz = -Math.cos(cam.yaw);
    const rx = Math.cos(cam.yaw), rz = -Math.sin(cam.yaw);
    mx = fx * fwd + rx * str;
    mz = fz * fwd + rz * str;
    const l = Math.hypot(mx, mz);
    mx /= l; mz /= l;
  }
  const target = (mx || mz) ? (sprint && player.weapon !== 1 ? 7.5 : (player.weapon === 1 ? 3.6 : 4) * Math.max(0.35, stickMag)) : 0;
  // yumşaq sürətlənmə
  player.speed += (target - player.speed) * Math.min(1, dt * 10);
  if (mx || mz) { player.dirX = mx; player.dirZ = mz; }
  const sp = player.speed;
  if (sp > 0.01 && player.dirX !== undefined) {
    player.pos.x += player.dirX * sp * dt;
    player.pos.z += player.dirZ * sp * dt;
  }
  const aiming = player.weapon === 1 || cam.fp; // birinci şəxsdə də bədən baxış tərəfinə dönür
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

  sendPos(dt, target > 0);
}

/** Mövqeni serverə saniyədə 10 dəfə (dəyişibsə) göndərir */
function sendPos(dt, moving) {
  sendTimer += dt;
  if (sendTimer < 0.1) return;
  sendTimer = 0;
  const msg = { t: 'pos', x: +player.pos.x.toFixed(2), y: +player.pos.y.toFixed(2), z: +player.pos.z.toFixed(2), ry: +player.ry.toFixed(2), m: moving ? 1 : 0, e: player.emote, w: player.weapon };
  const k = JSON.stringify(msg);
  const now = performance.now();
  if (k !== lastSent || now - lastSentAt > 1000) { send(msg); lastSent = k; lastSentAt = now; }
}

// ---------- İnteraksiyalar (F): oturmaq, topa vurmaq ----------
const inter = { current: null, charging: false, charge: 0, ball: null };
function roomHere() {
  return rooms.find((r) => { const b = r.bounds; return player.pos.x > b.minX - 1 && player.pos.x < b.maxX + 1 && player.pos.z > b.minZ - 1 && player.pos.z < b.maxZ + 1; }) || null;
}
function findInteraction() {
  if (player.dead || state.mode !== 'game' || !world) return null;
  if (player.sitting) return { kind: 'stand', label: 'Qalx' };
  const nb = play?.nearestBall(player.pos);
  const vb = nb?.ball.cfg.kind === 'volleyball';
  if (nb && nb.dist < (vb ? 2.6 : 2.0) && Math.abs(nb.ball.py - player.pos.y) < (vb ? 3.2 : 2.2)) {
    const label = vb ? (nb.ball.hold ? 'Servis — basılı saxla (güc)' : 'Topa vur!')
      : nb.ball.cfg.kind === 'basketball' ? 'Səbətə at — basılı saxla, ortada burax' : 'Topa vur — basılı saxla (güc)';
    return { kind: 'ball', ball: nb.ball, label };
  }
  let best = null, bd = 1.7;
  for (const s of world.seats) {
    const d = Math.hypot(s.x - player.pos.x, s.z - player.pos.z);
    if (d < bd) { bd = d; best = s; }
  }
  // otaq qapıları və imtahan
  for (const cfg of CAMPUS.rooms || []) {
    if (Math.hypot(player.pos.x - cfg.door.x, player.pos.z - cfg.door.z) < 3.2) return { kind: 'xdoor', label: `📝 ${cfg.title} — C# imtahanı (lobbi)` };
  }
  for (const r of rooms) {
    if (Math.hypot(player.pos.x - r.cfg.exit.x, player.pos.z - r.cfg.exit.z) < 2.2) return { kind: 'xexit', label: exam?.on ? '🚪 Çıx (imtahanı tərk et)' : '🚪 Otaqdan çıx' };
  }
  if (best) return { kind: 'sit', seat: best, label: 'Otur' };
  if (!mpanel.open && venuesHere().length && !activeMyMatch()) return { kind: 'match', label: 'Matç paneli (1v1 / 2v2)' };
  return null;
}
function sit(seat) {
  if (player.weapon) setWeapon(0);
  player.sitting = seat;
  player.pos.set(seat.x, 0, seat.z);
  player.ry = seat.ry;
  player.vy = 0;
  player.speed = 0;
  player.emote = player.smoking ? 15 : 5;
}
function stand() {
  const s = player.sitting;
  player.sitting = null;
  player.emote = 0;
  if (s?.out) { player.pos.x += s.out[0]; player.pos.z += s.out[1]; }
  else if (s) { player.pos.x += Math.sin(s.ry) * 0.95; player.pos.z += Math.cos(s.ry) * 0.95; }
}
function interactDown() {
  const it = inter.current;
  if (!it) return;
  sfx.init();
  if (it.kind === 'sit') sit(it.seat);
  else if (it.kind === 'stand') stand();
  else if (it.kind === 'match') openMatchPanel();
  else if (it.kind === 'xdoor') exam?.openLobby();
  else if (it.kind === 'xexit') send({ t: 'xleave' });
  else if (it.kind === 'ball') {
    // voleybolda top uçarkən gözləməyə vaxt yoxdur — dərhal vurulur
    if (it.ball.cfg.kind === 'volleyball' && !it.ball.hold) { kickBall(it.ball, 0.55); return; }
    inter.charging = true; inter.charge = 0; inter.ball = it.ball;
  }
}
function interactUp() {
  if (!inter.charging) return;
  inter.charging = false;
  kickBall(inter.ball, inter.charge);
}
function kickBall(b, p) {
  const vb = b?.cfg.kind === 'volleyball';
  if (!b || player.dead || Math.hypot(b.px - player.pos.x, b.pz - player.pos.z) > (vb ? 2.7 : 2.3)) return;
  if (!canKickBall(b)) return; // server onsuz da rədd edir — top yerli olaraq tərpənib geri sıçramasın
  b.kickBy = state.myId; b.kickAt = performance.now();
  // server vurulan topu yerdən 5 sm qaldırır — trayektoriya da həmin nöqtədən hesablanmalıdır (yoxsa atış uzun düşür)
  if (b.py < b.cfg.r + 0.05) b.py = b.cfg.r + 0.05;
  let v;
  if (vb) {
    // tora doğru hündür qövs; güc uçuş məsafəsini təyin edir
    let fx = -Math.sin(cam.yaw), fz = -Math.cos(cam.yaw);
    const side = mySide(matchList.find((m) => m.id === 'volleyball' && m.state === 'play'));
    if (side) {
      const want = side === 'A' ? 1 : -1; // A komandası z-in kiçik tərəfindədir, rəqib +z tərəfdə
      if (fz * want < 0.55) { fz = want * 0.8; fx = Math.sign(fx || 1) * 0.6; }
    }
    const d = 6 + 7 * p, T = 1.3 + 0.3 * p;
    v = [(fx * d) / T, (0.15 - b.py + 0.5 * BALL_G * T * T) / T, (fz * d) / T];
  } else if (b.cfg.kind === 'basketball') {
    // halqaya ~45° ilə düşən qövs (ballphys.js); güc zolağının ortası (p≈0.5) dəqiq atışdır,
    // az güc — qısa (ön çənbər), çox güc — uzun (lövhə / arxa çənbər)
    v = globalThis.BallPhys.basketAim(b, b.cfg.hoop, p);
  } else {
    const fx = -Math.sin(cam.yaw), fz = -Math.cos(cam.yaw);
    const sp = 6 + 16 * p;
    v = [fx * sp, 1.2 + 5.5 * p * p, fz * sp];
  }
  send({ t: 'kick', id: b.cfg.id, v: v.map((x) => +x.toFixed(3)) });
  [b.vx, b.vy, b.vz] = v; // dərhal yerli təsir, server sonra təsdiqləyir
  player.punchT = 0.001;
  player.ry = Math.atan2(v[0], v[2]);
  sfx.kick(1);
}
function updateInteractions(dt) {
  inter.current = inter.charging ? inter.current : findInteraction();
  const it = inter.current;
  const p = $('iprompt');
  p.hidden = !it || gallows.open || nearGallows();
  if (it) p.innerHTML = `<b>F</b> ${it.label}`;
  if (inter.charging) {
    inter.charge = Math.min(1, inter.charge + dt / 1.1);
    if (!inter.ball || Math.hypot(inter.ball.px - player.pos.x, inter.ball.pz - player.pos.z) > 2.4) inter.charging = false;
  }
  $('charge').hidden = !inter.charging;
  $('charge-fill').style.width = `${inter.charge * 100}%`;
  $('charge').classList.toggle('basket', inter.ball?.cfg.kind === 'basketball');
  play?.update(dt, clock.elapsedTime, player.pos, !player.dead && state.mode === 'game', send, ballBodies, ballMatch);
}
// Topa dəyən bədənlər (klient proqnozu üçün, server də eyni qaydanı tətbiq edir):
// matç gedirsə yalnız matç oyunçuları, vuran oyunçu 0.3 san nəzərə alınmır
function ballMatch(b) {
  const c = MATCHES.find((x) => x.ball === b.cfg.id);
  const mm = c && matchList.find((x) => x.id === c.id);
  return mm && (mm.state === 'play' || mm.state === 'count') ? mm : null;
}
function ballBodies(b) {
  const bd = b.cfg.bounds, now = performance.now(), out = [];
  const mm = ballMatch(b);
  const add = (id, p) => {
    if (p.x < bd.minX - 1 || p.x > bd.maxX + 1 || p.z < bd.minZ - 1 || p.z > bd.maxZ + 1) return;
    if (mm && !mm.kA.includes(id) && !mm.kB.includes(id)) return;
    if (b.kickBy === id && now - b.kickAt < 300) return;
    out.push(p);
  };
  if (!player.dead && state.mode === 'game') add(state.myId, player.pos);
  for (const [id, o] of others) if (!o.dead) add(id, o.char.root.position);
  return out;
}
// Başlanğıc vuruşu: qol buraxan komanda başlayır (server göndərir)
const kickoffs = new Map(); // ball id -> { side, until }
function canKickBall(b) {
  const mm = ballMatch(b);
  if (!mm) return true;
  const side = mySide(mm);
  if (!side) { toast('⛔ Burada matç gedir — topa yalnız oyunçular toxuna bilər.'); return false; }
  const ko = kickoffs.get(b.cfg.id);
  if (mm.state === 'play' && ko && performance.now() < ko.until && ko.side !== side) { toast('⏳ Başlanğıc vuruşunu rəqib edir — gözlə.'); return false; }
  return true;
}

// ---------- Matçlar (futbol / basketbol / voleybol — 1v1, 2v2) ----------
const MATCHES = CAMPUS.matches || [];
const TEAM_COL = { A: '#3a86ff', B: '#e63946' };
let matchList = [];
const mpanel = { open: false, mode: {} };
const mySide = (m) => (!m ? null : m.kA.includes(state.myId) ? 'A' : m.kB.includes(state.myId) ? 'B' : null);
const myMatch = () => matchList.find((m) => mySide(m));
const activeMyMatch = () => { const m = myMatch(); return m && (m.state === 'count' || m.state === 'play') ? m : null; };
function venuesHere() {
  const p = player.pos;
  return MATCHES.filter((c) => p.x >= c.area.minX && p.x <= c.area.maxX && p.z >= c.area.minZ && p.z <= c.area.maxZ);
}
function setMatches(list) {
  const now = performance.now();
  matchList = list.map((m) => ({ ...m, endsAtL: now + m.left * 1000, startAtL: now + m.start * 1000 }));
  if (mpanel.open) renderMatchPanel();
  updateMatchHud(true);
}
function sendMatch(act, id, team, mode) { send({ t: 'match', act, id, team, mode }); }
function openMatchPanel() {
  mpanel.open = true;
  if (document.pointerLockElement) document.exitPointerLock();
  renderMatchPanel();
}
function closeMatchPanel() { mpanel.open = false; $('match-panel').hidden = true; }
$('mp-close').onclick = closeMatchPanel;
$('mchip').onclick = () => (mpanel.open ? closeMatchPanel() : openMatchPanel());
$('smoke-chip').onclick = (ev) => { ev.currentTarget.blur(); toggleSmoke(); };

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function renderMatchPanel() {
  const here = venuesHere(), mine = myMatch();
  const cfgs = MATCHES.filter((c) => here.includes(c) || mine?.id === c.id);
  if (!cfgs.length) { closeMatchPanel(); return; }
  $('match-panel').hidden = false;
  const box = $('mp-list');
  box.replaceChildren();
  for (const c of cfgs) {
    const m = matchList.find((x) => x.id === c.id) || { state: 'idle', mode: 0, A: [], B: [], kA: [], kB: [], score: { A: 0, B: 0 } };
    const side = mySide(m);
    const card = el('div', 'mp-card');
    const st = { idle: 'Boşdur', wait: `${m.mode}v${m.mode} — oyunçu gözlənilir`, count: 'Başlayır…', play: `Gedir · ${m.score.A}:${m.score.B}`, end: `Bitdi · ${m.score.A}:${m.score.B}` }[m.state];
    const head = el('div', 'mp-title');
    head.append(el('b', null, c.title), el('span', 'mp-state ' + m.state, st));
    card.append(head, el('div', 'mp-sub', `İlk ${c.target} xal · ${Math.round(c.time / 60 * 10) / 10} dəq`));
    const open = m.state === 'idle' || m.state === 'wait' || m.state === 'end';
    let mode = m.state === 'wait' ? m.mode : (mpanel.mode[c.id] || 1);
    if (m.state === 'idle' || m.state === 'end') {
      const row = el('div', 'mp-modes');
      for (const n of [1, 2]) {
        const b = el('button', 'mp-mode' + (mode === n ? ' on' : ''), `${n}v${n}`);
        b.type = 'button';
        b.onclick = () => { mpanel.mode[c.id] = n; renderMatchPanel(); };
        row.append(b);
      }
      card.append(row);
    }
    const teams = el('div', 'mp-teams');
    for (const t of ['A', 'B']) {
      const col = el('div', 'mp-team');
      col.style.borderColor = TEAM_COL[t];
      const names = m[t] || [];
      col.append(el('div', 'mp-tname', c.names?.[t] || t));
      for (let i = 0; i < Math.max(mode, names.length); i++) col.append(el('div', 'mp-slot' + (names[i] ? '' : ' empty'), names[i] || '— boş —'));
      if (open && side !== t && names.length < mode) {
        const j = el('button', 'mp-join', side ? 'Bura keç' : 'Qoşul');
        j.type = 'button';
        j.style.background = TEAM_COL[t];
        j.onclick = () => sendMatch('join', c.id, t, mode);
        col.append(j);
      }
      teams.append(col);
    }
    card.append(teams);
    if (side) {
      const l = el('button', 'ghost mp-leave', m.state === 'play' || m.state === 'count' ? '🏳 Təslim ol / çıx' : 'Növbədən çıx');
      l.type = 'button';
      l.onclick = () => sendMatch('leave', c.id);
      card.append(l);
    }
    box.append(card);
  }
}
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
let mhudText = '', mhudT = 0;
function updateMatchHud(force) {
  mhudT -= 1 / 60;
  if (!force && mhudT > 0) return;
  mhudT = 0.2;
  const here = venuesHere();
  const m = activeMyMatch() || matchList.find((x) => (x.state === 'play' || x.state === 'count' || x.state === 'end') && here.some((c) => c.id === x.id));
  let html = '';
  if (m) {
    const c = MATCHES.find((x) => x.id === m.id);
    const now = performance.now();
    const t = m.state === 'count' ? `Başlayır: ${Math.max(0, Math.ceil((m.startAtL - now) / 1000))}`
      : m.state === 'play' ? `⏱ ${fmtTime(Math.max(0, (m.endsAtL - now) / 1000))}` : 'Bitdi';
    const side = mySide(m);
    html = `<span class="mh-title">${c.title}</span>`
      + `<span class="mh-team" style="background:${TEAM_COL.A}">${c.names.A}${side === 'A' ? ' (sən)' : ''}</span>`
      + `<b class="mh-score">${m.score.A} : ${m.score.B}</b>`
      + `<span class="mh-team" style="background:${TEAM_COL.B}">${c.names.B}${side === 'B' ? ' (sən)' : ''}</span>`
      + `<span class="mh-time">${t}</span>`;
  }
  if (html !== mhudText) { mhudText = html; $('mhud').innerHTML = html; $('mhud').hidden = !html; }
  const chip = here.length > 0 && !mpanel.open && !activeMyMatch();
  if ($('mchip').hidden === chip) $('mchip').hidden = !chip;
  // paneldən uzaqlaşanda bağla
  if (mpanel.open && !here.length && !myMatch()) closeMatchPanel();
}

// ---------- Liderlər cədvəli (Tab) və böyük elan ----------
function renderBoard(rows) {
  const tb = $('board-rows');
  tb.replaceChildren();
  rows.forEach((r, i) => {
    const tr = document.createElement('tr');
    if (r.me) tr.className = 'me';
    for (const v of [i + 1, `${r.online ? '🟢' : '⚪'} ${r.name}`, r.level, r.kills, r.deaths, r.stars, r.goals, r.wins ?? 0]) {
      const td = document.createElement('td');
      td.textContent = v;
      tr.append(td);
    }
    tb.append(tr);
  });
}
let bannerTimer;
function bigBanner(text) {
  const b = $('banner');
  b.textContent = text;
  b.hidden = false;
  b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => { b.hidden = true; }, 2600);
}

const aimOffset = new THREE.Vector3();
const eyePos = new THREE.Vector3();
const fpTarget = new THREE.Vector3();
let fpInit = false;
function updateCamera(dt) {
  // Birinci şəxs: kamera başın içində, baxış istiqaməti kameranın yaw/pitch-i ilə
  if (cam.fp && !player.dead && player.char) {
    player.char.root.updateMatrixWorld(true);
    player.char.rig.head.getWorldPosition(fpTarget);
    fpTarget.y += 0.2 * (state.appearance?.height || 1);
    const cp = Math.cos(cam.pitch);
    // göz bir az irəlidə olsun ki, aşağı baxanda bədənin içi görünməsin
    fpTarget.x -= Math.sin(cam.yaw) * 0.14; fpTarget.z -= Math.cos(cam.yaw) * 0.14;
    // yerişdə başın silkələnməsini yumşalt (ani sıçrayışlarda — teleport, respawn — birbaşa keç)
    if (!fpInit || eyePos.distanceToSquared(fpTarget) > 4) { eyePos.copy(fpTarget); fpInit = true; }
    else eyePos.lerp(fpTarget, Math.min(1, dt * 18));
    camera.position.copy(eyePos);
    camera.lookAt(eyePos.x - Math.sin(cam.yaw) * cp, eyePos.y - Math.sin(cam.pitch), eyePos.z - Math.cos(cam.yaw) * cp);
    camera.aspect = canvas.clientWidth / canvas.clientHeight;
    camera.updateProjectionMatrix();
    cam.curDist = 0.5;
    sun.position.copy(player.pos).addScaledVector(SUN_DIR, 120);
    sun.target.position.copy(player.pos);
    return;
  }
  if (!cam.fp) cam.pitch = Math.min(1.25, Math.max(-0.35, cam.pitch));
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
    // LOD: uzaqdakı personajlar gizlənir, orta məsafədəkilər daha seyrək animasiya olunur
    const d2 = r.position.distanceToSquared(camera.position);
    const far = LOD.hide * LOD.hide;
    r.visible = d2 < far;
    smokeHolder(o, o.dead ? 0 : o.emote, dt, r.visible && d2 < 45 * 45);
    if (!r.visible) continue;
    o.animAcc = (o.animAcc || 0) + dt;
    const every = d2 > LOD.slow * LOD.slow ? 3 : d2 > (LOD.slow * 0.5) ** 2 ? 2 : 1;
    o.animN = ((o.animN || 0) + 1) % every;
    if (o.animN !== 0) continue;
    const adt = Math.min(0.15, o.animAcc); o.animAcc = 0;
    animateRig(o.char.rig, adt, o.dead ? 0 : o.moving ? Math.max(0.35, v / 4) : 0, {
      air: !o.dead && r.position.y > 0.05, emote: o.emote, weapon: o.w, punch: o.punchT || 0, dead: o.dead,
    });
  }
}

function loop() {
  requestAnimationFrame(loop);
  const raw = clock.getDelta();
  if (state.inGame) adaptResolution(raw);
  frame(Math.min(0.05, raw));
}
// Sazlama/test üçün: oyun dövrünü əl ilə irəli aparmaq (məs. __bmu.step(1/60, 120))
window.__bmu.step = (dt = 1 / 60, n = 1) => { for (let i = 0; i < n; i++) { clock.elapsedTime += dt; frame(dt); } };

const opCache = {};
function setOpacity(id, v) {
  v = Math.round(v * 50) / 50;
  if (opCache[id] === v) return;
  opCache[id] = v; $(id).style.opacity = v;
}
function frame(dt) {
  document.body.classList.toggle('in-creator', state.mode === 'creator');
  if (player.emote !== frame.lastEmote) { frame.lastEmote = player.emote; updateEmoteBar(); }
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
  updateSmoking(dt);
  updateOthers(dt);
  animateDummies(dt);
  updateStaticNpcs(dt, clock.elapsedTime);
  updateGallowsUi();
  updateInteractions(dt);
  updateMatchHud();
  exam?.update(dt);
  { const inRoom = !!roomHere(); if (inRoom !== frame.inRoom) { frame.inRoom = inRoom; document.body.classList.toggle('in-room', inRoom); } }
  // qorunma dəyişəndə (matç başladı, otağa girdi...) silahı yığ və HUD-u yenilə
  { const sh = state.mode === 'game' ? myShield() : null; if (sh !== frame.shield) { frame.shield = sh; if (sh && player.weapon) setWeapon(0); updateCombatHud(); } }
  updateCamera(dt);
  world.update(clock.elapsedTime, dt, camera);
  updateBirds?.(clock.elapsedTime, dt);
  fx.update(dt);
  perf.frame++;
  // mini-xəritə (2D canvas) hər kadr çəkilmir: aşağı keyfiyyətdə saniyədə ~15 dəfə
  const mapBig = minimap.canvas?.classList?.contains('big');
  if (!document.body.classList.contains('photo') && (!LOW || mapBig || perf.frame % 4 === 0)) minimap.draw(player.pos, player.ry, cam.yaw, others, play?.stars);
  // zərər effekti və isabət işarəsi (DOM-a yalnız dəyişəndə yazılır)
  hurtT = Math.max(0, hurtT - dt * 1.6);
  setOpacity('hurt', Math.max(hurtT, player.dead ? 0.55 : player.hp < 30 ? 0.25 + Math.sin(clock.elapsedTime * 5) * 0.08 : 0));
  hitmarkT = Math.max(0, hitmarkT - dt);
  setOpacity('hitmark', hitmarkT > 0 ? 1 : 0);
  if (LOW) sun.shadow.needsUpdate = perf.frame % 2 === 0;
  renderer.render(scene, camera);
}

connect();
loop();
