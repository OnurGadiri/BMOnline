// Top fizikasının server və klient üçün ORTAQ hissəsi (bir mənbə — iki tərəf eyni hesablayır).
// Server: require('public/js/ballphys.js'); klient: <script src="/js/ballphys.js"> → globalThis.BallPhys
//  goalFrame  — qapı çərçivəsi: dirəklər, üst tir və tor (arxa, yanlar, dam); top qapıya arxadan/yandan girə bilməz
//  bodyHits   — oyunçunun bədəni (silindr): top içindən keçmir, dəyib geri qayıdır
//  goalCrossed — qol yalnız top qapı xəttini meydança tərəfdən İÇƏRİ keçəndə sayılır
(function (root) {
  const GOAL_DEPTH = 1.6, POST_R = 0.1, BODY_R = 0.32, BODY_H = 1.75;

  /** b: {px,py,pz,vx,vy,vz}, prev: {x,y,z}, g: {x,z,half,h}, dir: qapının meydançadan çölə istiqaməti (±1), r: topun radiusu */
  function goalFrame(b, prev, g, dir, r) {
    const zb = g.z + dir * GOAL_DEPTH, half = g.half, h = g.h;
    const inX = (x) => Math.abs(x - g.x) < half;
    const inBox = (z) => (z - g.z) * dir > 0 && (zb - z) * dir > 0;
    // arxa tor
    if ((prev.z - zb) * (b.pz - zb) < 0 && inX(b.px) && b.py < h) { b.pz = zb + Math.sign(prev.z - zb) * (r + 0.01); b.vz = -b.vz * 0.2; b.vx *= 0.6; }
    // yan torlar
    for (const sx of [g.x - half, g.x + half]) {
      if ((prev.x - sx) * (b.px - sx) < 0 && (inBox(b.pz) || inBox(prev.z)) && b.py < h) { b.px = sx + Math.sign(prev.x - sx) * (r + 0.01); b.vx = -b.vx * 0.2; b.vz *= 0.6; }
    }
    // dam toru
    if ((prev.y - h) * (b.py - h) < 0 && inX(b.px) && inBox(b.pz)) { b.py = h + Math.sign(prev.y - h) * (r + 0.01); b.vy = -b.vy * 0.2; }
    // dirəklər
    for (const sx of [g.x - half, g.x + half]) {
      const dx = b.px - sx, dz = b.pz - g.z, d = Math.hypot(dx, dz), m = r + POST_R;
      if (b.py < h + r && d < m && d > 1e-4) {
        const nx = dx / d, nz = dz / d, vn = b.vx * nx + b.vz * nz;
        b.px = sx + nx * m; b.pz = g.z + nz * m;
        if (vn < 0) { b.vx -= 1.6 * vn * nx; b.vz -= 1.6 * vn * nz; }
      }
    }
    // üst tir
    if (inX(b.px)) {
      const dy = b.py - h, dz = b.pz - g.z, d = Math.hypot(dy, dz), m = r + POST_R;
      if (d < m && d > 1e-4) {
        const ny = dy / d, nz = dz / d, vn = b.vy * ny + b.vz * nz;
        b.py = h + ny * m; b.pz = g.z + nz * m;
        if (vn < 0) { b.vy -= 1.6 * vn * ny; b.vz -= 1.6 * vn * nz; }
      }
    }
  }

  /** bodies: [{x, y?, z}] — oyunçuların ayaq nöqtələri */
  function bodyHits(b, prev, bodies, r) {
    for (const e of bodies) {
      const sx = b.px - prev.x, sz = b.pz - prev.z, L2 = sx * sx + sz * sz;
      // bu addımda topun yolu boyunca bədənə ən yaxın nöqtə (sürətli top "içindən sıçramasın")
      const t = L2 > 1e-8 ? Math.min(1, Math.max(0, ((e.x - prev.x) * sx + (e.z - prev.z) * sz) / L2)) : 1;
      const cx = prev.x + sx * t, cz = prev.z + sz * t, cy = prev.y + (b.py - prev.y) * t;
      const ey = e.y || 0;
      if (cy > ey + BODY_H + r || cy < ey - r) continue;
      let dx = cx - e.x, dz = cz - e.z, d = Math.hypot(dx, dz);
      const m = BODY_R + r;
      if (d >= m) continue;
      if (d < 1e-4) { dx = -b.vx || 1; dz = -b.vz; d = Math.hypot(dx, dz); }
      const nx = dx / d, nz = dz / d, vn = b.vx * nx + b.vz * nz;
      b.px = e.x + nx * m; b.pz = e.z + nz * m;
      if (vn < 0) { b.vx = (b.vx - 1.4 * vn * nx) * 0.8; b.vz = (b.vz - 1.4 * vn * nz) * 0.8; }
    }
  }

  function goalCrossed(b, prev, g, dir, r) {
    return (prev.z - g.z) * dir < 0 && (b.pz - g.z) * dir >= 0 && Math.abs(b.px - g.x) < g.half - r && b.py < g.h;
  }

  /** sürətli top bir addımda dirəyi/oyunçunu "atlamasın" — neçə kiçik addım lazımdır */
  const substeps = (b, dt) => Math.min(4, Math.max(1, Math.ceil((Math.hypot(b.vx, b.vy, b.vz) * dt) / 0.2)));

  const api = { GOAL_DEPTH, BODY_R, BODY_H, goalFrame, bodyHits, goalCrossed, substeps };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BallPhys = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
