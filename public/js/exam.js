// C# imtahanı — kopya missiyası.
// Oyunçu partada oturur, 5 sual cavablandırır. F-i basılı saxlayanda şpargalkaya baxır (düzgün cavab görünür),
// amma müəllim baxanda tutula bilər. Müəllimin davranışı: lövhəyə yazır → çevrilir → sinfə baxır → aralıqda gəzir.

const QUESTIONS = [
  ['C#-da tam ədəd tipi hansıdır?', ['int', 'string', 'bool'], 0],
  ['Konsola sətir yazmaq üçün:', ['print()', 'Console.WriteLine()', 'echo'], 1],
  ['Sinifdən obyekt yaratmaq üçün açar söz:', ['create', 'make', 'new'], 2],
  ['List<int> siyahısındakı elementlərin sayı:', ['.Count', '.Length', '.Size'], 0],
  ['Massivin uzunluğu:', ['.Size', '.Length', '.Total'], 1],
  ['Varislik (inheritance) hansı simvolla yazılır?', ['->', 'extends', ':'], 2],
  ['Dəyəri heç vaxt dəyişməyən sabit:', ['const', 'var', 'dynamic'], 0],
  ['Sətir interpolyasiyası:', ['"Salam {ad}"', '$"Salam {ad}"', '@"Salam {ad}"'], 1],
  ['İstisnanı (exception) tutmaq üçün:', ['if / else', 'switch', 'try / catch'], 2],
  ['Heç nə qaytarmayan metodun tipi:', ['void', 'null', 'empty'], 0],
  ['İnterfeys elan etmək üçün açar söz:', ['struct', 'interface', 'abstract'], 1],
  ['LINQ-da filtrləmə metodu:', ['Select', 'OrderBy', 'Where'], 2],
  ['async metodda nəticəni gözləmək üçün:', ['await', 'wait', 'yield'], 0],
  ['null ola bilən int:', ['int!', 'int?', 'int*'], 1],
  ['Bütün tiplərin baza sinfi:', ['base', 'root', 'object'], 2],
  ['"==" operatoru nə edir?', ['müqayisə', 'mənimsətmə', 'artırma'], 0],
  ['for (int i = 0; i < 3; i++) neçə dəfə işləyir?', ['2', '3', '4'], 1],
  ['Sinfin üzvünü yalnız daxildən əlçatan edən:', ['public', 'internal', 'private'], 2],
];
const EXAM_TIME = 110; // saniyə
const CHEAT_TIME = 2.2; // şpargalkaya baxma müddəti (bir sual üçün)

export function initExam(d) {
  const { room, $ } = d;
  const ex = { on: false, done: false };
  const T = room.tch; // müəllimin vəziyyəti
  const ai = { state: 'board', t: 3, target: null, warned: false, patrol: [] };
  const boardSpot = { x: room.cfg.x + 1.2, z: room.frontZ + 1.3 };

  // ---- panel ----
  const panel = $('exam');
  const opts = [...panel.querySelectorAll('.ex-opt')];
  opts.forEach((b, i) => { b.onclick = () => answer(i); });
  $('ex-quit').onclick = () => finish('quit');

  function pick5() {
    const a = [...QUESTIONS].sort(() => Math.random() - 0.5).slice(0, 5);
    return a.map(([q, o, c]) => {
      // variantları qarışdır
      const idx = [0, 1, 2].sort(() => Math.random() - 0.5);
      return { q, o: idx.map((i) => o[i]), c: idx.indexOf(c) };
    });
  }
  function render() {
    const q = ex.qs[ex.i];
    $('ex-num').textContent = `Sual ${ex.i + 1}/5`;
    $('ex-q').textContent = q.q;
    opts.forEach((b, i) => {
      b.querySelector('span').textContent = q.o[i];
      b.classList.toggle('hint', ex.revealed && i === q.c);
    });
    $('ex-note').hidden = !ex.revealed;
  }
  function start() {
    if (ex.on) return;
    // boş stul: arxa sıralar daha təhlükəsizdir, amma qarşıdakı sıra müəllimə yaxındır — ortada otur
    const seat = room.desks.find((s) => Math.abs(s.z - room.rowZ[3] - 0.6) < 0.01 && Math.abs(s.x - room.cols[1] - 0.62) < 0.01) || room.desks[0];
    d.sit(seat);
    Object.assign(ex, { on: true, done: false, qs: pick5(), i: 0, correct: 0, cheat: 0, sus: 0, revealed: false, cheating: false, cheated: false, left: EXAM_TIME, seat });
    Object.assign(ai, { state: 'board', t: 2.5, warned: false });
    panel.hidden = false;
    document.body.classList.add('in-exam');
    render();
    d.send({ t: 'exam', act: 'start' });
    room.say('İmtahan başladı. Telefonlar kənara!', 3);
    d.toast('📝 F-i basılı saxla — şpargalkaya bax. Müəllim baxanda dayan!');
  }
  function answer(i) {
    if (!ex.on) return;
    if (i === ex.qs[ex.i].c) ex.correct++;
    ex.i++;
    ex.cheat = 0; ex.revealed = false;
    d.sfx.kick?.(0.4);
    if (ex.i >= 5) return finish('done');
    render();
  }
  function setCheating(on) {
    if (!ex.on) return;
    ex.cheating = on;
    d.player.emote = on ? 13 : 5;
  }
  function finish(why) {
    if (!ex.on) return;
    ex.on = false;
    ex.cheating = false;
    panel.hidden = true;
    document.body.classList.remove('in-exam');
    const caught = why === 'caught';
    if (why === 'quit' || why === 'stood') {
      d.toast('İmtahanı tərk etdin.');
      d.send({ t: 'exam', act: 'done', correct: 0, caught: false, cheated: ex.cheated });
    } else {
      d.send({ t: 'exam', act: 'done', correct: ex.correct, caught, cheated: ex.cheated });
      if (caught) {
        room.say('Kopya?! İşini götür, çıx! 2 bal!', 3.5);
        d.bigBanner('🚨 TUTULDUN! — 2 bal');
      } else {
        const grade = [2, 2, 3, 3, 4, 5][ex.correct];
        d.bigBanner(`📝 ${ex.correct}/5 — qiymət: ${grade}${ex.cheated ? ' 😏' : ' 👏'}`);
        room.say(ex.correct >= 4 ? 'Əla! Afərin.' : 'Növbəti dəfə daha yaxşı hazırlaş.', 3);
      }
    }
    if (d.player.sitting) d.stand();
    Object.assign(ai, { state: 'board', t: 3 });
  }

  // ---- müəllimin baxışı ----
  function sees() {
    const dx = d.player.pos.x - T.pos.x, dz = d.player.pos.z - T.pos.z, dist = Math.hypot(dx, dz);
    if (dist > 15) return 0;
    const fx = Math.sin(T.ry), fz = Math.cos(T.ry);
    const cos = (dx * fx + dz * fz) / (dist || 1);
    if (cos < Math.cos(0.95)) return 0; // ~55° görmə bucağı
    return dist < 3 ? 2.2 : 1;
  }
  function nextState() {
    const r = Math.random();
    if (ai.state === 'board') {
      // lövhədən çevrilməzdən əvvəl qısa "işarə": yazmağı dayandırır
      Object.assign(ai, { state: 'turn', t: 0.6 });
    } else if (ai.state === 'turn') {
      Object.assign(ai, { state: 'watch', t: 1.8 + Math.random() * 2.2, base: 0 });
      if (Math.random() < 0.35) room.say(['Hmm…', 'Hamı öz vərəqinə baxsın!', 'Səs eşidirəm…'][Math.floor(Math.random() * 3)], 1.6);
    } else if (ai.state === 'watch') {
      if (r < 0.45) {
        // aralıqla arxaya qədər gəzib qayıdır
        const ax = room.aisleX[Math.random() < 0.5 ? 0 : 1];
        const far = room.rowZ[2 + Math.floor(Math.random() * 5)] + 0.9;
        ai.patrol = [{ x: ax, z: room.frontZ + 3.2 }, { x: ax, z: far }, { x: ax, z: room.frontZ + 3.2 }, boardSpot];
        Object.assign(ai, { state: 'patrol', t: 30 });
      } else Object.assign(ai, { state: 'board', t: 2.5 + Math.random() * 3.5 });
    } else Object.assign(ai, { state: 'board', t: 2.5 + Math.random() * 3.5 });
  }
  function updateTeacher(dt) {
    ai.t -= dt;
    if (ai.state === 'patrol') {
      const p = ai.patrol[0];
      if (room.walkTo(p.x, p.z, dt, 1.25)) ai.patrol.shift();
      if (!ai.patrol.length) nextState();
    } else {
      if (ai.state === 'board' || ai.state === 'turn') room.walkTo(boardSpot.x, boardSpot.z, dt, 1.25);
      else T.speed = 0;
      if (T.speed === 0) {
        if (ai.state === 'board') T.ry = Math.PI;                       // lövhəyə üzü (sinfə arxası)
        else if (ai.state === 'turn') T.ry = Math.PI * 0.5;             // yarıya çevrilib
        else if (ai.state === 'watch') T.ry = Math.sin(performance.now() / 900) * 0.45; // sinfi gözdən keçirir
      }
      if (ai.t <= 0) nextState();
    }
    // lövhəyə yazarkən əli qalxır (əl yelləmə pozası yox, sakit dayanır)
    T.emote = 0;
  }

  return {
    get on() { return ex.on; },
    start,
    finish,
    /** klaviatura: true qaytarsa düymə imtahan tərəfindən istifadə olunub */
    key(code, down) {
      if (!ex.on) return false;
      if (code === 'KeyF') { setCheating(down); return true; }
      const n = /^Digit([1-3])$/.exec(code);
      if (n) { if (down) answer(Number(n[1]) - 1); return true; }
      if (code === 'Escape' && down) { finish('quit'); return true; }
      return false;
    },
    update(dt) {
      room.update(dt);
      if (!ex.on) {
        // imtahan yoxdursa müəllim lövhənin yanında dayanıb sinfə baxır
        room.walkTo(boardSpot.x, boardSpot.z, dt, 1.2);
        if (T.speed === 0) T.ry = 0;
        return;
      }
      updateTeacher(dt);
      if (!d.player.sitting) return finish('stood');
      ex.left -= dt;
      if (ex.left <= 0) return finish('done');
      const seen = sees();
      if (ex.cheating) {
        ex.cheated = true;
        if (!ex.revealed) {
          ex.cheat += dt / CHEAT_TIME;
          if (ex.cheat >= 1) { ex.revealed = true; render(); }
        }
        if (seen) ex.sus += 50 * seen * dt;
      } else ex.sus = Math.max(0, ex.sus - 9 * dt);
      if (ex.sus >= 100) { ex.sus = 100; return finish('caught'); }
      // HUD
      $('ex-time').textContent = `⏱ ${Math.ceil(ex.left)}`;
      $('ex-cheat').style.width = `${(ex.revealed ? 1 : ex.cheat) * 100}%`;
      $('ex-sus').style.width = `${ex.sus}%`;
      $('ex-eye').className = 'ex-eye ' + (seen ? 'look' : ai.state === 'turn' ? 'warn' : '');
      $('ex-eye').textContent = seen ? '👁 Müəllim BAXIR!' : ai.state === 'turn' ? '⚠ Çevrilir…' : ai.state === 'patrol' ? '🚶 Gəzir' : '✍ Lövhəyə yazır';
    },
  };
}
