/**
 * Gallery ring — the salon's real photos on curved panels that orbit the
 * hair. Panels bend with scroll velocity and split RGB slightly when moving
 * fast, which is what gives it the "motion graphics" feel.
 */
import * as THREE from 'three';

const vertexShader = /* glsl */ `
  uniform float uVel;
  uniform float uRadius;
  varying vec2 vUv;
  varying float vFacing;
  void main() {
    vUv = uv;
    vec3 p = position;
    // flutter panels a little when the ring spins quickly
    p.y += sin(uv.x * 3.14159) * uVel * 0.35;
    vec4 world = modelMatrix * vec4(p, 1.0);
    vec3 n = normalize(mat3(modelMatrix) * normalize(vec3(position.x, 0.0, position.z)));
    vFacing = dot(n, normalize(cameraPosition - world.xyz));
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uImgAspect;
  uniform float uPlaneAspect;
  uniform float uOpacity;
  uniform float uVel;
  varying vec2 vUv;
  varying float vFacing;

  float roundRect(vec2 uv, vec2 size, float r) {
    vec2 q = abs(uv - 0.5) * size - (size * 0.5 - r);
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  }

  void main() {
    // object-fit: cover
    vec2 uv = vUv;
    if (uImgAspect > uPlaneAspect) {
      uv.x = (uv.x - 0.5) * (uPlaneAspect / uImgAspect) + 0.5;
    } else {
      uv.y = (uv.y - 0.5) * (uImgAspect / uPlaneAspect) + 0.5;
    }
    if (!gl_FrontFacing) uv.x = 1.0 - uv.x;

    float shift = uVel * 0.012;
    vec3 col;
    col.r = texture2D(uMap, uv + vec2(shift, 0.0)).r;
    col.g = texture2D(uMap, uv).g;
    col.b = texture2D(uMap, uv - vec2(shift, 0.0)).b;

    float d = roundRect(vUv, vec2(uPlaneAspect, 1.0), 0.06);
    float mask = 1.0 - smoothstep(-0.004, 0.004, d);

    float front = smoothstep(-0.35, 0.55, vFacing);
    col *= mix(0.2, 0.8, front);
    col = mix(col, col * vec3(0.75, 0.6, 1.0), (1.0 - front) * 0.6);

    float a = mask * uOpacity * mix(0.35, 1.0, front);
    if (a < 0.01) discard;
    gl_FragColor = vec4(col, a);
    #include <colorspace_fragment>
  }
`;

export function createGallery(textures, { radius = 5.4, height = 1.75, aspect = 1.5 } = {}) {
  const group = new THREE.Group();
  const panels = [];
  const width = height * aspect;
  const count = textures.length;
  const shared = { uVel: { value: 0 }, uOpacity: { value: 0 } };

  textures.forEach((tex, i) => {
    const seg = 40;
    const geo = new THREE.PlaneGeometry(width, height, seg, 1);
    const pos = geo.attributes.position;
    const slot = (i / count) * Math.PI * 2;
    for (let k = 0; k < pos.count; k++) {
      const x = pos.getX(k);
      const phi = slot + x / radius;
      pos.setXYZ(k, Math.sin(phi) * radius, pos.getY(k) + (i % 2 ? 0.35 : -0.35), Math.cos(phi) * radius);
    }
    pos.needsUpdate = true;

    const img = tex.image;
    const imgAspect = img && img.width ? img.width / img.height : 1.5;
    const mat = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uMap: { value: tex },
        uImgAspect: { value: imgAspect },
        uPlaneAspect: { value: aspect },
        uOpacity: shared.uOpacity,
        uVel: shared.uVel,
        uRadius: { value: radius },
      },
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: true,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 5;
    group.add(mesh);
    panels.push(mesh);
  });

  group.visible = false;
  return {
    group,
    uniforms: shared,
    setTextureImage(i, tex) {
      const m = panels[i];
      if (!m) return;
      m.material.uniforms.uMap.value = tex;
      if (tex.image) m.material.uniforms.uImgAspect.value = tex.image.width / tex.image.height;
    },
  };
}
