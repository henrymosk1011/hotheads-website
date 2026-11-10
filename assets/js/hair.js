/**
 * Hair: a lock of a few thousand strands, simulated entirely on the GPU.
 *
 * Every strand is a camera-facing ribbon. Its shape is computed in the vertex
 * shader from a handful of uniforms, so the whole lock can be cut, dyed,
 * curled, fanned out or wrapped into a halo just by tweening numbers.
 * Shading is a Kajiya–Kay style anisotropic highlight, the classic
 * "silk sheen" model for hair.
 */
import * as THREE from 'three';

const vertexShader = /* glsl */ `
  precision highp float;

  attribute vec4 aA;   // clump radius, clump angle, local radius, local angle
  attribute vec4 aB;   // seed 1, seed 2, width multiplier, clump seed

  uniform float uTime;
  uniform float uLen;
  uniform float uWave;
  uniform float uWind;
  uniform float uSpread;
  uniform float uTwist;
  uniform float uCurl;
  uniform float uClump;
  uniform float uDroop;
  uniform float uRing;
  uniform float uRingR;
  uniform float uCutOn;
  uniform float uCutT;
  uniform float uFall;
  uniform float uRecoil;
  uniform float uWidth;
  uniform float uPixel;
  uniform float uSegments;

  varying vec3 vTangent;
  varying vec3 vView;
  varying float vT;
  varying float vAlpha;
  varying float vSide;
  varying vec4 vSeed;

  vec3 spine(float x) {
    float a = smoothstep(0.0, 3.2, x);
    float recoil = 1.0 + uRecoil * 1.6;
    float y = sin(x * 0.55 - uTime * 1.05) * 0.55 * a * recoil
            + sin(x * 1.25 - uTime * 1.60 + 1.3) * 0.14 * a;
    float z = sin(x * 0.38 - uTime * 0.75 + 2.0) * 0.65 * a;
    return vec3(x, y * uWave - x * x * 0.012 * uDroop, z * uWave);
  }

  vec3 strandPos(float t) {
    float L = uLen * (0.95 + 0.1 * aB.x);
    float x = t * L * (1.0 - 0.3 * uCurl);

    // Frame along the spine
    vec3 P = spine(x);
    vec3 T = normalize(spine(x + 0.06) - P);
    vec3 N = normalize(cross(vec3(0.0, 0.0, 1.0), T));
    vec3 B = cross(T, N);

    // Cross-section: strands live in clumps, clumps fan out toward the tips
    float ca = aA.y + t * uTwist + uTime * 0.05;
    vec2 cdir = vec2(cos(ca), sin(ca));
    float fan = (0.3 + 1.12 * pow(t, 1.2)) * (1.0 + uSpread);
    vec2 clump = cdir * aA.x * fan;
    float la = aA.w + t * 2.0 * aB.y;
    vec2 loc = vec2(cos(la), sin(la)) * aA.z * (0.12 + 0.55 * t) * (1.0 - 0.82 * uClump) * (1.0 + 0.6 * uSpread);

    // Wind: coherent per clump, plus a little per-strand flutter
    float cs = aB.w * 40.0;
    vec2 wind = vec2(sin(uTime * 1.3 + cs + x * 0.7), cos(uTime * 1.1 + cs * 1.3 + x * 0.55)) * 0.16 * t * t * uWind;
    wind += vec2(sin(uTime * 2.1 + aB.x * 50.0 + x * 1.7), cos(uTime * 1.9 + aB.y * 50.0 + x * 1.4)) * 0.035 * t * uWind;

    // Ringlets: each clump spirals as a unit, strands add a tighter coil
    float k = smoothstep(0.04, 0.3, t) * uCurl;
    float ra = x * (4.2 + 2.0 * aB.w) + aB.w * 6.2831;
    vec2 curl = vec2(cos(ra), sin(ra)) * 0.26 * k * (0.7 + 0.6 * aB.w);
    float sa = x * (14.0 + 6.0 * aB.y) + aB.x * 6.2831;
    curl += vec2(cos(sa), sin(sa)) * 0.035 * k;

    vec2 off = clump + loc + wind + curl;
    vec3 lockP = P + N * off.x + B * off.y;

    // Halo: wrap the (visible part of the) lock into a ring
    if (uRing > 0.001) {
      float Lv = uLen * mix(1.0, uCutT, uCutOn) * (1.0 - 0.3 * uCurl);
      float th = (x / max(Lv, 0.001)) * 6.2831 * 0.97 + aB.w * 0.4 + uTime * 0.12 + 1.5708;
      vec3 rn = vec3(cos(th), sin(th), 0.0);
      vec2 ro = cdir * aA.x * 0.34 * (1.0 + 0.4 * uSpread) + loc * 0.45 + wind * 0.6 + curl * 0.8;
      vec3 ringP = rn * uRingR + rn * ro.x + vec3(0.0, 0.0, 1.0) * ro.y;
      lockP = mix(lockP, ringP, uRing);
    }
    return lockP;
  }

  void main() {
    float t = position.x;
    float side = position.y;
    float step1 = 0.5 / uSegments;
    float t1 = t < 0.999 ? t + step1 : t - step1;

    vec4 w0 = modelMatrix * vec4(strandPos(t), 1.0);
    vec4 w1 = modelMatrix * vec4(strandPos(t1), 1.0);

    // Cut: everything past the cut line drops away in world space
    float cutT = uCutT + (aB.y - 0.5) * 0.035;
    float isCut = uCutOn * step(cutT, t);
    vec3 fall = vec3(
      (aB.y - 0.35) * 1.3 * uFall,
      -uFall * uFall * 5.5 * (0.75 + 0.5 * aB.x) - uFall * 0.4,
      (aB.x - 0.5) * 1.6 * uFall
    );
    fall.y += sin(uFall * 7.0 + aB.x * 12.0) * 0.12 * uFall;
    w0.xyz += fall * isCut;
    w1.xyz += fall * isCut;

    vec3 T = normalize((w1.xyz - w0.xyz) * (t < 0.999 ? 1.0 : -1.0));
    vec3 V = normalize(cameraPosition - w0.xyz);
    vec3 S = normalize(cross(T, V));

    // Keep strands at least ~1px wide and fade them instead (clean thin lines)
    float dist = length(cameraPosition - w0.xyz);
    float width = uWidth * aB.z * (1.0 - 0.55 * t);
    float minW = uPixel * dist * 1.15;
    float a = 1.0;
    if (width < minW) { a = width / minW; width = minW; }

    vec3 wp = w0.xyz + S * side * width * 0.5;
    gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);

    float segT = 1.0 / uSegments;
    float boundary = uCutOn * (isCut > 0.5 ? step(t - segT, cutT) : step(cutT, t + segT));
    float tipFade = 1.0 - smoothstep(0.8, 1.0, t);
    float rootFade = smoothstep(0.0, 0.18, t);
    float cutVis = 1.0 - isCut * smoothstep(0.3, 1.0, uFall);

    vAlpha = a * tipFade * rootFade * cutVis * (1.0 - boundary);
    vTangent = T;
    vView = V;
    vT = t;
    vSide = side;
    vSeed = aB;
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;

  uniform vec3 uRootA;
  uniform vec3 uMidA;
  uniform vec3 uTipA;
  uniform vec3 uRootB;
  uniform vec3 uMidB;
  uniform vec3 uTipB;
  uniform vec3 uSpecCol;
  uniform vec3 uRimCol;
  uniform vec3 uGlowCol;
  uniform vec3 uL1;
  uniform vec3 uL2;
  uniform float uDye;
  uniform float uSheen;
  uniform float uCutOn;
  uniform float uCutT;
  uniform float uCutGlow;
  uniform float uOpacity;
  uniform float uExposure;

  varying vec3 vTangent;
  varying vec3 vView;
  varying float vT;
  varying float vAlpha;
  varying float vSide;
  varying vec4 vSeed;

  vec3 grad(vec3 a, vec3 b, vec3 c, float t) {
    return t < 0.5 ? mix(a, b, t * 2.0) : mix(b, c, t * 2.0 - 1.0);
  }

  void main() {
    if (vAlpha < 0.002) discard;
    // colour runs root → tip over whatever length is left after the cut
    float t = clamp(vT / mix(1.0, uCutT, uCutOn), 0.0, 1.0);

    // Balayage: new colour is painted from the tips up, in uneven sections
    float jitter = (vSeed.x - 0.5) * 0.22 + (vSeed.w - 0.5) * 0.2;
    float edge = 1.05 - uDye * 0.85;
    float dyed = smoothstep(edge - 0.1, edge + 0.1, t + jitter);
    vec3 base = mix(grad(uRootA, uMidA, uTipA, t), grad(uRootB, uMidB, uTipB, t), dyed);
    base *= 0.72 + 0.56 * vSeed.y;

    vec3 T = normalize(vTangent);
    vec3 V = normalize(vView);
    vec3 L1 = normalize(uL1);
    vec3 L2 = normalize(uL2);

    float tl = dot(T, L1);
    float diff = sqrt(max(0.0, 1.0 - tl * tl));
    vec3 H1 = normalize(L1 + V);
    float th1 = dot(T, H1);
    float spec1 = pow(sqrt(max(0.0, 1.0 - th1 * th1)), 140.0);
    vec3 H2 = normalize(L2 + V);
    float th2 = dot(T, H2);
    float spec2 = pow(sqrt(max(0.0, 1.0 - th2 * th2)), 36.0);

    vec3 col = base * (0.3 + 0.85 * diff) * uExposure;
    col += uSpecCol * spec1 * 0.62;
    col += (base * 1.3 + uRimCol * 0.45) * spec2 * 0.5;

    // Wet sheen riding the dye front
    float front = exp(-pow((t + jitter - edge) * 9.0, 2.0)) * uSheen;
    col += uRimCol * front * 1.4;

    // The cut edge flares hot for a moment after the snip
    col += uGlowCol * uCutOn * uCutGlow * exp(-abs(vT - uCutT) * 48.0) * 7.0;

    float a = vAlpha * uOpacity * (1.0 - vSide * vSide * 0.5);
    gl_FragColor = vec4(col, a);
  }
`;

export function createHair({ strands = 2600, segments = 56, length = 10 } = {}) {
  const vertsPerStrand = (segments + 1) * 2;
  const total = strands * vertsPerStrand;
  const position = new Float32Array(total * 3);
  const aA = new Float32Array(total * 4);
  const aB = new Float32Array(total * 4);
  const index = new Uint32Array(strands * segments * 6);

  const CLUMPS = 96;
  const clumps = Array.from({ length: CLUMPS }, () => ({
    r: Math.sqrt(Math.random()),
    a: Math.random() * Math.PI * 2,
    seed: Math.random(),
  }));

  let v = 0;
  let ii = 0;
  for (let s = 0; s < strands; s++) {
    const c = clumps[(Math.random() * CLUMPS) | 0];
    const flyaway = Math.random() < 0.03;
    const lr = Math.sqrt(Math.random()) * (flyaway ? 0.95 : 0.22);
    const la = Math.random() * Math.PI * 2;
    const s1 = Math.random();
    const s2 = Math.random();
    const w = 0.55 + Math.random() * 0.95;
    const first = v;
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      for (let side = -1; side <= 1; side += 2) {
        position[v * 3] = t;
        position[v * 3 + 1] = side;
        const o = v * 4;
        aA[o] = c.r; aA[o + 1] = c.a; aA[o + 2] = lr; aA[o + 3] = la;
        aB[o] = s1; aB[o + 1] = s2; aB[o + 2] = w; aB[o + 3] = c.seed;
        v++;
      }
    }
    for (let i = 0; i < segments; i++) {
      const a = first + i * 2;
      index[ii++] = a; index[ii++] = a + 1; index[ii++] = a + 2;
      index[ii++] = a + 1; index[ii++] = a + 3; index[ii++] = a + 2;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('aA', new THREE.BufferAttribute(aA, 4));
  geometry.setAttribute('aB', new THREE.BufferAttribute(aB, 4));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));

  const c = (hex) => new THREE.Color(hex);
  const uniforms = {
    uTime: { value: 0 },
    uLen: { value: length },
    uWave: { value: 1 },
    uWind: { value: 1 },
    uSpread: { value: 0 },
    uTwist: { value: 0 },
    uCurl: { value: 0 },
    uClump: { value: 0 },
    uDroop: { value: 0 },
    uRing: { value: 0 },
    uRingR: { value: 2.6 },
    uCutOn: { value: 0 },
    uCutT: { value: 0.56 },
    uFall: { value: 0 },
    uRecoil: { value: 0 },
    uWidth: { value: 0.012 },
    uPixel: { value: 0.001 },
    uSegments: { value: segments },
    // Before: the purple of the salon's mural. After: hot tips.
    uRootA: { value: c('#2a0b4a') },
    uMidA: { value: c('#7b2cbf') },
    uTipA: { value: c('#c77dff') },
    uRootB: { value: c('#3a0f5c') },
    uMidB: { value: c('#ff2e88') },
    uTipB: { value: c('#ffb36b') },
    uSpecCol: { value: c('#fff3ea') },
    uRimCol: { value: c('#ff5fb0') },
    uGlowCol: { value: c('#ff7a2e') },
    uL1: { value: new THREE.Vector3(0.4, 1.0, 0.7) },
    uL2: { value: new THREE.Vector3(-0.8, -0.2, -0.6) },
    uDye: { value: 0 },
    uSheen: { value: 0 },
    uCutGlow: { value: 0 },
    uOpacity: { value: 0.4 },
    uExposure: { value: 1 },
  };

  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 10;

  const indicesPerStrand = segments * 6;
  return {
    mesh,
    uniforms,
    strands,
    setStrandCount(n) {
      geometry.setDrawRange(0, Math.min(n, strands) * indicesPerStrand);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
