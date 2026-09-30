import * as THREE from 'three';

/* =====================================================================
   core — math, noise, textures, geometry merge, renderer, world model
          (terrain / water / solids), shared uniforms & GLSL, lights
   Everything below the "world model" banner is scene-specific: replace it.
   ===================================================================== */
const TAU = Math.PI * 2;
const V3 = THREE.Vector3;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(0x5eed2025);   // seeded: the same layout on every load
const rr = (a, b) => a + (b - a) * rng();
const pick = arr => arr[Math.floor(rng() * arr.length)];

/* ---------- value noise (CPU) ---------- */
const PERM = new Uint8Array(512);
{
  const p = [...Array(256).keys()];
  for (let i = 255; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
}
const h2 = (i, j) => PERM[(i & 255) + PERM[j & 255]] / 255;
const h3 = (i, j, k) => PERM[(PERM[(PERM[i & 255] + (j & 255)) & 511] + (k & 255)) & 511] / 255;
function noise2(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  return lerp(lerp(h2(xi, yi), h2(xi + 1, yi), u), lerp(h2(xi, yi + 1), h2(xi + 1, yi + 1), u), v);
}
function noise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const a = lerp(lerp(h3(xi, yi, zi), h3(xi + 1, yi, zi), u), lerp(h3(xi, yi + 1, zi), h3(xi + 1, yi + 1, zi), u), v);
  const b = lerp(lerp(h3(xi, yi, zi + 1), h3(xi + 1, yi, zi + 1), u), lerp(h3(xi, yi + 1, zi + 1), h3(xi + 1, yi + 1, zi + 1), u), v);
  return lerp(a, b, w);
}
function fbm2(x, y, o = 4) {
  let s = 0, a = 0.5, n = 0;
  for (let i = 0; i < o; i++) { s += a * noise2(x, y); n += a; a *= 0.5; x *= 2.03; y *= 2.03; }
  return s / n;
}
function fbm3(x, y, z, o = 4) {
  let s = 0, a = 0.5, n = 0;
  for (let i = 0; i < o; i++) { s += a * noise3(x, y, z); n += a; a *= 0.5; x *= 2.03; y *= 2.03; z *= 2.03; }
  return s / n;
}

/* ---------- procedural canvas textures ---------- */
function canvasTex(w, h, draw, { srgb = true, repeat = false, aniso = 8, mips = true } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); draw(g, w, h, c);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso; t.generateMipmaps = mips;
  return t;
}
// per-pixel painter: fn(u,v) -> [r,g,b,a] in 0..255
function pixelTex(w, h, fn, opts) {
  return canvasTex(w, h, (g) => {
    const img = g.createImageData(w, h), d = img.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const c = fn(x / w, y / h, x, y), k = (y * w + x) * 4;
      d[k] = c[0]; d[k + 1] = c[1]; d[k + 2] = c[2]; d[k + 3] = c.length > 3 ? c[3] : 255;
    }
    g.putImageData(img, 0, 0);
  }, opts);
}

/* ---------- geometry merge (position/normal/uv/color, indexed) ---------- */
const WHITE = new THREE.Color(1, 1, 1);
function mergeGeos(items, withColor = false) {
  let nv = 0, ni = 0;
  for (const it of items) {
    nv += it.g.attributes.position.count;
    ni += it.g.index ? it.g.index.count : it.g.attributes.position.count;
  }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
  const col = withColor ? new Float32Array(nv * 3) : null, idx = new Uint32Array(ni);
  const v = new V3(), nm = new THREE.Matrix3();
  let vo = 0, io = 0;
  for (const it of items) {
    const g = it.g, P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv, m = it.m;
    if (m) nm.getNormalMatrix(m);
    for (let i = 0; i < P.count; i++) {
      const k = (vo + i) * 3;
      v.fromBufferAttribute(P, i); if (m) v.applyMatrix4(m);
      pos[k] = v.x; pos[k + 1] = v.y; pos[k + 2] = v.z;
      const px = v.x, py = v.y, pz = v.z;
      if (N) { v.fromBufferAttribute(N, i); if (m) v.applyMatrix3(nm).normalize(); nor[k] = v.x; nor[k + 1] = v.y; nor[k + 2] = v.z; }
      if (U) { uv[(vo + i) * 2] = U.getX(i); uv[(vo + i) * 2 + 1] = U.getY(i); }
      if (col) {
        const c = it.cf ? it.cf(px, py, pz, v.x, v.y, v.z, i) : (it.c || WHITE);
        col[k] = c.r; col[k + 1] = c.g; col[k + 2] = c.b;
      }
    }
    if (g.index) { for (let i = 0; i < g.index.count; i++) idx[io + i] = g.index.getX(i) + vo; io += g.index.count; }
    else { for (let i = 0; i < P.count; i++) idx[io + i] = vo + i; io += P.count; }
    vo += P.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (col) out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}
const M4 = (x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) =>
  new THREE.Matrix4().compose(new V3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new V3(sx, sy, sz));

// rejection-sample n footprints {x, z, r} that overlap neither each other nor `blocked(x, z, r)`
function scatter(n, radius, area, blocked = () => false, tries = 40) {
  const out = [];
  for (let k = 0; k < n; k++) for (let t = 0; t < tries; t++) {
    const r = typeof radius === 'function' ? radius() : radius, [x, z] = area();
    if (blocked(x, z, r) || out.some(o => Math.hypot(o.x - x, o.z - z) < o.r + r)) continue;
    out.push({ x, z, r }); break;
  }
  return out;
}

/* ---------- renderer / scene / camera ---------- */
const stage = document.getElementById('stage');
// MSAA happens in the HDR scene target (see fx.js buildPost), so the canvas needs no antialias
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.NoToneMapping;      // ACES + grading run in the post composite
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;           // updated once per frame, not again for the reflection pass
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const FOG_COL = new THREE.Color(0x1b2233);
scene.fog = new THREE.FogExp2(FOG_COL, 0.02);
const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.05, 1600);

/* =====================================================================
   world model — REPLACE PER SCENE
   One analytic description of the ground, the water and every solid top
   surface. Geometry is built FROM these functions, and everything that
   moves is constrained BY them — that single source is what prevents
   clipping (穿模).
   ===================================================================== */
const SUN_DIR = new V3(-0.3, 0.1, -0.95).normalize();      // visible light source (sky disc, water glitter, god-rays)
const LIGHT_DIR = new V3(-0.3, 0.5, -0.8).normalize();     // key light for shading/shadows: same azimuth, raised
const WORLD_R = 14;                                        // all content & motion stays inside this radius
const POND = { x: 0.5, z: -0.5, r: 4.4 };

/* water region as a signed distance: < 0 inside the water (water level is y = 0) */
function waterSDF(x, z) {
  return Math.hypot((x - POND.x) / 1.25, z - POND.z) - POND.r + (noise2(x * 0.35 + 3.1, z * 0.35 - 7.3) - 0.5) * 0.9;
}
function waterGrad(x, z, out) {
  const e = 0.05, dx = waterSDF(x + e, z) - waterSDF(x - e, z), dz = waterSDF(x, z + e) - waterSDF(x, z - e);
  const l = Math.hypot(dx, dz) || 1; out.x = dx / l; out.y = dz / l; return out;
}
function groundH(x, z) {
  const d = waterSDF(x, z);
  const bank = 0.32 + (fbm2(x * 0.16, z * 0.16, 3) - 0.5) * 0.3 + 1.2 * smooth(WORLD_R * 0.75, WORLD_R * 1.6, Math.hypot(x, z));
  const bed = -0.3 - 0.7 * smooth(0, 2.6, -d) + (noise2(x * 0.7, z * 0.7) - 0.5) * 0.1;
  return lerp(bed, bank, smooth(-0.5, 0.35, d));
}

/* ---------- solids: every top surface that particles / creatures / the camera can rest on ---------- */
const solids = [];          // { top(x,z) -> y | -1e9, kind }
const waterObstacles = [];  // circles standing in the water (rocks, piers, stems)  { x, z, r }
let SURF_KIND = 'ground';
function surfaceAt(x, z) {
  let y = groundH(x, z); SURF_KIND = 'ground';
  if (y < 0) { y = 0; SURF_KIND = 'water'; }
  for (const s of solids) { const h = s.top(x, z); if (h > y) { y = h; SURF_KIND = s.kind; } }
  return y;
}
const discSolid = (cx, cz, r, y, kind = 'solid') => solids.push({ kind, top: (x, z) => ((x - cx) ** 2 + (z - cz) ** 2 < r * r ? y : -1e9) });
const boxSolid = (x0, x1, z0, z1, y, kind = 'solid') => solids.push({ kind, top: (x, z) => (x > x0 && x < x1 && z > z0 && z < z1 ? y : -1e9) });
const ellSolid = (cx, cy, cz, rx, ry, rz, kind = 'solid') => solids.push({
  kind, top: (x, z) => { const q = 1 - ((x - cx) / rx) ** 2 - ((z - cz) / rz) ** 2; return q > 0 ? cy + ry * Math.sqrt(q) : -1e9; }
});
// true if (x,z) is open water with the given clearance from shore and obstacles
function waterFree(x, z, margin) {
  if (waterSDF(x, z) > -margin) return false;
  for (const o of waterObstacles) { const dx = x - o.x, dz = z - o.z, r = o.r + margin * 0.6; if (dx * dx + dz * dz < r * r) return false; }
  return true;
}
// push a point {x, z} out of water obstacles / back inside the water; returns true if corrected
const _g2 = new THREE.Vector2();
function constrainWater(p, margin) {
  let hit = false;
  const d = waterSDF(p.x, p.z);
  if (d > -margin) { waterGrad(p.x, p.z, _g2); p.x -= _g2.x * (d + margin); p.z -= _g2.y * (d + margin); hit = true; }
  for (const o of waterObstacles) {
    const dx = p.x - o.x, dz = p.z - o.z, r = o.r + margin * 0.5, q = dx * dx + dz * dz;
    if (q < r * r) { const l = Math.sqrt(q) || 1e-3; p.x = o.x + dx / l * r; p.z = o.z + dz / l * r; hit = true; }
  }
  return hit;
}

/* ---------- baked collision surface: O(1) lookups for thousands of particles per frame ---------- */
const SURF = { x0: -WORLD_R - 2, z0: -WORLD_R - 2, n: 0, m: 0, cell: 0.1 };
const KIND = { ground: 0, water: 1, solid: 2 };
function bakeSurface() {
  SURF.n = SURF.m = Math.ceil((WORLD_R + 2) * 2 / SURF.cell);
  const N = SURF.n * SURF.m;
  SURF.h = new Float32Array(N); SURF.k = new Uint8Array(N);
  for (let j = 0; j < SURF.m; j++) for (let i = 0; i < SURF.n; i++) {
    const k = j * SURF.n + i;
    SURF.h[k] = surfaceAt(SURF.x0 + (i + 0.5) * SURF.cell, SURF.z0 + (j + 0.5) * SURF.cell);
    SURF.k[k] = KIND[SURF_KIND] ?? KIND.solid;
  }
}
let SURF_IDX = -1;   // set by surfaceFast: index into SURF.k for the kind of the last lookup
function surfaceFast(x, z) {
  const i = Math.floor((x - SURF.x0) / SURF.cell), j = Math.floor((z - SURF.z0) / SURF.cell);
  if (!SURF.h || i < 0 || j < 0 || i >= SURF.n || j >= SURF.m) { SURF_IDX = -1; return Math.max(groundH(x, z), 0); }
  SURF_IDX = j * SURF.n + i; return SURF.h[SURF_IDX];
}

/* ---------- shared uniforms (spread into every custom ShaderMaterial: { ...G, own }) ---------- */
const G = {
  uTime: { value: 0 },
  uBurst: { value: 0 },                 // 0..1 envelope of the Space-key event
  uRip: { value: Array.from({ length: 10 }, () => new THREE.Vector4(0, 0, -100, 0)) },
  uLightDir: { value: LIGHT_DIR.clone() },
  uLightCol: { value: new THREE.Color(0xffd2a0).multiplyScalar(1.4) },
  uSkyAmb: { value: new THREE.Color(0x4a5a8a).multiplyScalar(0.45) },
  uGndAmb: { value: new THREE.Color(0x2a2016).multiplyScalar(0.5) },
  uLampPos: { value: [new V3(0, -99, 0), new V3(0, -99, 0), new V3(0, -99, 0)] },
  uLampCol: { value: [new THREE.Color(0), new THREE.Color(0), new THREE.Color(0)] },
  uFogCol: { value: FOG_COL },
  uFogDen: { value: scene.fog.density },
};
function addRipple(x, z, amp) {
  let best = 0, bestT = Infinity;   // reuse the oldest slot
  for (let i = 0; i < G.uRip.value.length; i++) { const r = G.uRip.value[i]; if (r.z < bestT) { bestT = r.z; best = i; } }
  G.uRip.value[best].set(x, z, G.uTime.value, amp);
}
// radial push of ripple fronts at a point (CPU mirror of the shader wave packet) — floating things drift outward
function ripplePush(x, z, t, out) {
  out.x = 0; out.y = 0;
  for (const R of G.uRip.value) {
    const age = t - R.z; if (age < 0 || age > 9) continue;
    const dx = x - R.x, dz = z - R.y, dist = Math.hypot(dx, dz) + 1e-4, q = dist - age * 1.7;
    const env = Math.exp(-q * q * 1.6) * Math.exp(-age * 0.45) * R.w / (1 + dist * 0.35);
    out.x += dx / dist * env * 0.5; out.y += dz / dist * env * 0.5;
  }
  return out;
}

/* ---------- GLSL chunks shared by custom shaders ---------- */
const GLSL_COMMON = /* glsl */`
uniform float uTime; uniform float uBurst;
uniform vec3 uLightDir; uniform vec3 uLightCol; uniform vec3 uSkyAmb; uniform vec3 uGndAmb;
uniform vec3 uLampPos[3]; uniform vec3 uLampCol[3];
uniform vec3 uFogCol; uniform float uFogDen;
float hash12(vec2 p){ vec3 p3=fract(vec3(p.xyx)*.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
float hash13(vec3 p3){ p3=fract(p3*.1031); p3+=dot(p3,p3.zyx+31.32); return fract((p3.x+p3.y)*p3.z); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(hash12(i),hash12(i+vec2(1,0)),f.x), mix(hash12(i+vec2(0,1)),hash12(i+vec2(1,1)),f.x), f.y); }
float vnoise3(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(mix(hash13(i),hash13(i+vec3(1,0,0)),f.x),mix(hash13(i+vec3(0,1,0)),hash13(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash13(i+vec3(0,0,1)),hash13(i+vec3(1,0,1)),f.x),mix(hash13(i+vec3(0,1,1)),hash13(i+vec3(1,1,1)),f.x),f.y), f.z); }
float fbm(vec2 p){ float s=0., a=.5; for(int i=0;i<5;i++){ s+=a*vnoise(p); p=p*2.03+vec2(1.7,9.2); a*=.5; } return s; }
float fbm3(vec3 p){ float s=0., a=.5; for(int i=0;i<4;i++){ s+=a*vnoise3(p); p=p*2.03+vec3(1.7,9.2,3.1); a*=.5; } return s; }
vec3 applyFog(vec3 c, vec3 w){ float d=length(w-cameraPosition); float f=1.-exp(-pow(uFogDen*d,2.)); return mix(c,uFogCol,clamp(f,0.,1.)); }
// warm point lamps for custom shaders (built-in materials get real PointLights)
vec3 lampLight(vec3 N, vec3 W, float wrap){
  vec3 s=vec3(0.);
  for(int i=0;i<3;i++){ vec3 d=uLampPos[i]-W; float r2=dot(d,d); vec3 l=d*inversesqrt(r2);
    float nl=max((dot(N,l)+wrap)/(1.+wrap),0.); s+=uLampCol[i]*nl/(r2+0.25)*smoothstep(160.,40.,r2); }
  return s;
}
vec3 ambientLight(vec3 N){ return mix(uGndAmb,uSkyAmb,N.y*.5+.5); }
`;
const GLSL_RIPPLE = /* glsl */`
uniform vec4 uRip[10];
// returns (height, dh/dx, dh/dz) of all active ripple wave packets
vec3 ripple(vec2 p){
  vec3 r=vec3(0.);
  for(int i=0;i<10;i++){
    vec4 R=uRip[i]; float age=uTime-R.z; if(age<0.||age>9.) continue;
    vec2 d=p-R.xy; float dist=length(d)+1e-4; float q=dist-age*1.7;
    float env=exp(-q*q*1.6)*exp(-age*.45)*R.w/(1.+dist*.35);
    float inner=exp(-max(-q,0.)*.7)*smoothstep(0.,.6,age); // trailing wavelets
    float ph=q*7.5; float h=sin(ph)*env + sin(q*11.-age*2.)*env*.35*inner;
    float dh=(cos(ph)*7.5*env)*.05;
    r.x+=h*.05; r.yz+=d/dist*dh;
  }
  return r;
}
`;
// wind sway shared by branches / leaves / grass (CPU mirror: windAt)
const GLSL_WIND = /* glsl */`
uniform float uWindAmp;
vec3 windDisp(vec3 w, float flutter){
  float h=max(w.y-0.3,0.); float k=h*h*.008*uWindAmp;       // sway grows with height above the ground
  float s1=sin(uTime*.85+w.x*.23+w.z*.17), s2=sin(uTime*2.1+w.x*.8+w.y*.6)*.35;
  float f=sin(uTime*7.3+w.x*5.1+w.z*4.3+w.y*3.7)*flutter*uWindAmp;
  return vec3((s1+s2)*k+f*.012, f*.008, (s1*.6+s2)*k*.7+f*.01);
}
`;
function windAt(x, y, z, t, out) {
  const h = Math.max(y - 0.3, 0), k = h * h * 0.008;
  const s1 = Math.sin(t * 0.85 + x * 0.23 + z * 0.17), s2 = Math.sin(t * 2.1 + x * 0.8 + y * 0.6) * 0.35;
  out.set((s1 + s2) * k, 0, (s1 * 0.6 + s2) * k * 0.7); return out;
}
const WIND = { uWindAmp: { value: 1 } };
// inject world-space wind sway into any built-in material (works with InstancedMesh)
function windMaterial(mat, flutter) {
  mat.onBeforeCompile = (s) => {
    s.uniforms.uTime = G.uTime; s.uniforms.uWindAmp = WIND.uWindAmp;
    s.vertexShader = 'uniform float uTime;\n' + GLSL_WIND + s.vertexShader.replace('#include <project_vertex>', `
      vec4 mvPosition = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        mvPosition = instanceMatrix * mvPosition;
      #endif
      mvPosition = modelMatrix * mvPosition;
      mvPosition.xyz += windDisp(mvPosition.xyz, ${flutter.toFixed(2)});
      mvPosition = viewMatrix * mvPosition;
      gl_Position = projectionMatrix * mvPosition;`);
  };
  return mat;
}

/* ---------- lights ---------- */
const keyLight = new THREE.DirectionalLight(0xffd2a0, 1.4);
keyLight.position.copy(LIGHT_DIR).multiplyScalar(40);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
Object.assign(keyLight.shadow.camera, { left: -WORLD_R, right: WORLD_R, top: WORLD_R, bottom: -WORLD_R, near: 5, far: 90 });
keyLight.shadow.bias = -0.0004; keyLight.shadow.normalBias = 0.035;
scene.add(keyLight, keyLight.target);
const hemi = new THREE.HemisphereLight(0x5a6a9a, 0x2a2016, 0.6);
scene.add(hemi);
const LAMPS = [];   // { light, bulb (emissive material), phase } — mirrored into G.uLampPos / uLampCol

/* ---------- loader ---------- */
const lbar = document.getElementById('lbar');
const setProgress = p => { lbar.style.width = (p * 100).toFixed(0) + '%'; };
const nextFrame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
