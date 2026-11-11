// The scroll film, drawn into one canvas:
//   1. the entry clip (storefront -> door -> inside) as an image sequence, then
//   2. a 3D walk into the salon's real interior photo, projected onto a box room.
// The clip's last frame is an exact crop of that photo, so the hand-off is seamless.

const FRAMES = 94;

// Interior photo (pixels) and the camera it was taken with, measured from the photo:
// vanishing point (CX, CY) and focal length F.
const IW = 1767, IH = 1176, CX = 942, CY = 616, F = 1000;
// The room as a box in metres around that camera, which looks down -Z.
const X0 = -2.80, X1 = 2.90, Y0 = -1.32, Y1 = 2.08, Z0 = -16.3, Z1 = 1.0;
// The clip's last frame is this window of the photo (found by image matching):
// centred on (950, 572), at 1080 / 1920 photo pixels per clip pixel.
const HX = 950, HY = 572, HS = 1080 / 1920;
// How far the camera walks into the room (metres).
const DOLLY = 2.3;

const SETS = {
  // landscape frames cover the full 1920x1080 clip
  d: { dir: '/v2/assets/film/d/', w: 1920, h: 1080 },
  // portrait frames are the centre 608x1080 of the clip
  m: { dir: '/v2/assets/film/m/', w: 608, h: 1080 },
};

const GRADE = `
uniform vec2 uRes;
vec3 grade(vec3 c) {
  vec2 q = gl_FragCoord.xy / uRes;
  c *= 0.9;
  c = mix(c, c * c * (3.0 - 2.0 * c), 0.35);            // gentle S-curve
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(c, c * vec3(1.03, 0.95, 1.08), (1.0 - l) * 0.6); // violet shadows
  vec2 v = (q - 0.5) * vec2(1.0, 1.1);
  c *= mix(0.6, 1.0, smoothstep(0.85, 0.25, length(v)));  // vignette
  return c;
}`;

const IMG_VS = `#version 300 es
in vec2 aPos; out vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;
const IMG_FS = `#version 300 es
precision highp float;
uniform sampler2D uA, uB; uniform float uMix, uAlpha; uniform vec2 uFit;
in vec2 vUv; out vec4 o;
${GRADE}
void main() {
  vec2 uv = vec2(0.5 + (vUv.x - 0.5) * uFit.x, 0.5 - (vUv.y - 0.5) * uFit.y);
  vec3 c = mix(texture(uA, uv).rgb, texture(uB, uv).rgb, uMix);
  o = vec4(grade(c), uAlpha);
}`;
const ROOM_VS = `#version 300 es
in vec3 aPos; uniform mat4 uProj, uView; out vec3 vW;
void main() { vW = aPos; gl_Position = uProj * uView * vec4(aPos, 1.0); }`;
const ROOM_FS = `#version 300 es
precision highp float;
uniform sampler2D uPhoto; in vec3 vW; out vec4 o;
${GRADE}
void main() {
  // project this point of the room back into the original photo
  float d = max(-vW.z, 1e-3);
  vec2 px = vec2(${CX.toFixed(1)} + ${F.toFixed(1)} * vW.x / d, ${CY.toFixed(1)} - ${F.toFixed(1)} * vW.y / d);
  vec2 uv = clamp(px / vec2(${IW.toFixed(1)}, ${IH.toFixed(1)}), 0.0, 1.0);
  o = vec4(grade(texture(uPhoto, uv).rgb), 1.0);
}`;

function boxTriangles() {
  // the five inside faces we can ever see (the face behind the camera is left out)
  const c = [
    [X0, Y0, Z0], [X1, Y0, Z0], [X1, Y1, Z0], [X0, Y1, Z0], // back
    [X0, Y0, Z1], [X1, Y0, Z1], [X1, Y1, Z1], [X0, Y1, Z1], // front
  ];
  const quads = [[0, 1, 2, 3], [0, 4, 5, 1], [3, 2, 6, 7], [0, 3, 7, 4], [1, 5, 6, 2]];
  const out = [];
  for (const [a, b, cc, d] of quads) out.push(...c[a], ...c[b], ...c[cc], ...c[a], ...c[cc], ...c[d]);
  return new Float32Array(out);
}

const ease = (t) => t * t * (3 - 2 * t);

export function createFilm(canvas, { onFirstFrame } = {}) {
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: true, depth: false, powerPreference: 'high-performance' });
  const ctx = gl ? null : canvas.getContext('2d', { alpha: false });
  let set = null, frames = [], photo = null, dirty = true, dead = false;
  let state = { clip: 0, room: 0, mix: 0 };
  let W = 0, H = 0;

  // ---------- WebGL setup ----------
  let img, room, texA, texB, texPhoto, inA = -1, inB = -1, triBuf, boxBuf, boxCount;
  function program(vs, fs) {
    const p = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      gl.attachShader(p, s);
    }
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const name = gl.getActiveUniform(p, i).name; u[name] = gl.getUniformLocation(p, name); }
    return { p, u, a: gl.getAttribLocation(p, 'aPos') };
  }
  function texture() {
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  if (gl) {
    img = program(IMG_VS, IMG_FS);
    room = program(ROOM_VS, ROOM_FS);
    triBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, triBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const box = boxTriangles(); boxCount = box.length / 3;
    boxBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, boxBuf);
    gl.bufferData(gl.ARRAY_BUFFER, box, gl.STATIC_DRAW);
    texA = texture(); texB = texture(); texPhoto = texture();
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); dead = true; });
  }

  // ---------- loading ----------
  async function bitmap(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(url);
    return createImageBitmap(await r.blob());
  }
  function loadSet(key) {
    if (set && set.key === key) return;
    set = { key, ...SETS[key] }; frames = new Array(FRAMES).fill(null); inA = inB = -1; dirty = true;
    const mine = set;
    // coarse to fine, so the whole film is scrubbable early and sharpens as it loads
    const order = [0]; const seen = new Set(order);
    for (const step of [16, 8, 4, 2, 1]) for (let i = 0; i < FRAMES; i += step) if (!seen.has(i)) { seen.add(i); order.push(i); }
    if (!seen.has(FRAMES - 1)) order.splice(1, 0, FRAMES - 1);
    let next = 0;
    const worker = async () => {
      while (next < order.length && set === mine) {
        const i = order[next++];
        try {
          frames[i] = await bitmap(`${mine.dir}${String(i).padStart(3, '0')}.webp`);
          if (i === 0 && onFirstFrame) onFirstFrame();
          dirty = true;
        } catch { /* a missing frame is skipped; neighbours cover it */ }
      }
    };
    for (let k = 0; k < 6; k++) worker();
  }
  bitmap('/v2/assets/img/room.webp').then((b) => {
    photo = b;
    if (gl) {
      gl.bindTexture(gl.TEXTURE_2D, texPhoto);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, b);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      const an = gl.getExtension('EXT_texture_filter_anisotropic');
      if (an) gl.texParameterf(gl.TEXTURE_2D, an.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(an.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
    }
    dirty = true;
  }).catch(() => {});

  // ---------- geometry of what's on screen ----------
  // the part of the clip (in clip pixels) that a cover-fit shows at this aspect ratio
  function visible() {
    const a = W / H, s = SETS[set.key];
    return a >= s.w / s.h ? { w: s.w, h: s.w / a } : { w: s.h * a, h: s.h };
  }
  function nearest(i, dir) {
    for (let k = i; k >= 0 && k < FRAMES; k += dir) if (frames[k]) return k;
    for (let k = i; k >= 0 && k < FRAMES; k -= dir) if (frames[k]) return k;
    return -1;
  }

  function resize(dpr) {
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (w === canvas.width && h === canvas.height && W) return;
    canvas.width = w; canvas.height = h; W = w; H = h; dirty = true;
    loadSet(canvas.clientWidth / canvas.clientHeight < 1 ? 'm' : 'd');
  }

  function set_(next) {
    if (next.clip !== state.clip || next.room !== state.room || next.mix !== state.mix) { state = { ...next }; dirty = true; }
  }

  // ---------- drawing ----------
  function drawClipGL(alpha) {
    const pos = state.clip * (FRAMES - 1);
    const a = nearest(Math.floor(pos), -1); if (a < 0) return false;
    const b = nearest(Math.min(FRAMES - 1, Math.ceil(pos)), 1);
    const mix = b > a ? Math.min(1, Math.max(0, (pos - a) / (b - a))) : 0;
    // keep the two frames in two textures, uploading only what changed
    if (inA !== a) { if (inB === a) { [texA, texB] = [texB, texA]; [inA, inB] = [inB, inA]; } else { gl.bindTexture(gl.TEXTURE_2D, texA); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frames[a]); inA = a; } }
    if (inB !== b) { gl.bindTexture(gl.TEXTURE_2D, texB); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frames[b]); inB = b; }
    const v = visible(), s = SETS[set.key];
    gl.useProgram(img.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texA); gl.uniform1i(img.u.uA, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, texB); gl.uniform1i(img.u.uB, 1);
    gl.uniform1f(img.u.uMix, mix); gl.uniform1f(img.u.uAlpha, alpha);
    gl.uniform2f(img.u.uFit, v.w / s.w, v.h / s.h);
    gl.uniform2f(img.u.uRes, W, H);
    gl.bindBuffer(gl.ARRAY_BUFFER, triBuf);
    gl.enableVertexAttribArray(img.a); gl.vertexAttribPointer(img.a, 2, gl.FLOAT, false, 0, 0);
    if (alpha < 1) gl.enable(gl.BLEND); else gl.disable(gl.BLEND);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return true;
  }
  function drawRoomGL() {
    if (!photo) return false;
    const v = visible();
    const ww = v.w * HS, wh = v.h * HS;              // the same view, in photo pixels
    const n = 0.02, f = 50;
    const l = (HX - ww / 2 - CX) / F * n, r = (HX + ww / 2 - CX) / F * n;
    const t = (CY - (HY - wh / 2)) / F * n, b = (CY - (HY + wh / 2)) / F * n;
    const proj = new Float32Array([
      2 * n / (r - l), 0, 0, 0,
      0, 2 * n / (t - b), 0, 0,
      (r + l) / (r - l), (t + b) / (t - b), -(f + n) / (f - n), -1,
      0, 0, -2 * f * n / (f - n), 0,
    ]);
    const z = -DOLLY * ease(state.room);
    const view = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -z, 1]);
    gl.disable(gl.BLEND);
    gl.useProgram(room.p);
    gl.uniformMatrix4fv(room.u.uProj, false, proj);
    gl.uniformMatrix4fv(room.u.uView, false, view);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, texPhoto); gl.uniform1i(room.u.uPhoto, 2);
    gl.uniform2f(room.u.uRes, W, H);
    gl.bindBuffer(gl.ARRAY_BUFFER, boxBuf);
    gl.enableVertexAttribArray(room.a); gl.vertexAttribPointer(room.a, 3, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, boxCount);
    return true;
  }

  // 2D fallback (no WebGL2): the clip as-is, and a slow zoom into the photo for the room
  function draw2D() {
    ctx.fillStyle = '#07040b'; ctx.fillRect(0, 0, W, H);
    const v = visible(), s = SETS[set.key];
    if (state.mix < 1) {
      const i = nearest(Math.round(state.clip * (FRAMES - 1)), -1);
      if (i >= 0) {
        const fr = frames[i], kx = fr.width / s.w, ky = fr.height / s.h;
        ctx.globalAlpha = 1;
        ctx.drawImage(fr, (s.w - v.w) / 2 * kx, (s.h - v.h) / 2 * ky, v.w * kx, v.h * ky, 0, 0, W, H);
      }
    }
    if (state.mix > 0 && photo) {
      const z = 1 + 0.55 * ease(state.room), ww = v.w * HS / z, wh = v.h * HS / z;
      ctx.globalAlpha = state.mix;
      ctx.drawImage(photo, HX - ww / 2, HY - wh / 2, ww, wh, 0, 0, W, H);
      ctx.globalAlpha = 1;
    }
  }

  function render() {
    if (!dirty || dead || !set || !W) return;
    dirty = false;
    if (!gl) { draw2D(); return; }
    gl.viewport(0, 0, W, H);
    if (state.mix >= 1) { if (!drawRoomGL()) drawClipGL(1); return; }
    if (state.mix > 0 && drawRoomGL()) { drawClipGL(1 - state.mix); return; }
    if (!drawClipGL(1)) { gl.clearColor(0.027, 0.016, 0.043, 1); gl.clear(gl.COLOR_BUFFER_BIT); }
  }

  return { resize, set: set_, render, get ready() { return !!(frames[0]); }, loaded: () => frames.filter(Boolean).length };
}
