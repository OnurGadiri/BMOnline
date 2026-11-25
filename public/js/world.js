// Kampus xəritəsi: binalar, yollar, ağaclar, futbol meydançası və s.
import * as THREE from 'three';
import { buildSky, buildClouds, addDecor } from './decor.js';

// Sabit toxumlu təsadüfi ədəd (hər kəsdə eyni ağac düzümü olsun)
function rng(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Bina fasadı: divar fakturası, çərçivəli pəncərələr, şüşədə səma əksi, pərdələr */
function facadeTexture(color, floors, cols, R) {
  const curtains = ['#e9c46a', '#f4a261', '#e76f51', '#a8dadc', '#ffffff', '#cdb4db'];
  return canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = color;
    g.fillRect(0, 0, w, h);
    // divar fakturası
    for (let i = 0; i < 2500; i++) {
      g.fillStyle = R() < 0.5 ? 'rgba(0,0,0,0.035)' : 'rgba(255,255,255,0.05)';
      g.fillRect(R() * w, R() * h, 2 + R() * 6, 2 + R() * 3);
    }
    const fh = h / floors, cw = w / cols;
    for (let f = 0; f < floors; f++) {
      const y0 = f * fh;
      // mərtəbə arası kornis
      g.fillStyle = 'rgba(0,0,0,0.16)';
      g.fillRect(0, y0 + fh - 7, w, 7);
      g.fillStyle = 'rgba(255,255,255,0.22)';
      g.fillRect(0, y0 + fh - 10, w, 3);
      for (let c = 0; c < cols; c++) {
        const x = c * cw + cw * 0.17, y = y0 + fh * 0.2, ww = cw * 0.66, wh = fh * 0.56;
        // kölgə + çərçivə
        g.fillStyle = 'rgba(0,0,0,0.25)';
        g.fillRect(x - 3, y - 3, ww + 9, wh + 9);
        g.fillStyle = '#f3f0ea';
        g.fillRect(x - 5, y - 5, ww + 10, wh + 10);
        // şüşə: səma əksi qradiyenti
        const lit = R() < 0.12;
        const gr = g.createLinearGradient(0, y, 0, y + wh);
        if (lit) { gr.addColorStop(0, '#fff1c4'); gr.addColorStop(1, '#f2c879'); }
        else { gr.addColorStop(0, '#b9dcf2'); gr.addColorStop(0.55, '#6c9cc2'); gr.addColorStop(1, '#3b6385'); }
        g.fillStyle = gr;
        g.fillRect(x, y, ww, wh);
        // pərdə
        if (R() < 0.3) {
          g.fillStyle = curtains[Math.floor(R() * curtains.length)];
          g.globalAlpha = 0.75;
          const cwid = ww * (0.2 + R() * 0.25);
          g.fillRect(R() < 0.5 ? x : x + ww - cwid, y, cwid, wh);
          g.globalAlpha = 1;
        }
        // diaqonal parıltı
        g.fillStyle = 'rgba(255,255,255,0.28)';
        g.beginPath();
        g.moveTo(x + ww * 0.15, y); g.lineTo(x + ww * 0.42, y); g.lineTo(x + ww * 0.1, y + wh); g.lineTo(x - 0, y + wh);
        g.closePath();
        g.fill();
        // çərçivə dirəkləri
        g.fillStyle = '#e6e2da';
        g.fillRect(x + ww / 2 - 2, y, 4, wh);
        g.fillRect(x, y + wh * 0.32, ww, 4);
        // pəncərə altlığı
        g.fillStyle = 'rgba(0,0,0,0.3)';
        g.fillRect(x - 7, y + wh + 5, ww + 14, 5);
        g.fillStyle = '#ffffff';
        g.fillRect(x - 7, y + wh + 3, ww + 14, 3);
      }
    }
  });
}

function grassTexture() {
  const t = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#78ad5f';
    g.fillRect(0, 0, w, h);
    const R = rng(77);
    for (let i = 0; i < 5000; i++) {
      const v = R();
      g.fillStyle = v < 0.33 ? '#6c9f55' : v < 0.66 ? '#85b96b' : '#71a65a';
      g.fillRect(R() * w, R() * h, 1 + R() * 2, 2 + R() * 4);
    }
    for (let i = 0; i < 25; i++) {
      g.fillStyle = 'rgba(60,100,40,0.12)';
      g.beginPath(); g.arc(R() * w, R() * h, 10 + R() * 30, 0, Math.PI * 2); g.fill();
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function pavingTexture() {
  const t = canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#d6cdb9';
    g.fillRect(0, 0, w, h);
    const R = rng(5);
    const bh = 16, bw = 32;
    for (let row = 0; row < h / bh; row++) {
      for (let col = -1; col < w / bw + 1; col++) {
        const x = col * bw + (row % 2) * (bw / 2), y = row * bh;
        const s = 200 + Math.floor(R() * 25);
        g.fillStyle = `rgb(${s + 14},${s + 6},${s - 12})`;
        g.fillRect(x + 1, y + 1, bw - 2, bh - 2);
      }
    }
    g.strokeStyle = 'rgba(120,105,80,0.35)';
    g.lineWidth = 1;
    for (let row = 0; row <= h / bh; row++) { g.beginPath(); g.moveTo(0, row * bh); g.lineTo(w, row * bh); g.stroke(); }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function plazaTexture() {
  return canvasTex(1024, 1024, (g, w, h) => {
    const cx = w / 2, cy = h / 2;
    g.fillStyle = '#ddd3c0';
    g.fillRect(0, 0, w, h);
    // konsentrik daş halqalar
    for (let r = 40; r < 512; r += 26) {
      g.strokeStyle = r % 78 < 26 ? 'rgba(140,120,90,0.45)' : 'rgba(140,120,90,0.2)';
      g.lineWidth = r % 78 < 26 ? 5 : 2;
      g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
    }
    // radial xətlər
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      g.strokeStyle = 'rgba(140,120,90,0.2)';
      g.lineWidth = 2;
      g.beginPath(); g.moveTo(cx + Math.cos(a) * 60, cy + Math.sin(a) * 60); g.lineTo(cx + Math.cos(a) * 512, cy + Math.sin(a) * 512); g.stroke();
    }
    // 8 guşəli ulduz naxışı
    g.fillStyle = 'rgba(29,53,87,0.55)';
    for (let k = 0; k < 2; k++) {
      g.beginPath();
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + k * Math.PI / 4;
        g.lineTo(cx + Math.cos(a) * 330, cy + Math.sin(a) * 330);
      }
      g.closePath();
      g.globalAlpha = 0.35;
      g.fill();
      g.globalAlpha = 1;
    }
    g.strokeStyle = 'rgba(255,209,102,0.7)';
    g.lineWidth = 6;
    g.beginPath(); g.arc(cx, cy, 335, 0, Math.PI * 2); g.stroke();
  });
}

function labelTexture(text, bg = '#1d3557') {
  return canvasTex(1024, 160, (g, w, h) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#ffd166';
    g.lineWidth = 8;
    g.strokeRect(6, 6, w - 12, h - 12);
    g.fillStyle = '#ffffff';
    g.font = 'bold 84px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2 + 4, w - 40);
  });
}

export function buildWorld(scene, campus, quality = 'high') {
  const colliders = [];   // AABB: {minX,maxX,minZ,maxZ,h}
  const circles = [];     // {x,z,r}
  const blockers = [];    // kameranın keçə bilmədiyi meshlər
  const lambert = (c) => new THREE.MeshLambertMaterial({ color: c });
  const R = rng(20260127);

  // --- Torpaq ---
  const b = campus.bounds;
  const size = (b.maxX - b.minX) + 120;
  const gTex = grassTexture();
  gTex.repeat.set(size / 6, size / 6);
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshLambertMaterial({ map: gTex }));
  grass.rotation.x = -Math.PI / 2;
  grass.receiveShadow = true;
  scene.add(grass);

  // --- Yollar (qraf kənarları üzrə, daş döşəmə + bordür) ---
  const pave = pavingTexture();
  const curbMat = lambert('#9c9484');
  const nodes = campus.nodes;
  for (const [a, c] of campus.edges) {
    const [x1, z1] = nodes[a], [x2, z2] = nodes[c];
    const len = Math.hypot(x2 - x1, z2 - z1);
    const t = pave.clone();
    t.needsUpdate = true;
    t.repeat.set(1.2, (len + 4) / 3.4);
    const pathMat = new THREE.MeshLambertMaterial({ map: t });
    for (const sx of [-1, 1]) {
      const curb = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.12, len + 4), curbMat);
      curb.position.set((x1 + x2) / 2, 0.06, (z1 + z2) / 2);
      curb.rotation.y = Math.atan2(x2 - x1, z2 - z1);
      curb.translateX(sx * 2.1);
      curb.receiveShadow = true;
      scene.add(curb);
    }
    const m = new THREE.Mesh(new THREE.BoxGeometry(4, 0.04, len + 4), pathMat);
    m.position.set((x1 + x2) / 2, 0.02, (z1 + z2) / 2);
    m.rotation.y = Math.atan2(x2 - x1, z2 - z1);
    m.receiveShadow = true;
    scene.add(m);
  }

  // --- Mərkəzi meydan + fəvvarə ---
  const plazaSide = lambert('#b8ab93');
  const plaza = new THREE.Mesh(new THREE.CylinderGeometry(26, 26, 0.08, 64),
    [plazaSide, new THREE.MeshLambertMaterial({ map: plazaTexture() }), plazaSide]);
  plaza.position.y = 0.04;
  plaza.receiveShadow = true;
  scene.add(plaza);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(18, 0.25, 6, 48), lambert('#b8ab93'));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.07;
  scene.add(ring);
  const f = campus.fountain;
  const basin = new THREE.Mesh(new THREE.CylinderGeometry(f.r, f.r + 0.3, 0.8, 24), lambert('#9aa5b1'));
  basin.position.set(f.x, 0.4, f.z);
  basin.castShadow = basin.receiveShadow = true;
  scene.add(basin);
  const water = new THREE.Mesh(new THREE.CylinderGeometry(f.r - 0.3, f.r - 0.3, 0.1, 24),
    new THREE.MeshLambertMaterial({ color: '#4aa3df', transparent: true, opacity: 0.85 }));
  water.position.set(f.x, 0.75, f.z);
  scene.add(water);
  const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.7, 2.4, 10), lambert('#9aa5b1'));
  spout.position.set(f.x, 1.6, f.z);
  spout.castShadow = true;
  scene.add(spout);
  const jet = new THREE.Mesh(new THREE.ConeGeometry(0.9, 1.6, 10, 1, true),
    new THREE.MeshLambertMaterial({ color: '#bfe6ff', transparent: true, opacity: 0.6 }));
  jet.position.set(f.x, 3.4, f.z);
  jet.rotation.x = Math.PI;
  scene.add(jet);
  circles.push({ x: f.x, z: f.z, r: f.r + 0.3 });

  // --- Bayraq dirəyi (Azərbaycan bayrağı) ---
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 14, 8), lambert('#dddddd'));
  pole.position.set(-14, 7, 14);
  pole.castShadow = true;
  scene.add(pole);
  circles.push({ x: -14, z: 14, r: 0.4 });
  const flagTex = canvasTex(300, 150, (g) => {
    g.fillStyle = '#00b5e2'; g.fillRect(0, 0, 300, 50);
    g.fillStyle = '#ef3340'; g.fillRect(0, 50, 300, 50);
    g.fillStyle = '#509e2f'; g.fillRect(0, 100, 300, 50);
    g.fillStyle = '#ffffff';
    g.beginPath(); g.arc(140, 75, 18, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ef3340';
    g.beginPath(); g.arc(146, 75, 15, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ffffff';
    g.beginPath();
    for (let i = 0; i < 16; i++) {
      const ang = (i / 16) * Math.PI * 2, rr = i % 2 ? 4.5 : 10;
      g.lineTo(170 + Math.cos(ang) * rr, 75 + Math.sin(ang) * rr);
    }
    g.fill();
  });
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(4, 2, 12, 1),
    new THREE.MeshLambertMaterial({ map: flagTex, side: THREE.DoubleSide }));
  flag.position.set(-12, 12.8, 14);
  scene.add(flag);

  // --- Binalar ---
  for (const bd of campus.buildings) {
    const floors = Math.max(1, Math.round(bd.h / 4));
    const mats = [];
    const sideTex = (len) => {
      const t = facadeTexture(bd.color, floors, 4, R);
      t.wrapS = THREE.RepeatWrapping;
      t.repeat.set(Math.max(1, Math.round(len / 12)), 1);
      return new THREE.MeshLambertMaterial({ map: t });
    };
    const roof = lambert(bd.roof);
    // BoxGeometry tərəf sırası: +x, -x, +y, -y, +z, -z
    mats.push(sideTex(bd.d), sideTex(bd.d), roof, roof, sideTex(bd.w), sideTex(bd.w));
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(bd.w, bd.h, bd.d), mats);
    mesh.position.set(bd.x, bd.h / 2, bd.z);
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
    blockers.push(mesh);
    // dam kənarı
    const parapet = new THREE.Mesh(new THREE.BoxGeometry(bd.w + 0.6, 0.6, bd.d + 0.6), roof);
    parapet.position.set(bd.x, bd.h + 0.3, bd.z);
    parapet.castShadow = true;
    scene.add(parapet);
    const cornice = new THREE.Mesh(new THREE.BoxGeometry(bd.w + 0.35, 0.25, bd.d + 0.35), lambert('#f1ece2'));
    cornice.position.set(bd.x, bd.h - 0.15, bd.z);
    scene.add(cornice);
    // daş bünövrə
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(bd.w + 0.5, 1.0, bd.d + 0.5), lambert('#8e8678'));
    plinth.position.set(bd.x, 0.5, bd.z);
    plinth.receiveShadow = true;
    scene.add(plinth);
    // damda kondisionerlər, su çəni
    const roofItems = Math.max(2, Math.round((bd.w * bd.d) / 250));
    for (let i = 0; i < roofItems; i++) {
      const rx = bd.x + (R() - 0.5) * (bd.w - 4), rz = bd.z + (R() - 0.5) * (bd.d - 4);
      const unit = R() < 0.75
        ? new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.1, 1.2), lambert('#c9ccd1'))
        : new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 1.8, 12), lambert('#e4e4e4'));
      unit.position.set(rx, bd.h + 0.6 + (unit.geometry.type === 'CylinderGeometry' ? 0.9 : 0.55), rz);
      unit.castShadow = true;
      scene.add(unit);
    }
    colliders.push({ minX: bd.x - bd.w / 2, maxX: bd.x + bd.w / 2, minZ: bd.z - bd.d / 2, maxZ: bd.z + bd.d / 2, h: bd.h });

    if (bd.name && bd.labelSide) {
      const side = { s: [0, 1], n: [0, -1], e: [1, 0], w: [-1, 0] }[bd.labelSide];
      const faceHalf = side[0] ? bd.w / 2 : bd.d / 2;
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(10, 1.6), new THREE.MeshBasicMaterial({ map: labelTexture(bd.name) }));
      sign.position.set(bd.x + side[0] * (faceHalf + 0.05), 5.2, bd.z + side[1] * (faceHalf + 0.05));
      sign.rotation.y = Math.atan2(side[0], side[1]);
      scene.add(sign);
      // giriş qapısı
      const door = new THREE.Mesh(new THREE.BoxGeometry(4, 3.2, 0.3), lambert('#3a4a5a'));
      door.position.set(bd.x + side[0] * faceHalf, 1.6, bd.z + side[1] * faceHalf);
      door.rotation.y = sign.rotation.y;
      scene.add(door);
      const canopy = new THREE.Mesh(new THREE.BoxGeometry(6, 0.3, 2), lambert('#555555'));
      canopy.position.set(bd.x + side[0] * (faceHalf + 1), 3.6, bd.z + side[1] * (faceHalf + 1));
      canopy.rotation.y = sign.rotation.y;
      canopy.castShadow = true;
      scene.add(canopy);
    }
  }

  // Əsas korpusun mərkəzi girişi və böyük yazı
  const main = campus.buildings.find((x) => x.id === 'main');
  if (main) {
    const front = main.z + main.d / 2;
    const big = new THREE.Mesh(new THREE.PlaneGeometry(36, 3.2),
      new THREE.MeshBasicMaterial({ map: labelTexture('BAKI MÜHƏNDİSLİK UNİVERSİTETİ') }));
    big.position.set(main.x, main.h - 2.2, front + 0.06);
    scene.add(big);
    // Sütunlu giriş (portik)
    const stone = lambert('#efe9dc');
    const slab = new THREE.Mesh(new THREE.BoxGeometry(26, 0.2, 7), lambert('#cfc6b4'));
    slab.position.set(main.x, 0.1, front + 3.5);
    slab.receiveShadow = true;
    scene.add(slab);
    for (let i = 0; i < 6; i++) {
      const cx = main.x - 10 + i * 4, cz = front + 5.6;
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.48, 7.6, 14), stone);
      col.position.set(cx, 3.9, cz);
      col.castShadow = col.receiveShadow = true;
      scene.add(col);
      for (const y of [0.35, 7.6]) {
        const capital = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.4, 1.2), stone);
        capital.position.set(cx, y, cz);
        capital.castShadow = true;
        scene.add(capital);
      }
      circles.push({ x: cx, z: cz, r: 0.6 });
    }
    const roofSlab = new THREE.Mesh(new THREE.BoxGeometry(26, 0.9, 7.2), stone);
    roofSlab.position.set(main.x, 8.2, front + 3.6);
    roofSlab.castShadow = roofSlab.receiveShadow = true;
    scene.add(roofSlab);
    const trim = new THREE.Mesh(new THREE.BoxGeometry(26.4, 0.25, 7.5), lambert('#1d3557'));
    trim.position.set(main.x, 8.75, front + 3.6);
    scene.add(trim);
    // şüşə qapılar
    const glassDoor = new THREE.Mesh(new THREE.BoxGeometry(10, 5, 0.2), new THREE.MeshLambertMaterial({ color: '#4f7fa8', emissive: '#16324a', emissiveIntensity: 0.4 }));
    glassDoor.position.set(main.x, 2.7, front + 0.06);
    scene.add(glassDoor);
    for (let i = 0; i <= 5; i++) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.15, 5, 0.3), lambert('#2a3540'));
      bar.position.set(main.x - 5 + i * 2, 2.7, front + 0.1);
      scene.add(bar);
    }
  }

  // --- Futbol meydançası ---
  const fd = campus.field;
  const fieldTex = canvasTex(900, 500, (g, w, h) => {
    for (let i = 0; i < 10; i++) { g.fillStyle = i % 2 ? '#3f9b4a' : '#46a852'; g.fillRect(i * w / 10, 0, w / 10, h); }
    g.strokeStyle = '#ffffff'; g.lineWidth = 6;
    g.strokeRect(20, 20, w - 40, h - 40);
    g.beginPath(); g.moveTo(w / 2, 20); g.lineTo(w / 2, h - 20); g.stroke();
    g.beginPath(); g.arc(w / 2, h / 2, 60, 0, Math.PI * 2); g.stroke();
    g.strokeRect(20, h / 2 - 110, 120, 220);
    g.strokeRect(w - 140, h / 2 - 110, 120, 220);
  });
  const field = new THREE.Mesh(new THREE.PlaneGeometry(fd.w, fd.d), new THREE.MeshLambertMaterial({ map: fieldTex }));
  field.rotation.x = -Math.PI / 2;
  field.position.set(fd.x, 0.05, fd.z);
  field.receiveShadow = true;
  scene.add(field);
  for (const side of [-1, 1]) {
    const gx = fd.x + side * (fd.w / 2 - 2);
    const gm = lambert('#ffffff');
    for (const dz of [-3.5, 3.5]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2.4, 0.2), gm);
      post.position.set(gx, 1.2, fd.z + dz);
      post.castShadow = true;
      scene.add(post);
      circles.push({ x: gx, z: fd.z + dz, r: 0.3 });
    }
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 7.2), gm);
    bar.position.set(gx, 2.4, fd.z);
    scene.add(bar);
  }

  // --- Dayanacaq və maşınlar ---
  const pk = campus.parking;
  const lot = new THREE.Mesh(new THREE.PlaneGeometry(pk.w, pk.d), lambert('#6b6b6b'));
  lot.rotation.x = -Math.PI / 2;
  lot.position.set(pk.x, 0.04, pk.z);
  lot.receiveShadow = true;
  scene.add(lot);
  const carColors = ['#e63946', '#f1faee', '#1d3557', '#222222', '#8d99ae', '#ffd166'];
  for (let i = 0; i < 8; i++) {
    if (R() < 0.3) continue;
    const cx = pk.x - pk.w / 2 + 4 + i * 6, cz = pk.z - 6;
    const car = new THREE.Group();
    const cm = lambert(carColors[Math.floor(R() * carColors.length)]);
    const lower = new THREE.Mesh(new THREE.BoxGeometry(2, 0.8, 4.2), cm);
    lower.position.y = 0.6;
    const upper = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.6, 2.2), cm);
    upper.position.set(0, 1.3, -0.2);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(1.82, 0.45, 2), lambert('#2b3a4a'));
    glass.position.set(0, 1.3, -0.2);
    car.add(lower, upper, glass);
    for (const wx of [-1, 1]) for (const wz of [-1.3, 1.3]) {
      const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.3, 10), lambert('#111111'));
      wh.rotation.z = Math.PI / 2;
      wh.position.set(wx * 0.95, 0.35, wz);
      car.add(wh);
    }
    car.traverse((o) => { o.castShadow = true; });
    car.position.set(cx, 0, cz);
    scene.add(car);
    colliders.push({ minX: cx - 1, maxX: cx + 1, minZ: cz - 2.1, maxZ: cz + 2.1, h: 1.6 });
  }

  // --- Hasar və darvaza ---
  const fenceMat = lambert('#4a4f57');
  const fenceH = 2.2;
  const g = campus.gate;
  const addFence = (x1, z1, x2, z2) => {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.3, fenceH, len), fenceMat);
    m.position.set((x1 + x2) / 2, fenceH / 2, (z1 + z2) / 2);
    m.rotation.y = Math.atan2(x2 - x1, z2 - z1);
    scene.add(m);
  };
  addFence(b.minX, b.minZ, b.maxX, b.minZ);
  addFence(b.minX, b.minZ, b.minX, b.maxZ);
  addFence(b.maxX, b.minZ, b.maxX, b.maxZ);
  addFence(b.minX, b.maxZ, g.x - 6, b.maxZ);
  addFence(g.x + 6, b.maxZ, b.maxX, b.maxZ);
  for (const side of [-1, 1]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(1.5, 6, 1.5), lambert('#d8cbb0'));
    pillar.position.set(g.x + side * 6.5, 3, b.maxZ);
    pillar.castShadow = true;
    scene.add(pillar);
    colliders.push({ minX: g.x + side * 6.5 - 0.75, maxX: g.x + side * 6.5 + 0.75, minZ: b.maxZ - 0.75, maxZ: b.maxZ + 0.75, h: 6 });
  }
  const arch = new THREE.Mesh(new THREE.BoxGeometry(14.5, 1.4, 0.6), new THREE.MeshLambertMaterial({ map: labelTexture('BMU') }));
  arch.position.set(g.x, 6.4, b.maxZ);
  scene.add(arch);

  // --- Skamyalar meydanın ətrafında ---
  for (let i = 0; i < 8; i++) {
    const ang = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const bx = Math.sin(ang) * 20, bz = Math.cos(ang) * 20;
    const bench = new THREE.Group();
    const wood = lambert('#8b5a2b');
    const seat = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.1, 0.6), wood); seat.position.y = 0.5;
    const back = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.5, 0.08), wood); back.position.set(0, 0.8, -0.28);
    const l1 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.5, 0.5), lambert('#333333')); l1.position.set(-0.95, 0.25, 0);
    const l2 = l1.clone(); l2.position.x = 0.95;
    bench.add(seat, back, l1, l2);
    bench.traverse((o) => { o.castShadow = true; });
    bench.position.set(bx, 0, bz);
    bench.rotation.y = ang + Math.PI;
    scene.add(bench);
    circles.push({ x: bx, z: bz, r: 1.1 });
  }

  // --- Dar ağacı ---
  if (campus.gallows) buildGallows(scene, campus.gallows, colliders);

  // --- Ağaclar ---
  const trunkGeo = new THREE.CylinderGeometry(0.2, 0.3, 2, 6);
  const leafGeo = new THREE.IcosahedronGeometry(1.6, 1);
  const coneGeo = new THREE.ConeGeometry(1.5, 3.5, 7);
  const trunkMat = lambert('#6b4a2b');
  const leafMats = ['#3f7d3a', '#4f8f45', '#5a9c4a', '#2f6b35', '#6aa84f', '#7a9e3a'].map((c) => new THREE.MeshLambertMaterial({ color: c, flatShading: true }));
  const nearPath = (x, z) => campus.edges.some(([a, c]) => {
    const [x1, z1] = nodes[a], [x2, z2] = nodes[c];
    const dx = x2 - x1, dz = z2 - z1;
    const t = Math.max(0, Math.min(1, ((x - x1) * dx + (z - z1) * dz) / (dx * dx + dz * dz)));
    return Math.hypot(x - (x1 + t * dx), z - (z1 + t * dz)) < 5;
  });
  const blocked = (x, z) =>
    colliders.some((c) => x > c.minX - 4 && x < c.maxX + 4 && z > c.minZ - 4 && z < c.maxZ + 4) ||
    Math.hypot(x, z) < 30 ||
    (Math.abs(x - fd.x) < fd.w / 2 + 3 && Math.abs(z - fd.z) < fd.d / 2 + 3) ||
    (Math.abs(x - pk.x) < pk.w / 2 + 3 && Math.abs(z - pk.z) < pk.d / 2 + 3) ||
    nearPath(x, z);
  let placed = 0;
  for (let tries = 0; tries < 2000 && placed < 160; tries++) {
    const x = b.minX + 4 + R() * (b.maxX - b.minX - 8);
    const z = b.minZ + 4 + R() * (b.maxZ - b.minZ - 8);
    if (blocked(x, z)) continue;
    const tree = new THREE.Group();
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.y = 1;
    const pine = R() < 0.35;
    const lm = leafMats[Math.floor(R() * leafMats.length)];
    const leaves = new THREE.Mesh(pine ? coneGeo : leafGeo, lm);
    leaves.position.y = pine ? 3.4 : 3;
    tree.add(trunk, leaves);
    if (pine) {
      const top = new THREE.Mesh(coneGeo, lm);
      top.scale.setScalar(0.7);
      top.position.y = 5.1;
      tree.add(top);
    } else {
      for (let k = 0; k < 2; k++) {
        const blob = new THREE.Mesh(leafGeo, lm);
        blob.scale.setScalar(0.6 + R() * 0.2);
        blob.position.set((R() - 0.5) * 1.8, 3.4 + R() * 0.9, (R() - 0.5) * 1.8);
        tree.add(blob);
      }
    }
    tree.traverse((o) => { o.castShadow = true; });
    const s = 0.8 + R() * 0.6;
    tree.scale.setScalar(s);
    tree.position.set(x, 0, z);
    tree.rotation.y = R() * 6;
    scene.add(tree);
    circles.push({ x, z, r: 0.35 * s });
    placed++;
  }

  // --- Səma, buludlar, kollar, çiçəklər, fənərlər, ot ---
  const sky = buildSky(scene);
  const updateClouds = buildClouds(scene, R);
  addDecor(scene, campus, { colliders, circles }, R, quality);

  const update = (t, dt = 0.016, cam = null) => {
    if (cam) sky.position.copy(cam.position);
    updateClouds(dt);
    water.material.color.setHSL(0.56, 0.62, 0.55 + Math.sin(t * 2) * 0.03);
    jet.scale.y = 1 + Math.sin(t * 4) * 0.08;
    const pos = flag.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      pos.setZ(i, Math.sin(x * 1.6 + t * 4) * 0.15 * ((x + 2) / 4));
    }
    pos.needsUpdate = true;
  };

  return { colliders, circles, blockers, bounds: b, update };
}

/** Dar ağacı məhkumunun yeri (server də eyni hesablamanı edir) */
export function gallowsSlot(g, i) {
  return { x: g.x + (i - (g.slots - 1) / 2) * g.slotGap, y: g.platformH, z: g.z };
}

function buildGallows(scene, g, colliders) {
  const wood = new THREE.MeshLambertMaterial({ color: '#7a5230' });
  const woodDark = new THREE.MeshLambertMaterial({ color: '#5a3a20' });
  const rope = new THREE.MeshLambertMaterial({ color: '#c8a96a' });
  const grp = new THREE.Group();
  grp.position.set(g.x, 0, g.z);
  scene.add(grp);
  const box = (w, h, d, m, x, y, z, rz = 0) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    b.position.set(x, y, z);
    b.rotation.z = rz;
    b.castShadow = b.receiveShadow = true;
    grp.add(b);
    return b;
  };
  const H = g.platformH;
  const W = g.slots * g.slotGap + 1.2, D = 3.2;
  // platforma və taxta lövhələr
  box(W, H, D, wood, 0, H / 2, 0);
  for (let i = 0; i < 9; i++) box(W + 0.02, 0.02, 0.05, woodDark, 0, H + 0.005, -D / 2 + 0.2 + i * 0.35);
  for (let i = 0; i < g.slots; i++) {
    const s = gallowsSlot({ ...g, x: 0, z: 0 }, i);
    box(1.1, 0.03, 1.1, woodDark, s.x, H + 0.01, 0); // lyuk
  }
  // pilləkən (ön tərəf)
  const steps = 4;
  for (let i = 0; i < steps; i++) {
    const h = (H * (i + 1)) / steps;
    box(2, h, 0.45, wood, 0, h / 2, D / 2 + 0.45 * (steps - i) - 0.2);
  }
  // dirəklər və tir
  const postH = 3.6;
  for (const sx of [-1, 1]) {
    box(0.32, postH, 0.32, woodDark, sx * (W / 2 - 0.3), H + postH / 2, -0.2);
    box(0.16, 1.3, 0.16, woodDark, sx * (W / 2 - 0.75), H + postH - 0.55, -0.2, sx * 0.785);
  }
  const beamY = H + postH - 0.12;
  box(W - 0.1, 0.3, 0.3, woodDark, 0, beamY, -0.2);
  // kəndirlər və ilgəklər
  for (let i = 0; i < g.slots; i++) {
    const s = gallowsSlot({ ...g, x: 0, z: 0 }, i);
    const topY = beamY - 0.15, loopY = H + 1.55;
    const len = topY - loopY;
    const r = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, len, 6), rope);
    r.position.set(s.x, loopY + len / 2, -0.16);
    grp.add(r);
    const loop = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.03, 6, 14), rope);
    loop.position.set(s.x, loopY - 0.05, -0.03);
    loop.rotation.x = Math.PI / 2 - 0.4;
    grp.add(loop);
  }
  // lövhə
  const signTex = canvasTex(512, 128, (c, w, h) => {
    c.fillStyle = '#3b2412'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#c8a96a'; c.lineWidth = 8; c.strokeRect(6, 6, w - 12, h - 12);
    c.fillStyle = '#f0d9a8'; c.font = 'bold 64px Georgia, serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('DAR AĞACI', w / 2, h / 2 + 4);
  });
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.65), new THREE.MeshLambertMaterial({ map: signTex }));
  sign.position.set(0, beamY + 0.55, -0.04);
  grp.add(sign);
  box(0.1, 0.5, 0.1, woodDark, -0.9, beamY + 0.3, -0.2);
  box(0.1, 0.5, 0.1, woodDark, 0.9, beamY + 0.3, -0.2);

  // toqquşma: platforma + pilləkən
  colliders.push({ minX: g.x - W / 2, maxX: g.x + W / 2, minZ: g.z - D / 2, maxZ: g.z + D / 2, h: H + postH });
  colliders.push({ minX: g.x - 1, maxX: g.x + 1, minZ: g.z + D / 2, maxZ: g.z + D / 2 + 0.45 * steps, h: H });
}

/** Oyunçunu binalardan, ağaclardan, sərhəddən kənarda saxlayır */
export function resolveCollisions(pos, radius, world) {
  const b = world.bounds;
  pos.x = Math.min(b.maxX - radius - 0.3, Math.max(b.minX + radius + 0.3, pos.x));
  pos.z = Math.min(b.maxZ - radius - 0.3, Math.max(b.minZ + radius + 0.3, pos.z));
  for (const c of world.colliders) {
    if (pos.y >= c.h) continue; // üstündədirsə toqquşma yoxdur
    const cx = Math.max(c.minX, Math.min(pos.x, c.maxX));
    const cz = Math.max(c.minZ, Math.min(pos.z, c.maxZ));
    const dx = pos.x - cx, dz = pos.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 < radius * radius) {
      if (d2 > 1e-6) {
        const d = Math.sqrt(d2);
        pos.x = cx + (dx / d) * radius;
        pos.z = cz + (dz / d) * radius;
      } else {
        // mərkəz qutunun içindədirsə — ən yaxın kənara itələ
        const pushes = [[c.minX - radius - pos.x, 0], [c.maxX + radius - pos.x, 0], [0, c.minZ - radius - pos.z], [0, c.maxZ + radius - pos.z]];
        pushes.sort((p, q) => Math.abs(p[0] + p[1]) - Math.abs(q[0] + q[1]));
        pos.x += pushes[0][0];
        pos.z += pushes[0][1];
      }
    }
  }
  for (const c of world.circles) {
    const dx = pos.x - c.x, dz = pos.z - c.z;
    const d = Math.hypot(dx, dz);
    const min = c.r + radius;
    if (d < min && d > 1e-6) {
      pos.x = c.x + (dx / d) * min;
      pos.z = c.z + (dz / d) * min;
    }
  }
}
