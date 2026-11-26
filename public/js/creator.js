// Xarakter yaratma / dəyişmə ekranı
import * as THREE from 'three';
import { buildCharacter, animateRig, makeNameTag } from './character.js';

const TABS = [
  { id: 'presets', icon: '⭐', label: 'Hazır', focus: 'full' },
  { id: 'body', icon: '🧍', label: 'Bədən', focus: 'full' },
  { id: 'face', icon: '🙂', label: 'Üz', focus: 'head' },
  { id: 'hair', icon: '💇', label: 'Saç', focus: 'head' },
  { id: 'clothes', icon: '👕', label: 'Geyim', focus: 'full' },
  { id: 'acc', icon: '🎒', label: 'Aksesuar', focus: 'upper' },
];
// Hər bölmənin "qarışdır" düyməsinin dəyişdirdiyi sahələr
const TAB_KEYS = {
  body: ['skin', 'height', 'build', 'muscle', 'headSize', 'legLen'],
  face: ['faceShape', 'eyeShape', 'eyes', 'brows', 'nose', 'mouth', 'lipColor', 'cheeks', 'beard'],
  hair: ['hair', 'hairColor'],
  clothes: ['top', 'pattern', 'topColor', 'topColor2', 'bottom', 'bottomColor', 'shoeType', 'shoes'],
  acc: ['hat', 'glasses', 'bag', 'earrings', 'neck', 'accColor'],
};
const FOCUS = {
  full: { y: 0.98, dist: 5.3 },
  upper: { y: 1.42, dist: 2.4 },
  head: { y: 1.74, dist: 1.55 },
};
const POSES = [
  { e: 0, icon: '🧍', label: 'Dayan' },
  { e: 1, icon: '👋', label: 'Salam' },
  { e: 2, icon: '💃', label: 'Rəqs' },
  { e: 3, icon: '🙌', label: 'Sevinc' },
];

export class Creator {
  constructor(options) {
    this.opt = options;
    this.panel = document.getElementById('creator');
    this.fields = document.getElementById('creator-fields');
    this.tabsEl = document.getElementById('cr-tabs');
    this.app = null;
    this.tab = 'presets';
    this.undoStack = [];
    this.redoStack = [];
    this.savedKey = '';
    this.emote = 0;
    this.emoteTimer = 0;
    this.onSave = null;
    this.onCancel = null;

    this.setupScene();
    this.setupThumbs();
    this.setupUI();
  }

  // ---------------- Səhnə ----------------
  setupScene() {
    const s = (this.scene = new THREE.Scene());
    const bg = document.createElement('canvas');
    bg.width = 2; bg.height = 256;
    const g = bg.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#2b4162'); grad.addColorStop(0.6, '#1b2838'); grad.addColorStop(1, '#0f1722');
    g.fillStyle = grad; g.fillRect(0, 0, 2, 256);
    const bgTex = new THREE.CanvasTexture(bg);
    bgTex.colorSpace = THREE.SRGBColorSpace;
    s.background = bgTex;

    this.camera = new THREE.PerspectiveCamera(32, 1, 0.05, 50);
    s.add(new THREE.HemisphereLight('#ffffff', '#334455', 1.6));
    const key = new THREE.DirectionalLight('#fff4e0', 2.4);
    key.position.set(2.5, 4, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    Object.assign(key.shadow.camera, { left: -2, right: 2, top: 3, bottom: -1 });
    s.add(key);
    const rim = new THREE.DirectionalLight('#7fb3ff', 1.8);
    rim.position.set(-3, 3, -4);
    s.add(rim);
    const fill = new THREE.DirectionalLight('#ffd6a8', 0.6);
    fill.position.set(-4, 1, 3);
    s.add(fill);

    const floor = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.4, 0.16, 48), new THREE.MeshLambertMaterial({ color: '#24364a' }));
    floor.position.y = -0.08;
    floor.receiveShadow = true;
    s.add(floor);
    const glow = new THREE.Mesh(new THREE.TorusGeometry(1.32, 0.025, 8, 64), new THREE.MeshBasicMaterial({ color: '#ffd166' }));
    glow.rotation.x = Math.PI / 2;
    s.add(glow);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(12, 48), new THREE.MeshLambertMaterial({ color: '#16202c' }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.16;
    ground.receiveShadow = true;
    s.add(ground);

    this.holder = new THREE.Group();
    s.add(this.holder);
    this.char = null;
    this.spin = 0;
    this.zoom = 1;
    this.focus = { ...FOCUS.full };
    this.focusTarget = FOCUS.full;

    const canvas = document.getElementById('view');
    let dragging = false, lastX = 0, vel = 0;
    canvas.addEventListener('pointerdown', (e) => { if (this.isOpen()) { dragging = true; lastX = e.clientX; vel = 0; } });
    window.addEventListener('pointerup', () => { if (dragging) { dragging = false; this.spin = vel; } });
    window.addEventListener('pointermove', (e) => {
      if (!dragging || !this.isOpen()) return;
      const dx = (e.clientX - lastX) * 0.012;
      this.holder.rotation.y += dx;
      vel = dx * 30;
      lastX = e.clientX;
    });
    canvas.addEventListener('wheel', (e) => {
      if (this.isOpen()) this.zoom = Math.min(1.5, Math.max(0.55, this.zoom + Math.sign(e.deltaY) * 0.08));
    }, { passive: true });
  }

  // ---------------- Kiçik önizləmə şəkilləri ----------------
  setupThumbs() {
    this.thumbR = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.thumbR.setSize(112, 112);
    this.thumbScene = new THREE.Scene();
    this.thumbScene.add(new THREE.HemisphereLight('#ffffff', '#445566', 1.8));
    const l = new THREE.DirectionalLight('#ffffff', 2);
    l.position.set(2, 3, 4);
    this.thumbScene.add(l);
    this.thumbCam = new THREE.PerspectiveCamera(30, 1, 0.05, 20);
    this.thumbCache = new Map();
    this.thumbQueue = [];
  }

  thumb(appearance, mode, img) {
    const key = mode + JSON.stringify(appearance);
    if (this.thumbCache.has(key)) { img.src = this.thumbCache.get(key); return; }
    this.thumbQueue.push({ appearance, mode, img, key });
  }

  processThumbs() {
    // hər kadrda bir neçə şəkil — interfeys donmasın
    const t0 = performance.now();
    while (this.thumbQueue.length && performance.now() - t0 < 8) {
      const job = this.thumbQueue.shift();
      if (!job.img.isConnected) continue;
      if (this.thumbCache.has(job.key)) { job.img.src = this.thumbCache.get(job.key); continue; }
      const c = buildCharacter(job.appearance);
      c.root.rotation.y = job.mode === 'head' ? 0.35 : 0.3;
      this.thumbScene.add(c.root);
      if (job.mode === 'head') {
        const hy = c.headY + 0.08 * job.appearance.height;
        this.thumbCam.position.set(0, hy + 0.04, 1.05);
        this.thumbCam.lookAt(0, hy, 0);
      } else {
        this.thumbCam.position.set(0, 1.05, 4.6);
        this.thumbCam.lookAt(0, 0.95, 0);
      }
      this.thumbR.render(this.thumbScene, this.thumbCam);
      this.thumbScene.remove(c.root);
      const url = this.thumbR.domElement.toDataURL();
      if (this.thumbCache.size > 400) this.thumbCache.clear();
      this.thumbCache.set(job.key, url);
      job.img.src = url;
    }
  }

  // ---------------- İnterfeys ----------------
  setupUI() {
    for (const t of TABS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.tab = t.id;
      b.innerHTML = `<span class="ti"></span><span class="tl"></span>`;
      b.querySelector('.ti').textContent = t.icon;
      b.querySelector('.tl').textContent = t.label;
      b.onclick = () => this.setTab(t.id);
      this.tabsEl.append(b);
    }
    document.querySelectorAll('#cr-gender button').forEach((b) => { b.onclick = () => this.setGender(b.dataset.g); });
    const sel = document.getElementById('cr-dummy-name');
    for (const n of this.opt.dummyNames) {
      const o = document.createElement('option');
      o.value = o.textContent = n;
      sel.append(o);
    }
    sel.onchange = () => { this.name = sel.value; this.rebuild(); };
    document.getElementById('cr-dummy-rand').onclick = () => {
      sel.value = this.opt.dummyNames[Math.floor(Math.random() * this.opt.dummyNames.length)];
      sel.onchange();
    };
    document.getElementById('cr-undo').onclick = () => this.undo();
    document.getElementById('cr-redo').onclick = () => this.redo();
    document.getElementById('creator-random').onclick = () => this.randomize();
    document.getElementById('creator-save').onclick = () => {
      this.savedKey = JSON.stringify(this.app);
      this.onSave?.({ ...this.app }, { mode: this.mode, name: this.name });
    };
    document.getElementById('creator-cancel').onclick = () => {
      if (JSON.stringify(this.app) !== this.savedKey && !confirm('Dəyişikliklər yadda saxlanmayacaq. Çıxırsan?')) return;
      this.onCancel?.();
    };
    document.getElementById('cr-rot-l').onclick = () => { this.spin = 0; this.holder.rotation.y -= Math.PI / 4; };
    document.getElementById('cr-rot-r').onclick = () => { this.spin = 0; this.holder.rotation.y += Math.PI / 4; };
    document.getElementById('cr-zoom-in').onclick = () => { this.zoom = Math.max(0.55, this.zoom - 0.15); };
    document.getElementById('cr-zoom-out').onclick = () => { this.zoom = Math.min(1.5, this.zoom + 0.15); };
    const poses = document.getElementById('cr-poses');
    for (const p of POSES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.title = p.label;
      b.innerHTML = `<span></span><span class="pl"></span>`;
      b.firstChild.textContent = p.icon;
      b.lastChild.textContent = ' ' + p.label;
      b.onclick = () => { this.emote = p.e; this.emoteTimer = 0; this.updatePoseButtons(); };
      poses.append(b);
    }
    window.addEventListener('keydown', (e) => {
      if (!this.isOpen() || e.target.tagName === 'INPUT') return;
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); }
      else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY') { e.preventDefault(); this.redo(); }
      else if (e.code === 'ArrowLeft') this.holder.rotation.y -= 0.2;
      else if (e.code === 'ArrowRight') this.holder.rotation.y += 0.2;
    });
  }

  isOpen() { return !this.panel.hidden; }

  /** mode: 'player' (öz xarakteri) və ya 'dummy' (dar ağacı üçün məhkum NPC) */
  open(appearance, { first = false, name = '', mode = 'player' } = {}) {
    this.mode = mode;
    const dummy = mode === 'dummy';
    this.app = { ...this.opt.default, ...(appearance || {}) };
    if (dummy) {
      const body = Math.random() < 0.5 ? 'm' : 'f';
      Object.assign(this.app, { body, ...this.opt.genderDefaults[body], ...this.randomValues(Object.values(TAB_KEYS).flat(), body) });
      const sel = document.getElementById('cr-dummy-name');
      sel.value = this.opt.dummyNames[Math.floor(Math.random() * this.opt.dummyNames.length)];
      name = sel.value;
    }
    this.savedKey = JSON.stringify(this.app);
    this.undoStack = [];
    this.redoStack = [];
    this.first = first;
    this.panel.hidden = false;
    document.getElementById('cr-dummy').hidden = !dummy;
    document.getElementById('creator-title').textContent = dummy ? '⚖ Məhkum yarat' : first ? 'Xarakterini yarat' : 'Xarakterini dəyiş';
    document.getElementById('creator-cancel').hidden = first;
    document.getElementById('creator-save').textContent = dummy ? '⚖ Dar ağacına göndər' : first ? '✔ Kampusa gir' : '✔ Yadda saxla';
    this.name = name;
    this.holder.rotation.y = 0.35;
    this.spin = 0;
    this.zoom = 1;
    this.emote = 1;
    this.emoteTimer = 2.2;
    this.setTab(first ? 'presets' : 'body');
    this.rebuild();
  }

  close() { this.panel.hidden = true; }

  setTab(id) {
    this.tab = id;
    for (const b of this.tabsEl.children) b.classList.toggle('on', b.dataset.tab === id);
    this.focusTarget = FOCUS[TABS.find((t) => t.id === id).focus];
    this.zoom = 1;
    this.renderFields();
  }

  // ---- dəyişiklik + tarixçə ----
  commit(changes, { rerender = true, celebrate = false } = {}) {
    const before = JSON.stringify(this.app);
    const next = { ...this.app, ...changes };
    if (JSON.stringify(next) === before) return;
    this.undoStack.push(before);
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack = [];
    this.app = next;
    this.rebuild();
    if (rerender) this.renderFields();
    if (celebrate) { this.emote = 3; this.emoteTimer = 1.6; }
    this.updateHistoryButtons();
  }
  undo() {
    if (!this.undoStack.length) return;
    this.redoStack.push(JSON.stringify(this.app));
    this.app = JSON.parse(this.undoStack.pop());
    this.rebuild(); this.renderFields(); this.updateHistoryButtons();
  }
  redo() {
    if (!this.redoStack.length) return;
    this.undoStack.push(JSON.stringify(this.app));
    this.app = JSON.parse(this.redoStack.pop());
    this.rebuild(); this.renderFields(); this.updateHistoryButtons();
  }
  updateHistoryButtons() {
    document.getElementById('cr-undo').disabled = !this.undoStack.length;
    document.getElementById('cr-redo').disabled = !this.redoStack.length;
  }
  updatePoseButtons() {
    [...document.getElementById('cr-poses').children].forEach((b, i) => b.classList.toggle('on', POSES[i].e === this.emote));
  }

  setGender(g) {
    if (this.app.body === g) return;
    const changes = { body: g, ...this.opt.genderDefaults[g] };
    if (g === 'm') {
      if (this.app.top === 'dress') changes.top = 'tshirt';
      if (this.app.bottom.includes('skirt')) changes.bottom = 'jeans';
      changes.earrings = 'none';
    }
    this.commit(changes, { celebrate: true });
  }

  applyPreset(p) {
    this.commit({ ...this.opt.default, ...p.a, skin: this.app.skin }, { celebrate: true });
  }

  randomValues(keys, body = this.app.body) {
    const o = this.opt;
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    const fem = body === 'f';
    const out = {};
    for (const k of keys) {
      if (o.enums[k]) out[k] = pick(o.enums[k]);
      else if (o.palettes[k]) out[k] = pick(o.palettes[k]);
      else if (o.ranges[k]) { const [lo, hi] = o.ranges[k]; out[k] = +(lo + Math.random() * (hi - lo)).toFixed(2); }
    }
    // inandırıcı nəticə üçün bəzi qaydalar
    if ('beard' in out && (fem || Math.random() < 0.5)) out.beard = 'none';
    if ('top' in out && !fem && out.top === 'dress') out.top = pick(['tshirt', 'hoodie', 'shirt']);
    if ('bottom' in out && !fem && out.bottom.includes('skirt')) out.bottom = 'jeans';
    if ('earrings' in out && (!fem || Math.random() < 0.4)) out.earrings = 'none';
    if ('hair' in out && fem && ['buzz', 'bald', 'mohawk'].includes(out.hair)) out.hair = pick(['long', 'ponytail', 'bob', 'bun', 'braids', 'curly']);
    if ('hair' in out && !fem && ['braids', 'bob', 'long'].includes(out.hair) && Math.random() < 0.7) out.hair = pick(['short', 'side', 'spiky', 'curly', 'buzz']);
    if ('hat' in out && (Math.random() < 0.5 || (!fem && out.hat === 'hijab'))) out.hat = 'none';
    if ('glasses' in out && Math.random() < 0.6) out.glasses = 'none';
    if ('bag' in out && Math.random() < 0.4) out.bag = 'none';
    if ('neck' in out && Math.random() < 0.6) out.neck = 'none';
    if ('cheeks' in out && Math.random() < 0.5) out.cheeks = 'none';
    if ('muscle' in out && fem) out.muscle = +(Math.random() * 0.4).toFixed(2);
    return out;
  }

  randomize(keys) {
    if (!keys) {
      const all = Object.values(TAB_KEYS).flat();
      const body = Math.random() < 0.5 ? 'm' : 'f';
      this.commit({ body, ...this.opt.genderDefaults[body], ...this.randomValues(all, body) }, { celebrate: true });
    } else {
      this.commit(this.randomValues(keys));
    }
  }

  rebuild() {
    if (this.char) this.holder.remove(this.char.root);
    this.char = buildCharacter(this.app);
    this.holder.add(this.char.root);
    if (this.name) {
      const tag = this.mode === 'dummy' ? makeNameTag(this.name, 'məhkum', '#ffcf9a') : makeNameTag(this.name, null);
      tag.position.y = this.char.height + 0.3;
      tag.scale.multiplyScalar(0.8);
      this.char.root.add(tag);
    }
    document.querySelectorAll('#cr-gender button').forEach((b) => b.classList.toggle('on', b.dataset.g === this.app.body));
    this.updateHistoryButtons();
    this.updatePoseButtons();
  }

  // ---------------- Sahələr ----------------
  renderFields() {
    const o = this.opt, a = this.app, f = this.fields;
    const scrollTop = f.scrollTop;
    f.replaceChildren();

    const section = (title, extra) => {
      const s = document.createElement('div');
      s.className = 'field';
      const h = document.createElement('div');
      h.className = 'field-title';
      h.textContent = title;
      if (extra) { const e = document.createElement('span'); e.className = 'field-extra'; e.textContent = extra; h.append(e); }
      s.append(h);
      f.append(s);
      return s;
    };
    const header = (text, randomKeys) => {
      const h = document.createElement('div');
      h.className = 'tab-header';
      const t = document.createElement('span');
      t.textContent = text;
      h.append(t);
      if (randomKeys) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'mini';
        b.textContent = '🎲 Qarışdır';
        b.onclick = () => this.randomize(randomKeys);
        h.append(b);
      }
      f.append(h);
    };
    const choices = (title, key, { thumbs = null, hide = [] } = {}) => {
      const s = section(title);
      const row = document.createElement('div');
      row.className = thumbs ? 'tiles' : 'choices';
      for (const v of o.enums[key]) {
        if (hide.includes(v)) continue;
        const b = document.createElement('button');
        b.type = 'button';
        if (a[key] === v) b.className = 'on';
        if (thumbs) {
          const img = document.createElement('img');
          img.alt = '';
          b.append(img);
          const lab = document.createElement('span');
          lab.textContent = o.labels[key][v];
          b.append(lab);
          this.thumb({ ...a, ...thumbs, [key]: v }, 'head', img);
        } else b.textContent = o.labels[key][v];
        b.onclick = () => this.commit({ [key]: v });
        row.append(b);
      }
      s.append(row);
    };
    const colors = (title, key) => {
      const s = section(title);
      const row = document.createElement('div');
      row.className = 'swatches';
      for (const c of o.palettes[key]) {
        const b = document.createElement('button');
        b.type = 'button';
        b.style.background = c;
        b.title = c;
        if (a[key] === c) b.className = 'on';
        b.onclick = () => this.commit({ [key]: c });
        row.append(b);
      }
      const custom = document.createElement('label');
      custom.className = 'custom-color';
      custom.title = 'Öz rəngini seç';
      const inp = document.createElement('input');
      inp.type = 'color';
      inp.value = a[key];
      const startVal = a[key];
      inp.oninput = () => { this.app = { ...this.app, [key]: inp.value }; this.rebuild(); };
      inp.onchange = () => { this.app = { ...this.app, [key]: startVal }; this.commit({ [key]: inp.value }); };
      custom.append(inp);
      if (!o.palettes[key].includes(a[key])) custom.classList.add('on');
      custom.style.background = o.palettes[key].includes(a[key]) ? '' : a[key];
      row.append(custom);
      s.append(row);
    };
    const slider = (title, key, lowLabel, highLabel, fmt) => {
      const s = section(title, fmt ? fmt(a[key]) : null);
      const extra = s.querySelector('.field-extra');
      const row = document.createElement('div');
      row.className = 'slider';
      const [lo, hi] = o.ranges[key];
      const l = document.createElement('span'); l.textContent = lowLabel;
      const r = document.createElement('span'); r.textContent = highLabel;
      const inp = document.createElement('input');
      inp.type = 'range'; inp.min = lo; inp.max = hi; inp.step = 0.01; inp.value = a[key];
      let startVal = a[key];
      inp.oninput = () => {
        this.app = { ...this.app, [key]: +inp.value };
        if (extra) extra.textContent = fmt(+inp.value);
        this.rebuild();
      };
      inp.onchange = () => {
        const v = +inp.value;
        this.app = { ...this.app, [key]: startVal };
        this.commit({ [key]: v }, { rerender: false });
        startVal = v;
      };
      row.append(l, inp, r);
      s.append(row);
    };

    const fem = a.body === 'f';
    switch (this.tab) {
      case 'presets': {
        header('Hazır obrazlar — seç, sonra istədiyin kimi dəyiş');
        const grid = document.createElement('div');
        grid.className = 'presets';
        for (const p of o.presets) {
          const b = document.createElement('button');
          b.type = 'button';
          const img = document.createElement('img');
          img.alt = '';
          const lab = document.createElement('span');
          lab.textContent = p.name;
          b.append(img, lab);
          b.onclick = () => this.applyPreset(p);
          grid.append(b);
          this.thumb({ ...o.default, ...p.a, skin: a.skin }, 'full', img);
        }
        f.append(grid);
        const tip = document.createElement('p');
        tip.className = 'tip';
        tip.textContent = 'İpucu: aşağıdakı “🎲 Hamısı” düyməsi tamamilə təsadüfi xarakter yaradır. Ctrl+Z ilə geri qayıda bilərsən.';
        f.append(tip);
        break;
      }
      case 'body':
        header('Bədən', TAB_KEYS.body);
        colors('Dəri rəngi', 'skin');
        slider('Boy', 'height', 'Qısa', 'Uzun', (v) => `${Math.round(v * (fem ? 166 : 178))} sm`);
        slider('Çəki', 'build', 'Arıq', 'Dolu', (v) => `${Math.round(((v - 0.8) / 0.45) * 100)}%`);
        slider('Əzələ', 'muscle', 'Zərif', 'İdmançı', (v) => `${Math.round(v * 100)}%`);
        slider('Ayaq uzunluğu', 'legLen', 'Qısa', 'Uzun', (v) => `${Math.round(((v - 0.92) / 0.16) * 100)}%`);
        slider('Baş ölçüsü', 'headSize', 'Kiçik', 'Böyük', (v) => `${Math.round(((v - 0.9) / 0.22) * 100)}%`);
        break;
      case 'face':
        header('Üz', TAB_KEYS.face);
        choices('Üz forması', 'faceShape');
        choices('Göz forması', 'eyeShape');
        colors('Göz rəngi', 'eyes');
        choices('Qaşlar', 'brows');
        choices('Burun', 'nose');
        choices('Ağız', 'mouth');
        colors(fem ? 'Dodaq rəngi' : 'Dodaq tonu', 'lipColor');
        choices('Yanaqlar', 'cheeks');
        choices('Saqqal / bığ', 'beard', { thumbs: { hat: 'none', glasses: 'none' } });
        break;
      case 'hair':
        header('Saç', TAB_KEYS.hair);
        choices('Saç düzümü', 'hair', { thumbs: { hat: 'none' } });
        colors('Saç rəngi', 'hairColor');
        if (a.hat !== 'none' && a.hat !== 'headband') {
          const tip = document.createElement('p');
          tip.className = 'tip';
          tip.textContent = 'Papaq taxılıb — saçın bir hissəsi gizlənir. “Aksesuar” bölməsindən çıxara bilərsən.';
          f.append(tip);
        }
        break;
      case 'clothes':
        header('Geyim', TAB_KEYS.clothes);
        choices('Üst geyim', 'top', { hide: fem ? [] : ['dress'] });
        colors('Əsas rəng', 'topColor');
        if (a.top !== 'jacket') choices('Naxış', 'pattern');
        if (a.pattern !== 'plain' || a.top === 'jacket') colors(a.top === 'jacket' ? 'İçlik rəngi' : 'Naxış rəngi', 'topColor2');
        if (a.top !== 'dress') {
          choices('Alt geyim', 'bottom', { hide: fem ? [] : ['skirt', 'longskirt'] });
          colors('Alt geyim rəngi', 'bottomColor');
        }
        choices('Ayaqqabı', 'shoeType');
        colors('Ayaqqabı rəngi', 'shoes');
        break;
      case 'acc':
        header('Aksesuarlar', TAB_KEYS.acc);
        choices('Baş', 'hat', { thumbs: {} });
        choices('Eynək', 'glasses', { thumbs: { hat: 'none' } });
        choices('Çanta', 'bag');
        choices('Sırğa', 'earrings');
        choices('Boyun', 'neck');
        colors('Aksesuar rəngi', 'accColor');
        break;
    }
    f.scrollTop = scrollTop;
  }

  // ---------------- Render ----------------
  render(renderer, dt) {
    const w = renderer.domElement.clientWidth, h = renderer.domElement.clientHeight;
    this.processThumbs();

    if (this.emoteTimer > 0) {
      this.emoteTimer -= dt;
      if (this.emoteTimer <= 0) { this.emote = 0; this.updatePoseButtons(); }
    }
    // kamera fokusunu yumşaq dəyiş
    const ft = this.focusTarget, k = Math.min(1, dt * 6);
    const s = this.app ? this.app.height : 1;
    // Panel solda (kompüter, telefon yan) və ya aşağıda (telefon dik) ola bilər —
    // xarakter qalan boş sahənin ortasında görünsün
    const rect = this.panel.querySelector('.panel').getBoundingClientRect();
    const bottomSheet = rect.width > w * 0.8;
    const freeFrac = bottomSheet ? Math.max(0.3, 1 - rect.height / h) : 1;
    this.focus.y += (ft.y * s - this.focus.y) * k;
    this.focus.dist += ((ft.dist * this.zoom) / Math.max(0.42, freeFrac * 0.9) - this.focus.dist) * k;
    this.camera.aspect = w / h;
    this.camera.position.set(0, this.focus.y + 0.12, this.focus.dist);
    this.camera.lookAt(0, this.focus.y, 0);
    this.camera.updateProjectionMatrix();
    const e = this.camera.projectionMatrix.elements;
    e[8] = bottomSheet ? 0 : -Math.min(rect.right, w * 0.7) / w;
    e[9] = bottomSheet ? -rect.height / h : 0;
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();

    this.holder.rotation.y += this.spin * dt;
    this.spin *= Math.pow(0.05, dt);
    if (this.char) animateRig(this.char.rig, dt, 0, { emote: this.emote });
    renderer.render(this.scene, this.camera);
  }
}
