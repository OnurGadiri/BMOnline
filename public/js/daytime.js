// Günün vaxtı: səhər, gündüz, gün batımı, gecə — işıqlar, səma, duman, fənərlər bir-birinə yumşaq keçir.
// Rejim: 'auto' (real yerli saat) və ya əl ilə seçilmiş vaxt. Hesablama ucuzdur — hər iki keyfiyyətdə işləyir.
import * as THREE from 'three';

// hər vəziyyət: günəşin istiqaməti (azimut/yüksəklik), rənglər və güclər
const P = {
  night: {
    az: 2.4, el: 0.55, sun: '#9fb4ff', sunI: 0.7, hemiSky: '#43578c', hemiGround: '#1f2e25', hemiI: 0.9,
    top: '#0a1230', horizon: '#26365f', bottom: '#18223c', fog: '#1d2a46', glow: 0.05, exposure: 1.05, lamps: 2.4, clouds: 0.05,
  },
  morning: {
    az: 0.55, el: 0.28, sun: '#ffd2a6', sunI: 2.3, hemiSky: '#cfe0ff', hemiGround: '#5f7d45', hemiI: 1.05,
    top: '#3f7fd6', horizon: '#ffd9b8', bottom: '#d9c8b8', fog: '#e6d8ca', glow: 0.9, exposure: 1.12, lamps: 0.25, clouds: 0.3,
  },
  day: {
    az: 0.0, el: 0.92, sun: '#fff0d4', sunI: 3.0, hemiSky: '#d6ebff', hemiGround: '#5f7d45', hemiI: 1.25,
    top: '#0f5cc4', horizon: '#bcdcf5', bottom: '#c4dcee', fog: '#c3def3', glow: 1, exposure: 1.15, lamps: 0, clouds: 0.35,
  },
  sunset: {
    az: -0.6, el: 0.2, sun: '#ff9a5c', sunI: 2.2, hemiSky: '#ffc49c', hemiGround: '#4b5638', hemiI: 0.95,
    top: '#34548f', horizon: '#ff9f6e', bottom: '#d98f6c', fog: '#e2a98c', glow: 1.2, exposure: 1.1, lamps: 1.2, clouds: 0.45,
  },
};
// real saat → iki vəziyyət arasında qarışdırma
const SCHEDULE = [
  [0, 'night'], [5, 'night'], [7, 'morning'], [10, 'day'], [16, 'day'], [18.5, 'sunset'], [20.5, 'night'], [24, 'night'],
];
export const DAYTIME_MODES = ['auto', 'morning', 'day', 'sunset', 'night'];

function blendAt(hour) {
  for (let i = 0; i < SCHEDULE.length - 1; i++) {
    const [h0, a] = SCHEDULE[i], [h1, b] = SCHEDULE[i + 1];
    if (hour >= h0 && hour <= h1) return [P[a], P[b], h1 > h0 ? (hour - h0) / (h1 - h0) : 0];
  }
  return [P.day, P.day, 0];
}
const c1 = new THREE.Color(), c2 = new THREE.Color();
const mixC = (a, b, t, out) => out.copy(c1.set(a)).lerp(c2.set(b), t);
const mixN = (a, b, t) => a + (b - a) * t;

/** mode: 'auto' | 'morning' | 'day' | 'sunset' | 'night'; ctx: {sun, hemi, scene, renderer, sunDir, sky, cloudMat, lampMat} */
export function applyDaytime(mode, ctx, date = new Date()) {
  const [a, b, t] = mode in P ? [P[mode], P[mode], 0] : blendAt(date.getHours() + date.getMinutes() / 60);
  const el = mixN(a.el, b.el, t);
  // azimut bucağı keçiddə ən qısa yolla
  let daz = b.az - a.az;
  if (daz > Math.PI) daz -= Math.PI * 2;
  if (daz < -Math.PI) daz += Math.PI * 2;
  const az = a.az + daz * t;
  ctx.sunDir.set(Math.sin(az) * Math.cos(el) * 0.9 + 0.2, Math.sin(el), Math.cos(az) * Math.cos(el)).normalize();
  mixC(a.sun, b.sun, t, ctx.sun.color);
  ctx.sun.intensity = mixN(a.sunI, b.sunI, t);
  mixC(a.hemiSky, b.hemiSky, t, ctx.hemi.color);
  mixC(a.hemiGround, b.hemiGround, t, ctx.hemi.groundColor);
  ctx.hemi.intensity = mixN(a.hemiI, b.hemiI, t);
  const fog = mixC(a.fog, b.fog, t, new THREE.Color());
  ctx.scene.fog.color.copy(fog);
  if (ctx.scene.background?.isColor) ctx.scene.background.copy(fog);
  ctx.renderer.toneMappingExposure = mixN(a.exposure, b.exposure, t);
  const u = ctx.sky?.material?.uniforms;
  if (u) {
    mixC(a.top, b.top, t, u.top.value);
    mixC(a.horizon, b.horizon, t, u.horizon.value);
    mixC(a.bottom, b.bottom, t, u.bottom.value);
    if (u.glow) u.glow.value = mixN(a.glow, b.glow, t);
  }
  if (ctx.cloudMat) ctx.cloudMat.emissiveIntensity = mixN(a.clouds, b.clouds, t);
  if (ctx.lampMat) ctx.lampMat.emissiveIntensity = mixN(a.lamps, b.lamps, t);
  // gecə: fənərlər yanır (0.6-dan yuxarı)
  return { night: mixN(a.lamps, b.lamps, t) > 1.5, lamps: mixN(a.lamps, b.lamps, t) };
}
