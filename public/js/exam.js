// C# imtahanı — çoxoyunçulu kopya missiyası (klient).
// Server: lobbi (min 3 nəfər), müəllimin hərəkəti, kopya mənbələri, tutulma. Klient: panel, HUD, idarəetmə.
//  F (öz yerində, basılı)  — telefondakı şpargalkaya bax (yavaş, amma dəqiq)
//  F (ayaq üstə, kiminsə yanında, basılı) — onun kağızına bax (sürətli, amma o da səhv edə bilər)
//  F (öz yerinin yanında) — yerinə otur · 1-3 — cavab yaz (yalnız öz yerində)
// Müəllim səni yerindən kənarda və ya kopya çəkərkən görsə şübhə artır; dolsa — imtahandan xaric.

export function initExam(d) {
  const { $ } = d;
  const ex = {
    list: [], sid: null, inst: 0, seat: -1, qs: [], i: 0, st: null, hints: [], peek: false, xs: null, answeredAt: -1,
  };
  const room = () => d.rooms[ex.inst];
  const mySeat = () => room()?.seats[ex.seat];
  const nearSeat = (m = 0.5) => { const s = mySeat(); return s && Math.hypot(d.player.pos.x - s.x, d.player.pos.z - s.z) < m; };
  const inExam = () => ex.st === 'in';
  const myLobby = () => ex.list.find((s) => (s.state === 'lobby' || s.state === 'count') && s.names.includes(d.state.name));

  // ---------- lobbi paneli (Rektorluğun qapısında) ----------
  const lob = $('xlobby');
  $('xl-close').onclick = () => { lob.hidden = true; };
  // gözləmə zolağına klik — lobbi paneli açılır (host oradan başladır)
  $('xwait').onclick = () => { lob.hidden = false; renderLobby(); if (document.pointerLockElement) document.exitPointerLock(); };
  function renderLobby() {
    if (lob.hidden) return;
    const box = $('xl-list');
    box.replaceChildren();
    const mine = myLobby();
    if (!ex.list.length) box.append(el('div', 'xl-empty', 'Hələ açıq otaq yoxdur. Birinci sən aç!'));
    for (const s of ex.list) {
      const card = el('div', 'xl-card');
      const st = { lobby: s.n >= s.min ? `Hazırdır ${s.n}/${s.max}` : `Gözlənilir ${s.n}/${s.min}`, count: `Başlayır: ${Math.ceil(s.start)} san`,
        exam: `İmtahan gedir · ${Math.ceil(s.left)} san`, done: 'Bitdi' }[s.state];
      const h = el('div', 'xl-head');
      const title = el('b', null, `Otaq #${s.id}`);
      title.append(el('span', 'xl-host', `👑 ${s.host}`));
      h.append(title, el('span', 'xl-st ' + s.state, st));
      card.append(h, el('div', 'xl-names', `${s.names.join(', ') || '—'}  (${s.n}/${s.max})`));
      const join = (label) => {
        const b = el('button', 'xl-join', label);
        b.type = 'button';
        b.onclick = () => d.send({ t: 'xjoin', id: s.id });
        card.append(b);
      };
      if ((s.state === 'lobby' || s.state === 'count') && !mine && !inExam() && s.n < s.max) join('Qoşul');
      // gedən imtahana sonradan qoşulmaq (xaric olunduğun otağa yox)
      else if (s.late && !mine && !inExam() && !s.names.includes(d.state.name)) join('Gec qoşul ⏱');
      box.append(card);
    }
    const acts = $('xl-acts');
    acts.replaceChildren();
    if (mine) {
      if (mine.state === 'lobby' && mine.host === d.state.name) {
        const go = el('button', 'xl-go', mine.n >= mine.min ? '▶ İmtahanı başlat' : `▶ Başlat (ən az ${mine.min} nəfər)`);
        go.type = 'button';
        go.disabled = mine.n < mine.min;
        go.onclick = () => d.send({ t: 'xgo' });
        acts.append(go);
      } else if (mine.state === 'lobby') acts.append(el('span', 'xl-note', `👑 ${mine.host} başladacaq`));
      const b = el('button', 'ghost', 'Lobbidən çıx');
      b.type = 'button';
      b.onclick = () => d.send({ t: 'xleave' });
      acts.append(b);
    } else if (!inExam()) {
      const b = el('button', null, '➕ Yeni otaq aç');
      b.type = 'button';
      b.onclick = () => d.send({ t: 'xjoin', new: true });
      acts.append(b);
    }
  }
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // ---------- imtahan paneli ----------
  const panel = $('exam');
  const opts = [...panel.querySelectorAll('.ex-opt')];
  opts.forEach((b, i) => { b.onclick = () => answer(i); });
  function renderQ() {
    const q = ex.qs[ex.i];
    if (!q) {
      $('ex-num').textContent = 'Hamısını yazdın ✔';
      $('ex-q').textContent = 'Digərlərini gözlə…';
      opts.forEach((b) => { b.hidden = true; });
      $('ex-hints').replaceChildren();
      return;
    }
    $('ex-num').textContent = `Sual ${ex.i + 1}/${ex.qs.length}`;
    $('ex-q').textContent = q.q;
    opts.forEach((b, i) => { b.hidden = false; b.querySelector('span').textContent = q.o[i]; });
    const hb = $('ex-hints');
    hb.replaceChildren();
    for (const h of ex.hints[ex.i] || []) {
      hb.append(el('div', 'ex-hint', h.a < 0 ? `👀 ${h.src}: hələ yazmayıb` : `👀 ${h.src}: ${h.a + 1}) ${q.o[h.a]}`));
    }
  }
  function answer(i) {
    if (!inExam() || ex.i >= ex.qs.length || ex.answeredAt === ex.i) return;
    if (!d.player.sitting) { d.toast('Cavab yazmaq üçün öz yerinə otur (F).'); return; }
    ex.answeredAt = ex.i;
    d.send({ t: 'xans', a: i });
    setTimeout(() => { if (ex.answeredAt === ex.i) ex.answeredAt = -1; }, 1500);
    d.sfx.kick?.(0.3);
  }
  function setPeek(on) {
    if (on === ex.peek) return;
    ex.peek = on;
    d.send({ t: 'xpeek', on });
    if (d.player.sitting) d.player.emote = on ? 13 : 5;
  }
  function closeExam() {
    setPeek(false);
    ex.st = null;
    panel.hidden = true;
    document.body.classList.remove('in-exam');
    room()?.clearNpcs();
  }

  return {
    get on() { return inExam(); },
    /** çıxışda (logout): imtahan və lobbi panellərini bağla, siyahını sıfırla */
    reset() { closeExam(); lob.hidden = true; ex.list = []; $('xres').hidden = true; },
    openLobby() { lob.hidden = false; renderLobby(); if (document.pointerLockElement) document.exitPointerLock(); },
    onMsg(m) {
      switch (m.t) {
        case 'xlist': ex.list = m.s; renderLobby(); break;
        case 'xstart': {
          Object.assign(ex, { sid: m.id, inst: m.inst, seat: m.seat, qs: m.qs, i: 0, st: 'in', hints: [], answeredAt: -1 });
          lob.hidden = true;
          const r = room();
          r.spawnNpcs(m.npcs);
          const s = r.seats[m.seat];
          d.player.pos.set(s.x, 0, s.z);
          d.sit(s);
          panel.hidden = false;
          document.body.classList.add('in-exam');
          renderQ();
          d.bigBanner(m.late ? `📝 Gec qoşuldun — ${Math.ceil(m.time)} san qalıb!` : '📝 İmtahan başladı!');
          if (!m.late) r.say('İmtahan başladı. Hər kəs öz vərəqinə baxsın!', 3);
          break;
        }
        case 'xs': {
          ex.xs = m;
          const r = room();
          r?.setTeacher(m.tch[0], m.tch[1], m.tch[2], m.tch[4]);
          r?.setNpcBits(m.npc);
          if (m.i !== ex.i) { ex.i = m.i; renderQ(); }
          break;
        }
        case 'xreveal':
          (ex.hints[m.i] ||= []).push({ src: m.src, a: m.a });
          if (m.i === ex.i) renderQ();
          d.sfx.chime?.(0.4);
          break;
        case 'xsay': room()?.say(m.text, 2.8); break;
        case 'xout':
          closeExam();
          if (d.player.sitting) d.stand();
          if (m.why === 'caught') {
            d.bigBanner('🚨 TUTULDUN! İmtahandan xaric edildin');
            d.toast('Digərləri bitirənə qədər gözlə və ya Rektorluğun qapısında yeni otaq aç.');
          } else d.toast('İmtahanı tərk etdin.');
          break;
        case 'xend': {
          const was = inExam();
          closeExam();
          const me = m.res.find((r) => r.name === d.state.name);
          if (was && me) d.bigBanner(me.out ? '🚨 Xaric edilmişdin' : `📝 ${me.score}/${m.n}${me.xp ? ` · +${me.xp} XP` : ''}`);
          const t = $('xres');
          const rows = $('xres-rows');
          rows.replaceChildren();
          m.res.forEach((r, i) => {
            const tr = el('tr', r.name === d.state.name ? 'me' : null);
            for (const v of [i + 1, r.name, r.out ? '🚨 tutuldu' : `${r.score}/${m.n}`, r.xp ? `+${r.xp}` : '—']) tr.append(el('td', null, v));
            rows.append(tr);
          });
          if (me) { t.hidden = false; setTimeout(() => { t.hidden = true; }, 7000); }
          break;
        }
      }
    },
    /** klaviatura: true qaytarsa düymə imtahan tərəfindən istifadə olunub */
    key(code, down) {
      if (!inExam()) return false;
      if (code === 'KeyF') {
        if (down) {
          if (!d.player.sitting && nearSeat()) { d.sit(mySeat()); return true; }
          setPeek(true);
        } else setPeek(false);
        return true;
      }
      const n = /^Digit([1-3])$/.exec(code);
      if (n) { if (down) answer(Number(n[1]) - 1); return true; }
      return false;
    },
    update(dt) {
      for (const r of d.rooms) r.update(dt);
      // lobbi gözləmə göstəricisi
      const mine = myLobby();
      const w = $('xwait');
      const host = mine && mine.host === d.state.name;
      const txt = !mine ? ''
        : mine.state === 'count' ? `📝 İmtahan ${Math.max(0, Math.ceil(mine.start))} saniyəyə başlayır… (${mine.n} nəfər)`
        : mine.n < mine.min ? `📝 İmtahan lobbisi: ${mine.n}/${mine.min} — daha ${mine.min - mine.n} tələbə lazımdır`
        : host ? `📝 ${mine.n} nəfər hazırdır — başlatmaq üçün bura klik et ▶` : `📝 ${mine.n} nəfər hazırdır — 👑 ${mine.host} başlatmalıdır`;
      if (w.textContent !== txt) { w.textContent = txt; w.hidden = !txt; }
      w.classList.toggle('click', !!mine && mine.state === 'lobby');
      if (!inExam() || !ex.xs) return;
      const m = ex.xs;
      if (!d.player.sitting && ex.peek && d.player.emote === 13) d.player.emote = 0;
      $('ex-time').textContent = `⏱ ${Math.ceil(m.left)}`;
      $('ex-cheat').style.width = `${Math.min(1, m.prog) * 100}%`;
      $('ex-sus').style.width = `${m.sus}%`;
      const tst = m.tch[3];
      const eye = $('ex-eye');
      eye.className = 'ex-eye ' + (m.seen ? 'look' : tst === 'turn' ? 'warn' : tst === 'board' ? '' : 'mid');
      eye.textContent = m.seen ? '👁 Müəllim SƏNİ GÖRÜR!' : tst === 'turn' ? '⚠ Müəllim çevrilir…'
        : tst === 'board' ? '✍ Müəllim lövhəyə yazır — fürsət!' : tst === 'watch' || tst === 'look' ? '👀 Müəllim sinfə baxır' : '🚶 Müəllim sinifdə gəzir';
      const tgt = m.tgt;
      $('ex-src').textContent = !ex.peek ? (d.player.sitting ? 'F basılı: telefona bax · ayağa qalx və yoldaşının kağızına bax'
        : nearSeat() ? 'F — yerinə otur' : 'Kiminsə yanında F-i basılı saxla — kağızına bax')
        : tgt === 'phone' ? '📱 Telefona baxırsan…' : tgt ? '👀 Kağıza baxırsan…' : 'Yaxında kağız yoxdur';
      $('ex-ps').textContent = m.ps.map(([n, i, st]) => `${st === 'out' ? '🚨' : i >= ex.qs.length ? '✔' : '✍'} ${n} ${st === 'out' ? '' : `${i}/${ex.qs.length}`}`).join('   ');
      opts.forEach((b) => b.classList.toggle('dis', !d.player.sitting));
    },
  };
}
