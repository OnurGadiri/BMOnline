// BMU Online — server protokol testi.
// İşə salmaq: npm test
// Test ayrıca portda (3101) və müvəqqəti məlumat qovluğu ilə öz serverini qaldırır —
// əsl oyunçu məlumatlarına (data/players.json) toxunmur.
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const PORT = 3101;
const URL = `ws://localhost:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bmu-test-'));
const server = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'server.js')], {
  env: { ...process.env, PORT: String(PORT), BMU_DATA_DIR: dataDir },
  stdio: ['ignore', 'pipe', 'inherit'],
});
const serverReady = new Promise((res) => server.stdout.on('data', (d) => { if (String(d).includes('işləyir')) res(); }));
const cleanup = () => { server.kill(); fs.rmSync(dataDir, { recursive: true, force: true }); };

const results = [];
const ok = (name, cond, extra = '') => { results.push([cond ? 'PASS' : 'FAIL', name, extra]); if (process.env.VERBOSE) console.log(cond ? 'PASS' : 'FAIL', name); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Client {
  constructor(name) { this.name = name; this.msgs = []; this.waiters = []; }
  open() {
    return new Promise((res, rej) => {
      this.ws = new WebSocket(URL);
      this.ws.on('open', res);
      this.ws.on('error', rej);
      this.ws.on('message', (raw) => {
        const m = JSON.parse(raw);
        this.msgs.push(m);
        for (const w of [...this.waiters]) if (w.pred(m)) { this.waiters.splice(this.waiters.indexOf(w), 1); w.res(m); }
      });
    });
  }
  send(m) { this.ws.send(JSON.stringify(m)); }
  wait(pred, ms = 3000) {
    return new Promise((res) => {
      const w = { pred, res };
      this.waiters.push(w);
      setTimeout(() => { const i = this.waiters.indexOf(w); if (i >= 0) { this.waiters.splice(i, 1); res(null); } }, ms);
    });
  }
  waitT(t, ms, extra = () => true) { return this.wait((m) => m.t === t && extra(m), ms); }
  close() { this.ws.close(); }
  // Oyunçunun hərəkəti: real sürətlə addım-addım
  async walkTo(from, to, speed = 7) {
    const d = Math.hypot(to.x - from.x, to.z - from.z);
    const steps = Math.max(1, Math.ceil(d / (speed * 0.1)));
    for (let i = 1; i <= steps; i++) {
      const x = from.x + ((to.x - from.x) * i) / steps, z = from.z + ((to.z - from.z) * i) / steps;
      this.send({ t: 'pos', x, y: 0, z, ry: Math.atan2(to.x - from.x, to.z - from.z), m: 1, e: 0, w: this.w || 0 });
      await sleep(100);
    }
    this.send({ t: 'pos', x: to.x, y: 0, z: to.z, ry: Math.atan2(to.x - from.x, to.z - from.z), m: 0, e: 0, w: this.w || 0 });
    return { x: to.x, z: to.z };
  }
}

/** Yeni hesab — qeydiyyat (register); mövcud hesab (existing=true) — giriş (login) */
async function enter(name, pin = '1234', existing = false) {
  const c = new Client(name);
  await c.open();
  c.send(existing ? { t: 'login', name, pin } : { t: 'register', name, pin, pin2: pin });
  const lo = await c.waitT('loginOk');
  c.send({ t: 'saveChar', appearance: { body: 'm', hair: 'NOT_A_HAIR', skin: 'red', height: 99 } });
  const cs = await c.waitT('charSaved');
  c.send({ t: 'join' });
  const wel = await c.waitT('welcome');
  c.pos = { x: wel.you.x, z: wel.you.z };
  return { c, lo, cs, wel };
}

(async () => {
  await serverReady;
  // --- 1. Giriş yoxlamaları ---
  const bad = new Client('bad');
  await bad.open();
  bad.send({ t: 'login', name: 'x', pin: '1234' });
  ok('qısa ad rədd edilir', !!(await bad.waitT('loginErr')));
  await sleep(850);
  bad.send({ t: 'login', name: 'Valid Name', pin: '12' });
  ok('qısa PIN rədd edilir', !!(await bad.waitT('loginErr')));
  bad.send({ t: 'login', name: 'Valid Name', pin: '1234' });
  const slow = await bad.waitT('loginErr', 500);
  ok('tez-tez giriş cəhdi yavaşladılır', !!slow && /yavaş/.test(slow.msg), slow?.msg);
  await sleep(850);
  bad.send({ t: 'login', name: 'Hesabsiz', pin: '1234' });
  const noAcc = await bad.waitT('loginErr', 1500);
  ok('giriş (login) hesab yaratmır — "belə hesab yoxdur"', !!noAcc && noAcc.code === 'noAcc' && /qeydiyyat/.test(noAcc.msg), noAcc?.msg);
  await sleep(850);
  bad.send({ t: 'register', name: 'Hesabsiz', pin: '1234', pin2: '4321' });
  const pinMis = await bad.waitT('loginErr', 1500);
  ok('qeydiyyatda PIN təkrarı eyni olmalıdır', !!pinMis && pinMis.code === 'pin2', pinMis?.msg);
  await sleep(850);
  bad.send({ t: 'register', name: 'Valid Name', pin: '12', pin2: '12' });
  ok('qeydiyyatda da qısa PIN rədd edilir', /PIN 4-8/.test((await bad.waitT('loginErr', 1500))?.msg || ''));
  bad.close();

  // --- 2. Hesab yaratma, xarakter, oyuna giriş ---
  const A = await enter('Alfa');
  ok('qeydiyyat (register) yeni hesab yaradır', A.lo?.isNew === true);
  {
    const dup = new Client('dup');
    await dup.open();
    dup.send({ t: 'register', name: 'ALFA', pin: '9999', pin2: '9999' });
    const taken = await dup.waitT('loginErr', 1500);
    ok('qeydiyyatda tutulmuş ad (böyük/kiçik hərf fərqi olmadan) rədd edilir', !!taken && taken.code === 'taken' && /artıq var/.test(taken.msg), taken?.msg);
    dup.close();
  }
  ok('yanlış görünüş standart dəyərlərlə düzəldilir', A.cs && A.cs.appearance.hair !== 'NOT_A_HAIR' && /^#[0-9a-f]{6}$/.test(A.cs.appearance.skin) && A.cs.appearance.height <= 1.12, JSON.stringify(A.cs?.appearance).slice(0, 80));
  ok('oyuna giriş (welcome)', !!A.wel && A.wel.you.hp === 100);
  await sleep(200);
  ok('ammo mesajı gəlir', A.c.msgs.some((m) => m.t === 'ammo' && m.ammo === 12));
  ok('dar ağacı vəziyyəti gəlir', A.c.msgs.some((m) => m.t === 'gallows'));

  const entityB = A.c.waitT('entity', 4000, (m) => m.e.id === 'beta');
  const B = await enter('Beta');
  ok('digər oyunçu girəndə xəbər gəlir', !!(await entityB));
  ok('ikinci oyunçu birincini görür', B.wel.entities.some((e) => e.id === 'alfa'));

  // --- 3. Snapshot və çat ---
  const snap = await A.c.waitT('snap', 2000);
  ok('snapshot hər iki oyunçunu ehtiva edir', !!snap && ['alfa', 'beta'].every((id) => snap.e.some((r) => r[0] === id)));
  const chatB = B.c.waitT('chat', 2000);
  A.c.send({ t: 'chat', text: '  salam   <b>dostlar</b>  ' });
  const ch = await chatB;
  ok('çat çatdırılır və boşluqlar sıxılır', ch?.text === 'salam <b>dostlar</b>', ch?.text);

  // --- 4. Teleport qoruması ---
  const corr = A.c.waitT('correct', 2000);
  A.c.send({ t: 'pos', x: A.c.pos.x + 150, y: 0, z: A.c.pos.z, ry: 0, m: 1, e: 0, w: 0 });
  ok('teleport rədd edilir', !!(await corr));

  // --- 5. Atəş: A, B-dən 10 m aralıda ---
  await sleep(3200); // giriş qoruması (3 s) bitsin
  A.c.w = 1;
  A.c.pos = await A.c.walkTo(A.c.pos, { x: B.c.pos.x - 10, z: B.c.pos.z });
  await sleep(200);
  const eye = [A.c.pos.x, 1.45, A.c.pos.z];
  const target = [B.c.pos.x, 1.2, B.c.pos.z];
  const dir = target.map((v, i) => v - eye[i]);
  const shoot = () => A.c.send({ t: 'shoot', o: eye, d: dir });
  const hit1 = A.c.waitT('hit', 2000);
  const hpB = B.c.waitT('hp', 2000, (m) => m.id === 'beta');
  shoot();
  const h1 = await hit1;
  ok('güllə hədəfə dəyir', !!h1 && h1.dmg === 22, JSON.stringify(h1));
  ok('vurulan oyunçu can mesajı alır', (await hpB)?.hp === 78);
  // atəş sürəti limiti
  shoot();
  const fast = await A.c.waitT('hit', 150);
  ok('çox sürətli atəş qəbul olunmur', !fast);
  const deadB = B.c.waitT('dead', 4000, (m) => m.id === 'beta');
  const xpKill = A.c.waitT('xp', 4000, (m) => m.xp >= 25 || m.level > 1);
  for (let i = 0; i < 4; i++) { await sleep(260); shoot(); }
  const dB = await deadB;
  ok('5 güllə ilə öldürülür', !!dB && dB.by === 'Alfa', JSON.stringify(dB));
  ok('ölüm mesajında vuranın yeri var (yıxılma istiqaməti üçün)', Array.isArray(dB?.from) && Math.hypot(dB.from[0] - A.c.pos.x, dB.from[1] - A.c.pos.z) < 0.6, JSON.stringify(dB?.from));
  const xp = await xpKill;
  ok('öldürən XP alır', !!xp, JSON.stringify(xp));
  // ölü oyunçu hərəkət edə bilmir
  B.c.send({ t: 'pos', x: B.c.pos.x + 1, y: 0, z: B.c.pos.z, ry: 0, m: 1, e: 0, w: 0 });
  await sleep(300);
  const snapDead = await A.c.waitT('snap', 1000);
  const rowB = snapDead?.e.find((r) => r[0] === 'beta');
  ok('ölü oyunçu snapshot-da ölü görünür və yerindən tərpənmir', !!rowB && rowB[8] === 1 && Math.abs(rowB[1] - B.c.pos.x) < 0.01, JSON.stringify(rowB));
  {
    // üzü vurana dönür — arxası üstə vurandan uzağa yıxılır
    const want = Math.atan2(A.c.pos.x - B.c.pos.x, A.c.pos.z - B.c.pos.z);
    const diff = rowB ? Math.abs(Math.atan2(Math.sin(rowB[4] - want), Math.cos(rowB[4] - want))) : 9;
    ok('ölən oyunçu vurana tərəf dönüb ondan uzağa yıxılır', diff < 0.05, rowB ? `ry=${rowB[4]} istənən=${want.toFixed(2)}` : '');
  }
  // ölüyə atəş
  await sleep(260);
  shoot();
  ok('ölüyə dəyən güllə sayılmır', !(await A.c.waitT('hit', 400)));
  const resp = await B.c.waitT('respawn', 8000, (m) => m.id === 'beta');
  ok('6 saniyə sonra yenidən doğulur', !!resp);
  const dist = resp ? Math.hypot(resp.x - A.c.pos.x, resp.z - A.c.pos.z) : 0;
  ok('öldürəndən uzaqda doğulur (>40 m)', dist > 40, dist.toFixed(1));
  if (resp) B.c.pos = { x: resp.x, z: resp.z };

  // --- 6. Güllə sayı və doldurma ---
  let ammo = A.c.msgs.filter((m) => m.t === 'ammo').pop()?.ammo;
  for (let i = 0; i < 14; i++) { await sleep(250); A.c.send({ t: 'shoot', o: eye, d: [0, 0, 1] }); }
  await sleep(300);
  ammo = A.c.msgs.filter((m) => m.t === 'ammo').pop()?.ammo;
  ok('güllə 0-dan aşağı düşmür', ammo === 0, String(ammo));
  A.c.send({ t: 'reload' });
  const rl = await A.c.waitT('ammo', 2500, (m) => m.ammo === 12);
  ok('doldurma 12 güllə qaytarır', !!rl);

  // --- 7. Yumruq ---
  await sleep(3200); // B-nin qoruması bitsin
  A.c.w = 0;
  A.c.pos = await A.c.walkTo(A.c.pos, { x: B.c.pos.x, z: B.c.pos.z - 1.2 }, 9);
  // B-yə tərəf dön (z oxu boyunca +)
  A.c.send({ t: 'pos', x: A.c.pos.x, y: 0, z: A.c.pos.z, ry: 0, m: 0, e: 0, w: 0 });
  await sleep(150);
  const ph = A.c.waitT('hit', 1500);
  const kbB = B.c.waitT('correct', 1500, (m) => m.kb === 1);
  A.c.send({ t: 'punch' });
  const p = await ph;
  ok('yumruq dəyir (12 zərər)', p?.dmg === 12, JSON.stringify(p));
  const kb = await kbB;
  const kbD = kb ? Math.hypot(kb.x - A.c.pos.x, kb.z - A.c.pos.z) : 0;
  ok('yumruq hədəfi geri itələyir (knockback ~1.3 m)', kbD > 2.3 && kbD < 2.7, kbD.toFixed(2));
  if (kb) B.c.pos = { x: kb.x, z: kb.z };
  // arxaya dönüb vurmaq dəyməməlidir
  A.c.send({ t: 'pos', x: A.c.pos.x, y: 0, z: A.c.pos.z, ry: Math.PI, m: 0, e: 0, w: 0 });
  await sleep(600);
  const ph2 = A.c.waitT('hit', 800);
  A.c.send({ t: 'punch' });
  ok('arxadakı hədəfə yumruq dəymir', !(await ph2));

  // --- 8. Dar ağacı ---
  // B təsadüfi yerdə doğulur və A yumruq üçün onun yanına gedir — dar ağacının yanına düşə bilər.
  // "Uzaqda göndərmək olmur" yoxlaması həqiqətən uzaqdan olsun (yoxsa məhkum yerləşir və sonrakı testlər zəncirvari düşür)
  if (Math.hypot(A.c.pos.x + 92, A.c.pos.z + 140) < 30 || Math.hypot(A.c.pos.x + 105, A.c.pos.z + 135) < 30) {
    A.c.pos = await A.c.walkTo(A.c.pos, { x: -55, z: -140 }, 8.5);
    await sleep(150);
  }
  A.c.send({ t: 'gallowsDummy', name: 'Qara Quldur', appearance: {} });
  const far = await A.c.waitT('error', 1500);
  ok('dar ağacından uzaqda məhkum göndərmək olmur', !!far && /yaxınlaş/.test(far.msg));
  A.c.pos = await A.c.walkTo(A.c.pos, { x: -92, z: -134 }, 8.5);
  await sleep(200);
  A.c.send({ t: 'gallowsDummy', name: 'Real Adam Soyadov', appearance: {} });
  const badName = await A.c.waitT('error', 1500);
  ok('siyahıda olmayan ad rədd edilir', !!badName && /siyahı/.test(badName.msg));
  const gl = A.c.waitT('gallows', 1500, (m) => m.slots.some(Boolean));
  A.c.send({ t: 'gallowsDummy', name: 'Qara Quldur', appearance: { body: 'f' } });
  const g1 = await gl;
  ok('məhkum dar ağacına gəlir', !!g1 && g1.slots.some((s) => s && s.name === 'Qara Quldur'));
  const id = g1?.slots.find(Boolean)?.id;
  const gl2 = A.c.waitT('gallows', 1500, (m) => !m.slots.some(Boolean));
  A.c.send({ t: 'gallowsRemove', id });
  ok('məhkum azad edilir', !!(await gl2));
  // çarmıx: eyni qaydalar
  await sleep(15_100); // məhkum göndərmə fasiləsi (15 san)
  A.c.pos = await A.c.walkTo(A.c.pos, { x: -105, z: -135 }, 8.5);
  await sleep(150);
  const cr = A.c.waitT('gallows', 1500, (m) => (m.crucifix || []).some((s) => s && s.name === 'Gecə Bayquşu'));
  A.c.send({ t: 'gallowsDummy', site: 'crucifix', name: 'Gecə Bayquşu', appearance: {} });
  const c1 = await cr;
  ok('məhkum çarmıxa gəlir', !!c1);
  ok('çarmıx dar ağacından ayrı yerlərdir', !!c1 && !c1.slots.some(Boolean));
  const cid = c1?.crucifix.find(Boolean)?.id;
  const cr2 = A.c.waitT('gallows', 1500, (m) => !(m.crucifix || []).some(Boolean));
  A.c.send({ t: 'gallowsRemove', id: cid });
  ok('çarmıxdakı məhkum azad edilir', !!(await cr2));

  // --- 8b. İnteraksiyalar: cədvəl, ulduz, basketbol, oturmaq ---
  A.c.send({ t: 'board' });
  const board = await A.c.waitT('board', 1500);
  ok('liderlər cədvəli gəlir', !!board && board.rows.some((r) => r.name === 'Alfa' && r.me), board && board.rows.map((r) => r.name).join(','));
  const starsMsg = A.c.msgs.find((m) => m.t === 'stars');
  ok('ulduzlar oyuna girəndə göndərilir', !!starsMsg && starsMsg.s.length > 0, String(starsMsg?.s.length));
  const farStar = starsMsg.s.map((s) => ({ s, d: Math.hypot(s.x - A.c.pos.x, s.z - A.c.pos.z) })).sort((p, q) => q.d - p.d)[0];
  A.c.send({ t: 'collect', id: farStar.s.id });
  ok('uzaqdakı ulduzu götürmək olmur', !(await A.c.waitT('starGone', 600)), `${farStar.d.toFixed(0)} m`);
  const near = starsMsg.s.map((s) => ({ s, d: Math.hypot(s.x - A.c.pos.x, s.z - A.c.pos.z) })).sort((p, q) => p.d - q.d)[0];
  A.c.pos = await A.c.walkTo(A.c.pos, { x: near.s.x, z: near.s.z }, 8.5);
  const gone = A.c.waitT('starGone', 1500, (m) => m.id === near.s.id);
  const starXp = A.c.waitT('xp', 1500);
  A.c.send({ t: 'collect', id: near.s.id });
  ok('yaxındakı ulduz toplanır', (await gone)?.by === 'Alfa');
  ok('ulduz XP verir', !!(await starXp));
  // basketbol meydançasına get və topu at
  const ballsMsg = A.c.msgs.filter((m) => m.t === 'balls').pop();
  const bRow = ballsMsg.b.find((r) => r[0] === 'basket');
  A.c.pos = await A.c.walkTo(A.c.pos, { x: bRow[1] - 0.8, z: bRow[3] }, 8.5);
  await sleep(150);
  const moved = A.c.waitT('balls', 1500, (m) => { const r = m.b.find((x) => x[0] === 'basket'); return r && Math.hypot(r[4], r[5], r[6]) > 1; });
  A.c.send({ t: 'kick', id: 'basket', v: [-0.5, 8, 2] });
  ok('topa vurmaq işləyir', !!(await moved));
  const bTooFast = A.c.waitT('balls', 1200, (m) => { const r = m.b.find((x) => x[0] === 'basket'); return r && Math.hypot(r[4], r[5], r[6]) > 20.5; });
  await sleep(400);
  A.c.send({ t: 'kick', id: 'basket', v: [0, 100, 0] });
  ok('topun sürəti məhdudlaşdırılır (hiylə qorunması)', !(await bTooFast));
  // dəqiq atış (klientin istifadə etdiyi basketAim) serverdə çənbər/lövhə fizikası ilə səbətə düşür
  // yuxarı atılan top (20 m/s) ~12 san sıçrayır — tam dayanana qədər gözlə: yerdədir və sürəti 0-dır
  // (dayanmış top saniyədə bir göndərilir; sıçrayan topdan hesablanan atış alçaqdan başlayıb ön çənbərə dəyir)
  const lastBasket = () => A.c.msgs.filter((m) => m.t === 'balls').pop()?.b.find((r) => r[0] === 'basket');
  for (const until = Date.now() + 25000; Date.now() < until; await sleep(300)) {
    const r = lastBasket();
    if (r && r[4] === 0 && r[5] === 0 && r[6] === 0 && r[2] < 0.14) break;
  }
  const bNow = A.c.msgs.filter((m) => m.t === 'balls').pop().b.find((r) => r[0] === 'basket');
  A.c.pos = await A.c.walkTo(A.c.pos, { x: bNow[1] - 0.8, z: bNow[3] }, 8.5);
  await sleep(150);
  const { basketAim } = require(path.join(__dirname, '..', 'public', 'js', 'ballphys.js'));
  const hoopCfg = require(path.join(__dirname, '..', 'public', 'data', 'campus.json')).balls.find((b) => b.id === 'basket').hoop;
  const made = A.c.waitT('score', 3500, (m) => m.kind === 'basket' && m.ball === 'basket');
  A.c.send({ t: 'kick', id: 'basket', v: basketAim({ px: bNow[1], py: Math.max(bNow[2], 0.12 + 0.05), pz: bNow[3] }, hoopCfg, 0.5, () => 0.5).map((x) => +x.toFixed(3)) });
  ok('dəqiq basketbol atışı serverdə səbət sayılır', (await made)?.by === 'Alfa', `top (${bNow[1].toFixed(1)}, ${bNow[3].toFixed(1)})`);
  // uzaqdakı futbol topuna vurmaq olmur
  const fb = A.c.waitT('balls', 800, (m) => { const r = m.b.find((x) => x[0] === 'football'); return r && Math.hypot(r[4], r[6]) > 1; });
  A.c.send({ t: 'kick', id: 'football', v: [10, 2, 0] });
  ok('uzaqdakı topa vurmaq olmur', !(await fb));
  // oturma emosiyası (5) qəbul olunur
  A.c.send({ t: 'pos', x: A.c.pos.x, y: 0, z: A.c.pos.z, ry: 0, m: 0, e: 5, w: 0 });
  const sitSnap = await B.c.waitT('snap', 1500, (m) => m.e.some((r) => r[0] === 'alfa' && r[6] === 5));
  ok('oturmaq digərlərinə görünür', !!sitSnap);

  // --- 8b. Matç: voleybol 1v1 ---
  const waitM = (c, pred, ms = 2500) => c.waitT('matches', ms, (m) => { const v = m.m.find((x) => x.id === 'volleyball'); return v && pred(v); });
  const w1 = waitM(A.c, (v) => v.state === 'wait' && v.A.includes('Alfa'));
  A.c.send({ t: 'match', act: 'join', id: 'volleyball', team: 'A', mode: 1 });
  ok('matça qoşulmaq (növbə)', !!(await w1));
  const corrA = A.c.waitT('correct', 2500);
  const cnt = waitM(A.c, (v) => v.state === 'count');
  B.c.send({ t: 'match', act: 'join', id: 'volleyball', team: 'B', mode: 1 });
  ok('hər iki komanda dolanda geri sayım başlayır', !!(await cnt));
  const cA = await corrA;
  ok('oyunçular öz meydança tərəfinə köçürülür', !!cA && cA.z < -240.2, cA ? `${cA.x},${cA.z}` : '');
  const koMsg = A.c.waitT('kickoff', 7000, (m) => m.id === 'volleyball' && m.side);
  const started = await A.c.waitT('mstart', 7000);
  ok('matç başlayır', !!started);
  const ko = await koMsg;
  ok('ilk servisi vuran komanda püşklə seçilir və hamıya bildirilir', ko?.side === 'A' || ko?.side === 'B', ko?.side);
  await sleep(150);
  const vRow = A.c.msgs.filter((m) => m.t === 'balls').pop().b.find((r) => r[0] === 'volley');
  ok('voleybol topu servis üçün havada gözləyir', vRow && vRow[7] === 1 && vRow[2] > 1.5, JSON.stringify(vRow));
  const [srv, rcv, sSide] = ko?.side === 'B' ? [B, A, 'B'] : [A, B, 'A'];
  // servisi rəqib komanda vura bilməz
  const noServe = rcv.c.waitT('sys', 1500, (m) => /rəqib/.test(m.msg));
  rcv.c.send({ t: 'kick', id: 'volley', v: [0, 5, 0] });
  ok('servisi yalnız servis növbəsi olan komanda vurur', !!(await noServe));
  // servis: rəqibin meydançasına
  const scoreS = A.c.waitT('mscore', 4000, (m) => m.id === 'volleyball');
  const T = 1.4, dz = (sSide === 'A' ? -236 : -244) - vRow[3], dx = 74 - vRow[1];
  srv.c.send({ t: 'kick', id: 'volley', v: [dx / T, (0.15 - vRow[2] + 6 * T * T) / T, dz / T] });
  const sc = await scoreS;
  ok('top rəqib meydançasına düşəndə xal verilir', sc?.side === sSide && sc.score[sSide] === 1, JSON.stringify(sc?.score));
  // xalı qazanan növbəti servisi vurur (voleybol qaydası)
  const ko2 = await A.c.waitT('kickoff', 3000, (m) => m.id === 'volleyball' && m.side);
  ok('xalı qazanan komanda növbəti servisi vurur', ko2?.side === sSide, ko2?.side);
  const ended = A.c.waitT('mend', 2500, (m) => m.id === 'volleyball');
  B.c.send({ t: 'match', act: 'leave', id: 'volleyball' });
  const en = await ended;
  ok('rəqib çıxanda matç bitir (texniki qələbə)', en?.win === 'A');

  // --- 8b2. Futbol: başlanğıc vuruşu ---
  {
    await sleep(300);
    const koF = A.c.waitT('kickoff', 9000, (m) => m.id === 'football' && m.side);
    A.c.send({ t: 'match', act: 'join', id: 'football', team: 'A', mode: 1 });
    await sleep(200);
    B.c.send({ t: 'match', act: 'join', id: 'football', team: 'B', mode: 1 });
    const early = A.c.waitT('balls', 900, (m) => { const r = m.b.find((x) => x[0] === 'football'); return r && Math.hypot(r[4], r[6]) > 1; });
    await sleep(300);
    A.c.send({ t: 'kick', id: 'football', v: [0, 2, 10] });
    B.c.send({ t: 'kick', id: 'football', v: [0, 2, -10] });
    ok('geri sayımda topa toxunmaq olmur', !(await early));
    const kf = await koF;
    ok('futbolda ilk vuruşu püşklə seçilən komanda edir', kf?.side === 'A' || kf?.side === 'B', kf?.side);
    const [kick, wait] = kf?.side === 'B' ? [B, A] : [A, B];
    const rej = wait.c.waitT('sys', 1500, (m) => /rəqib/.test(m.msg));
    wait.c.send({ t: 'kick', id: 'football', v: [0, 1, 8] });
    ok('başlanğıc vuruşunu rəqib komanda edə bilməz', !!(await rej));
    const cleared = A.c.waitT('kickoff', 1500, (m) => m.ball === 'football' && !m.side);
    kick.c.send({ t: 'kick', id: 'football', v: [3, 1, 0] });
    ok('başlanğıc vuruşu edildikdən sonra hamı oynaya bilər', !!(await cleared));
    const endF = A.c.waitT('mend', 2500, (m) => m.id === 'football');
    B.c.send({ t: 'match', act: 'leave', id: 'football' });
    await endF;
  }

  // --- 8c. C# imtahanı (kopya missiyası): lobbi, 3 nəfər, başlanğıc, cavablar, kopya, çıxış ---
  {
    const door = { x: 56.6, z: -140 };
    const G = await enter('Gamma');
    const far = G.c.waitT('xlist', 800, (m) => m.s.length > 0);
    G.c.send({ t: 'xjoin', new: true });
    ok('imtahan otağını yalnız Rektorluğun qapısında açmaq olar', !(await far));
    // serverin bildiyi əsl mövqedən başla (ölüm/yenidən doğulma/düzəlişlərdən sonra)
    const realPos = (P, key) => { const sn = [...P.c.msgs].reverse().find((m) => m.t === 'snap'); const r = sn?.e.find((x) => x[0] === key); return r ? { x: r[1], z: r[3] } : P.c.pos; };
    await Promise.all([[A, 'alfa'], [B, 'beta'], [G, 'gamma']].map(async ([P, k]) => { P.c.pos = await P.c.walkTo(realPos(P, k), door, 8.5); }));
    await sleep(200);
    const l1 = A.c.waitT('xlist', 2000, (m) => m.s.some((s) => s.state === 'lobby' && s.n === 1));
    A.c.send({ t: 'xjoin', new: true });
    ok('qapıda yeni imtahan otağı (lobbi) açılır', !!(await l1));
    const l2 = A.c.waitT('xlist', 2000, (m) => m.s.some((s) => s.n === 2 && s.state === 'lobby'));
    B.c.send({ t: 'xjoin' });
    ok('2 nəfərlə imtahan başlamır (min 3)', !!(await l2));
    const l3 = A.c.waitT('xlist', 2000, (m) => m.s.some((s) => s.state === 'lobby' && s.n === 3 && s.host === 'Alfa'));
    G.c.send({ t: 'xjoin' });
    ok('3 nəfər olanda imtahan özü başlamır — otağı quran başladır', !!(await l3));
    const notHost = B.c.waitT('sys', 1500, (m) => /yalnız otağı quran/.test(m.msg));
    B.c.send({ t: 'xgo' });
    ok('otağı qurmayan imtahanı başlada bilməz', !!(await notHost));
    const cnt = A.c.waitT('xlist', 2000, (m) => m.s.some((s) => s.state === 'count' && s.n === 3));
    A.c.send({ t: 'xgo' });
    ok('otağı quran 3 nəfərlə başladanda geri sayım başlayır', !!(await cnt));
    const [sa, sb, sg] = await Promise.all([A, B, G].map((P) => P.c.waitT('xstart', 9000)));
    ok('imtahan avtomatik başlayır (hamıya suallar gəlir)', !!(sa && sb && sg) && sa.qs.length === 5 && sa.npcs.length > 0, sa ? `${sa.qs.length} sual, ${sa.npcs.length} NPC` : '');
    ok('hər tələbəyə ayrı yer verilir', !!sa && new Set([sa.seat, sb?.seat, sg?.seat]).size === 3);
    const noFight = A.c.waitT('combatOff', 1500);
    A.c.send({ t: 'punch' });
    ok('imtahan otağında döyüşmək olmur', (await noFight)?.why === 'room');
    // telefona bax (öz yerində)
    const rev = A.c.waitT('xreveal', 6500);
    A.c.send({ t: 'xpeek', on: true });
    const rv = await rev;
    A.c.send({ t: 'xpeek', on: false });
    ok('yerində telefona baxanda cavab görünür', !!rv && rv.a >= 0 && rv.i === 0, rv ? rv.src : 'gəlmədi');
    // B imtahanı tərk edir
    const bo = B.c.waitT('xout', 2000);
    B.c.send({ t: 'xleave' });
    ok('imtahanı tərk edən xaric olunur və çölə çıxarılır', (await bo)?.why === 'left' || !!(await bo));
    // xaric olunan eyni imtahana geri qayıda bilməz
    const noBack = B.c.waitT('sys', 1500, (m) => /xaric olunmusan/.test(m.msg));
    B.c.send({ t: 'xjoin', id: sa.id });
    ok('xaric olunan həmin imtahana geri qoşula bilmir', !!(await noBack));
    // yeni tələbə gedən imtahana sonradan qoşulur
    const E = await enter('Epsilon');
    const eTp = E.c.waitT('correct', 2000);
    E.c.send({ t: 'tp', id: 'rect' });
    await eTp;
    await sleep(150);
    const late = E.c.waitT('xstart', 2000);
    E.c.send({ t: 'xjoin', id: sa.id });
    const lt = await late;
    ok('gedən imtahana sonradan qoşulmaq olur (boş yer + qalan vaxt)', !!lt && lt.late === true && lt.qs.length === 5 && lt.time > 30 && lt.time < 180 && ![sa.seat, sg?.seat].includes(lt.seat), lt ? `yer ${lt.seat}, ${lt.time} san` : 'gəlmədi');
    // A, G və E bütün sualları cavablandırır → imtahan bitir
    const end = A.c.waitT('xend', 4000);
    for (let i = 0; i < 5; i++) { A.c.send({ t: 'xans', a: rv && i === 0 ? rv.a : 0 }); G.c.send({ t: 'xans', a: 1 }); E.c.send({ t: 'xans', a: 2 }); await sleep(120); }
    const en = await end;
    ok('hamı cavab verəndə imtahan bitir, nəticələr gəlir', !!en && en.res.length === 4, en ? en.res.map((r) => `${r.name}:${r.out ? 'out' : r.score}`).join(' ') : '');
    E.c.close();
    ok('tərk edən nəticədə xaric kimi görünür', !!en && en.res.find((r) => r.name === 'Beta')?.out === true);
    G.c.close();
    await sleep(300);
  }

  // --- 8d. Sürətli yol (teleport) ---
  {
    const D = await enter('Delta');
    const cor = D.c.waitT('correct', 2000);
    const okM = D.c.waitT('tpOk', 2000);
    D.c.send({ t: 'tp', id: 'rect' });
    const c1 = await cor;
    ok('Rektorluğa teleport olmaq olur', !!c1 && Math.hypot(c1.x - 55.5, c1.z + 141.5) < 2 && !!(await okM), c1 ? `${c1.x.toFixed(1)},${c1.z.toFixed(1)}` : '');
    const err = D.c.waitT('tpErr', 1500);
    D.c.send({ t: 'tp', id: 'plaza' });
    ok('teleport arasında gözləmə var (10 san)', /saniyə/.test((await err)?.msg || ''));
    const bad = D.c.waitT('correct', 600);
    D.c.send({ t: 'tp', id: 'yoxdur' });
    ok('olmayan nöqtəyə teleport olmur', !(await bad));
    D.c.close();
  }

  // --- 8e. 🛡 Təhlükəsiz rejim və oyun zamanı qoruma ---
  {
    // bir IP-dən saatda 5 hesab yaradılır — əvvəlki bölmələrin hesablarından istifadə edirik (oflayn NPC-lər idi)
    let S = await enter('Gamma', '1234', true);
    const T = await enter('Epsilon', '1234', true);
    const Y = await enter('Delta', '1234', true);
    // hamını meydana gətir (teleport gözləməsi varsa, gözlə)
    const toPlaza = async (P) => {
      for (let i = 0; i < 3; i++) {
        const c = P.c.waitT('correct', 2000), er = P.c.waitT('tpErr', 2000);
        P.c.send({ t: 'tp', id: 'plaza' });
        const got = await Promise.race([c, er]);
        if (got?.t === 'correct') { P.c.pos = { x: got.x, z: got.z }; return; }
        await sleep(10500);
      }
    };
    await Promise.all([S, T, Y].map(toPlaza));
    await sleep(3300); // giriş qoruması bitsin
    // bir xətt üzrə: T (Epsilon) — S (Gamma) — Y (Delta), 6 m aralı
    const p0 = { x: S.c.pos.x, z: S.c.pos.z - 4 };
    [S.c.pos, T.c.pos, Y.c.pos] = await Promise.all([
      S.c.walkTo(S.c.pos, p0, 8.5), T.c.walkTo(T.c.pos, { x: p0.x - 6, z: p0.z }, 8.5), Y.c.walkTo(Y.c.pos, { x: p0.x + 6, z: p0.z }, 8.5)]);
    await sleep(200);
    const eyeT = [T.c.pos.x, 1.45, T.c.pos.z];
    const shootAt = (P, from, to) => P.c.send({ t: 'shoot', o: from, d: [to.x - from[0], 1.2 - from[1], to.z - from[2]] });
    const h0 = T.c.waitT('hit', 1500);
    shootAt(T, eyeT, S.c.pos);
    ok('təhlükəsiz rejim bağlı olanda oyunçu vurulur', (await h0)?.id === 'gamma');
    // döyüşdən qaçmaq üçün rejimi açmaq olmur
    const r1 = S.c.waitT('safe', 1500);
    S.c.send({ t: 'safe', on: true });
    ok('zərər alan oyunçu 6 san ərzində təhlükəsiz rejimi aça bilmir', /Döyüşdəsən/.test((await r1)?.err || ''));
    const r2 = T.c.waitT('safe', 1500);
    T.c.send({ t: 'safe', on: true });
    ok('vuran oyunçu da 6 san ərzində rejimi aça bilmir', /vurmusan/.test((await r2)?.err || ''));
    await sleep(6200);
    const seen = T.c.waitT('entity', 2000, (m) => m.e.id === 'gamma' && m.e.safe === true);
    const r3 = S.c.waitT('safe', 1500);
    S.c.send({ t: 'safe', on: true });
    ok('6 san sonra təhlükəsiz rejim açılır', (await r3)?.on === true && !(await r3).err);
    ok('başqaları onun təhlükəsiz rejimdə olduğunu görür', !!(await seen));
    // S-i vurmaq olmur — güllə içindən keçib arxadakı Y-ə dəyir
    // (can bərpası da hp göndərir — yalnız azalma zərər deməkdir)
    const hpBefore = [...S.c.msgs].reverse().find((m) => m.t === 'hp' && m.id === 'gamma')?.hp ?? 100;
    const sHp = S.c.waitT('hp', 900, (m) => m.id === 'gamma' && m.hp < hpBefore);
    const h1 = T.c.waitT('hit', 1500);
    shootAt(T, eyeT, Y.c.pos);
    const hh = await h1;
    ok('təhlükəsiz rejimdəki oyunçuya güllə dəymir (içindən keçir)', !(await sHp) && hh?.id === 'delta', hh?.id);
    T.c.pos = await T.c.walkTo(T.c.pos, { x: S.c.pos.x - 1.2, z: S.c.pos.z }, 8.5);
    T.c.send({ t: 'pos', x: T.c.pos.x, y: 0, z: T.c.pos.z, ry: Math.PI / 2, m: 0, e: 0, w: 0 });
    await sleep(500);
    const ph = T.c.waitT('hit', 900);
    const kbS = S.c.waitT('correct', 900, (m) => m.kb === 1);
    T.c.send({ t: 'punch' });
    ok('təhlükəsiz rejimdəki oyunçuya yumruq dəymir və onu itələmir', !(await ph) && !(await kbS));
    // S özü də heç kimi vura bilmir, silah tuta bilmir
    const off1 = S.c.waitT('combatOff', 1500);
    const sh1 = S.c.waitT('hit', 900);
    shootAt(S, [S.c.pos.x, 1.45, S.c.pos.z], T.c.pos);
    ok('təhlükəsiz rejimdə atəş açmaq olmur', (await off1)?.why === 'safe' && !(await sh1));
    await sleep(500);
    const off2 = S.c.waitT('combatOff', 1500);
    S.c.send({ t: 'pos', x: S.c.pos.x, y: 0, z: S.c.pos.z, ry: -Math.PI / 2, m: 0, e: 0, w: 1 });
    S.c.send({ t: 'punch' });
    ok('təhlükəsiz rejimdə yumruq vurmaq olmur', (await off2)?.why === 'safe');
    const sn = await T.c.waitT('snap', 1500, (m) => m.e.some((r) => r[0] === 'gamma'));
    ok('təhlükəsiz rejimdə əldə silah görünmür', sn?.e.find((r) => r[0] === 'gamma')?.[7] === 0);
    const r4 = S.c.waitT('safe', 1500);
    S.c.send({ t: 'safe', on: false });
    ok('rejimi tez-tez dəyişmək olmur (10 san)', /tez-tez/.test((await r4)?.err || ''));
    // rejim hesabda saxlanır: çıxanda NPC-si də qorunur, yenidən girəndə açıq qalır
    const offNpc = T.c.waitT('entity', 3000, (m) => m.e.id === 'gamma' && m.e.online === false);
    S.c.close();
    ok('çıxan oyunçunun NPC-si də qorunur', (await offNpc)?.e.safe === true);
    S = await enter('Gamma', '1234', true);
    ok('təhlükəsiz rejim yenidən girəndə də açıq qalır', S.wel.you.safe === true);
    // döyüşdə (zərər aldıqdan dərhal sonra) matça qoşulub qorunmağa qaçmaq olmur — Y indicə vuruldu
    const noJoin = Y.c.waitT('sys', 1500, (m) => /Döyüşdəsən/.test(m.msg));
    Y.c.send({ t: 'match', act: 'join', id: 'football', team: 'B', mode: 1 });
    ok('döyüşdə matça qoşulmaq olmur', !!(await noJoin));
    await sleep(6200);
    // matç: oyunçuları nə vurmaq olar, nə də onlar vura bilər
    const corT = T.c.waitT('correct', 2500);
    T.c.send({ t: 'match', act: 'join', id: 'football', team: 'A', mode: 1 });
    await sleep(150);
    Y.c.send({ t: 'match', act: 'join', id: 'football', team: 'B', mode: 1 });
    const ct = await corT;
    if (ct) T.c.pos = { x: ct.x, z: ct.z };
    const r5 = S.c.waitT('safe', 1500);
    S.c.send({ t: 'safe', on: false });
    ok('10 san sonra təhlükəsiz rejim söndürülür', (await r5)?.on === false && !(await r5).err);
    S.c.pos = await S.c.walkTo(S.c.pos, { x: T.c.pos.x, z: T.c.pos.z - 6 }, 8.5);
    await sleep(200);
    const offM = T.c.waitT('combatOff', 1500);
    shootAt(T, [T.c.pos.x, 1.45, T.c.pos.z], S.c.pos);
    ok('matçda olan oyunçu vura bilmir', (await offM)?.why === 'match');
    const tHp = T.c.waitT('hp', 900, (m) => m.id === 'epsilon');
    const sh2 = S.c.waitT('hit', 900);
    shootAt(S, [S.c.pos.x, 1.45, S.c.pos.z], T.c.pos);
    ok('matçda olan oyunçunu vurmaq olmur', !(await sh2) && !(await tHp));
    const endM = T.c.waitT('mend', 2500, (m) => m.id === 'football');
    Y.c.send({ t: 'match', act: 'leave', id: 'football' });
    await endM;
    S.c.close(); T.c.close(); Y.c.close();
    await sleep(300);
  }

  // --- 8f. 🚬 Tüstüxana: siqaret yalnız Prefabrik 1-in yanındakı zonada ---
  {
    const D = await enter('Delta', '1234', true);
    const zone = require(path.join(__dirname, '..', 'public', 'data', 'campus.json')).smokeArea.zone;
    const emoteOf = async () => {
      const sn = await A.c.waitT('snap', 1500, (m) => m.e.some((r) => r[0] === 'delta'));
      return sn?.e.find((r) => r[0] === 'delta')?.[6];
    };
    const far = Math.hypot(D.c.pos.x - zone.x, D.c.pos.z - zone.z);
    D.c.send({ t: 'pos', x: D.c.pos.x, y: 0, z: D.c.pos.z, ry: 0, m: 0, e: 14, w: 0 });
    await sleep(250);
    ok('Tüstüxanadan uzaqda siqaret çəkmək olmur', far > zone.r + 2 && (await emoteOf()) === 0, `${far.toFixed(0)} m`);
    D.c.pos = await D.c.walkTo(D.c.pos, { x: zone.x, z: zone.z + 1 }, 8.5);
    D.c.send({ t: 'pos', x: D.c.pos.x, y: 0, z: D.c.pos.z, ry: 0, m: 0, e: 14, w: 0 });
    await sleep(250);
    ok('Tüstüxanada siqaret çəkmək olur', (await emoteOf()) === 14);
    D.c.send({ t: 'pos', x: D.c.pos.x, y: 0, z: D.c.pos.z, ry: 0, m: 0, e: 15, w: 0 });
    await sleep(250);
    ok('Tüstüxanada skamyada oturub siqaret çəkmək olur', (await emoteOf()) === 15);
    D.c.close();
    await sleep(300);
  }

  // --- 8g. 🚪 Çıxış (logout): NPC olur, matç/imtahandan çıxır, eyni bağlantıda başqa hesabla girmək olur ---
  {
    const L = await enter('Gamma', '1234', true);
    // imtahan lobbisi: Rektorluğa teleport (gözləmə varsa təkrar), yeni otaq aç
    for (let i = 0; i < 3; i++) {
      const c = L.c.waitT('correct', 2000), er = L.c.waitT('tpErr', 2000);
      L.c.send({ t: 'tp', id: 'rect' });
      if ((await Promise.race([c, er]))?.t === 'correct') break;
      await sleep(10500);
    }
    await sleep(150);
    const inLobby = A.c.waitT('xlist', 2000, (m) => m.s.some((x) => x.names.includes('Gamma')));
    L.c.send({ t: 'xjoin', new: true });
    ok('çıxışdan əvvəl: oyunçu imtahan lobbisindədir', !!(await inLobby));
    const inMatch = A.c.waitT('matches', 2000, (m) => m.m.some((x) => x.id === 'football' && x.kA.includes('gamma')));
    L.c.send({ t: 'match', act: 'join', id: 'football', team: 'A', mode: 1 });
    ok('çıxışdan əvvəl: oyunçu matç komandasındadır', !!(await inMatch));
    const npc = A.c.waitT('entity', 2500, (m) => m.e.id === 'gamma' && m.e.online === false);
    const outMatch = A.c.waitT('matches', 2500, (m) => m.m.some((x) => x.id === 'football' && !x.kA.includes('gamma')));
    const outLobby = A.c.waitT('xlist', 2500, (m) => !m.s.some((x) => x.names.includes('Gamma')));
    const bye = L.c.waitT('loggedOut', 2000);
    L.c.send({ t: 'logout' });
    ok('çıxış təsdiqlənir (loggedOut)', !!(await bye));
    ok('çıxan oyunçu NPC-yə çevrilir (oflayn, kampusda qalır)', !!(await npc));
    ok('çıxışda matçdan çıxarılır', !!(await outMatch));
    ok('çıxışda imtahan lobbisindən çıxarılır', !!(await outLobby));
    // çıxdıqdan sonra bu bağlantıdan gələn oyun mesajları heç nə etmir
    const ghost = A.c.waitT('chat', 800, (m) => m.name === 'Gamma');
    L.c.send({ t: 'chat', text: 'hələ buradayam?' });
    ok('çıxdıqdan sonra həmin bağlantı oyunda heç nə edə bilmir', !(await ghost));
    // eyni bağlantıda başqa hesabla giriş
    await sleep(850);
    L.c.send({ t: 'login', name: 'Delta', pin: '1234' });
    const lo2 = await L.c.waitT('loginOk', 2000);
    L.c.send({ t: 'join' });
    const w2 = await L.c.waitT('welcome', 2000);
    ok('çıxıb başqa hesabla girmək olur', lo2?.name === 'Delta' && w2?.you.id === 'delta');
    // yenidən çıxıb öz hesabına qayıt
    const bye2 = L.c.waitT('loggedOut', 2000);
    L.c.send({ t: 'logout' });
    await bye2;
    await sleep(850);
    const back = A.c.waitT('entity', 2500, (m) => m.e.id === 'gamma' && m.e.online === true);
    L.c.send({ t: 'login', name: 'Gamma', pin: '1234' });
    await L.c.waitT('loginOk', 2000);
    L.c.send({ t: 'join' });
    const w3 = await L.c.waitT('welcome', 2000);
    ok('çıxdıqdan sonra yenidən girmək olur (NPC yenə oyunçu olur)', w3?.you.id === 'gamma' && !!(await back));
    L.c.close();
    await sleep(300);
  }

  // --- 8h. Döyüş fizikası: məsafə ilə zərər, qaçanda səpələnmə, güllə binadan keçmir ---
  {
    const S = await enter('Gamma', '1234', true);
    const T = await enter('Epsilon', '1234', true);
    const toPlaza = async (P) => {
      for (let i = 0; i < 3; i++) {
        const c = P.c.waitT('correct', 2000), er = P.c.waitT('tpErr', 2000);
        P.c.send({ t: 'tp', id: 'plaza' });
        const got = await Promise.race([c, er]);
        if (got?.t === 'correct') { P.c.pos = { x: got.x, z: got.z }; return; }
        await sleep(10500);
      }
    };
    await Promise.all([S, T].map(toPlaza));
    await sleep(3300); // giriş qoruması
    // meydanda 65 m aralı (arada bina yoxdur)
    [S.c.pos, T.c.pos] = await Promise.all([S.c.walkTo(S.c.pos, { x: 57, z: -160 }, 8.5), T.c.walkTo(T.c.pos, { x: -8, z: -160 }, 8.5)]);
    await sleep(300);
    const eyeT = [T.c.pos.x, 1.45, T.c.pos.z];
    const at = (P) => [P.c.pos.x - eyeT[0], 1.2 - 1.45, P.c.pos.z - eyeT[2]];
    const h1 = T.c.waitT('hit', 1500);
    T.c.send({ t: 'shoot', o: eyeT, d: at(S) });
    const r1 = await h1;
    ok('uzaq məsafədə (65 m) tapança zərəri azalır', !!r1 && r1.dmg < 22 && r1.dmg > 0, `${r1?.dmg} zərər`);
    // qaçarkən atəş: güllə səpələnir
    T.c.send({ t: 'pos', x: T.c.pos.x, y: 0, z: T.c.pos.z, ry: Math.PI / 2, m: 1, e: 0, w: 1 });
    await sleep(150);
    let hits = 0;
    for (let i = 0; i < 8; i++) {
      await sleep(260);
      const h = T.c.waitT('hit', 450);
      T.c.send({ t: 'shoot', o: eyeT, d: at(S) });
      if (await h) hits++;
    }
    ok('qaçarkən atəşdə güllə səpələnir (65 m-də çoxu yayınır)', hits <= 5, `${hits}/8 dəydi`);
    // güllə binadan keçmir: aralarında Rektorluq
    [S.c.pos, T.c.pos] = await Promise.all([S.c.walkTo(S.c.pos, { x: 95, z: -140 }, 8.5), T.c.walkTo(T.c.pos, { x: 52, z: -140 }, 8.5)]);
    await sleep(300);
    const eye2 = [T.c.pos.x, 1.45, T.c.pos.z];
    const wall = T.c.waitT('hit', 900);
    const shotB = S.c.waitT('shot', 900, (m) => m.id === 'epsilon');
    T.c.send({ t: 'shoot', o: eye2, d: [S.c.pos.x - eye2[0], 1.2 - 1.45, S.c.pos.z - eye2[2]] });
    const sb = await shotB;
    ok('güllə binadan keçmir (arada Rektorluq)', !(await wall) && !!sb && sb.hit === false && sb.h[0] < 61, sb ? `güllə x=${sb.h[0]}-də dayandı` : '');
    S.c.close(); T.c.close();
    await sleep(300);
  }

  // --- 9. Eyni hesabla ikinci giriş, çıxış → NPC ---
  const kicked = B.c.waitT('kicked', 3000);
  const offline = A.c.waitT('entity', 6000, (m) => m.e.id === 'beta' && m.e.online === false);
  const B2 = new Client('Beta2');
  await B2.open();
  B2.send({ t: 'login', name: 'Beta', pin: '1234' });
  ok('eyni hesab başqa yerdən girəndə köhnəsi çıxarılır', !!(await kicked));
  await B2.waitT('loginOk');
  B2.close();
  // B2 heç vaxt oyuna girmədi; köhnə B bağlandı → Beta oflayn NPC olmalıdır
  const off = await offline;
  ok('çıxan oyunçu NPC-yə çevrilir', !!off, off ? 'online=false' : 'gəlmədi');

  // --- 10. PIN qoruması ---
  const C = new Client('brute');
  await C.open();
  let lastErr = null;
  for (let i = 0; i < 6; i++) {
    C.send({ t: 'login', name: 'Alfa', pin: String(1000 + i) });
    lastErr = await C.waitT('loginErr', 1500);
    await sleep(850);
  }
  ok('5 səhv PIN-dən sonra hesab bu IP üçün bloklanır', !!lastErr && /Çox səhv/.test(lastErr.msg), lastErr?.msg);
  C.send({ t: 'login', name: 'Alfa', pin: '1234' });
  const blocked = await C.waitT('loginErr', 1500);
  ok('bloklanandan sonra düzgün PIN ilə də girmək olmur', !!blocked && /Çox səhv/.test(blocked.msg));
  await sleep(850);
  C.send({ t: 'login', name: 'Beta', pin: '1234' });
  ok('eyni IP-dən BAŞQA hesab girə bilir (kampus Wi-Fi)', !!(await C.waitT('loginOk', 1500)));
  C.close();

  A.c.close();
  await sleep(200);
  const fails = results.filter((r) => r[0] === 'FAIL').length;
  for (const r of results) console.log(r[0], '-', r[1], r[2] ? `(${r[2]})` : '');
  console.log(`\n${results.length - fails}/${results.length} keçdi`);
  cleanup();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('TEST XƏTASI', e); cleanup(); process.exit(2); });
