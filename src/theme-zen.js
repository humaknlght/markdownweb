/**
 * Vanilla WebGL calm water backdrop for the secret Zen theme.
 * Ambient droplets + soft typing ripples via a ring of impulse uniforms.
 * A single autumn leaf floats on the surface and rides the ripple field.
 */

const CANVAS_ID = "zen-canvas";
const MAX_RIPPLES = 16;
/** Keep in sync with fragment-shader SPEED / DAMP / FREQ / LIFE / CREST_AMP. */
const RIPPLE_SPEED = 0.154;
const RIPPLE_DAMP = 1.55;
const RIPPLE_FREQ = 24;
const RIPPLE_LIFE = 12;
const RING_COUNT = 4;
/** Crest height scale (1 = full). Keep in sync with waveAt CREST_AMP. */
const RIPPLE_CREST_AMP = 0.8;

/**
 * @typedef {{ x: number, y: number, t0: number, strength: number }} ZenRipple
 * @typedef {{
 *   x: number, y: number,
 *   vx: number, vy: number,
 *   angle: number,
 *   spin: number,
 *   h: number,
 *   gx: number, gy: number,
 * }} ZenLeaf
 */

/** @type {null | {
 *   canvas: HTMLCanvasElement,
 *   gl: WebGLRenderingContext | null,
 *   raf: number,
 *   ambientTimer: number,
 *   onResize: () => void,
 *   onForeground: () => void,
 *   renderFrame: ((now: number) => void) | null,
 *   pausedAt: number,
 *   reduce: boolean,
 *   ripples: ZenRipple[],
 *   leaf: ZenLeaf,
 *   lastT: number,
 *   prog: WebGLProgram | null,
 *   uniforms: Record<string, WebGLUniformLocation | null>,
 * }} */
let runtime = null;

const VS = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

const FS = `
precision highp float;
varying vec2 vUv;
uniform float uTime;
uniform vec2 uRes;
uniform vec3 uRipplePos[16];
uniform vec3 uRippleData[16];
uniform int uRippleCount;
/* leaf: xy = UV center, z = yaw (rad), w = surface height at center */
uniform vec4 uLeaf;
/* water slope under leaf center (aspect-space) — mild pitch/roll shear */
uniform vec2 uLeafGrad;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * valueNoise(p);
    p = p * 2.03 + vec2(17.1, 9.7);
    a *= 0.5;
  }
  return v;
}

/* Pool floor: soft stone tiles + grit, viewed through the water. */
vec3 poolFloor(vec2 uv) {
  vec2 tileUv = uv * vec2(7.0, 5.5);
  vec2 cell = floor(tileUv);
  vec2 local = fract(tileUv) - 0.5;
  float mortar = 1.0 - smoothstep(0.42, 0.48, max(abs(local.x), abs(local.y)));
  float tone = 0.55 + 0.35 * hash21(cell);
  float grit = fbm(uv * 28.0) * 0.18;
  float vein = fbm(uv * 9.0 + cell * 0.3) * 0.12;
  vec3 stoneA = vec3(0.22, 0.34, 0.36);
  vec3 stoneB = vec3(0.14, 0.24, 0.28);
  vec3 stoneC = vec3(0.30, 0.42, 0.40);
  vec3 stone = mix(stoneB, stoneA, tone);
  stone = mix(stone, stoneC, vein);
  stone += grit - 0.06;
  vec3 grout = vec3(0.08, 0.14, 0.16);
  return mix(grout, stone, mortar);
}

/*
 * Aspen / birch fall leaf — pointed tip, stem, light serration.
 * Reads as a leaf at small size (polar maple lobes read as a star).
 */
float leafMask(vec2 q) {
  vec2 p = q;
  p.y += 0.05;
  float y = p.y;
  float halfW = 0.52 * sqrt(max(0.0, 1.0 - y * y * (y > 0.0 ? 1.25 : 0.7)));
  // Point the tip
  halfW *= mix(1.0, 0.2, smoothstep(0.55, 1.02, y));
  float ang = atan(p.x, max(p.y, -0.9));
  float serr = 0.02 * sin(ang * 18.0) * smoothstep(0.12, 0.48, length(p));
  halfW += serr;
  float body = 1.0 - smoothstep(halfW - 0.022, halfW + 0.012, abs(p.x));
  body *= smoothstep(-0.95, -0.8, y) * smoothstep(1.05, 0.9, y);
  float stem = (1.0 - smoothstep(0.016, 0.036, abs(p.x)))
    * smoothstep(-0.3, -0.58, y)
    * smoothstep(-1.12, -0.85, y);
  return clamp(max(body, stem), 0.0, 1.0);
}

float leafVein(vec2 q) {
  vec2 p = q;
  p.y += 0.05;
  float mid = 1.0 - smoothstep(0.01, 0.022, abs(p.x));
  mid *= smoothstep(-0.7, -0.4, p.y) * smoothstep(0.88, 0.2, p.y);
  float side = 0.0;
  for (int i = 0; i < 4; i++) {
    float yy = -0.4 + float(i) * 0.28;
    float t = (p.y - yy) / 0.5;
    float xLine = t * 0.3;
    float d = abs(abs(p.x) - xLine);
    float v = (1.0 - smoothstep(0.007, 0.018, d))
      * step(0.0, t) * (1.0 - smoothstep(0.72, 1.0, t))
      * smoothstep(0.02, 0.07, abs(p.x));
    side = max(side, v);
  }
  return max(mid, side * 0.75);
}

/* Leaf-local q at a UV (yaw + slope shear) — shared by floor shadow + floating leaf. */
vec2 leafQAt(vec2 sampleUv, float aspect) {
  float ca = cos(uLeaf.z);
  float sa = sin(uLeaf.z);
  float leafScale = 0.11;
  vec2 dUv = sampleUv - uLeaf.xy;
  vec2 local = vec2(dUv.x * aspect, dUv.y) / leafScale;
  vec2 q = vec2(ca * local.x + sa * local.y, -sa * local.x + ca * local.y);
  vec2 slope = clamp(uLeafGrad * 3.2, vec2(-0.5), vec2(0.5));
  q.x += q.y * slope.x * 0.3;
  q.y = q.y * (1.0 - abs(slope.y) * 0.25) + q.x * slope.y * 0.22;
  return q;
}

/* Height + gradient at aspect-space point p (matches water field). */
vec3 waveAt(vec2 p) {
  float h = 0.0;
  vec2 grad = vec2(0.0);
  const float FREQ = 24.0;
  const float RING_COUNT = 4.0;
  const float LIFE = 12.0;
  const float CREST_AMP = 0.8;
  float wavelength = 6.2831853 / FREQ;
  float crestWidth = wavelength * 0.22;
  float aspect = uRes.x / max(uRes.y, 1.0);

  for (int i = 0; i < 16; i++) {
    if (i >= uRippleCount) break;
    vec2 c = vec2((uRipplePos[i].x - 0.5) * aspect, uRipplePos[i].y - 0.5);
    float t0 = uRipplePos[i].z;
    float strength = uRippleData[i].x;
    float speed = uRippleData[i].y;
    float damp = uRippleData[i].z;
    float age = uTime - t0;
    if (age < 0.0 || age > LIFE) continue;

    vec2 d = p - c;
    float dist = length(d);
    float ringPeriod = wavelength / max(speed, 0.001);
    vec2 radial = dist > 0.0001 ? normalize(d) : vec2(0.0);

    for (int k = 0; k < 4; k++) {
      if (float(k) >= RING_COUNT) break;
      float emitTime = float(k) * ringPeriod;
      if (age < emitTime) continue;
      float ringAge = age - emitTime;
      float radius = ringAge * speed;
      float energy = exp(-ringAge * 0.18) * exp(-radius * damp) * strength;
      float u = (dist - radius) / crestWidth;
      float crest = exp(-u * u) * energy * CREST_AMP;
      h += crest;
      grad += radial * (crest * (-2.0 * u / crestWidth));
    }
  }

  float ambient = sin(p.x * 2.1 + uTime * 0.12) * cos(p.y * 1.7 - uTime * 0.09) * 0.01;
  h += ambient;
  grad += vec2(
    cos(p.x * 2.1 + uTime * 0.12) * 2.1 * 0.01,
    -sin(p.y * 1.7 - uTime * 0.09) * 1.7 * 0.01
  );
  return vec3(h, grad);
}

void main() {
  vec2 uv = vUv;
  float aspect = uRes.x / max(uRes.y, 1.0);
  vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);

  vec3 wave = waveAt(p);
  float h = wave.x;
  vec2 grad = wave.yz;

  vec3 N = normalize(vec3(-grad * 0.85, 1.0));
  vec3 L = normalize(vec3(-0.3, 0.5, 0.8));
  vec3 V = vec3(0.0, 0.0, 1.0);
  vec3 R = reflect(-L, N);

  // Refract the pool floor through the surface normals.
  vec2 refractUv = uv + N.xy * 0.045;
  vec3 floorCol = poolFloor(refractUv);

  // Slow caustics projected onto the floor.
  vec2 cauUv = refractUv * 6.5 + grad * 0.8;
  float cau =
    sin(cauUv.x * 3.1 + uTime * 0.15 + h * 6.0) *
    sin(cauUv.y * 2.7 - uTime * 0.11 - h * 5.0);
  cau = pow(max(cau, 0.0), 2.2);
  floorCol += vec3(0.15, 0.28, 0.26) * cau * 0.55;

  // Leaf contact shadow on the floor, sampled in refracted UV so ripples
  // distort it the same way they distort the tiles.
  {
    vec2 qShadow = leafQAt(refractUv, aspect) - vec2(0.06, -0.1);
    float shadow = leafMask(qShadow);
    floorCol *= 1.0 - shadow * 0.55;
  }

  vec3 deep = vec3(0.03, 0.10, 0.14);
  vec3 mid = vec3(0.06, 0.22, 0.28);
  float depth = clamp(0.35 + uv.y * 0.35 - h * 0.4, 0.15, 0.85);
  vec3 throughWater = mix(floorCol, mid, depth * 0.72);
  throughWater = mix(throughWater, deep, depth * 0.35);

  float diff = max(dot(N, L), 0.0);
  float spec = pow(max(dot(R, V), 0.0), 64.0);
  vec3 sky = vec3(0.42, 0.60, 0.70);
  float fresnel = pow(1.0 - max(dot(N, V), 0.0), 2.8);

  vec3 color = throughWater * (0.55 + 0.45 * diff);
  color = mix(color, sky, fresnel * 0.42);
  color += vec3(0.9, 0.97, 1.0) * spec * 0.45;
  // Soft highlight along ripple crests
  color += vec3(0.12, 0.2, 0.2) * max(h, 0.0) * 0.35;

  // Floating leaf on the surface (above the ripples).
  {
    float h0 = uLeaf.w;
    float leafScale = 0.11;
    float ca = cos(uLeaf.z);
    float sa = sin(uLeaf.z);

    // Whole-leaf bob + small per-part lift from local crest height.
    vec2 leafUv = uLeaf.xy + vec2(0.0, h0 * 0.07);
    vec2 dUv = uv - leafUv;
    vec2 screenLocal = vec2(dUv.x * aspect, dUv.y) / leafScale;

    vec2 qFlat = vec2(ca * screenLocal.x + sa * screenLocal.y,
                      -sa * screenLocal.x + ca * screenLocal.y);
    vec2 worldP = vec2((uLeaf.x - 0.5) * aspect, uLeaf.y - 0.5)
      + vec2(ca * qFlat.x - sa * qFlat.y, sa * qFlat.x + ca * qFlat.y) * leafScale;
    vec3 wLeaf = waveAt(worldP);
    float zRel = wLeaf.x - h0;

    // Subtle screen lift for the part of the leaf over a crest (clamped so shape holds).
    vec2 lifted = vec2(screenLocal.x, screenLocal.y - clamp(zRel * 0.9, -0.12, 0.18));
    vec2 q = vec2(ca * lifted.x + sa * lifted.y, -sa * lifted.x + ca * lifted.y);

    // Mild pitch/roll shear from center slope (same as leafQAt / floor shadow).
    vec2 slope = clamp(uLeafGrad * 3.2, vec2(-0.5), vec2(0.5));
    q.x += q.y * slope.x * 0.3;
    q.y = q.y * (1.0 - abs(slope.y) * 0.25) + q.x * slope.y * 0.22;

    float mask = leafMask(q);
    if (mask > 0.02) {
      float vein = leafVein(q);
      float mott = fbm(q * 2.8 + uLeaf.xy * 5.0);
      vec3 amber = vec3(0.84, 0.42, 0.10);
      vec3 rust = vec3(0.50, 0.14, 0.05);
      vec3 gold = vec3(0.92, 0.66, 0.18);
      vec3 leafCol = mix(amber, rust, clamp(mott * 1.2, 0.0, 1.0));
      leafCol = mix(leafCol, gold, clamp(0.45 - length(q) * 0.5, 0.0, 0.55));
      leafCol = mix(leafCol, leafCol * 0.48, vein * 0.75);

      // Matte leaf: soft diffuse only — no specular crawl from water normals.
      vec3 leafN = normalize(vec3(-slope * 0.35, 1.0));
      float leafDiff = max(dot(leafN, L), 0.0);
      float liftShade = 0.72 + 0.28 * leafDiff + zRel * 1.2 + h0 * 0.15;
      leafCol *= clamp(liftShade, 0.45, 1.25);
      leafCol = mix(leafCol, leafCol * vec3(0.75, 0.85, 0.95), clamp(-zRel * 1.2, 0.0, 0.35));

      color = mix(color, leafCol, mask);
    }
  }

  gl_FragColor = vec4(color, 1.0);
}
`;

/**
 * @param {WebGLRenderingContext} gl
 * @param {number} type
 * @param {string} src
 */
function compileShader(gl, type, src) {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.warn("[zen] shader compile failed", gl.getShaderInfoLog(sh));
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

/**
 * @param {WebGLRenderingContext} gl
 */
function createProgram(gl) {
  const vs = compileShader(gl, gl.VERTEX_SHADER, VS);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, FS);
  if (!vs || !fs) return null;
  const prog = gl.createProgram();
  if (!prog) return null;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    gl.deleteProgram(prog);
    return null;
  }
  return prog;
}

/**
 * Production build injects `__DROPS_URL__`; dev resolves next to this module.
 * @type {string}
 */
const DROPS_URL =
  typeof __DROPS_URL__ !== "undefined"
    ? /** @type {string} */ (__DROPS_URL__)
    : new URL("./drops.mp3", import.meta.url).href;

/** @type {AudioContext | null} */
let audioCtx = null;
/** @type {AudioBuffer | null} */
let dropBuffer = null;
/** @type {Promise<AudioBuffer | null> | null} */
let dropBufferPromise = null;
/** @type {null | (() => void)} */
let audioUnlockCleanup = null;
/** @type {Set<AudioBufferSourceNode>} */
const activeDropSources = new Set();

function getAudioCtx() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!audioCtx) audioCtx = new AC();
  // Don't auto-resume while backgrounded — that undoes pauseZenWhileHidden.
  if (audioCtx.state === "suspended" && zenPageIsForeground()) void audioCtx.resume();
  return audioCtx;
}

/** Hard-stop any in-flight droplet one-shots (suspend alone is unreliable). */
function stopActiveDropSounds() {
  for (const src of activeDropSources) {
    try {
      src.stop(0);
    } catch {
      /* already stopped */
    }
    try {
      src.disconnect();
    } catch {
      /* already disconnected */
    }
  }
  activeDropSources.clear();
}

/** Browsers block AudioContext until a user gesture; arm a one-shot unlock. */
function armAudioUnlock() {
  if (audioUnlockCleanup) return;
  const unlock = () => {
    const ctx = getAudioCtx();
    if (ctx?.state === "suspended") void ctx.resume();
    void ensureDropBuffer();
    audioUnlockCleanup?.();
  };
  document.addEventListener("pointerdown", unlock);
  document.addEventListener("keydown", unlock);
  audioUnlockCleanup = () => {
    document.removeEventListener("pointerdown", unlock);
    document.removeEventListener("keydown", unlock);
    audioUnlockCleanup = null;
  };
}

async function ensureDropBuffer() {
  if (dropBuffer) return dropBuffer;
  if (dropBufferPromise) return dropBufferPromise;
  dropBufferPromise = (async () => {
    const ctx = getAudioCtx();
    if (!ctx) return null;
    try {
      const res = await fetch(DROPS_URL);
      if (!res.ok) return null;
      const arr = await res.arrayBuffer();
      dropBuffer = await ctx.decodeAudioData(arr.slice(0));
      return dropBuffer;
    } catch {
      return null;
    }
  })();
  return dropBufferPromise;
}

/** drops.mp3 has ~0.2s lead-in before the impact transient — skip it to match the ripple. */
const DROP_ATTACK_OFFSET = 0.2;

/**
 * Play src/drops.mp3 for a droplet (rate, volume, attack sync + stereo pan).
 * @param {number} strength
 * @param {number} panX UV 0–1 → stereo pan
 */
function playWaterDrop(strength = 0.4, panX = 0.5) {
  if (!runtime || runtime.reduce) return;
  if (!zenPageIsForeground()) return;
  void (async () => {
    const ctx = getAudioCtx();
    if (!ctx) return;
    const buf = await ensureDropBuffer();
    if (!buf || !runtime || runtime.reduce) return;
    if (!zenPageIsForeground()) return;

    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = 0.92 + Math.random() * 0.18;

    const gain = ctx.createGain();
    const baseVol = 0.35 + strength * 0.55;
    gain.gain.value = Math.min(0.9, baseVol * (0.85 + Math.random() * 0.3));

    if (typeof ctx.createStereoPanner === "function") {
      const panner = ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, (panX - 0.5) * 1.4));
      src.connect(gain);
      gain.connect(panner);
      panner.connect(ctx.destination);
    } else {
      src.connect(gain);
      gain.connect(ctx.destination);
    }

    // Start at the impact, not the silent lead-in; tiny jitter so repeats vary.
    const offset = Math.min(
      DROP_ATTACK_OFFSET + (Math.random() - 0.5) * 0.02,
      Math.max(0, buf.duration - 0.05),
    );
    activeDropSources.add(src);
    src.onended = () => {
      activeDropSources.delete(src);
      try {
        src.disconnect();
      } catch {
        /* ignore */
      }
    };
    src.start(t, offset);
  })();
}

/**
 * @param {number} [x]
 * @param {number} [y]
 * @param {number} [strength]
 * @param {{ sound?: boolean }} [opts]
 */
function pushRipple(x = Math.random(), y = Math.random(), strength = 0.55, opts = {}) {
  if (!runtime || runtime.reduce) return;
  const nx = Math.min(1, Math.max(0, x));
  const ny = Math.min(1, Math.max(0, y));
  const t0 = performance.now() * 0.001;
  runtime.ripples.push({
    x: nx,
    y: ny,
    t0,
    strength,
  });
  if (runtime.ripples.length > MAX_RIPPLES) {
    runtime.ripples.splice(0, runtime.ripples.length - MAX_RIPPLES);
  }
  if (opts.sound) playWaterDrop(strength, nx);
}

/**
 * Soft typing ripple (UV coords) — no droplet sound.
 * @param {{ x?: number, y?: number, strength?: number }} [opts]
 */
export function addZenRipple(opts = {}) {
  pushRipple(opts.x ?? 0.5, opts.y ?? 0.5, opts.strength ?? 0.22, { sound: false });
}

/**
 * Sample ripple height + aspect-space gradient (matches fragment shader).
 * @param {ZenRipple[]} ripples
 * @param {number} x UV
 * @param {number} y UV
 * @param {number} t seconds
 * @param {number} aspect width/height
 * @returns {{ h: number, gx: number, gy: number }}
 */
function sampleRippleField(ripples, x, y, t, aspect) {
  const px = (x - 0.5) * aspect;
  const py = y - 0.5;
  const wavelength = (Math.PI * 2) / RIPPLE_FREQ;
  const crestWidth = wavelength * 0.22;
  let h = 0;
  let gx = 0;
  let gy = 0;

  for (let i = 0; i < ripples.length; i++) {
    const r = ripples[i];
    const age = t - r.t0;
    if (age < 0 || age > RIPPLE_LIFE) continue;
    const cx = (r.x - 0.5) * aspect;
    const cy = r.y - 0.5;
    const dx = px - cx;
    const dy = py - cy;
    const dist = Math.hypot(dx, dy);
    const ringPeriod = wavelength / Math.max(RIPPLE_SPEED, 0.001);
    const nx = dist > 1e-4 ? dx / dist : 0;
    const ny = dist > 1e-4 ? dy / dist : 0;

    for (let k = 0; k < RING_COUNT; k++) {
      const emitTime = k * ringPeriod;
      if (age < emitTime) continue;
      const ringAge = age - emitTime;
      const radius = ringAge * RIPPLE_SPEED;
      const energy =
        Math.exp(-ringAge * 0.18) * Math.exp(-radius * RIPPLE_DAMP) * r.strength;
      const u = (dist - radius) / crestWidth;
      const crest = Math.exp(-u * u) * energy * RIPPLE_CREST_AMP;
      h += crest;
      const dCrest = (crest * (-2 * u)) / crestWidth;
      gx += nx * dCrest;
      gy += ny * dCrest;
    }
  }

  // Ambient swell (same as shader).
  const ambient =
    Math.sin(px * 2.1 + t * 0.12) * Math.cos(py * 1.7 - t * 0.09) * 0.01;
  h += ambient;
  gx += Math.cos(px * 2.1 + t * 0.12) * 2.1 * 0.01;
  gy += -Math.sin(py * 1.7 - t * 0.09) * 1.7 * 0.01;

  // Keep gradient in aspect-space for shader tilt (not UV-scaled).
  return { h, gx, gy };
}

/** @returns {ZenLeaf} */
function createLeaf() {
  // Fresh random spot each theme load (kept inside the soft travel bounds).
  return {
    x: 0.12 + Math.random() * 0.76,
    y: 0.12 + Math.random() * 0.76,
    vx: 0,
    vy: 0,
    angle: Math.random() * Math.PI * 2,
    spin: 0,
    h: 0,
    gx: 0,
    gy: 0,
  };
}

/**
 * Slow radial drift away from ripple centers when crests pass under the leaf.
 * @param {ZenLeaf} leaf
 * @param {ZenRipple[]} ripples
 * @param {number} t
 * @param {number} dt
 * @param {number} aspect
 */
function updateLeaf(leaf, ripples, t, dt, aspect) {
  const sample = sampleRippleField(ripples, leaf.x, leaf.y, t, aspect);
  leaf.h = sample.h;
  leaf.gx = sample.gx;
  leaf.gy = sample.gy;

  const wavelength = (Math.PI * 2) / RIPPLE_FREQ;
  const crestWidth = wavelength * 0.22;
  const lx = (leaf.x - 0.5) * aspect;
  const ly = leaf.y - 0.5;

  // Aspect-space force: each crest kicks the leaf radially outward from its origin.
  let fx = 0;
  let fy = 0;
  for (let i = 0; i < ripples.length; i++) {
    const r = ripples[i];
    const age = t - r.t0;
    if (age < 0 || age > RIPPLE_LIFE) continue;
    const cx = (r.x - 0.5) * aspect;
    const cy = r.y - 0.5;
    const dx = lx - cx;
    const dy = ly - cy;
    const dist = Math.hypot(dx, dy);
    if (dist < 1e-4) continue;
    const nx = dx / dist;
    const ny = dy / dist;
    const ringPeriod = wavelength / Math.max(RIPPLE_SPEED, 0.001);
    for (let k = 0; k < RING_COUNT; k++) {
      const emitTime = k * ringPeriod;
      if (age < emitTime) continue;
      const ringAge = age - emitTime;
      const radius = ringAge * RIPPLE_SPEED;
      // Use a wider, slower-fading envelope than the visual damp so distant
      // rings still nudge the leaf (visual damp kills energy before it arrives).
      const energy =
        Math.exp(-ringAge * 0.12) * Math.exp(-radius * 0.55) * r.strength;
      const u = (dist - radius) / crestWidth;
      const crest = Math.exp(-u * u) * energy;
      // Whole crest pushes outward (not only the inner face — that was ~zero net).
      fx += nx * crest;
      fy += ny * crest;
    }
  }

  // UV acceleration. A strength-0.4 crest under the leaf → slow visible drift.
  const push = 0.55;
  leaf.vx += (fx / Math.max(aspect, 0.001)) * push * dt;
  leaf.vy += fy * push * dt;
  // Light idle meander between waves.
  leaf.vx += Math.sin(t * 0.07 + 1.7) * 0.00004 * dt;
  leaf.vy += Math.cos(t * 0.05 + 0.4) * 0.00003 * dt;
  // Coast between crests (was ~0.97/frame → motion died immediately).
  const drag = Math.exp(-0.55 * dt);
  leaf.vx *= drag;
  leaf.vy *= drag;

  // Soft inward bias near edges so crests can't pin the leaf to the border.
  // Edge push also torques yaw (spin coasts so the turn is visible).
  const margin = 0.18;
  const turn = 28;
  if (leaf.x < margin) {
    const f = (margin - leaf.x) * 0.8;
    leaf.vx += f * dt;
    leaf.spin += f * turn * dt;
  }
  if (leaf.x > 1 - margin) {
    const f = (leaf.x - (1 - margin)) * 0.8;
    leaf.vx -= f * dt;
    leaf.spin -= f * turn * dt;
  }
  if (leaf.y < margin) {
    const f = (margin - leaf.y) * 0.8;
    leaf.vy += f * dt;
    leaf.spin -= f * turn * dt;
  }
  if (leaf.y > 1 - margin) {
    const f = (leaf.y - (1 - margin)) * 0.8;
    leaf.vy -= f * dt;
    leaf.spin += f * turn * dt;
  }

  leaf.spin *= Math.exp(-1.1 * dt);
  leaf.angle += leaf.spin * dt;

  leaf.x += leaf.vx * dt;
  leaf.y += leaf.vy * dt;

  const minX = 0.1;
  const maxX = 0.9;
  const minY = 0.1;
  const maxY = 0.9;
  if (leaf.x < minX) {
    leaf.x = minX;
    leaf.vx = Math.abs(leaf.vx) * 0.35;
    leaf.spin += 1.8;
  } else if (leaf.x > maxX) {
    leaf.x = maxX;
    leaf.vx = -Math.abs(leaf.vx) * 0.35;
    leaf.spin -= 1.8;
  }
  if (leaf.y < minY) {
    leaf.y = minY;
    leaf.vy = Math.abs(leaf.vy) * 0.35;
    leaf.spin -= 1.8;
  } else if (leaf.y > maxY) {
    leaf.y = maxY;
    leaf.vy = -Math.abs(leaf.vy) * 0.35;
    leaf.spin += 1.8;
  }
}

/** True when the tab is visible and this window has focus (not covered by another app). */
function zenPageIsForeground() {
  if (typeof document === "undefined") return true;
  if (document.visibilityState === "hidden") return false;
  // visibilitychange alone misses “another window covering this one”.
  if (typeof document.hasFocus === "function" && !document.hasFocus()) return false;
  return true;
}

function scheduleAmbientDrop() {
  if (!runtime || runtime.reduce) return;
  if (!zenPageIsForeground()) return;
  // Sparse, unhurried droplets — closer to a still pool than rain.
  const delay = 4000 + Math.random() * 8000;
  runtime.ambientTimer = window.setTimeout(() => {
    if (!runtime || runtime.reduce) return;
    if (!zenPageIsForeground()) return;
    pushRipple(
      0.12 + Math.random() * 0.76,
      0.18 + Math.random() * 0.64,
      0.32 + Math.random() * 0.2,
      { sound: true },
    );
    scheduleAmbientDrop();
  }, delay);
}

/** Pause RAF / ambient drops / audio while the tab is hidden or the window is unfocused. */
function pauseZenWhileHidden() {
  if (!runtime || runtime.reduce || runtime.pausedAt) return;
  runtime.pausedAt = performance.now();
  cancelAnimationFrame(runtime.raf);
  runtime.raf = 0;
  window.clearTimeout(runtime.ambientTimer);
  runtime.ambientTimer = 0;
  stopActiveDropSounds();
  if (audioCtx?.state === "running") void audioCtx.suspend();
}

/** Resume when foreground again; shift ripple clocks so age doesn't jump. */
function resumeZenWhenVisible() {
  if (!runtime || runtime.reduce) return;
  if (!zenPageIsForeground()) return;
  if (runtime.pausedAt) {
    const pauseSec = (performance.now() - runtime.pausedAt) * 0.001;
    for (let i = 0; i < runtime.ripples.length; i++) {
      runtime.ripples[i].t0 += pauseSec;
    }
    runtime.pausedAt = 0;
    runtime.lastT = 0;
  }
  if (audioCtx?.state === "suspended") void audioCtx.resume();
  if (!runtime.raf && runtime.renderFrame) {
    scheduleAmbientDrop();
    runtime.raf = requestAnimationFrame(runtime.renderFrame);
  }
}

function onZenForegroundChange() {
  if (!runtime || runtime.reduce) return;
  if (zenPageIsForeground()) resumeZenWhenVisible();
  else pauseZenWhileHidden();
}

/**
 * @param {{ reducedMotion?: boolean }} [opts]
 */
export function startZenBackdrop(opts = {}) {
  stopZenBackdrop();

  const reduce = Boolean(opts.reducedMotion);
  const canvas = document.createElement("canvas");
  canvas.id = CANVAS_ID;
  canvas.setAttribute("aria-hidden", "true");
  document.body.prepend(canvas);

  const gl = canvas.getContext("webgl", {
    alpha: false,
    antialias: true,
    depth: false,
    powerPreference: "low-power",
  });

  if (!gl) {
    canvas.style.background = "#0b1c24";
    runtime = {
      canvas,
      gl: null,
      raf: 0,
      ambientTimer: 0,
      onResize: () => {},
      onForeground: () => {},
      renderFrame: null,
      pausedAt: 0,
      reduce,
      ripples: [],
      leaf: createLeaf(),
      lastT: 0,
      prog: null,
      uniforms: {},
    };
    return;
  }

  const prog = createProgram(gl);
  if (!prog) {
    canvas.remove();
    return;
  }

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW,
  );

  const aPos = gl.getAttribLocation(prog, "aPos");
  /** @type {Record<string, WebGLUniformLocation | null>} */
  const uniforms = {
    uTime: gl.getUniformLocation(prog, "uTime"),
    uRes: gl.getUniformLocation(prog, "uRes"),
    uRippleCount: gl.getUniformLocation(prog, "uRippleCount"),
    uLeaf: gl.getUniformLocation(prog, "uLeaf"),
    uLeafGrad: gl.getUniformLocation(prog, "uLeafGrad"),
  };
  for (let i = 0; i < MAX_RIPPLES; i++) {
    uniforms[`uRipplePos${i}`] = gl.getUniformLocation(prog, `uRipplePos[${i}]`);
    uniforms[`uRippleData${i}`] = gl.getUniformLocation(prog, `uRippleData[${i}]`);
  }

  gl.clearColor(0.043, 0.11, 0.141, 1);

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor(window.innerWidth * dpr));
    const h = Math.max(1, Math.floor(window.innerHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
  }

  function renderFrame(now) {
    if (!runtime || !runtime.gl) return;
    const t = now * 0.001;
    const dt = runtime.lastT > 0 ? Math.min(0.05, Math.max(0, t - runtime.lastT)) : 1 / 60;
    runtime.lastT = t;
    // Drop finished ripples (matches shader LIFE)
    runtime.ripples = runtime.ripples.filter((r) => t - r.t0 < RIPPLE_LIFE);

    const aspect = canvas.width / Math.max(canvas.height, 1);
    if (!runtime.reduce) {
      updateLeaf(runtime.leaf, runtime.ripples, t, dt, aspect);
    } else {
      const sample = sampleRippleField(
        runtime.ripples,
        runtime.leaf.x,
        runtime.leaf.y,
        t,
        aspect,
      );
      runtime.leaf.h = sample.h;
      runtime.leaf.gx = sample.gx;
      runtime.leaf.gy = sample.gy;
    }

    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    gl.uniform1f(uniforms.uTime, t);
    gl.uniform2f(uniforms.uRes, canvas.width, canvas.height);
    const count = Math.min(runtime.ripples.length, MAX_RIPPLES);
    gl.uniform1i(uniforms.uRippleCount, count);
    for (let i = 0; i < MAX_RIPPLES; i++) {
      const r = runtime.ripples[i];
      if (r) {
        // speed / damp stay in sync with RIPPLE_SPEED / RIPPLE_DAMP
        gl.uniform3f(uniforms[`uRipplePos${i}`], r.x, r.y, r.t0);
        gl.uniform3f(uniforms[`uRippleData${i}`], r.strength, RIPPLE_SPEED, RIPPLE_DAMP);
      } else {
        gl.uniform3f(uniforms[`uRipplePos${i}`], 0, 0, -10);
        gl.uniform3f(uniforms[`uRippleData${i}`], 0, 0, 0);
      }
    }
    const leaf = runtime.leaf;
    gl.uniform4f(uniforms.uLeaf, leaf.x, leaf.y, leaf.angle, leaf.h);
    gl.uniform2f(uniforms.uLeafGrad, leaf.gx, leaf.gy);

    gl.drawArrays(gl.TRIANGLES, 0, 6);

    if (!runtime.reduce && !runtime.pausedAt) {
      runtime.raf = requestAnimationFrame(renderFrame);
    }
  }

  const onResize = () => {
    resize();
    if (reduce && runtime) renderFrame(performance.now());
  };

  resize();
  runtime = {
    canvas,
    gl,
    raf: 0,
    ambientTimer: 0,
    onResize,
    onForeground: onZenForegroundChange,
    renderFrame,
    pausedAt: 0,
    reduce,
    ripples: [],
    leaf: createLeaf(),
    lastT: 0,
    prog,
    uniforms,
  };
  window.addEventListener("resize", onResize);
  document.addEventListener("visibilitychange", onZenForegroundChange);
  window.addEventListener("blur", onZenForegroundChange);
  window.addEventListener("focus", onZenForegroundChange);

  if (reduce) {
    renderFrame(performance.now());
  } else if (!zenPageIsForeground()) {
    runtime.pausedAt = performance.now();
  } else {
    armAudioUnlock();
    // Opening droplet so the surface feels alive immediately.
    pushRipple(0.5, 0.45, 0.38, { sound: true });
    scheduleAmbientDrop();
    runtime.raf = requestAnimationFrame(renderFrame);
  }
}

export function stopZenBackdrop() {
  if (!runtime) return;
  cancelAnimationFrame(runtime.raf);
  window.clearTimeout(runtime.ambientTimer);
  window.removeEventListener("resize", runtime.onResize);
  document.removeEventListener("visibilitychange", runtime.onForeground);
  window.removeEventListener("blur", runtime.onForeground);
  window.removeEventListener("focus", runtime.onForeground);
  audioUnlockCleanup?.();
  stopActiveDropSounds();
  if (audioCtx?.state === "running") void audioCtx.suspend();
  const { canvas, gl } = runtime;
  if (gl) {
    const ext = gl.getExtension("WEBGL_lose_context");
    if (ext) ext.loseContext();
  }
  canvas.remove();
  runtime = null;
  dropBufferPromise = null;
  // Keep dropBuffer / audioCtx for fast re-entry when switching themes.
}
