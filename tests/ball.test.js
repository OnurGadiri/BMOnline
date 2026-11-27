// Top fizikası (public/js/ballphys.js — server və klient eyni faylı işlədir): qapı toru, dirəklər, qol xətti, oyunçu bədəni.
// İşə salmaq: node tests/ball.test.js
const path = require('path');
const { goalFrame, bodyHits, goalCrossed, hoopFrame, hoopCrossed, basketAim, ballPair, substeps } = require(path.join(__dirname, '..', 'public', 'js', 'ballphys.js'));
const CAMPUS = require(path.join(__dirname, '..', 'public', 'data', 'campus.json'));

let pass = 0, fail = 0;
const ok = (name, cond, info = '') => { if (cond) pass++; else fail++; console.log(`${cond ? 'PASS' : 'FAIL'} - ${name} ${info}`); };

const FB = CAMPUS.balls.find((b) => b.id === 'football');
const G = 12;
/** serverdəki stepBall-un sadə surəti: cazibə, yer, qapı çərçivəsi, bədənlər, qol */
function simulate(start, v, bodies = [], seconds = 2) {
  const b = { px: start.x, py: start.y ?? FB.r, pz: start.z, vx: v[0], vy: v[1], vz: v[2] };
  let goal = -1;
  const dt = 1 / 30;
  for (let t = 0; t < seconds; t += dt) {
    const n = substeps(b, dt);
    for (let i = 0; i < n; i++) {
      const h = dt / n, prev = { x: b.px, y: b.py, z: b.pz }, vy0 = b.vy;
      b.vy -= G * h;
      b.px += b.vx * h; b.py += ((vy0 + b.vy) / 2) * h; b.pz += b.vz * h;
      if (b.py < FB.r) { b.py = FB.r; if (b.vy < 0) b.vy = -b.vy * 0.55; if (b.vy < 0.8) b.vy = 0; }
      for (const g of FB.goals) goalFrame(b, prev, g, Math.sign(g.z - FB.z), FB.r);
      if (bodies.length) bodyHits(b, prev, bodies, FB.r);
      FB.goals.forEach((g, gi) => { if (goal < 0 && goalCrossed(b, prev, g, Math.sign(g.z - FB.z), FB.r)) goal = gi; });
    }
  }
  return { b, goal };
}

const g0 = FB.goals[0]; // z=1, meydança +z tərəfdədir, tor -z tərəfdə
// 1) meydançadan qapıya vurulan top — qol
let r = simulate({ x: g0.x, z: g0.z + 10 }, [0, 1, -15]);
ok('meydançadan qapıya vurulan top qol olur', r.goal === 0);
ok('qoldan sonra top torda qalır (arxadan çıxmır)', r.b.pz > g0.z - 1.6 - 0.01, r.b.pz.toFixed(2));
// 2) arxadan (qapının arxasından) qapıya doğru — qol deyil, arxa tora dəyir
r = simulate({ x: g0.x, z: g0.z - 3 }, [0, 0, 15]);
ok('qapının arxasından keçən top qol olmur', r.goal === -1);
ok('arxadan gələn top arxa tora dəyib geri qayıdır', r.b.pz < g0.z - 1.6, r.b.pz.toFixed(2));
// 3) yandan, qapının içinə doğru
r = simulate({ x: g0.x + 6, z: g0.z - 0.8 }, [-14, 0, 0]);
ok('yandan gələn top yan tordan keçmir', r.b.px > g0.x + g0.half - 0.01 && r.goal === -1, r.b.px.toFixed(2));
// 4) dirəyə dəyən top geri qayıdır
r = simulate({ x: g0.x + g0.half, z: g0.z + 8 }, [0, 0.5, -16], [], 1);
ok('dirəyə dəyən top geri sıçrayır', r.goal === -1 && r.b.vz > 0, `vz=${r.b.vz.toFixed(2)}`);
// 5) üst tirin üstündən — qol deyil
r = simulate({ x: g0.x, z: g0.z + 6, y: 4.5 }, [0, 1, -10], [], 1);
ok('üst tirin üstündən keçən top qol olmur', r.goal === -1);
// 6) oyunçunun içindən keçmir
const body = { x: 48, z: 20 };
r = simulate({ x: 48, z: 28 }, [0, 0, -18], [body], 1);
ok('top oyunçunun içindən keçmir, dəyib geri qayıdır', r.b.pz > body.z && r.b.vz >= 0, `z=${r.b.pz.toFixed(2)} vz=${r.b.vz.toFixed(2)}`);
// 7) çox sürətli top da bədəndən keçmir (bir addımda atlamır)
r = simulate({ x: 48, z: 21.2 }, [0, 0, -24], [body], 0.2);
ok('sürətli top da bədəndən keçmir', r.b.pz > body.z, r.b.pz.toFixed(2));
// 8) başın üstündən keçən top dəymir
r = simulate({ x: 48, z: 26, y: 3 }, [0, 3, -16], [body], 0.6);
ok('başın üstündən keçən topa bədən mane olmur', r.b.pz < body.z, r.b.pz.toFixed(2));

// ---------- Basketbol: halqa, lövhə, səbət ----------
const BB = CAMPUS.balls.find((b) => b.kind === 'basketball'), H = BB.hoop;
/** serverdəki basketbol stepBall-un surəti */
function shoot(start, v, seconds = 4) {
  const b = { px: start.x, py: start.y ?? BB.r, pz: start.z, vx: v[0], vy: v[1], vz: v[2] };
  let made = 0, hits = 0;
  const dt = 1 / 30, bd = BB.bounds;
  for (let t = 0; t < seconds; t += dt) {
    const n = substeps(b, dt, BB.r);
    for (let i = 0; i < n; i++) {
      const h = dt / n, prev = { x: b.px, y: b.py, z: b.pz }, vy0 = b.vy;
      b.vy -= G * h;
      b.px += b.vx * h; b.py += ((vy0 + b.vy) / 2) * h; b.pz += b.vz * h;
      if (b.py < BB.r) { b.py = BB.r; if (b.vy < 0) b.vy = -b.vy * 0.72; if (b.vy < 0.8) b.vy = 0; const f = Math.max(0, 1 - 1.6 * h); b.vx *= f; b.vz *= f; }
      if (hoopFrame(b, prev, H, BB.r, h) > 0.5) hits++;
      if (hoopCrossed(b, prev, H)) made++;
      if (b.px < bd.minX + BB.r) { b.px = bd.minX + BB.r; b.vx = Math.abs(b.vx) * 0.5; }
      if (b.px > bd.maxX - BB.r) { b.px = bd.maxX - BB.r; b.vx = -Math.abs(b.vx) * 0.5; }
      if (b.pz < bd.minZ + BB.r) { b.pz = bd.minZ + BB.r; b.vz = Math.abs(b.vz) * 0.5; }
      if (b.pz > bd.maxZ - BB.r) { b.pz = bd.maxZ - BB.r; b.vz = -Math.abs(b.vz) * 0.5; }
    }
  }
  return { b, made, hits };
}
const decor = CAMPUS.plazaDecor.hoops[0];
ok('halqa və lövhə görünüşü fizika ilə eyni yerdədir', Math.abs(decor.z + decor.dir * decor.rim - H.z) < 1e-6 && Math.abs(decor.z + decor.dir * decor.board - H.board.z) < 1e-6);
ok('halqanın arxa hissəsi görünməz divarla kəsilmir', H.z + H.r + BB.r < BB.bounds.maxZ && (H.board.z - H.z) * H.board.dir > H.r);
const spots = [[69, -231.5], [72, -233], [66, -234], [69, -237], [75, -238], [63, -240], [80, -245], [69, -250]];
const aim = (x, z, p, rnd) => basketAim({ px: x, py: BB.r, pz: z }, H, p, rnd);
const exact = spots.filter(([x, z]) => shoot({ x, z }, aim(x, z, 0.5, () => 0.5)).made === 1).length;
ok('dəqiq atış (güc zolağının ortası) müxtəlif yerlərdən səbətə düşür', exact === spots.length, `${exact}/${spots.length}`);
let weak = 0;
for (const [x, z] of spots) weak += shoot({ x, z }, aim(x, z, 0, () => 0.5)).made;
ok('zəif atış (güc 0) səbətə düşmür', weak === 0, `${weak}`);
const fastest = Math.max(...spots.map(([x, z]) => Math.hypot(...aim(x, z, 1, () => 1))));
ok('ən uzaq/güclü atış serverin sürət limitinə (20) sığır', fastest < 20, fastest.toFixed(1));
let rb = shoot({ x: H.x, z: H.z, y: 1.2 }, [0, 7.5, 0]);
ok('aşağıdan halqadan keçib geri düşən top səbət sayılmır', rb.made === 0);
rb = shoot({ x: H.x, z: H.z, y: 4.2 }, [0, 0, 0]);
ok('yuxarıdan halqanın içinə düşən top səbətdir', rb.made === 1);
rb = shoot({ x: H.x + 0.4, z: -231, y: 3.5 }, [0, 3, 10], 0.6);
ok('lövhəyə atılan top içindən keçmir, geri qayıdır', rb.b.vz < 0 && rb.b.pz < H.board.z && rb.hits > 0, `z=${rb.b.pz.toFixed(2)} vz=${rb.b.vz.toFixed(2)}`);
rb = shoot({ x: H.x, z: H.z - H.r, y: 4 }, [0, 0, 0], 0.5);
ok('ön çənbərin üstünə düşən top ondan sıçrayır', rb.hits > 0 && rb.made === 0);
let stuck = '';
for (const [x, y, z] of [[H.x, 3.25, H.board.z - BB.r - 0.005], [H.x, 3.2, H.z + H.r], [H.x, 3.2, H.z - H.r], [H.x + H.r, 3.2, H.z]]) {
  rb = shoot({ x, z, y }, [0, 0, 0], 5);
  if (rb.b.py > 1) stuck += ` (${x},${y},${z}) → y=${rb.b.py.toFixed(2)}`;
}
ok('top çənbərin / lövhənin üstündə ilişib qalmır', !stuck, stuck);

// ---------- Toplar bir-birinə dəyir ----------
const A = { px: 70, py: 0.13, pz: -240, vx: 6, vy: 0, vz: 0 }, B2 = { px: 70.2, py: 0.12, pz: -240, vx: 0, vy: 0, vz: 0 };
ballPair(A, B2, 0.13, 0.12, 0.27, 0.62);
ok('toplar bir-birinin içindən keçmir, impuls ötürülür', Math.hypot(B2.px - A.px, B2.pz - A.pz) >= 0.249 && B2.vx > 0 && A.vx < 6);
const held = { px: 70, py: 1.9, pz: -240, vx: 0, vy: 0, vz: 0 }, hitter = { px: 69.8, py: 1.9, pz: -240, vx: 8, vy: 0, vz: 0 };
ballPair(hitter, held, 0.12, 0.13, 0.62, Infinity);
ok('havada dayanan (servis) top dəyəndə yerindən tərpənmir', held.px === 70 && held.vx === 0 && hitter.vx < 0);

console.log(`\n${pass}/${pass + fail} keçdi`);
process.exit(fail ? 1 : 0);
