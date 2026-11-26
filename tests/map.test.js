// BMU Online — xəritə (campus.json) yoxlaması: npm run test:map
const fs = require('fs');
const path = require('path');

const C = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'data', 'campus.json'), 'utf8'));
const problems = [];
const warn = (msg) => problems.push(msg);

const box = (b, pad = 0) => ({ minX: b.x - b.w / 2 - pad, maxX: b.x + b.w / 2 + pad, minZ: b.z - b.d / 2 - pad, maxZ: b.z + b.d / 2 + pad });
const inBox = (x, z, r) => x > r.minX && x < r.maxX && z > r.minZ && z < r.maxZ;
function segHitsBox(x1, z1, x2, z2, r) {
  let t0 = 0, t1 = 1;
  const dx = x2 - x1, dz = z2 - z1;
  for (const [p, q] of [[-dx, x1 - r.minX], [dx, r.maxX - x1], [-dz, z1 - r.minZ], [dz, r.maxZ - z1]]) {
    if (p === 0) { if (q < 0) return false; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return true;
}
function segDist(x, z, x1, z1, x2, z2) {
  const dx = x2 - x1, dz = z2 - z1;
  const t = Math.max(0, Math.min(1, ((x - x1) * dx + (z - z1) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(x - (x1 + t * dx), z - (z1 + t * dz));
}

const N = C.nodes, B = C.buildings, bnd = C.bounds;
const edges = C.edges.map(([a, c, type = 'path']) => {
  if (!N[a] || !N[c]) { warn(`kənar ${a}-${c}: mövcud olmayan nöqtə`); return null; }
  return { a, c, type, x1: N[a][0], z1: N[a][1], x2: N[c][0], z2: N[c][1], half: type === 'road' ? 6.7 : 1.9 };
}).filter(Boolean);

// 1. Nöqtələr xəritənin içində və binalardan kənarda
for (const [id, [x, z]] of Object.entries(N)) {
  if (!inBox(x, z, { minX: bnd.minX, maxX: bnd.maxX, minZ: bnd.minZ, maxZ: bnd.maxZ })) warn(`nöqtə ${id} xəritədən kənardadır`);
  for (const b of B) if (inBox(x, z, box(b, 1))) warn(`nöqtə ${id} "${b.id}" binasının içindədir`);
}
// 2. NPC marşrutları (server 1 m boşluq istəyir) və yol səthləri binalardan keçməsin
for (const e of edges) {
  for (const b of B) {
    if (segHitsBox(e.x1, e.z1, e.x2, e.z2, box(b, 1))) warn(`marşrut ${e.a}-${e.c} "${b.id}" binasından keçir`);
    else if (segHitsBox(e.x1, e.z1, e.x2, e.z2, box(b, e.type === 'road' ? 4.6 : 1.7))) warn(`${e.type === 'road' ? 'yol asfaltı' : 'cığır'} ${e.a}-${e.c} "${b.id}" binasına dəyir`);
  }
}
// 3. Qraf bağlıdır (hər yerə gedib çatmaq olur)
const adj = {};
for (const e of edges) { (adj[e.a] ||= []).push(e.c); (adj[e.c] ||= []).push(e.a); }
const ids = Object.keys(N);
const seen = new Set([ids[0]]);
const q = [ids[0]];
while (q.length) for (const n of adj[q.shift()] || []) if (!seen.has(n)) { seen.add(n); q.push(n); }
for (const id of ids) if (!seen.has(id)) warn(`nöqtə ${id} digərləri ilə bağlı deyil`);
// 4. Obyektlər yolun/binanın üstünə düşməsin
const onRoad = (x, z, r = 0) => edges.find((e) => segDist(x, z, e.x1, e.z1, e.x2, e.z2) < (e.type === 'road' ? 4.6 : 1.7) + r);
const objects = [];
const pd = C.plazaDecor || {};
for (const [x, z] of pd.benches || []) objects.push(['skamya', x, z, 1.1]);
for (const [x, z] of pd.flags || []) objects.push(['bayraq', x, z, 0.3]);
if (pd.letters) objects.push(['BEU hərfləri', pd.letters.x, pd.letters.z, 1]);
if (pd.billboard) objects.push(['lövhə', pd.billboard.x, pd.billboard.z, 1.5]);
if (pd.monument) objects.push(['abidə', pd.monument.x, pd.monument.z, 1.5]);
for (const n of C.npcs || []) objects.push([`NPC ${n.name}`, n.x, n.z, 0.5]);
if (C.gallows) objects.push(['dar ağacı', C.gallows.x, C.gallows.z, 4]);
if (C.crucifix) objects.push(['çarmıx', C.crucifix.x, C.crucifix.z, (C.crucifix.slots * C.crucifix.slotGap + 2) / 2]);
objects.push(['doğulma nöqtəsi', C.spawn.x, C.spawn.z, 0.5]);
for (const [name, x, z, r] of objects) {
  const e = onRoad(x, z, r);
  if (e && name !== 'doğulma nöqtəsi') warn(`${name} (${x}, ${z}) ${e.a}-${e.c} ${e.type === 'road' ? 'yolunun' : 'cığırının'} üstündədir`);
  for (const b of B) if (inBox(x, z, box(b, r))) warn(`${name} (${x}, ${z}) "${b.id}" binasının içindədir`);
  if (!inBox(x, z, { minX: bnd.minX, maxX: bnd.maxX, minZ: bnd.minZ, maxZ: bnd.maxZ })) warn(`${name} xəritədən kənardadır`);
}
// 5. Sahələr binalarla üst-üstə düşməsin (çəmənlik istisna)
for (const a of C.areas || []) {
  if (a.type === 'meadow') continue;
  for (const b of B) {
    const ra = box(a), rb = box(b);
    if (ra.minX < rb.maxX && ra.maxX > rb.minX && ra.minZ < rb.maxZ && ra.maxZ > rb.minZ) warn(`${a.type} sahəsi (${a.x}, ${a.z}) "${b.id}" binası ilə üst-üstə düşür`);
  }
  if (a.type === 'field' || a.type === 'court' || a.type === 'volley') {
    const e = edges.find((e) => ['minX', 'maxX'].some((kx) => ['minZ', 'maxZ'].some((kz) => segDist(box(a)[kx], box(a)[kz], e.x1, e.z1, e.x2, e.z2) < 0)) ||
      segHitsBox(e.x1, e.z1, e.x2, e.z2, box(a, e.type === 'road' ? 4.6 : 1.7)));
    if (e) warn(`${a.type} sahəsi (${a.x}, ${a.z}) ${e.a}-${e.c} yolu ilə kəsişir`);
  }
}
// 6. Binalar bir-birinin içinə girməsin (bitişik bloklar istisna: kəsişmə 7 m-dən çox olmasın)
for (let i = 0; i < B.length; i++) for (let j = i + 1; j < B.length; j++) {
  const a = box(B[i]), b = box(B[j]);
  const ox = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX), oz = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ);
  if (ox > 7 && oz > 7) warn(`"${B[i].id}" və "${B[j].id}" binaları bir-birinin içinə girir (${ox.toFixed(1)}×${oz.toFixed(1)} m)`);
}
// 7. Qüllələr kampusdan kənarda olsun
for (const t of C.towers || []) if (inBox(t.x, t.z, { minX: bnd.minX - 12, maxX: bnd.maxX + 12, minZ: bnd.minZ - 12, maxZ: bnd.maxZ + 12 })) warn(`qüllə (${t.x}, ${t.z}) kampusun içindədir`);

if (problems.length) {
  console.log(`${problems.length} problem tapıldı:`);
  for (const p of problems) console.log(' - ' + p);
  process.exit(1);
}
console.log(`Xəritə yaxşıdır: ${ids.length} nöqtə, ${edges.length} marşrut, ${B.length} bina yoxlandı.`);
