// Mobil (toxunma) idarəetmə: virtual joystik, kamera sürüşdürmə, ekran düymələri
export const touchInput = { mx: 0, my: 0, active: false, sprint: false };

// ?touch=1 — kompüterdə mobil idarəetməni sınamaq üçün; ?touch=0 — söndürmək üçün
export const isTouchDevice = () => {
  const q = new URLSearchParams(location.search).get('touch');
  if (q === '1') return true;
  if (q === '0') return false;
  // yalnız əsas idarəsi barmaq olan cihazlar (telefon, planşet); toxunma ekranlı noutbuklar siçan rejimində qalır
  return !!window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)').matches;
};

/**
 * opts: { isGame(): bool, rotateCamera(dx, dy), attack(), key(code, down) }
 */
export function initTouch(opts) {
  document.body.classList.add('touch');
  const ui = document.getElementById('touch');
  ui.hidden = false;
  const stick = document.getElementById('stick');
  const knob = document.getElementById('stick-knob');
  const R = 50; // joystikin radiusu (px) — kiçik radius: az hərəkətlə tam sürət
  let stickId = null, sx = 0, sy = 0;
  let camId = null, cx = 0, cy = 0;

  const isUi = (el) => !!el?.closest?.('.tbtn, button, input, select, label, .gpanel, .settings, #chat-log, .board, #creator, .card');

  const placeStick = (x, y) => {
    stick.style.left = `${x - 70}px`;
    stick.style.top = `${y - 70}px`;
    stick.classList.add('on');
  };
  const resetStick = () => {
    stickId = null;
    touchInput.mx = touchInput.my = 0;
    touchInput.active = false;
    touchInput.sprint = false;
    knob.style.transform = 'translate(-50%, -50%)';
    stick.classList.remove('on');
    stick.style.left = stick.style.top = '';
  };

  window.addEventListener('touchstart', (e) => {
    if (!opts.isGame()) return;
    for (const t of e.changedTouches) {
      if (isUi(t.target)) continue;
      if (t.clientX < window.innerWidth * 0.42 && stickId === null) {
        stickId = t.identifier; sx = t.clientX; sy = t.clientY;
        placeStick(sx, sy);
        touchInput.active = true;
      } else if (camId === null) {
        camId = t.identifier; cx = t.clientX; cy = t.clientY;
      }
    }
    if (stickId !== null || camId !== null) e.preventDefault();
  }, { passive: false });

  window.addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === stickId) {
        let dx = t.clientX - sx, dy = t.clientY - sy;
        const d = Math.hypot(dx, dy);
        // barmaq çox uzaqlaşanda joystikin özü də arxasınca gəlir (barmaq qaldırmadan istiqamət dəyişmək asandır)
        if (d > R * 1.6) {
          const k = (d - R * 1.6) / d;
          sx += dx * k; sy += dy * k;
          placeStick(sx, sy);
          dx = t.clientX - sx; dy = t.clientY - sy;
        }
        if (d > R) { const dd = Math.hypot(dx, dy); dx = (dx / dd) * R; dy = (dy / dd) * R; }
        knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
        touchInput.mx = dx / R;
        touchInput.my = dy / R;
        touchInput.sprint = d > R * 0.92; // kənara qədər itələyəndə qaçış
        stick.classList.toggle('sprint', touchInput.sprint);
      } else if (t.identifier === camId) {
        const k = 1.5 * Math.max(1, 640 / Math.min(window.innerWidth, window.innerHeight)) ** 0.5;
        opts.rotateCamera((t.clientX - cx) * k, (t.clientY - cy) * k);
        cx = t.clientX; cy = t.clientY;
      }
    }
    if (stickId !== null || camId !== null) e.preventDefault();
  }, { passive: false });

  const end = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === stickId) resetStick();
      if (t.identifier === camId) camId = null;
    }
  };
  window.addEventListener('touchend', end);
  window.addEventListener('touchcancel', end);

  // ekran düymələri: data-key → klaviatura düyməsi kimi, data-act → xüsusi əməliyyat
  for (const btn of ui.querySelectorAll('.tbtn')) {
    const code = btn.dataset.key, act = btn.dataset.act;
    const down = (e) => {
      e.preventDefault();
      e.stopPropagation();
      btn.classList.add('pressed');
      if (code) opts.key(code, true);
      else if (act === 'attack') opts.attack();
      else if (act === 'menu') document.body.classList.toggle('menu-open');
      else if (act === 'emotes') document.body.classList.toggle('show-emotes');
      else if (act === 'logout') opts.logout?.();
      else if (act === 'fullscreen') {
        const el = document.documentElement;
        if (!document.fullscreenElement) {
          el.requestFullscreen?.().catch(() => {}); // istiqamət kilidlənmir — şaquli rejim də dəstəklənir
        } else document.exitFullscreen?.();
      }
    };
    const up = (e) => {
      e.preventDefault();
      btn.classList.remove('pressed');
      if (code) opts.key(code, false);
      // menyudan bir şey seçiləndə menyu bağlansın
      if (btn.closest('.ttop') && act !== 'menu') document.body.classList.remove('menu-open');
    };
    btn.addEventListener('touchstart', down, { passive: false });
    btn.addEventListener('touchend', up, { passive: false });
    btn.addEventListener('touchcancel', up, { passive: false });
    // siçanla da sınamaq olsun (kompüterdə mobil görünüş)
    btn.addEventListener('mousedown', down);
    btn.addEventListener('mouseup', up);
  }
  // oyundan çıxanda (redaktor və s.) joystiki sıfırla
  return { reset: () => { resetStick(); camId = null; } };
}
