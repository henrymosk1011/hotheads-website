/**
 * Page conductor: smooth scroll → film position T → 3D world + DOM reveals.
 */
import Lenis from 'lenis';

const root = document.documentElement;
root.classList.add('js');

const params = new URLSearchParams(location.search);
const capture = params.has('capture');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches && !capture;
if (capture) root.classList.add('is-capture');

const yearEl = document.querySelector('[data-year]');
if (yearEl) yearEl.textContent = String(new Date().getFullYear());

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ */
/* Motion control (WCAG 2.2.2 Pause, Stop, Hide)                       */
/* Ambient motion (wind in the hair, particles, CSS loops) can be       */
/* paused. Scroll-driven changes still follow the user.                */
/* ------------------------------------------------------------------ */
const motionBtn = document.querySelector('.motion-toggle');
const motionLabel = motionBtn?.querySelector('.motion-toggle__label');
let stored = null;
try { stored = localStorage.getItem('hh-motion'); } catch { /* storage unavailable */ }
let paused = !capture && (stored ? stored === 'paused' : reducedMotion);

function applyMotion() {
  root.classList.toggle('is-paused', paused);
  if (!motionBtn) return;
  motionBtn.setAttribute('aria-pressed', String(paused));
  motionLabel.textContent = paused ? 'Play motion' : 'Pause motion';
}
motionBtn?.addEventListener('click', () => {
  paused = !paused;
  try { localStorage.setItem('hh-motion', paused ? 'paused' : 'playing'); } catch { /* ignore */ }
  applyMotion();
});
applyMotion();

/* ------------------------------------------------------------------ */
/* Smooth scroll                                                       */
/* ------------------------------------------------------------------ */
const lenis = !reducedMotion && !capture
  ? new Lenis({ lerp: 0.1, wheelMultiplier: 1, smoothWheel: true })
  : null;

const scrollY = () => (lenis ? lenis.scroll : window.scrollY);

function focusTarget(el) {
  if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
  el.focus({ preventScroll: true });
}

function scrollToTarget(hash) {
  const el = document.getElementById(decodeURIComponent(hash.slice(1)));
  if (!el) return;
  if (lenis) lenis.scrollTo(el, { duration: 1.8 });
  else el.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth' });
  // move keyboard / screen-reader focus to where the user asked to go
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

/* ------------------------------------------------------------------ */
/* Mobile menu                                                         */
/* ------------------------------------------------------------------ */
const toggle = document.querySelector('.nav__toggle');
const menu = document.getElementById('mobile-menu');
const inertTargets = [document.querySelector('main'), document.querySelector('footer'), document.querySelector('.skip')].filter(Boolean);

function setMenu(open, restoreFocus = true) {
  if (!menu || !toggle) return;
  menu.hidden = !open;
  toggle.setAttribute('aria-expanded', String(open));
  inertTargets.forEach((el) => { el.inert = open; });
  if (open) {
    lenis?.stop();
    menu.querySelector('a')?.focus();
  } else {
    lenis?.start();
    if (restoreFocus) toggle.focus();
  }
}
function closeMenu(restoreFocus = true) {
  if (menu && !menu.hidden) setMenu(false, restoreFocus);
}
toggle?.addEventListener('click', () => setMenu(menu.hidden));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
matchMedia('(min-width: 961px)').addEventListener('change', (m) => { if (m.matches) closeMenu(false); });

/* ------------------------------------------------------------------ */
/* Scenes → film position                                              */
/* ------------------------------------------------------------------ */
const scenes = [...document.querySelectorAll('[data-scene]')];
const chapters = [...document.querySelectorAll('.chapter')].map((el) => ({
  el,
  items: [...el.querySelectorAll('[data-reveal]')].map((n) => ({
    n,
    w: n.dataset.reveal.trim().split(/\s+/).map(Number),
    last: -1,
  })),
  top: 0,
  height: 0,
  lastP: -1,
}));
const galleryData = chapters.find((c) => c.el.classList.contains('chapter--gallery'));
const hero = document.querySelector('.hero');
const navLinks = [...document.querySelectorAll('[data-link]')];
const railItems = [...document.querySelectorAll('[data-rail]')];
const railTrack = document.querySelector('.rail__track');

/* Salon gallery: a pinned section whose photos slide sideways with scroll */
const galleryChapter = document.querySelector('.chapter--gallery');
const galleryTrack = galleryChapter?.querySelector('.gallery__track');
const galleryStage = galleryChapter?.querySelector('.stage');
let shotItems = [];
let galleryTravel = 0;
let galleryStageW = 1;
let lastGX = null;

function measureGallery() {
  if (!galleryTrack) return;
  galleryTrack.style.transform = 'none';
  galleryStageW = galleryStage.clientWidth;
  shotItems = [...galleryTrack.querySelectorAll('.shot')].map((el) => ({ el, center: el.offsetLeft + el.offsetWidth / 2 }));
  const lastCenter = shotItems.length ? shotItems[shotItems.length - 1].center : 0;
  // travel until the last photo sits in the middle of the screen
  galleryTravel = Math.max(0, lastCenter - galleryStageW / 2);
  // roughly one pixel of scroll per pixel of sideways travel, plus a short dwell
  galleryChapter.style.height = `${Math.round(galleryTravel + vh * 1.5)}px`;
  lastGX = null;
}

function updateGallery(y) {
  const c = galleryData;
  if (!galleryTrack || !c) return;
  const span = Math.max(1, c.height - vh);
  const p = (y - c.top) / span;
  if (p < -0.5 || p > 1.5) return;
  const q = clamp01((p - 0.03) / 0.9);
  const x = Math.round(-q * galleryTravel * 10) / 10;
  if (x === lastGX) return;
  lastGX = x;
  galleryTrack.style.transform = `translate3d(${x}px, 0, 0)`;
  for (const s of shotItems) {
    const d = Math.max(-1.5, Math.min(1.5, (s.center + x - galleryStageW / 2) / galleryStageW));
    s.el.style.setProperty('--d', d.toFixed(3));
    s.el.style.setProperty('--f', Math.max(0, 1 - Math.abs(d) * 1.8).toFixed(3));
  }
}

let anchors = [];
let maxScroll = 1;
let vh = window.innerHeight;

function absTop(el) {
  return el.getBoundingClientRect().top + window.scrollY;
}

function measure() {
  vh = window.innerHeight;
  measureGallery();
  maxScroll = Math.max(1, document.documentElement.scrollHeight - vh);
  anchors = scenes.map((el) => Math.min(absTop(el), maxScroll));
  for (const c of chapters) {
    c.top = absTop(c.el);
    c.height = c.el.offsetHeight;
    c.lastP = -1;
  }
}

function filmPosition(y) {
  const n = anchors.length;
  if (!n || y <= anchors[0]) return 0;
  for (let i = 0; i < n - 1; i++) {
    if (y < anchors[i + 1]) {
      const span = anchors[i + 1] - anchors[i];
      return i + (span > 0 ? (y - anchors[i]) / span : 0);
    }
  }
  const last = anchors[n - 1];
  return n - 1 + (maxScroll > last ? Math.min(1, (y - last) / (maxScroll - last)) : 0);
}

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const ease = (x) => x * x * (3 - 2 * x);

let lastHero = -1;
let lastActive = -1;
function updateDom(y, T, time, velocity) {
  // only touch styles when a value actually changes (keeps style recalcs cheap)
  const heroP = Math.round(clamp01(y / (vh * 0.9)) * 1000) / 1000;
  if (heroP !== lastHero) { hero.style.setProperty('--hero', String(heroP)); lastHero = heroP; }
  root.classList.toggle('is-scrolled', y > 30);
  root.classList.toggle('show-rail', T > 0.75 && T < 3.9); // hidden once the photo gallery starts

  for (const c of chapters) {
    const span = Math.max(1, c.height - vh);
    const p = (y - c.top) / span;
    if (p < -0.6 || p > 1.6) {
      if (c.lastP !== -9) {
        c.items.forEach((it) => { it.n.style.setProperty('--r', '0'); it.last = 0; });
        c.el.style.setProperty('--s', '0');
        c.lastP = -9;
      }
      continue;
    }
    if (Math.abs(p - c.lastP) < 0.0004) continue;
    c.lastP = p;
    c.el.style.setProperty('--p', clamp01(p).toFixed(4));
    let strongest = 0;
    for (const it of c.items) {
      const [a, b, d, e] = it.w;
      let r = ease(clamp01((p - a) / (b - a))) * (1 - ease(clamp01((p - d) / (e - d))));
      if (reducedMotion) r = p > a - 0.05 && p < e ? 1 : 0;
      r = Math.round(r * 1000) / 1000;
      if (!it.n.hasAttribute('aria-hidden')) strongest = Math.max(strongest, r);
      if (r !== it.last) {
        it.n.style.setProperty('--r', String(r));
        it.last = r;
      }
    }
    c.el.style.setProperty('--s', String(strongest));
  }

  const active = T < 0.6 ? 0 : Math.floor(T + 0.4);
  if (active !== lastActive) {
    lastActive = active;
    navLinks.forEach((a) => {
      const on = Number(a.dataset.link) === active;
      a.classList.toggle('is-active', on);
      if (on) a.setAttribute('aria-current', 'location'); else a.removeAttribute('aria-current');
    });
  }
  railItems.forEach((li) => li.classList.toggle('is-active', Number(li.dataset.rail) === Math.floor(T + 0.15)));
  if (railTrack) railTrack.style.setProperty('--rail', clamp01((T - 1) / 4).toFixed(4));

  updateGallery(y);
}

/* Plain in-view reveals for normal flowing sections */
const io = new IntersectionObserver((entries) => {
  for (const en of entries) {
    if (en.isIntersecting) {
      en.target.classList.add('is-in');
      io.unobserve(en.target);
    }
  }
}, { rootMargin: '0px 0px -12% 0px', threshold: 0.08 });
document.querySelectorAll('[data-inview]').forEach((el) => io.observe(el));
// anything that receives keyboard focus is revealed immediately
document.addEventListener('focusin', (e) => {
  const el = e.target.closest?.('[data-inview]');
  if (el) el.classList.add('is-in');
});

/* Stylist cards tilt toward the pointer */
if (matchMedia('(hover: hover) and (pointer: fine)').matches && !reducedMotion) {
  document.querySelectorAll('.card').forEach((card) => {
    card.addEventListener('pointermove', (e) => {
      if (paused) return;
      const r = card.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      card.style.setProperty('--ry', `${(x * 8).toFixed(2)}deg`);
      card.style.setProperty('--rx', `${(-y * 8).toFixed(2)}deg`);
    });
    card.addEventListener('pointerleave', () => {
      card.style.setProperty('--ry', '0deg');
      card.style.setProperty('--rx', '0deg');
    });
  });
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */
let world = null;
let T = 0;
let prevT = 0;
let last = performance.now();
let filmTime = 0;

function reveal() {
  if (!root.classList.contains('is-loaded')) {
    root.classList.add('is-loaded');
    measure();
  }
}

async function boot() {
  measure();

  // Content never waits on the 3D: lift the curtain as soon as fonts are in
  const fontsReady = document.fonts ? document.fonts.ready : Promise.resolve();
  if (!capture) {
    Promise.race([fontsReady, wait(1200)]).then(reveal);
    requestAnimationFrame(frame);
  }

  try {
    const { createWorld } = await import('./world.js');
    world = await createWorld(document.getElementById('gl'), { capture, reducedMotion });
    await Promise.race([world.ready, wait(8000)]);
    measure();
    // compile shaders on a first frame before fading the canvas in
    T = filmPosition(scrollY());
    world.update(T, filmTime);
    world.render();
    root.classList.add('gl-ready');
  } catch (err) {
    console.warn('3D disabled:', err);
    world = null;
    root.classList.add('no-webgl');
  }

  if (capture) {
    await fontsReady;
    reveal();
    root.classList.add('gl-ready');
    exposeCapture();
  }
}

function frame(now) {
  const dt = Math.min(0.1, Math.max(0.001, (now - last) / 1000));
  last = now;
  lenis?.raf(now);
  if (!paused) filmTime += dt;

  const y = scrollY();
  const target = filmPosition(y);
  // Lenis already smooths the scroll; a light extra ease keeps the 3D silky without lagging the page
  T = reducedMotion ? target : T + (target - T) * (1 - Math.exp(-dt * 9));
  const velocity = (T - prevT) / dt;
  prevT = T;

  updateDom(y, T, now / 1000, velocity);
  if (world) {
    world.update(T, filmTime, { velocity: paused ? 0 : velocity, dt });
    world.render();
    if (!paused) world.reportFrame(dt * 1000);
  }
  requestAnimationFrame(frame);
}

window.addEventListener('resize', () => {
  measure();
  world?.resize();
});
window.addEventListener('load', measure);

window.addEventListener('pointermove', (e) => {
  if (!world || e.pointerType === 'touch' || paused) return;
  world.setPointer((e.clientX / window.innerWidth) * 2 - 1, -((e.clientY / window.innerHeight) * 2 - 1));
}, { passive: true });

/* Deterministic hook used to render the preview video frame by frame */
function exposeCapture() {
  let cPrevT = null;
  document.querySelectorAll('[data-inview]').forEach((el) => el.classList.add('is-in'));
  window.__HH = {
    maxScroll: () => maxScroll,
    anchors: () => anchors.slice(),
    frame(y, time, fps = 30) {
      window.scrollTo({ top: y, behavior: 'instant' });
      const t = filmPosition(y);
      const velocity = cPrevT === null ? 0 : (t - cPrevT) * fps;
      cPrevT = t;
      updateDom(y, t, time, velocity);
      if (world) {
        world.update(t, time, { velocity, dt: 1 / fps });
        world.render();
      }
      return t;
    },
  };
  window.__HH_READY = true;
}

boot();
