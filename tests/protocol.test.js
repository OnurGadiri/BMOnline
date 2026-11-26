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
const ok = (name, cond, extra = '') => { results.push([cond ? 'PASS' : 'FAIL', name, extra]); };
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
    return { x: to.x, z: to.z };
  }
}

async function enter(name, pin = '1234') {
  const c = new Client(name);
  await c.open();
  c.send({ t: 'login', name, pin });
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
  bad.close();

  // --- 2. Hesab yaratma, xarakter, oyuna giriş ---
  const A = await enter('Alfa');
  ok('yeni hesab yaradılır', A.lo?.isNew === true);
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
  const xp = await xpKill;
  ok('öldürən XP alır', !!xp, JSON.stringify(xp));
  // ölü oyunçu hərəkət edə bilmir
  B.c.send({ t: 'pos', x: B.c.pos.x + 1, y: 0, z: B.c.pos.z, ry: 0, m: 1, e: 0, w: 0 });
  await sleep(300);
  const snapDead = await A.c.waitT('snap', 1000);
  const rowB = snapDead?.e.find((r) => r[0] === 'beta');
  ok('ölü oyunçu snapshot-da ölü görünür və yerindən tərpənmir', !!rowB && rowB[8] === 1 && Math.abs(rowB[1] - B.c.pos.x) < 0.01, JSON.stringify(rowB));
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
  A.c.pos = await A.c.walkTo(A.c.pos, { x: B.c.pos.x, z: B.c.pos.z - 1.2 });
  // B-yə tərəf dön (z oxu boyunca +)
  A.c.send({ t: 'pos', x: A.c.pos.x, y: 0, z: A.c.pos.z, ry: 0, m: 0, e: 0, w: 0 });
  await sleep(150);
  const ph = A.c.waitT('hit', 1500);
  A.c.send({ t: 'punch' });
  const p = await ph;
  ok('yumruq dəyir (12 zərər)', p?.dmg === 12, JSON.stringify(p));
  // arxaya dönüb vurmaq dəyməməlidir
  A.c.send({ t: 'pos', x: A.c.pos.x, y: 0, z: A.c.pos.z, ry: Math.PI, m: 0, e: 0, w: 0 });
  await sleep(600);
  const ph2 = A.c.waitT('hit', 800);
  A.c.send({ t: 'punch' });
  ok('arxadakı hədəfə yumruq dəymir', !(await ph2));

  // --- 8. Dar ağacı ---
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
  // uzaqdakı futbol topuna vurmaq olmur
  const fb = A.c.waitT('balls', 800, (m) => { const r = m.b.find((x) => x[0] === 'football'); return r && Math.hypot(r[4], r[6]) > 1; });
  A.c.send({ t: 'kick', id: 'football', v: [10, 2, 0] });
  ok('uzaqdakı topa vurmaq olmur', !(await fb));
  // oturma emosiyası (5) qəbul olunur
  A.c.send({ t: 'pos', x: A.c.pos.x, y: 0, z: A.c.pos.z, ry: 0, m: 0, e: 5, w: 0 });
  const sitSnap = await B.c.waitT('snap', 1500, (m) => m.e.some((r) => r[0] === 'alfa' && r[6] === 5));
  ok('oturmaq digərlərinə görünür', !!sitSnap);

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
