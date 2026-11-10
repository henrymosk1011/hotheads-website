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

/* ------------------------------------------------------------------ */
/* Smooth scroll                                                       */
/* ------------------------------------------------------------------ */
const lenis = !reducedMotion && !capture
  ? new Lenis({ lerp: 0.09, wheelMultiplier: 0.95, smoothWheel: true })
  : null;

const scrollY = () => (lenis ? lenis.scroll : window.scrollY);

function scrollToTarget(hash) {
  const el = document.querySelector(hash);
  if (!el) return;
  if (lenis) lenis.scrollTo(el, { duration: 1.8 });
  else el.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth' });
}

document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href^="#"]');
  if (!a) return;
  const hash = a.getAttribute('href');
  if (hash.length < 2) return;
  e.preventDefault();
  closeMenu();
  scrollToTarget(hash);
  history.replaceState(null, '', hash);
});

/* ------------------------------------------------------------------ */
/* Mobile menu                                                         */
/* ------------------------------------------------------------------ */
const toggle = document.querySelector('.nav__toggle');
const menu = document.getElementById('mobile-menu');
function closeMenu() {
  if (!menu || menu.hidden) return;
  menu.hidden = true;
  toggle.setAttribute('aria-expanded', 'false');
  lenis?.start();
}
toggle?.addEventListener('click', () => {
  const open = menu.hidden;
  menu.hidden = !open;
  toggle.setAttribute('aria-expanded', String(open));
  if (open) lenis?.stop(); else lenis?.start();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });

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
const hero = document.querySelector('.hero');
const navLinks = [...document.querySelectorAll('[data-link]')];
const railItems = [...document.querySelectorAll('[data-rail]')];
const railTrack = document.querySelector('.rail__track');
const marquee = document.querySelector('.marquee__track');

let anchors = [];
let maxScroll = 1;
let vh = window.innerHeight;

function absTop(el) {
  return el.getBoundingClientRect().top + window.scrollY;
}

function measure() {
  vh = window.innerHeight;
  maxScroll = Math.max(1, document.documentElement.scrollHeight - vh);
  anchors = scenes.map((el) => Math.min(absTop(el), maxScroll));
  for (const c of chapters) {
    c.top = absTop(c.el);
    c.height = c.el.offsetHeight;
  }
}

function filmPosition(y) {
  const n = anchors.length;
  if (y <= anchors[0]) return 0;
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

function updateDom(y, T, time, velocity) {
  // hero parallax-out
  hero.style.setProperty('--hero', clamp01(y / (vh * 0.9)).toFixed(4));
  root.classList.toggle('is-scrolled', y > 30);
  root.classList.toggle('show-rail', T > 0.75 && T < 4.9);

  for (const c of chapters) {
    const span = Math.max(1, c.height - vh);
    const p = (y - c.top) / span;
    if (p < -0.6 || p > 1.6) {
      if (c.lastP !== -9) {
        c.items.forEach((it) => { it.n.style.setProperty('--r', '0'); it.last = 0; });
        c.lastP = -9;
      }
      continue;
    }
    if (Math.abs(p - c.lastP) < 0.0004) continue;
    c.lastP = p;
    c.el.style.setProperty('--p', clamp01(p).toFixed(4));
    for (const it of c.items) {
      const [a, b, d, e] = it.w;
      let r = ease(clamp01((p - a) / (b - a))) * (1 - ease(clamp01((p - d) / (e - d))));
      if (reducedMotion) r = p > a - 0.05 && p < e ? 1 : 0;
      r = Math.round(r * 1000) / 1000;
      if (r !== it.last) {
        it.n.style.setProperty('--r', String(r));
        it.last = r;
      }
    }
  }

  // nav + rail
  const active = T < 0.6 ? 0 : Math.floor(T + 0.4);
  navLinks.forEach((a) => a.classList.toggle('is-active', Number(a.dataset.link) === active));
  railItems.forEach((li) => li.classList.toggle('is-active', Number(li.dataset.rail) === Math.floor(T + 0.15)));
  if (railTrack) railTrack.style.setProperty('--rail', clamp01((T - 1) / 4).toFixed(4));

  // marquee drifts with time and kicks with scroll speed
  if (marquee) {
    const dtm = lastTime ? Math.min(0.1, time - lastTime) : 0;
    marqueeX -= (0.6 + Math.min(Math.abs(velocity) * 14, 18)) * dtm * 60;
    const w = marquee.scrollWidth / 2;
    if (w > 0) marqueeX = ((marqueeX % w) + w) % w - w;
    marquee.style.setProperty('--x', `${marqueeX.toFixed(1)}px`);
  }
  lastTime = time;
}
let marqueeX = 0;
let lastTime = 0;

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

/* Stylist cards tilt toward the pointer */
if (matchMedia('(hover: hover) and (pointer: fine)').matches && !reducedMotion) {
  document.querySelectorAll('.card').forEach((card) => {
    card.addEventListener('pointermove', (e) => {
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
const loaderBar = document.querySelector('.loader__bar span');
const setLoad = (v) => loaderBar?.style.setProperty('--load', String(v));

let world = null;
let T = 0;
let prevT = 0;
let last = performance.now();

async function boot() {
  measure();
  setLoad(0.25);

  try {
    const { createWorld } = await import('./world.js');
    setLoad(0.5);
    world = await createWorld(document.getElementById('gl'), { capture, reducedMotion });
    setLoad(0.7);
  } catch (err) {
    console.warn('3D disabled:', err);
    root.classList.add('no-webgl');
  }

  const fontsReady = document.fonts ? document.fonts.ready : Promise.resolve();
  const timeout = new Promise((r) => setTimeout(r, 6000));
  await Promise.race([Promise.all([fontsReady, world ? world.ready : null]), timeout]);
  setLoad(1);
  measure();

  // warm up one frame so shaders are compiled before the curtain lifts
  if (world) {
    T = filmPosition(scrollY());
    world.update(T, performance.now() / 1000);
    world.render();
  }

  if (capture) {
    root.classList.add('is-loaded');
    exposeCapture();
    return;
  }

  setTimeout(() => root.classList.add('is-loaded'), 250);
  requestAnimationFrame(frame);
}

function frame(now) {
  const dt = Math.min(0.1, Math.max(0.001, (now - last) / 1000));
  last = now;
  lenis?.raf(now);

  const y = scrollY();
  const target = filmPosition(y);
  T = reducedMotion ? target : T + (target - T) * (1 - Math.exp(-dt * 5.5));
  const velocity = (T - prevT) / dt;
  prevT = T;

  updateDom(y, T, now / 1000, velocity);
  if (world) {
    world.update(T, now / 1000, { velocity, dt });
    world.render();
    world.reportFrame(dt * 1000);
  }
  requestAnimationFrame(frame);
}

window.addEventListener('resize', () => {
  measure();
  world?.resize();
});
window.addEventListener('load', measure);

window.addEventListener('pointermove', (e) => {
  if (!world || e.pointerType === 'touch') return;
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
