// Kiçik xəritə (küncdə) və böyük xəritə (M düyməsi)
const PX = 2; // statik qatda 1 metr = 2 piksel

export class Minimap {
  constructor(campus, canvas) {
    this.c = campus;
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.big = false;
    this.b = campus.bounds;
    this.layer = this.buildLayer();
  }

  // dünya koordinatından statik qatın pikselinə
  lx(x) { return (x - this.b.minX) * PX; }
  lz(z) { return (z - this.b.minZ) * PX; }

  buildLayer() {
    const { c, b } = this;
    const cv = document.createElement('canvas');
    cv.width = (b.maxX - b.minX) * PX;
    cv.height = (b.maxZ - b.minZ) * PX;
    const g = cv.getContext('2d');
    g.fillStyle = '#5f8f4e';
    g.fillRect(0, 0, cv.width, cv.height);
    const areaCol = { meadow: '#8a8f5a', garden: '#4f8a43', asphalt: '#6b6e73', paving: '#b9b2a4', parking: '#5f6267', field: '#2f8a45', court: '#3f7fb0', volley: '#8a8c8f' };
    for (const a of c.areas || []) {
      g.fillStyle = areaCol[a.type] || '#777';
      g.fillRect(this.lx(a.x - a.w / 2), this.lz(a.z - a.d / 2), a.w * PX, a.d * PX);
    }
    // yollar
    g.lineCap = 'round';
    for (const [a, d, type = 'path'] of c.edges) {
      const [x1, z1] = c.nodes[a], [x2, z2] = c.nodes[d];
      g.strokeStyle = type === 'road' ? '#c9c4b8' : '#d8d1c1';
      g.lineWidth = (type === 'road' ? 13 : 3.4) * PX;
      g.beginPath(); g.moveTo(this.lx(x1), this.lz(z1)); g.lineTo(this.lx(x2), this.lz(z2)); g.stroke();
    }
    for (const [a, d, type = 'path'] of c.edges) {
      if (type !== 'road') continue;
      const [x1, z1] = c.nodes[a], [x2, z2] = c.nodes[d];
      g.strokeStyle = '#55585d';
      g.lineWidth = 9 * PX;
      g.beginPath(); g.moveTo(this.lx(x1), this.lz(z1)); g.lineTo(this.lx(x2), this.lz(z2)); g.stroke();
    }
    // binalar
    const bCol = { brick: '#9a4a35', brickglass: '#8a4535', pinkstripe: '#e8cfc6', modern: '#e9e2d6', cream: '#e3ddd2' };
    for (const bd of c.buildings) {
      g.fillStyle = bCol[bd.style] || '#ddd';
      g.fillRect(this.lx(bd.x - bd.w / 2), this.lz(bd.z - bd.d / 2), bd.w * PX, bd.d * PX);
      g.strokeStyle = 'rgba(0,0,0,0.45)';
      g.lineWidth = 2;
      g.strokeRect(this.lx(bd.x - bd.w / 2), this.lz(bd.z - bd.d / 2), bd.w * PX, bd.d * PX);
    }
    if (c.gallows) {
      g.fillStyle = '#5a3a20';
      g.fillRect(this.lx(c.gallows.x - 4), this.lz(c.gallows.z - 2), 8 * PX, 4 * PX);
    }
    return cv;
  }

  toggle() {
    this.big = !this.big;
    this.canvas.classList.toggle('big', this.big);
  }

  draw(player, facing, camYaw, others) {
    const cv = this.canvas, g = this.g;
    const cw = cv.clientWidth, ch = cv.clientHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (cv.width !== Math.round(cw * dpr) || cv.height !== Math.round(ch * dpr)) {
      cv.width = Math.round(cw * dpr);
      cv.height = Math.round(ch * dpr);
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, cw, ch);
    const L = this.layer;
    // miqyas: kiçik xəritədə ~1.2 px/m (oyunçu ortada), böyük xəritədə bütün kampus
    let scale, ox, oz;
    if (this.big) {
      scale = Math.min(cw / (L.width / PX), ch / (L.height / PX)) * 0.95;
      ox = (cw - (L.width / PX) * scale) / 2 - this.b.minX * scale;
      oz = (ch - (L.height / PX) * scale) / 2 - this.b.minZ * scale;
    } else {
      scale = 1.3;
      ox = cw / 2 - player.x * scale;
      oz = ch / 2 - player.z * scale;
    }
    const sx = (x) => ox + x * scale, sz = (z) => oz + z * scale;
    g.fillStyle = '#3d5f34';
    g.fillRect(0, 0, cw, ch);
    g.imageSmoothingEnabled = true;
    g.drawImage(L, sx(this.b.minX), sz(this.b.minZ), (L.width / PX) * scale, (L.height / PX) * scale);

    if (this.big) {
      g.font = '600 11px system-ui, sans-serif';
      g.textAlign = 'center';
      for (const bd of this.c.buildings) {
        if (!bd.name) continue;
        g.fillStyle = 'rgba(0,0,0,0.55)';
        const w = g.measureText(bd.name).width + 8;
        g.fillRect(sx(bd.x) - w / 2, sz(bd.z) - 8, w, 16);
        g.fillStyle = '#fff';
        g.fillText(bd.name, sx(bd.x), sz(bd.z) + 4);
      }
      if (this.c.gallows) {
        g.fillStyle = '#ffcf9a';
        g.fillText('Dar ağacı', sx(this.c.gallows.x), sz(this.c.gallows.z) - 10);
      }
    }
    // digər oyunçular və NPC-lər
    for (const o of others.values()) {
      const p = o.char.root.position;
      const x = sx(p.x), z = sz(p.z);
      if (x < -5 || z < -5 || x > cw + 5 || z > ch + 5) continue;
      g.beginPath();
      g.arc(x, z, this.big ? 3.5 : 3, 0, Math.PI * 2);
      g.fillStyle = o.dead ? '#ff3b30' : o.online ? '#4cd964' : '#c7c7c7';
      g.fill();
      g.lineWidth = 1;
      g.strokeStyle = 'rgba(0,0,0,0.6)';
      g.stroke();
    }
    // oyunçu: istiqamət oxu + kameranın baxış konusu
    const px = sx(player.x), pz = sz(player.z);
    g.save();
    g.translate(px, pz);
    g.fillStyle = 'rgba(255,255,255,0.13)';
    const look = camYaw + Math.PI; // kameranın baxdığı istiqamət
    g.beginPath();
    g.moveTo(0, 0);
    g.arc(0, 0, this.big ? 26 : 34, -look + Math.PI / 2 - 0.55, -look + Math.PI / 2 + 0.55);
    g.closePath();
    g.fill();
    g.rotate(-facing);
    g.beginPath();
    g.moveTo(0, 7); g.lineTo(5, -5); g.lineTo(0, -2.5); g.lineTo(-5, -5); g.closePath();
    g.fillStyle = '#ffd166';
    g.fill();
    g.strokeStyle = '#1b2838';
    g.lineWidth = 1.5;
    g.stroke();
    g.restore();
  }
}
