/**
 * Page conductor. One scroll position drives two layers:
 *
 *   1. the opening film (film.js): storefront, through the door, a walk into the salon,
 *      then the room bleeds away, and
 *   2. the 3D hair world (world.js) underneath it, mapped through a film position T.
 */
import Lenis from 'lenis';
import { createFilm } from './film.js';

const root = document.documentElement;
root.classList.add('js');

const params = new URLSearchParams(location.search);
const capture = params.has('capture');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches && !capture;
if (capture) root.classList.add('is-capture');

const yearEl = document.querySelector('[data-year]');
if (yearEl) yearEl.textContent = String(new Date().getFullYear());

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const ease = (x) => x * x * (3 - 2 * x);

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
/* Scrolling: slow and silky                                           */
/* ------------------------------------------------------------------ */
// Mouse wheels and trackpads: each notch travels a little over half as far as the
// browser default and glides to rest, so the film plays at an unhurried pace.
// Touch screens keep the browser's own scrolling (momentum, pinch-zoom and the
// address bar are handled far better natively); there the film is paced by longer
// sections and a softer follow instead. See WHEEL_PACE / FOLLOW below and the
// section heights in style.css.
const WHEEL_PACE = 0.58;  // 1 = browser default distance per wheel notch
const WHEEL_GLIDE = 0.072; // lower = longer, softer glide to rest
const touchDevice = matchMedia('(pointer: coarse)').matches;
// Touch screens get a plain, naturally scrolling page with no pinned sections
// (see the "(pointer: coarse)" block in style.css): iOS Safari jitters them.
const flowMode = touchDevice;
const lenis = !reducedMotion && !capture && !touchDevice
  ? new Lenis({ lerp: WHEEL_GLIDE, wheelMultiplier: WHEEL_PACE, smoothWheel: true })
  : null;
// How quickly the pictures catch up with the scroll position (per second).
// Softer on touch, so a fast flick plays out as a smooth move, not a jump.
const FOLLOW = touchDevice ? { film: 5.5, world: 4 } : { film: 11, world: 7 };

const scrollY = () => (lenis ? lenis.scroll : window.scrollY);

function focusTarget(el) {
  if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
  el.focus({ preventScroll: true });
}

function scrollToTarget(hash) {
  const el = document.getElementById(decodeURIComponent(hash.slice(1)));
  if (!el) return;
  if (lenis) {
    // long jumps take a little longer, so the film never whips past
    const dist = Math.abs(el.getBoundingClientRect().top);
    lenis.scrollTo(el, { duration: Math.min(3.4, Math.max(1.4, dist / 4200)) });
  } else el.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth' });
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
  strongest: 0,
  side: el.classList.contains('chapter--left') || el.classList.contains('chapter--right'),
}));
const galleryData = chapters.find((c) => c.el.classList.contains('chapter--gallery'));
const navLinks = [...document.querySelectorAll('[data-link]')];
const railItems = [...document.querySelectorAll('[data-rail]')];
const railTrack = document.querySelector('.rail__track');
const progressBar = document.querySelector('.progress i');

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
  if (flowMode) { galleryChapter.style.height = ''; return; } // a plain vertical stack
  galleryTrack.style.transform = 'none';
  galleryStageW = galleryStage.clientWidth;
  shotItems = [...galleryTrack.querySelectorAll('.shot')].map((el) => ({ el, center: el.offsetLeft + el.offsetWidth / 2 }));
  const lastCenter = shotItems.length ? shotItems[shotItems.length - 1].center : 0;
  // travel until the last photo sits in the middle of the screen
  galleryTravel = Math.max(0, lastCenter - galleryStageW / 2);
  // roughly one pixel of scroll per pixel of sideways travel, plus a short dwell
  // (its calmer pace comes from the slower wheel, see WHEEL_PACE)
  const ratio = matchMedia('(max-width: 720px)').matches ? 1.7 : 1;
  galleryChapter.style.height = `${Math.round(galleryTravel * ratio + vh * 1.5)}px`;
  lastGX = null;
}

function updateGallery(y) {
  const c = galleryData;
  if (!galleryTrack || !c || flowMode) return;
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
// Layout-viewport size: unlike innerWidth/innerHeight it doesn't change while
// a phone is pinch-zoomed or its toolbar slides, so zooming can't break layout.
const viewW = () => document.documentElement.clientWidth;
const viewH = () => document.documentElement.clientHeight;
let vh = viewH();

/* Phone veils: fixed to the screen, faded by scroll position */
const veilText = document.querySelector('.veil--text');
const veilPage = document.querySelector('.veil--page');
const pageSections = ['stylists', 'menu', 'visit'].map((id) => document.getElementById(id)).filter(Boolean);
let pageRanges = [];
let lastVeilT = -1;
let lastVeilP = -1;

function absTop(el) {
  return el.getBoundingClientRect().top + window.scrollY;
}
// Position in the document from the layout alone (ignores reveal transforms)
function docTop(el) { let y = 0; for (let e = el; e; e = e.offsetParent) y += e.offsetTop; return y; }

/* ------------------------------------------------------------------ */
/* The opening film                                                    */
/* ------------------------------------------------------------------ */
const filmEl = document.querySelector('.film');
const filmCanvas = filmEl?.querySelector('canvas');
const filmShade = filmEl?.querySelector('.film__shade');
const reel = document.querySelector('.reel');
const heroBeat = document.querySelector('.beat--hero');
const roomCopy = document.querySelector('[data-beat="room"] .beat__copy');
const homeBeat = document.querySelector('[data-beat="home"]');

let film = null;
let filmFirstFrame = () => {};
const filmFirst = new Promise((r) => { filmFirstFrame = r; });
if (filmCanvas) {
  try { film = createFilm(filmCanvas, { onFirstFrame: filmFirstFrame }); } catch { root.classList.add('no-film'); filmFirstFrame(); }
} else filmFirstFrame();

// Scroll positions (px) of the film's beats. Measured from the layout.
let R = null;
function measureReel() {
  if (!reel || !roomCopy || !homeBeat) { R = null; return; }
  const home = docTop(homeBeat);                       // T = 0: the hair world's first scene
  const room = docTop(roomCopy) - vh * 0.95;           // the room copy is about to enter
  R = {
    y0: docTop(reel),
    yA: room - vh * 0.08,        // the clip ends
    yB: room + vh * 0.08,        // the 3D room has fully taken over
    yM0: home - vh * 0.85,       // the lights start to go down
    yG0: home - vh * 0.35,       // the room starts to bleed away
    yG1: home + vh * 0.6,        // gone: the hair film has the screen
  };
}

// What the film should show at scroll position y
function filmTargets(y) {
  return {
    c: clamp01((y - R.y0) / (R.yA - R.y0)),                 // clip progress
    m: ease(clamp01((y - R.yA) / (R.yB - R.yA))),           // clip → room cross-fade
    r: clamp01((y - R.yB) / (R.yG1 - R.yB)),                // walk into the room
    d: ease(clamp01((y - R.yM0) / (R.yG0 + vh * 0.2 - R.yM0))), // lights down
    g: clamp01((y - R.yG0) / (R.yG1 - R.yG0)),              // the bleed
  };
}
const shown = { c: 0, m: 0, r: 0, d: 0, g: 0 };
let filmSnapped = false;
let filmHidden = false;
let filmKept = true;
let lastShade = -1;

function driveFilm(y, dt, snap = false) {
  if (!R || !filmEl) return 1;
  const t = filmTargets(y);
  // follow the scroll with a little easing so frame steps blend smoothly
  const k = snap || !filmSnapped || capture || reducedMotion ? 1 : 1 - Math.exp(-dt * FOLLOW.film);
  filmSnapped = true;
  for (const key in shown) shown[key] += (t[key] - shown[key]) * k;
  const g = shown.g < 0.0005 ? 0 : shown.g > 0.9995 ? 1 : shown.g;

  // once the room has bled away completely, the film layer is taken off screen
  const gone = g >= 1;
  if (gone !== filmHidden) { filmHidden = gone; filmEl.style.visibility = gone ? 'hidden' : ''; }

  // the clip's frames are only held in memory while the film is within reach
  if (film) {
    if (filmKept && y > R.yG1 + vh * 3) { filmKept = false; film.keep(false); }
    else if (!filmKept && y < R.yG1 + vh * 1.5) { filmKept = true; film.keep(true); }
  }

  if (!gone) {
    const shade = Math.round((1 - ease(g)) * 100) / 100;
    if (shade !== lastShade) {
      lastShade = shade;
      if (filmShade) filmShade.style.opacity = String(shade);
      // without WebGL2 there is no bleed: the whole layer simply fades
      if (!film || film.mode !== 'gl') filmEl.style.opacity = String(shade);
    }
    if (film && !zoomed) {
      film.resize(Math.min(window.devicePixelRatio || 1, 2));
      film.set({ clip: shown.c, mix: shown.m, room: shown.r, mood: shown.d, gone: g });
      film.render();
      if (film.ready && !root.classList.contains('film-ready')) root.classList.add('film-ready');
    }
  }
  return g;
}

function measure() {
  vh = viewH();
  measureGallery();
  maxScroll = Math.max(1, document.documentElement.scrollHeight - vh);
  anchors = scenes.map((el) => Math.min(docTop(el), maxScroll));
  for (const c of chapters) {
    c.top = absTop(c.el);
    c.height = c.el.offsetHeight;
    c.lastP = -1;
  }
  pageRanges = pageSections.map((el) => { const top = absTop(el); return { top, bottom: top + el.offsetHeight }; });
  measureReel();
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

let lastHero = -1;
let lastActive = -1;
let lastProgress = -1;
function updateDom(y, T) {
  // only touch styles when a value actually changes (keeps style recalcs cheap)
  const heroP = Math.round(clamp01(y / (vh * 0.9)) * 1000) / 1000;
  if (heroP !== lastHero && heroBeat) { heroBeat.style.setProperty('--hero', String(heroP)); lastHero = heroP; }
  root.classList.toggle('is-scrolled', y > 30);
  root.classList.toggle('show-rail', T > 0.75 && T < 3.9); // hidden once the photo gallery starts

  const progress = Math.round(clamp01(y / maxScroll) * 2000) / 2000;
  if (progress !== lastProgress && progressBar) { progressBar.style.transform = `scaleX(${progress})`; lastProgress = progress; }

  for (const c of chapters) {
    if (flowMode) break; // touch screens reveal text on entry instead (see below)
    const span = Math.max(1, c.height - vh);
    const p = (y - c.top) / span;
    if (p < -0.6 || p > 1.6) {
      if (c.lastP !== -9) {
        c.items.forEach((it) => { it.n.style.setProperty('--r', '0'); it.last = 0; });
        c.el.style.setProperty('--s', '0');
        c.strongest = 0;
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
    c.strongest = strongest;
  }

  // phone veils (hidden by CSS on larger screens)
  if (veilText) {
    let vt = 0;
    if (!flowMode) for (const c of chapters) if (c.side) vt = Math.max(vt, clamp01(((c.strongest || 0) - 0.02) * 17)); // on just before its text
    let vp = 0;
    for (const r of pageRanges) vp += Math.max(0, Math.min(y + vh, r.bottom) - Math.max(y, r.top)) / vh;
    vt = Math.round(vt * 100) / 100;
    vp = Math.round(Math.min(1, vp) * 100) / 100;
    if (vt !== lastVeilT) { veilText.style.opacity = String(vt); lastVeilT = vt; }
    if (vp !== lastVeilP) { veilPage.style.opacity = String(vp); lastVeilP = vp; }
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

/* ------------------------------------------------------------------ */
/* Reveals                                                             */
/* ------------------------------------------------------------------ */
// The film's copy fades in and out as each block passes through the screen
const beatCopies = [...document.querySelectorAll('[data-beat] .beat__copy')];
// Normal flowing sections fade in once
const revealSelector = flowMode ? '[data-inview], [data-reveal]' : '[data-inview]';
const inviewEls = [...document.querySelectorAll(revealSelector)];
if (capture || !('IntersectionObserver' in window)) {
  [...beatCopies, ...inviewEls].forEach((el) => el.classList.add('is-in'));
} else {
  const beatIO = new IntersectionObserver((entries) => {
    for (const en of entries) en.target.classList.toggle('is-in', en.isIntersecting);
  }, { rootMargin: '-8% 0px -12% 0px' });
  beatCopies.forEach((el) => beatIO.observe(el));
  const io = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (en.isIntersecting) {
        en.target.classList.add('is-in');
        io.unobserve(en.target);
      }
    }
  }, { rootMargin: '0px 0px -12% 0px', threshold: 0.08 });
  inviewEls.forEach((el) => io.observe(el));
}
// anything that receives keyboard focus is revealed immediately
document.addEventListener('focusin', (e) => {
  const el = e.target.closest?.(`${revealSelector}, .beat__copy`);
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
let bleed = 0;       // 0 while the opening film covers the screen, 1 once it has gone
let worldDrawn = false;

let curtainUp = false;
function reveal() {
  curtainUp = true;
  if (!root.classList.contains('is-loaded')) {
    root.classList.add('is-loaded');
    measure();
  }
}

let worldRequested = false;
async function loadWorld() {
  if (worldRequested) return;
  worldRequested = true;
  try {
    const { createWorld } = await import('./world.js');
    const w = await createWorld(document.getElementById('gl'), { capture, reducedMotion });
    await Promise.race([w.ready, wait(8000)]);
    measure();
    // compile shaders on a first frame before the canvas is ever seen
    T = prevT = filmPosition(scrollY());
    w.update(T, filmTime, { intro: bleed });
    w.render();
    world = w;
    root.classList.add('gl-ready');
  } catch (err) {
    console.warn('3D disabled:', err);
    world = null;
    root.classList.add('no-webgl');
  }
}

async function boot() {
  measure();
  bleed = driveFilm(scrollY(), 0, true);
  const fontsReady = document.fonts ? document.fonts.ready : Promise.resolve();

  if (capture) {
    await loadWorld();
    await fontsReady;
    // every film frame in place, so captures are deterministic
    const t0 = performance.now();
    while (film && film.loaded() < film.frames && performance.now() - t0 < 30000) await wait(100);
    reveal();
    exposeCapture();
    return;
  }

  // Content never waits on the 3D: the curtain lifts as soon as the fonts and the
  // film's first frame are in (or straight away with the fonts when the page
  // opens below the film, e.g. on a reload or a #link).
  const below = bleed >= 1;
  const lifted = Promise.race([Promise.all([fontsReady, below ? null : filmFirst]), wait(1800)]).then(reveal);
  requestAnimationFrame(frame);
  // The hair world always starts loading after the curtain is up, never before.
  // It isn't on screen until the film bleeds away several screens down, so it
  // waits for the opening to settle; if the visitor gets near it sooner, frame()
  // starts the load at once.
  await lifted;
  if (!below) await wait(1400);
  loadWorld();
}

// While pinch-zoomed, hold the 3D still: it saves the phone's memory and GPU
// for drawing the zoomed page.
let zoomed = false;
if (window.visualViewport) {
  const onZoom = () => {
    const z = visualViewport.scale > 1.01;
    if (z !== zoomed) {
      zoomed = z;
      root.classList.toggle('is-zoomed', z); // CSS takes the 3D canvas off screen
    }
  };
  visualViewport.addEventListener('resize', onZoom);
  visualViewport.addEventListener('scroll', onZoom);
}

function frame(now) {
  const dt = Math.min(0.1, Math.max(0.001, (now - last) / 1000));
  last = now;
  lenis?.raf(now);
  if (!paused) filmTime += dt;

  const y = scrollY();
  bleed = driveFilm(y, dt);
  if (!worldRequested && curtainUp && R && y > R.yA) loadWorld(); // the clip is over: the hair is up next

  const target = filmPosition(y);
  // Lenis already smooths the scroll; a light extra ease keeps the 3D silky without lagging the page
  T = reducedMotion ? target : T + (target - T) * (1 - Math.exp(-dt * FOLLOW.world));
  const velocity = (T - prevT) / dt;
  prevT = T;

  updateDom(y, T);
  // While the opening film covers the whole screen the hair world is not drawn at all.
  const covered = bleed <= 0 && worldDrawn;
  if (world && !zoomed && !covered) {
    world.update(T, filmTime, { velocity: paused ? 0 : velocity, dt, intro: bleed });
    world.render();
    worldDrawn = true;
    if (!paused && bleed > 0) world.reportFrame(dt * 1000);
  }
  requestAnimationFrame(frame);
}

let lastW = viewW();
let lastH = viewH();
window.addEventListener('resize', () => {
  const w = viewW();
  const h = viewH();
  // Pinch-zoom changes neither. On touch screens, small height-only changes are
  // the address bar or keyboard: re-measuring then would shift the page.
  if (w === lastW && (h === lastH || (touchDevice && Math.abs(h - lastH) < 200))) return;
  lastW = w;
  lastH = h;
  measure();
  world?.resize();
  worldDrawn = false;
});
window.addEventListener('load', measure);
document.fonts?.ready.then(measure);

window.addEventListener('pointermove', (e) => {
  if (!world || e.pointerType === 'touch' || paused) return;
  world.setPointer((e.clientX / viewW()) * 2 - 1, -((e.clientY / viewH()) * 2 - 1));
}, { passive: true });

/* Deterministic hook used to render previews frame by frame */
function exposeCapture() {
  let cPrevT = null;
  window.__HH = {
    maxScroll: () => maxScroll,
    anchors: () => anchors.slice(),
    reel: () => ({ ...R }),
    frame(y, time, fps = 30) {
      window.scrollTo({ top: y, behavior: 'instant' });
      const g = driveFilm(y, 1 / fps, true);
      const t = filmPosition(y);
      const velocity = cPrevT === null ? 0 : (t - cPrevT) * fps;
      cPrevT = t;
      updateDom(y, t);
      if (world) {
        world.update(t, time, { velocity, dt: 1 / fps, intro: g });
        world.render();
      }
      return { t, g };
    },
  };
  window.__HH_READY = true;
}

boot();
