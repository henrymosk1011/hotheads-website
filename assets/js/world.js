/**
 * World: owns the renderer and every 3D element, and maps a single number
 * (the scroll "film position" T) to the whole scene. T runs from 0 at the
 * top of the page to the number of scenes at the bottom; each integer is
 * the start of a section:
 *
 *   0 welcome · 1 cut · 2 color · 3 style · 4 salon · 5 stylists · 6 menu · 7 book · 8 visit
 *
 * Before 0 the opening film (film.js) covers the screen. As it bleeds away the
 * page passes "intro" (0 to 1): the lock grows out across the frame to meet it.
 *
 * Continuous values (camera, hair shape, light) come from keyframes with
 * monotone cubic interpolation, so motion never overshoots. One-off moments
 * (the snip, the dye drops) are small functions of T. Because everything is
 * a pure function of T, scrolling back simply rewinds the film.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createHair } from './hair.js';
import { createScissors } from './scissors.js';
import { createDust, createSparks } from './particles.js';

/* ------------------------------------------------------------------ */
/* Timeline                                                            */
/* ------------------------------------------------------------------ */

// Every key lists only what changes; missing channels carry forward.
const KEYS = [
  { t: 0.0, cam: [0, 0.1, 10.5], look: [0.2, 0.1, 0], lock: [-4.4, -3.6, -1.2], rot: [0.1, 0.2, 0.46], len: 10,
    spread: 0.55, wave: 1, wind: 1, curl: 0, clump: 0, twist: 0.8, ring: 0, ringR: 2.6, op: 0.44, exp: 1.0,
    bloom: 0.95, glow: [0.24, 0.07, 0.42], sparks: 0, dust: 0.55, aberr: 0.0 },
  { t: 0.55, cam: [0.6, 0.3, 9.2], look: [0.4, 0.15, 0], lock: [-5.6, -1.5, -0.6], rot: [0.05, 0.12, 0.2], spread: 0.35, op: 0.38 },
  // 01 · Cut: cut point sits at world (0.9, 0, 0)
  { t: 1.0, cam: [1.9, 0.85, 7.6], look: [0.7, 0.42, 0], lock: [-4.7, 0, 0], rot: [0, 0, 0], wave: 0.55, spread: 0.2, twist: 0.4, bloom: 0.9, op: 0.36 },
  { t: 1.33, cam: [1.5, 0.7, 7.0], look: [0.8, 0.32, 0] },
  { t: 1.45, cam: [1.4, 0.35, 7.0], look: [0.7, 0.0, 0], wave: 0.75 },
  { t: 1.62, cam: [1.0, 0.2, 7.6], look: [0.6, -0.1, 0], glow: [0.32, 0.06, 0.3] },
  // 02 · Color: lock on the left, text on the right
  { t: 2.0, cam: [-0.3, 0.4, 8.0], look: [-1.0, 0.1, 0], lock: [-6.3, -0.5, -0.4], rot: [0, -0.3, 0.14], wave: 0.9, spread: 0.3, twist: 0.6,
    glow: [0.4, 0.05, 0.25], bloom: 1.0 },
  { t: 2.6, cam: [-0.1, 0.2, 7.3], look: [-1.1, 0.0, 0], rot: [0, -0.42, 0.1], glow: [0.42, 0.08, 0.16] },
  // 03 · Style: curls, volume, heat
  { t: 3.0, cam: [0.4, 0.6, 8.2], look: [1.6, 0.0, 0], lock: [0.1, -0.35, 0], rot: [0, -0.3, 0.14], spread: 0.45, curl: 0, twist: 1.0,
    glow: [0.36, 0.08, 0.3], sparks: 0, op: 0.34 },
  { t: 3.18, op: 0.26 },
  { t: 3.3, curl: 1, clump: 1, spread: 0.45, sparks: 0.9, cam: [2.0, 1.0, 7.4], look: [1.8, 0.0, 0] },
  { t: 3.62, curl: 0.9, clump: 1, spread: 0.55, sparks: 0.7, cam: [3.4, 1.3, 6.6], look: [1.9, 0.05, 0], wave: 0.8 },
  // 04 · Salon: the photos take the stage; the hair drifts low and dim behind them
  { t: 4.0, cam: [0, 0.4, 11], look: [0, 0, 0], lock: [-3.6, -4.6, -4], rot: [0, 0.1, 0.14], curl: 0.6, clump: 0.6, spread: 0.6, sparks: 0,
    wave: 0.9, glow: [0.2, 0.06, 0.34], bloom: 0.75, op: 0.16 },
  { t: 4.62, lock: [-1.0, -4.4, -4], rot: [0, 0.1, 0.18] },
  { t: 4.95, cam: [0, 0.4, 11] },
  // 05 · Stylists: hair settles behind the cards
  { t: 5.0, cam: [0, 0.2, 10.5], look: [0, 0, 0], lock: [1.6, -1.6, -3.5], rot: [0, -0.2, 0.3], curl: 0.55, clump: 0.6, spread: 0.6, op: 0.24,
    glow: [0.18, 0.05, 0.3], bloom: 0.75, dust: 0.4 },
  // 06 · Menu
  { t: 6.0, lock: [-8.6, 0.2, -3.0], rot: [0, 0.3, -0.12], curl: 0.35, op: 0.26, glow: [0.22, 0.05, 0.22] },
  // 07 · Book: the lock becomes a halo
  { t: 7.0, cam: [0, 0.1, 10.4], look: [0, 0, 0], lock: [0, 0, 0], rot: [0, 0, 0], ring: 0, curl: 0.45, spread: 0.35, op: 0.3,
    glow: [0.36, 0.06, 0.4], bloom: 1.0, sparks: 0 },
  { t: 7.12, ring: 1, ringR: 3.35, op: 0.34, bloom: 1.25, sparks: 0.35, dust: 0.65 },
  { t: 7.52, cam: [0, 0.0, 10.0], look: [0, 0, 0], ring: 1 },
  // 08 · Visit: the halo scrolls away with its section so the footer reads cleanly
  { t: 8.0, cam: [0, -6.6, 10.0], look: [0, -6.6, 0], op: 0.22, bloom: 0.8, glow: [0.16, 0.04, 0.26] },
  { t: 9.0, cam: [0, -7.2, 10.0], look: [0, -7.2, 0] },
];

function monotoneTrack(times, values) {
  const n = times.length;
  const d = new Array(n - 1);
  const m = new Array(n);
  for (let i = 0; i < n - 1; i++) d[i] = (values[i + 1] - values[i]) / (times[i + 1] - times[i]);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const tau = 3 / Math.sqrt(s);
      m[i] = tau * a * d[i];
      m[i + 1] = tau * b * d[i];
    }
  }
  return (t) => {
    if (t <= times[0]) return values[0];
    if (t >= times[n - 1]) return values[n - 1];
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (times[mid] <= t) lo = mid; else hi = mid;
    }
    const h = times[hi] - times[lo];
    const s = (t - times[lo]) / h;
    const s2 = s * s;
    const s3 = s2 * s;
    return (2 * s3 - 3 * s2 + 1) * values[lo] + (s3 - 2 * s2 + s) * h * m[lo]
      + (-2 * s3 + 3 * s2) * values[hi] + (s3 - s2) * h * m[hi];
  };
}

function buildTimeline(keys) {
  const filled = [];
  let prev = {};
  for (const k of keys) {
    prev = { ...prev, ...k };
    filled.push(prev);
  }
  const channels = {};
  const names = Object.keys(filled[0]).filter((k) => k !== 't');
  const times = filled.map((k) => k.t);
  for (const name of names) {
    const sample = filled[0][name];
    if (Array.isArray(sample)) {
      channels[name] = sample.map((_, i) => monotoneTrack(times, filled.map((k) => k[name][i])));
    } else {
      channels[name] = monotoneTrack(times, filled.map((k) => k[name]));
    }
  }
  const out = {};
  return (t) => {
    for (const name of names) {
      const ch = channels[name];
      if (Array.isArray(ch)) {
        out[name] = out[name] || new Array(ch.length);
        for (let i = 0; i < ch.length; i++) out[name][i] = ch[i](t);
      } else {
        out[name] = ch(t);
      }
    }
    return out;
  };
}

// Global tuning knobs for the additive hair and the glow
const OPACITY_SCALE = 0.26;
const BLOOM_SCALE = 0.7;

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;
const easeInCubic = (t) => t * t * t;

/* ------------------------------------------------------------------ */
/* Screen-space passes                                                 */
/* ------------------------------------------------------------------ */

const BackgroundShader = {
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 uBase;
    uniform vec3 uGlow;
    uniform vec3 uWarm;
    uniform vec2 uRes;
    uniform float uTime;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p) {
      vec2 i = floor(p); vec2 f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
    }
    float fbm(vec2 p) { float v = 0.0; float a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
    void main() {
      vec2 p = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
      vec3 col = uBase;
      float smoke = fbm(p * 1.7 + vec2(uTime * 0.025, -uTime * 0.018));
      col += uGlow * exp(-dot(p - vec2(0.18, 0.02), p - vec2(0.18, 0.02)) * 1.6) * (0.55 + 0.45 * smoke) * 0.16;
      col += uWarm * exp(-length(p - vec2(-0.85, 0.55)) * 2.4) * 0.07;
      col += uGlow * smoke * 0.012;
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

const FinishShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uGrain: { value: 0.035 },
    uVignette: { value: 0.85 },
    uAberration: { value: 0.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform vec2 uRes;
    uniform float uGrain;
    uniform float uVignette;
    uniform float uAberration;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 c = vUv - 0.5;
      float d = length(c * vec2(uRes.x / uRes.y, 1.0)) / length(vec2(uRes.x / uRes.y, 1.0) * 0.5);
      vec2 off = c * d * uAberration;
      vec3 col = vec3(
        texture2D(tDiffuse, vUv + off).r,
        texture2D(tDiffuse, vUv).g,
        texture2D(tDiffuse, vUv - off).b
      );
      col *= 1.0 - smoothstep(0.45, 1.05, d) * uVignette;
      col += (hash(vUv * uRes + fract(uTime * 7.0) * 113.0) - 0.5) * uGrain * (0.4 + col);
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }
  `,
};

/* ------------------------------------------------------------------ */
/* World                                                               */
/* ------------------------------------------------------------------ */

function createStudio() {
  const studio = new THREE.Scene();
  const room = new THREE.Mesh(
    new THREE.BoxGeometry(20, 12, 20),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0.012, 0.006, 0.02), side: THREE.BackSide }),
  );
  studio.add(room);
  const box = (w, h, color, intensity, pos, rot = [0, 0, 0]) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }),
    );
    m.position.set(...pos);
    m.rotation.set(...rot);
    studio.add(m);
  };
  box(9, 2.2, '#fff1e6', 6, [0, 5.8, 0], [Math.PI / 2, 0, 0]);       // warm overhead strip
  box(1.2, 8, '#ff4fa3', 5, [-9.5, 0, -1], [0, Math.PI / 2, 0]);     // pink side strip
  box(1.2, 8, '#a35bff', 5, [9.5, 0, 1], [0, -Math.PI / 2, 0]);      // violet side strip
  box(6, 1.0, '#ffffff', 8, [2, 2.5, 9.5], [0, Math.PI, 0]);        // key strip in front
  box(4, 1.4, '#ff8a3d', 3, [-3, -3, -9.5]);                        // ember kicker behind
  return studio;
}

export async function createWorld(canvas, { capture = false, reducedMotion = false } = {}) {
  const vw0 = document.documentElement.clientWidth;
  const vh0 = document.documentElement.clientHeight;
  const isSmall = Math.min(vw0, vh0) < 700 || matchMedia('(pointer: coarse)').matches;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: capture,
  });
  renderer.setClearColor('#07040b', 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 0.95;

  // Resolution budget: large/retina windows get a slightly lower internal
  // resolution (bloom + grain hide it) so the GPU keeps a steady frame rate.
  const cssPixels = vw0 * vh0;
  const maxDpr = isSmall ? 1.25 : (cssPixels > 2.0e6 ? 1.25 : 1.5);
  let dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
  renderer.setPixelRatio(dpr);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  const baseFov = 35;

  // Image-based lighting for the metal and the dye drops: a dark photo
  // studio with a few coloured softboxes, so chrome reads as chrome.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(createStudio(), 0.02).texture;
  scene.environment = env;
  pmrem.dispose();

  const key = new THREE.DirectionalLight('#ffe2cf', 2.2);
  key.position.set(3, 5, 6);
  const rim = new THREE.DirectionalLight('#ff4fa3', 2.5);
  rim.position.set(-6, -1, -4);
  scene.add(key, rim);

  // Background
  const bgMat = new THREE.ShaderMaterial({
    ...BackgroundShader,
    uniforms: {
      uBase: { value: new THREE.Color('#07040b') },
      uGlow: { value: new THREE.Color(0.24, 0.07, 0.42) },
      uWarm: { value: new THREE.Color('#3a1206') },
      uRes: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 },
    },
    depthTest: false,
    depthWrite: false,
  });
  const bgGeo = new THREE.BufferGeometry();
  bgGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const bg = new THREE.Mesh(bgGeo, bgMat);
  bg.frustumCulled = false;
  bg.renderOrder = -100;
  scene.add(bg);

  // Hair
  const hair = createHair({
    strands: isSmall ? 1200 : 2400,
    segments: isSmall ? 32 : 48,
    length: 10,
  });
  // Fewer strands are drawn a touch brighter so the lock keeps its density
  const refStrands = isSmall ? 1500 : 2800;
  let density = Math.min(1.6, refStrands / hair.strands);
  const lock = new THREE.Group();
  lock.add(hair.mesh);
  scene.add(lock);

  // Shears
  const scissors = createScissors();
  scene.add(scissors.group);

  // Dye drops
  const dropColors = ['#ff2e88', '#ff7a3d', '#ffc46b', '#ff5fb0', '#b04cff'];
  const drops = dropColors.map((hex) => {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 32, 20),
      new THREE.MeshPhysicalMaterial({
        color: hex,
        emissive: new THREE.Color(hex).multiplyScalar(0.55),
        roughness: 0.08,
        metalness: 0,
        clearcoat: 1,
        clearcoatRoughness: 0.04,
        envMapIntensity: 1.4,
      }),
    );
    m.visible = false;
    scene.add(m);
    return m;
  });

  // Particles
  const dust = createDust(isSmall ? 220 : 420);
  const sparks = createSparks(isSmall ? 260 : 520);
  scene.add(dust.points, sparks.points);


  // Post-processing
  const size = new THREE.Vector2();
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: isSmall || dpr > 1.25 ? 2 : 4 });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.6, 0.6, 0.8);
  composer.addPass(bloom);
  const finish = new ShaderPass(FinishShader);
  composer.addPass(finish);
  composer.addPass(new OutputPass());

  const timeline = buildTimeline(KEYS);

  // Scratch objects
  const v3 = new THREE.Vector3();
  const v3b = new THREE.Vector3();
  const look = new THREE.Vector3();
  const pointer = new THREE.Vector2();
  const pointerSmooth = new THREE.Vector2();
  let scrollSpeed = 0;
  let strandCount = hair.strands;

  function resize() {
    // size from the canvas's own box (fixed, 100lvh): pinch-zoom never changes it
    const w = canvas.clientWidth || document.documentElement.clientWidth;
    const h = canvas.clientHeight || document.documentElement.clientHeight;
    renderer.setSize(w, h, false);
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(w, h);
    const aspect = w / h;
    camera.aspect = aspect;
    // Keep the horizontal framing on portrait screens without going fisheye
    const ref = 1.45;
    if (aspect < ref) {
      const hf = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(baseFov) / 2) * ref);
      camera.fov = Math.min(62, THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(hf / 2) / aspect)));
    } else {
      camera.fov = baseFov;
    }
    camera.updateProjectionMatrix();
    renderer.getDrawingBufferSize(size);
    hair.uniforms.uPixel.value = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / size.y;
    bgMat.uniforms.uRes.value.set(size.x, size.y);
    finish.uniforms.uRes.value.set(size.x, size.y);
    dust.uniforms.uPixelRatio.value = renderer.getPixelRatio();
    sparks.uniforms.uPixelRatio.value = renderer.getPixelRatio();
  }
  resize();

  /* ---------------------------------------------------------------- */
  /* Per-frame update                                                  */
  /* ---------------------------------------------------------------- */
  function update(T, time, { velocity = 0, dt = 1 / 60, intro = 1 } = {}) {
    const k = timeline(T);
    // The entrance: while the opening film bleeds away, the lock pours in from the corner
    const arrive = reducedMotion ? 1 : clamp01(intro);
    const grow = 0.3 + 0.7 * smooth(0, 1, arrive);
    const u = hair.uniforms;
    const timeScale = reducedMotion ? 0.35 : 1;
    const t = time * timeScale;

    // Pointer parallax
    pointerSmooth.lerp(pointer, 1 - Math.exp(-dt * 3));

    camera.position.set(
      k.cam[0] + pointerSmooth.x * 0.35,
      k.cam[1] + pointerSmooth.y * 0.22,
      k.cam[2],
    );
    look.set(k.look[0], k.look[1], k.look[2]);
    camera.lookAt(look);

    lock.position.set(k.lock[0], k.lock[1], k.lock[2]);
    // Portrait screens: lift the hero lock into the open space above the headline
    if (camera.aspect < 0.85) {
      const hero = 1 - smooth(0.45, 1.0, T);
      lock.position.x += -1.4 * hero;
      lock.position.y += 3.6 * hero;
    }
    lock.rotation.set(k.rot[0], k.rot[1], k.rot[2]);
    lock.updateMatrixWorld();

    // eased scroll speed: drives a gentle wind gust, never a jitter
    scrollSpeed += (Math.min(Math.abs(velocity), 3) - scrollSpeed) * (1 - Math.exp(-dt * 3));
    const speed = scrollSpeed;
    u.uTime.value = t;
    u.uLen.value = k.len * grow;
    u.uSpread.value = k.spread;
    u.uWave.value = k.wave;
    u.uWind.value = k.wind + speed * 0.2;
    u.uTwist.value = k.twist;
    u.uCurl.value = clamp01(k.curl);
    u.uClump.value = clamp01(k.clump);
    u.uRing.value = clamp01(k.ring);
    // portrait screens: a wider ring keeps its sides off-screen, clear of the text
    u.uRingR.value = k.ringR * (camera.aspect < 0.85 ? 1.28 : 1);
    u.uOpacity.value = k.op * OPACITY_SCALE * density * smooth(0, 0.45, arrive);
    u.uExposure.value = k.exp;

    /* 01 · The snip ------------------------------------------------ */
    const c = T - 1;
    const SNIP = 0.355;
    const cutX = 0.9;
    const cutOn = T >= 1 + SNIP ? 1 : 0;
    u.uCutOn.value = cutOn;
    u.uFall.value = cutOn ? smooth(SNIP, SNIP + 0.32, c) : 0;
    u.uCutGlow.value = cutOn ? Math.exp(-Math.max(0, c - SNIP) * 14) : 0;
    u.uRecoil.value = cutOn ? Math.sin(clamp01((c - SNIP) / 0.22) * Math.PI) * 0.6 : 0;

    const sc = scissors.group;
    sc.visible = c > -0.08 && c < 0.72;
    if (sc.visible) {
      const fly = smooth(-0.08, 0.15, c);
      const lower = smooth(0.15, 0.31, c);
      const exit = smooth(0.43, 0.7, c);
      const breathe = Math.sin(t * 2.4) * 0.03;
      // path: off-screen → hover → cut → away
      v3.set(lerp(5.5, cutX + 0.3, fly), lerp(4.2, 1.85, fly), lerp(1.8, 0.8, fly));
      v3.x = lerp(v3.x, cutX, lower);
      v3.y = lerp(v3.y, 0.98, lower) + breathe * (1 - lower);
      v3.z = lerp(v3.z, 0.62, lower);
      v3.x = lerp(v3.x, cutX - 4.6, exit);
      v3.y = lerp(v3.y, 3.9, exit);
      v3.z = lerp(v3.z, 1.4, exit);
      sc.position.copy(v3);
      const rz = -Math.PI / 2 + lerp(1.3, 0.22, fly) - 0.14 * lower - 1.1 * exit;
      const ry = lerp(-1.0, -0.55, fly) + 0.85 * exit;
      sc.rotation.set(lerp(0.4, 0.08, fly), ry, rz);
      const snip = easeInCubic(smooth(0.315, 0.36, c));
      const open = 0.64 * smooth(-0.05, 0.12, c) * (1 - snip) + 0.18 * smooth(0.5, 0.65, c);
      scissors.setOpen(open + (1 - snip) * Math.sin(t * 3.1) * 0.025 * lower);
      sc.scale.setScalar(0.56);
    }

    /* 02 · Dye drops ------------------------------------------------ */
    const cc = T - 2;
    const dropXs = [5.2, 4.3, 3.4, 2.5, 1.7];
    drops.forEach((m, i) => {
      const start = 0.02 + i * 0.075;
      const p = (cc - start) / 0.1;
      if (p < 0 || p > 1.35) { m.visible = false; return; }
      m.visible = true;
      v3b.set(dropXs[i], (i % 2 ? 0.25 : -0.2), (i % 3 - 1) * 0.3);
      lock.localToWorld(v3b);
      const fall = Math.min(p, 1);
      const e = fall * fall;
      m.position.set(v3b.x + (1 - e) * 0.6, v3b.y + (1 - e) * 4.6, v3b.z + (1 - e) * 0.5);
      const absorb = smooth(1, 1.35, p);
      const stretch = 1 + fall * 0.45 * (1 - absorb);
      const s = (1 - absorb) * (0.85 + 0.15 * Math.sin(p * 9));
      m.scale.set(s / Math.sqrt(stretch), s * stretch, s / Math.sqrt(stretch));
    });
    u.uDye.value = smooth(0.06, 0.52, cc);
    u.uSheen.value = smooth(0.03, 0.12, cc) * (1 - smooth(0.42, 0.62, cc));

    /* Particles & light --------------------------------------------- */
    const visLen = k.len * grow * (cutOn ? 0.56 : 1) * (1 - 0.3 * u.uCurl.value);
    v3.set(visLen * 0.55, 0, 0);
    lock.localToWorld(v3);
    sparks.uniforms.uOrigin.value.copy(v3).add(v3b.set(0, -0.6, 0));
    sparks.uniforms.uSpan.value.set(visLen * 0.9, 1.4, 2.2);
    if (u.uRing.value > 0.5) sparks.uniforms.uSpan.value.set(5.2, 4.6, 1.5);
    sparks.uniforms.uIntensity.value = k.sparks;
    sparks.uniforms.uTime.value = t;
    dust.uniforms.uTime.value = t;
    dust.uniforms.uOpacity.value = k.dust;

    bgMat.uniforms.uGlow.value.setRGB(k.glow[0], k.glow[1], k.glow[2]);
    bgMat.uniforms.uTime.value = t;
    bloom.strength = k.bloom * BLOOM_SCALE * (1 + 0.5 * Math.sin(arrive * Math.PI)); // a soft swell as it arrives
    finish.uniforms.uTime.value = time;
    finish.uniforms.uAberration.value = Math.min(0.006, speed * 0.0025);
  }

  function render() {
    composer.render();
  }

  // Adaptive quality, measured against this display's own refresh rate:
  // if frames run noticeably slower than the screen, step down gently.
  let frames = 0;
  let acc = 0;
  let warm = 0;
  let minDt = Infinity;
  function reportFrame(ms) {
    if (capture) return;
    if (warm < 90) { warm++; return; } // ignore start-up work
    minDt = Math.min(minDt, Math.max(ms, 4));
    frames++;
    acc += ms;
    if (frames < 60) return;
    const avg = acc / frames;
    frames = 0;
    acc = 0;
    if (avg <= Math.max(minDt * 1.2, 11)) return;
    if (dpr > 1) {
      dpr = Math.max(1, Math.round((dpr - 0.25) * 100) / 100);
      renderer.setPixelRatio(dpr);
      resize();
    } else if (strandCount > 1100) {
      strandCount = Math.round(strandCount * 0.75);
      hair.setStrandCount(strandCount);
      density = Math.min(1.6, refStrands / strandCount);
    } else if (bloom.enabled) {
      bloom.enabled = false;
    }
  }

  // Compile every shader up front, including objects that start hidden
  // (shears, dye drops, photo ring), so nothing stalls mid-scroll. Uses the
  // browser's parallel compile when available, off the main thread.
  async function warmUp() {
    const hidden = [scissors.group, ...drops].filter((o) => !o.visible);
    hidden.forEach((o) => { o.visible = true; });
    try {
      const parallel = renderer.extensions.has('KHR_parallel_shader_compile');
      if (parallel && renderer.compileAsync) await renderer.compileAsync(scene, camera);
      else renderer.compile(scene, camera); // still up front, while the canvas is hidden
    } catch (err) {
      console.warn('shader warm-up skipped:', err);
    }
    hidden.forEach((o) => { o.visible = false; });
  }

  return {
    renderer,
    ready: warmUp(),
    resize,
    update,
    render,
    reportFrame,
    setPointer(x, y) { pointer.set(x, y); },
  };
}
