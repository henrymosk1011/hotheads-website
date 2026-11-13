/**
 * Ambient light dust plus "heat" sparks that rise off the hair while it is
 * being styled. Both are single draw calls animated in the vertex shader.
 */
import * as THREE from 'three';

const dustVert = /* glsl */ `
  attribute vec4 aSeed;
  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uSize;
  varying float vTwinkle;
  varying float vHue;
  void main() {
    vec3 p = position;
    p.x += sin(uTime * 0.11 + aSeed.x * 20.0) * 0.6;
    p.y = mod(p.y + uTime * (0.05 + aSeed.y * 0.12) + 6.0, 12.0) - 6.0;
    p.z += cos(uTime * 0.09 + aSeed.z * 20.0) * 0.5;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = min(uSize * (0.4 + aSeed.w * 1.6) * uPixelRatio * (10.0 / -mv.z), 22.0 * uPixelRatio);
    // fade out motes that drift right up to the lens
    vTwinkle = (0.45 + 0.55 * sin(uTime * (0.6 + aSeed.x * 2.0) + aSeed.y * 30.0)) * smoothstep(2.5, 5.0, -mv.z);
    vHue = aSeed.z;
  }
`;

const dustFrag = /* glsl */ `
  uniform float uOpacity;
  uniform vec3 uColA;
  uniform vec3 uColB;
  varying float vTwinkle;
  varying float vHue;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d);
    a *= a;
    gl_FragColor = vec4(mix(uColA, uColB, vHue), a * vTwinkle * uOpacity);
  }
`;

const sparkVert = /* glsl */ `
  attribute vec4 aSeed;
  uniform float uTime;
  uniform float uPixelRatio;
  uniform vec3 uOrigin;
  uniform vec3 uSpan;
  varying float vLife;
  varying float vSeed;
  void main() {
    float life = fract(uTime * (0.12 + aSeed.w * 0.18) + aSeed.x);
    vec3 p = uOrigin + (aSeed.xyz - 0.5) * uSpan;
    p.y += life * 3.6;
    p.x += sin(life * 6.0 + aSeed.y * 20.0) * 0.35 * life;
    p.z += cos(life * 5.0 + aSeed.z * 20.0) * 0.35 * life;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = min((2.0 + aSeed.w * 4.0) * uPixelRatio * (10.0 / -mv.z) * (1.0 - life * 0.6), 14.0 * uPixelRatio);
    vLife = life;
    vSeed = aSeed.y;
  }
`;

const sparkFrag = /* glsl */ `
  uniform float uIntensity;
  uniform vec3 uColA;
  uniform vec3 uColB;
  varying float vLife;
  varying float vSeed;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.05, d);
    float fade = sin(vLife * 3.14159);
    vec3 col = mix(uColA, uColB, vLife * 0.8 + vSeed * 0.2);
    gl_FragColor = vec4(col * 2.0, a * fade * uIntensity);
  }
`;

function seeds(n, spread) {
  const pos = new Float32Array(n * 3);
  const seed = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = (Math.random() - 0.5) * spread[0];
    pos[i * 3 + 1] = (Math.random() - 0.5) * spread[1];
    pos[i * 3 + 2] = (Math.random() - 0.5) * spread[2];
    for (let k = 0; k < 4; k++) seed[i * 4 + k] = Math.random();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
  return g;
}

export function createDust(count = 420) {
  const material = new THREE.ShaderMaterial({
    vertexShader: dustVert,
    fragmentShader: dustFrag,
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: 1 },
      uSize: { value: 6 },
      uOpacity: { value: 0.5 },
      uColA: { value: new THREE.Color('#b98cff') },
      uColB: { value: new THREE.Color('#ffb08a') },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(seeds(count, [22, 12, 12]), material);
  points.frustumCulled = false;
  points.renderOrder = 20;
  return { points, uniforms: material.uniforms };
}

export function createSparks(count = 520) {
  const material = new THREE.ShaderMaterial({
    vertexShader: sparkVert,
    fragmentShader: sparkFrag,
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: 1 },
      uOrigin: { value: new THREE.Vector3() },
      uSpan: { value: new THREE.Vector3(5, 1.6, 2.4) },
      uIntensity: { value: 0 },
      uColA: { value: new THREE.Color('#ffcf8a') },
      uColB: { value: new THREE.Color('#ff3d7f') },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(seeds(count, [1, 1, 1]), material);
  points.frustumCulled = false;
  points.renderOrder = 21;
  return { points, uniforms: material.uniforms };
}
