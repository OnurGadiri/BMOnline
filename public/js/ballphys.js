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

  // ---------- Basketbol: halqa (çənbər), lövhə, tor ----------
  const RIM_TUBE = 0.02; // çənbər borusunun radiusu
  const RIM_E = 0.55, BOARD_E = 0.65; // sıçrama əmsalları (çənbər / şüşə lövhə)

  /** Kürə ilə qutu (lövhə) toqquşması; dəyişmə sürətini qaytarır */
  function boxHit(b, x1, x2, y1, y2, z1, z2, r, e) {
    const cx = Math.min(x2, Math.max(x1, b.px)), cy = Math.min(y2, Math.max(y1, b.py)), cz = Math.min(z2, Math.max(z1, b.pz));
    let dx = b.px - cx, dy = b.py - cy, dz = b.pz - cz, d = Math.hypot(dx, dy, dz);
    if (d >= r) return 0;
    if (d < 1e-5) return 0; // mərkəz qutunun içindədir — klampla çıxarılır (aşağıda)
    const nx = dx / d, ny = dy / d, nz = dz / d, vn = b.vx * nx + b.vy * ny + b.vz * nz;
    b.px = cx + nx * r; b.py = cy + ny * r; b.pz = cz + nz * r;
    if (vn >= 0) return 0;
    // normal üzrə əks, toxunan üzrə bir az sürtünmə
    const tx = b.vx - vn * nx, ty = b.vy - vn * ny, tz = b.vz - vn * nz;
    b.vx = tx * 0.92 - vn * e * nx; b.vy = ty * 0.92 - vn * e * ny; b.vz = tz * 0.92 - vn * e * nz;
    return -vn;
  }

  /**
   * h: {x, y, z, r, board: {z, dir, w, y1, y2}} — halqanın mərkəzi və radiusu, lövhənin ön üzü (dir: lövhənin halqaya görə z istiqaməti).
   * Top çənbərdən sıçrayır, lövhədən əks olunur, torun içində yavaşlayır. Ən güclü zərbənin sürətini qaytarır (səs üçün).
   */
  function hoopFrame(b, prev, h, r, dt) {
    let hit = 0;
    const bo = h.board;
    if (bo) {
      // lövhə: ön üzü bo.z, qalınlığı 5 sm divara doğru (kiçik addımlar sayəsində top onu "atlamır")
      const za = bo.z, zb = bo.z + bo.dir * 0.05;
      hit = Math.max(hit, boxHit(b, h.x - bo.w / 2, h.x + bo.w / 2, bo.y1, bo.y2, Math.min(za, zb), Math.max(za, zb), r, BOARD_E));
    }
    // çənbər (torus): topun mərkəzinə ən yaxın çənbər nöqtəsi
    const dx = b.px - h.x, dz = b.pz - h.z, dh = Math.hypot(dx, dz);
    let touching = false;
    if (dh > 1e-4 && Math.abs(b.py - h.y) < r + RIM_TUBE + 0.05) {
      const qx = h.x + (dx / dh) * h.r, qz = h.z + (dz / dh) * h.r;
      let ex = b.px - qx, ey = b.py - h.y, ez = b.pz - qz;
      const d = Math.hypot(ex, ey, ez), m = r + RIM_TUBE;
      if (d < m && d > 1e-5) {
        touching = true;
        const nx = ex / d, ny = ey / d, nz = ez / d, vn = b.vx * nx + b.vy * ny + b.vz * nz;
        b.px = qx + nx * m; b.py = h.y + ny * m; b.pz = qz + nz * m;
        if (vn < 0) {
          const tx = b.vx - vn * nx, ty = b.vy - vn * ny, tz = b.vz - vn * nz;
          b.vx = tx * 0.9 - vn * RIM_E * nx; b.vy = ty * 0.9 - vn * RIM_E * ny; b.vz = tz * 0.9 - vn * RIM_E * nz;
          hit = Math.max(hit, -vn);
        }
        // çənbərin üstündə "ilişib qalmasın" (məs. lövhə ilə çənbər arasında): yavaş top meylli olduğu tərəfə yuvarlanır,
        // lövhəyə doğru meyllidirsə — meydançaya / halqanın içinə doğru
        if (Math.hypot(b.vx, b.vy, b.vz) < 0.6 && ny > 0.3) {
          let lx = nx, lz = nz;
          if (bo && lz * bo.dir > 0) lz = -bo.dir * 0.8;
          if (Math.hypot(lx, lz) < 0.15) lz = bo ? -bo.dir : -1;
          const L = Math.hypot(lx, lz);
          b.vx += (lx / L) * 0.7; b.vz += (lz / L) * 0.7;
        }
      }
    }
    // tor: çənbərin altında, topu yavaşladır və aşağı yönəldir (səbət "şıx" edir)
    if (!touching && dh < h.r && b.py < h.y && b.py > h.y - 0.45) {
      const f = Math.exp(-9 * dt);
      b.vx *= f; b.vz *= f;
      if (b.vy > 0) b.vy *= f;
    }
    return hit;
  }

  /**
   * Səbət: top halqanın içindən YUXARIDAN aşağı düşür. Aşağıdan yuxarı halqadan keçən top (sonra geri düşsə də) sayılmır.
   * b.hoopUp — topun aşağıdan keçdiyi qeyd edilir.
   */
  function hoopCrossed(b, prev, h) {
    const at = (k) => Math.hypot(prev.x + (b.px - prev.x) * k - h.x, prev.z + (b.pz - prev.z) * k - h.z);
    let made = false;
    if (prev.y < h.y && b.py >= h.y && at((h.y - prev.y) / (b.py - prev.y)) < h.r) b.hoopUp = 1;
    else if (prev.y > h.y && b.py <= h.y) made = !b.hoopUp && at((prev.y - h.y) / (prev.y - b.py)) < h.r;
    if (b.hoopUp && (b.py < h.y - 0.6 || Math.hypot(b.px - h.x, b.pz - h.z) > h.r + 0.6)) b.hoopUp = 0;
    return made;
  }

  /**
   * Basketbol atışı: halqaya ~45° ilə düşən qövs. p — güc zolağı (0..1), 0.5 dəqiq atışdır;
   * səhv topu qısa (p<0.5) və ya uzun (p>0.5, lövhəyə) salır, uzaq atış daha çətindir. rnd: () => [0,1)
   */
  function basketAim(b, h, p, rnd = Math.random) {
    let dx = h.x - b.px, dz = h.z - b.pz;
    const d = Math.hypot(dx, dz) || 1e-3, ux = dx / d, uz = dz / d;
    const err = (p - 0.5) * (0.8 + d / 20) + (rnd() - 0.5) * 0.04; // qısa/uzun (m)
    const side = (rnd() - 0.5) * 0.04; // yana kiçik səpələnmə
    dx += ux * err - uz * side; dz += uz * err + ux * side;
    const dd = Math.hypot(dx, dz), dy = h.y + 0.02 - b.py;
    const G = 12, slope = 1.05; // düşmə bucağı ~46°
    const T = Math.sqrt((2 * Math.max(0.3, dy + slope * dd)) / G);
    return [dx / T, dy / T + 0.5 * G * T, dz / T];
  }

  /** İki top toqquşması (kütlələrə görə); held — havada dayanan top (servis) tərpənmir. Zərbə sürətini qaytarır. */
  const MASS = { football: 0.43, basketball: 0.62, volleyball: 0.27 };
  function ballPair(a, b, ra, rb, ma, mb) {
    const dx = b.px - a.px, dy = b.py - a.py, dz = b.pz - a.pz, d = Math.hypot(dx, dy, dz), m = ra + rb;
    if (d >= m || d < 1e-5) return 0;
    const nx = dx / d, ny = dy / d, nz = dz / d;
    const wa = ma === Infinity ? 0 : 1 / ma, wb = mb === Infinity ? 0 : 1 / mb;
    if (!wa && !wb) return 0;
    const pen = m - d;
    a.px -= nx * pen * (wa / (wa + wb)); a.py -= ny * pen * (wa / (wa + wb)); a.pz -= nz * pen * (wa / (wa + wb));
    b.px += nx * pen * (wb / (wa + wb)); b.py += ny * pen * (wb / (wa + wb)); b.pz += nz * pen * (wb / (wa + wb));
    const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny + (b.vz - a.vz) * nz;
    if (vn >= 0) return 0;
    const j = (-(1 + 0.8) * vn) / (wa + wb);
    a.vx -= j * wa * nx; a.vy -= j * wa * ny; a.vz -= j * wa * nz;
    b.vx += j * wb * nx; b.vy += j * wb * ny; b.vz += j * wb * nz;
    return -vn;
  }

  /** sürətli top bir addımda dirəyi/çənbəri/oyunçunu "atlamasın" — neçə kiçik addım lazımdır (kiçik top daha xırda addımla) */
  const substeps = (b, dt, r = 0.2) => Math.min(8, Math.max(1, Math.ceil((Math.hypot(b.vx, b.vy, b.vz) * dt) / (r < 0.15 ? 0.1 : 0.2))));

  const api = { GOAL_DEPTH, BODY_R, BODY_H, MASS, goalFrame, bodyHits, goalCrossed, hoopFrame, hoopCrossed, basketAim, ballPair, substeps };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BallPhys = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
