// Top fizikası (public/js/ballphys.js — server və klient eyni faylı işlədir): qapı toru, dirəklər, qol xətti, oyunçu bədəni.
// İşə salmaq: node tests/ball.test.js
const path = require('path');
const { goalFrame, bodyHits, goalCrossed, substeps } = require(path.join(__dirname, '..', 'public', 'js', 'ballphys.js'));
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

console.log(`\n${pass}/${pass + fail} keçdi`);
process.exit(fail ? 1 : 0);
