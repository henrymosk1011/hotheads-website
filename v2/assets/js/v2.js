import { createFilm } from '/v2/assets/js/film.js';

const root = document.documentElement;
root.classList.add('js');
const params = new URLSearchParams(location.search);
const capture = params.has('capture');
if (capture) root.classList.add('is-capture');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const touchDevice = matchMedia('(pointer: coarse)').matches;

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const ease = (t) => t * t * (3 - 2 * t);

/* ------------------------------------------------------------------ */
/* Smooth wheel scrolling on desktop only. Touch keeps native scrolling. */
/* ------------------------------------------------------------------ */
let lenis = null;
if (!touchDevice && !reducedMotion && !capture) {
  try {
    const { default: Lenis } = await import('/assets/vendor/lenis.min.mjs');
    lenis = new Lenis({ lerp: 0.1, smoothWheel: true, allowNestedScroll: true });
  } catch { /* native scrolling is fine */ }
}

/* ------------------------------------------------------------------ */
/* In-page links and the mobile menu                                    */
/* ------------------------------------------------------------------ */
function focusTarget(el) {
  if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
  el.focus({ preventScroll: true });
}
function scrollToTarget(hash) {
  const el = document.getElementById(decodeURIComponent(hash.slice(1)));
  if (!el) return;
  if (lenis) lenis.scrollTo(el, { duration: 1.6 });
  else el.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth' });
  focusTarget(el);
}
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href^="#"]');
  if (!a) return;
  const hash = a.getAttribute('href');
  if (hash.length < 2) return;
  e.preventDefault();
  closeMenu(false);
  scrollToTarget(hash);
  history.replaceState(null, '', hash);
});

const toggle = document.querySelector('.nav__toggle');
const menu = document.getElementById('mobile-menu');
const inertTargets = [document.querySelector('main'), document.querySelector('footer'), document.querySelector('.skip')].filter(Boolean);
function setMenu(open, restoreFocus = true) {
  menu.hidden = !open;
  toggle.setAttribute('aria-expanded', String(open));
  root.classList.toggle('menu-open', open);
  inertTargets.forEach((el) => { el.inert = open; });
  if (open) { lenis?.stop(); menu.querySelector('a')?.focus(); }
  else { lenis?.start(); if (restoreFocus) toggle.focus(); }
}
function closeMenu(restoreFocus = true) { if (!menu.hidden) setMenu(false, restoreFocus); }
toggle.addEventListener('click', () => setMenu(menu.hidden));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
matchMedia('(min-width: 861px)').addEventListener('change', (m) => { if (m.matches) closeMenu(false); });

/* ------------------------------------------------------------------ */
/* Reveals                                                              */
/* ------------------------------------------------------------------ */
const beats = [...document.querySelectorAll('[data-beat] .beat__copy')];
const ins = [...document.querySelectorAll('[data-in]')];
if (capture || reducedMotion || !('IntersectionObserver' in window)) {
  [...beats, ...ins].forEach((el) => el.classList.add('is-in'));
} else {
  // film copy fades in and out as it passes; page blocks fade in once
  const beatIO = new IntersectionObserver((entries) => {
    for (const e of entries) e.target.classList.toggle('is-in', e.isIntersecting);
  }, { rootMargin: '-8% 0px -12% 0px' });
  beats.forEach((el) => beatIO.observe(el));
  const inIO = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('is-in'); inIO.unobserve(e.target); }
  }, { rootMargin: '0px 0px -8% 0px' });
  ins.forEach((el) => inIO.observe(el));
}

/* Nav: current section */
const navLinks = [...document.querySelectorAll('.nav__links a')];
const sections = navLinks.map((a) => document.querySelector(a.getAttribute('href')));
if ('IntersectionObserver' in window) {
  const navIO = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const a = navLinks[sections.indexOf(e.target)];
      if (e.isIntersecting) a.setAttribute('aria-current', 'location'); else a.removeAttribute('aria-current');
    }
  }, { rootMargin: '-45% 0px -50% 0px' });
  sections.forEach((s) => s && navIO.observe(s));
}

/* ------------------------------------------------------------------ */
/* Services deck: native horizontal scroll with a cover-flow tilt       */
/* ------------------------------------------------------------------ */
const track = document.getElementById('deck');
const cards = [...track.children];
const count = document.querySelector('.deck__count b');
const [prevBtn, nextBtn] = document.querySelectorAll('.deck__btn');
let current = 0, tiltQueued = false;
function tilt() {
  tiltQueued = false;
  const r = track.getBoundingClientRect(), mid = r.left + r.width / 2;
  let best = 0, bd = Infinity;
  cards.forEach((c, i) => {
    const b = c.getBoundingClientRect();
    const o = (b.left + b.width / 2 - mid) / b.width;
    if (Math.abs(o) < bd) { bd = Math.abs(o); best = i; }
    const k = clamp(o, -1.4, 1.4);
    c.style.setProperty('--ry', `${(-k * 16).toFixed(2)}deg`);
    c.style.setProperty('--sc', (1 - Math.min(1, Math.abs(k)) * 0.08).toFixed(3));
  });
  current = best;
  count.textContent = String(best + 1).padStart(2, '0');
  prevBtn.setAttribute('aria-disabled', String(best === 0));
  nextBtn.setAttribute('aria-disabled', String(best === cards.length - 1));
}
function queueTilt() { if (!tiltQueued) { tiltQueued = true; requestAnimationFrame(tilt); } }
track.addEventListener('scroll', queueTilt, { passive: true });
function goTo(i) {
  const c = cards[clamp(i, 0, cards.length - 1)];
  track.scrollTo({ left: c.offsetLeft - (track.clientWidth - c.offsetWidth) / 2, behavior: reducedMotion ? 'auto' : 'smooth' });
}
for (const b of [prevBtn, nextBtn]) b.addEventListener('click', () => goTo(current + Number(b.dataset.dir)));
track.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight') { e.preventDefault(); goTo(current + 1); }
  if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(current - 1); }
});

document.querySelectorAll('[data-year]').forEach((n) => { n.textContent = String(new Date().getFullYear()); });

/* ------------------------------------------------------------------ */
/* The film                                                             */
/* ------------------------------------------------------------------ */
const filmEl = document.querySelector('.film');
const canvas = filmEl.querySelector('canvas');
const shade = filmEl.querySelector('.film__shade');
const reel = document.querySelector('.reel');
const copyOf = (k) => document.querySelector(`[data-beat="${k}"] .beat__copy`);
let film = null;
try { film = createFilm(canvas); } catch { root.classList.add('no-film'); }

function docTop(el) { let y = 0; for (let e = el; e; e = e.offsetParent) y += e.offsetTop; return y; }
let M = null;
function measure() {
  const vw = root.clientWidth, vh = window.innerHeight, portrait = vw / vh < 1;
  const y0 = docTop(reel);
  const room = docTop(copyOf('room')) - vh * 0.95;   // the room copy is about to enter
  const home = docTop(copyOf('home'));
  M = {
    vw, vh, portrait, y0,
    yA: room - vh * 0.08,                                   // clip ends
    yB: room + vh * 0.08,                                   // 3D room has fully taken over
    yH0: home - vh,                                         // walk ends, film starts to shrink
    yH1: home - vh * (portrait ? 0.62 : 0.4),               // shrunk into a card
    end: y0 + reel.offsetHeight,
  };
  tilt();
}

const shown = { c: 0, m: 0, r: 0, s: 0 };
function targets(y) {
  return {
    c: clamp((y - M.y0) / (M.yA - M.y0)),
    m: ease(clamp((y - M.yA) / (M.yB - M.yA))),
    r: clamp((y - M.yB) / (M.yH0 - M.yB)),
    s: clamp((y - M.yH0) / (M.yH1 - M.yH0)),
  };
}

let zoomed = false;
window.visualViewport?.addEventListener('resize', () => { zoomed = window.visualViewport.scale > 1.01; });

let lastW = 0, lastH = 0;
function onResize() {
  const w = root.clientWidth, h = window.innerHeight;
  // phones change height as the address bar slides; that needs a re-measure, nothing more
  if (w === lastW && Math.abs(h - lastH) < 1) return;
  lastW = w; lastH = h;
  measure();
}
window.addEventListener('resize', onResize);
window.addEventListener('load', measure);
document.fonts?.ready.then(measure);
onResize();

let last = performance.now(), hidden = false;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  lenis?.raf(now);
  const y = window.scrollY;
  const t = targets(y);
  // follow the scroll with a little easing so frame steps blend smoothly
  const k = capture || reducedMotion ? 1 : 1 - Math.exp(-dt * (touchDevice ? 14 : 20));
  for (const key in shown) shown[key] += (t[key] - shown[key]) * k;

  // shrink the film into a card for the "welcome" beat
  const e = ease(shown.s);
  if (M.portrait) {
    const sc = 1 - 0.44 * e;
    filmEl.style.transform = e > 0.001 ? `translate3d(0, ${(-0.2 * M.vh * e).toFixed(1)}px, 0) scale(${sc.toFixed(4)})` : '';
    filmEl.style.borderRadius = e > 0.001 ? `${(22 * e / sc).toFixed(1)}px` : '';
  } else {
    const sc = 1 - 0.5 * e;
    filmEl.style.transform = e > 0.001 ? `translate3d(${(0.22 * M.vw * e).toFixed(1)}px, 0, 0) scale(${sc.toFixed(4)})` : '';
    filmEl.style.borderRadius = e > 0.001 ? `${(26 * e / sc).toFixed(1)}px` : '';
  }
  shade.style.opacity = (1 - 0.85 * e).toFixed(3);

  // once the page has slid over the film, stop drawing it
  const gone = y > M.end + 10;
  if (gone !== hidden) { hidden = gone; filmEl.style.visibility = gone ? 'hidden' : ''; }
  root.classList.toggle('nav-solid', y > M.vh * 0.6);

  if (film && !hidden && !zoomed) {
    film.resize(Math.min(window.devicePixelRatio || 1, 2));
    film.set({ clip: shown.c, room: shown.r, mix: shown.m });
    film.render();
    if (film.ready && !root.classList.contains('film-ready')) root.classList.add('film-ready');
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

/* test hooks for screenshots */
if (capture) {
  window.__V2 = { measure: () => M, loaded: () => (film ? film.loaded() : 0) };
}
