import * as THREE from 'three';

/* =====================================================================
   core — math, noise, textures, renderer, shared uniforms, world model
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
const rng = mulberry32(0x5eed2025);
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

/* ---------- renderer / scene / camera ---------- */
const stage = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.NoToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const FOG_COL = new THREE.Color(0x121a33);
scene.fog = new THREE.FogExp2(FOG_COL, 0.0135);
scene.background = null;
const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.05, 1600);

/* ---------- world constants ---------- */
const MOON_DIR = new V3(-0.1, 0.2, -1).normalize();   // direction to the moon (low, rising over the hills)
const MOON_D = 440, MOON_R = 36;
const LIGHT_DIR = new V3(-0.32, 1, -0.5).normalize(); // key moon-light (from high above, behind)
const PV = { x: 10, z: -5, half: 3.2, floor: 1.35, col: 2.8, colTop: 4.55, eaveY: 4.72, E: 4.3, H: 2.35 };
const BR = { x: -10.5, half: 5, hw: 0.86 };           // stone arch bridge (spans along z)
const TR = { x: -4, z: -10.6 };                        // osmanthus tree
const RS = { x: 15.1, z: 3.5, rx: 0.78, ry: 0.46, rz: 0.64 }; // white pebble stone under the rabbit
const WALL_Z = -15.6;

/* ---------- pond / terrain signed distance model ---------- */
function smin(a, b, k) { const h = clamp(0.5 + 0.5 * (b - a) / k, 0, 1); return lerp(b, a, h) - k * h * (1 - h); }
function sdCapsule(x, z, ax, az, bx, bz, r) {
  const pax = x - ax, paz = z - az, bax = bx - ax, baz = bz - az;
  const h = clamp((pax * bax + paz * baz) / (bax * bax + baz * baz), 0, 1);
  return Math.hypot(pax - bax * h, paz - baz * h) - r;
}
function pondSDF(x, z) {
  const px = (x - 3) / 11, pz = z / 8;
  let d = (Math.sqrt(px * px + pz * pz) - 1) * 8.6;
  d = smin(d, sdCapsule(x, z, -7, 0, -13.4, 0.25, 2.05), 1.6);
  d = smin(d, Math.hypot(x + 16.8, z - 0.6) - 4.3, 1.6);
  return d + (noise2(x * 0.33 + 7.1, z * 0.33 - 3.7) - 0.5) * 0.55;
}
function pondGrad(x, z, out) {
  const e = 0.05, dx = pondSDF(x + e, z) - pondSDF(x - e, z), dz = pondSDF(x, z + e) - pondSDF(x, z - e);
  const l = Math.hypot(dx, dz) || 1; out.x = dx / l; out.y = dz / l; return out;
}
function groundH(x, z) {
  const d = pondSDF(x, z);
  const tx = x - TR.x, tz = z - TR.z;
  const bank = 0.5 + (fbm2(x * 0.16, z * 0.16, 3) - 0.5) * 0.2 + 0.22 * Math.exp(-(tx * tx + tz * tz) / 9)
    + 0.9 * smooth(22, 40, Math.hypot(x, z * 1.3));
  const bed = -0.34 - 1.05 * smooth(0, 3.8, -d) + (noise2(x * 0.7, z * 0.7) - 0.5) * 0.14;
  return lerp(bed, bank, smooth(-0.55, 0.3, d));
}

/* ---------- colliders: every solid top surface that petals / droplets can rest on ---------- */
const solids = [];          // { top(x,z) -> y | -1e9, kind }
const waterObstacles = [];  // circles in the water: piers, stems  { x, z, r }
const floatPads = [];       // floating lotus pads { x, z, r, y }
let SURF_KIND = 'ground', SURF_REF = null, SKIP_ROOF = false;
function surfaceAt(x, z) {
  let y = groundH(x, z); SURF_KIND = 'ground'; SURF_REF = null;
  if (y < 0) {
    y = 0; SURF_KIND = 'water';
    for (const p of floatPads) {
      const dx = x - p.x, dz = z - p.z;
      if (dx * dx + dz * dz < p.r * p.r * 0.8) { y = p.y + 0.012; SURF_KIND = 'pad'; SURF_REF = p; break; }
    }
  }
  for (const s of solids) { if (SKIP_ROOF && s.kind === 'roof') continue; const h = s.top(x, z); if (h > y) { y = h; SURF_KIND = s.kind; SURF_REF = null; } }
  return y;
}
const discSolid = (cx, cz, r, y, kind = 'solid') => solids.push({ kind, top: (x, z) => ((x - cx) ** 2 + (z - cz) ** 2 < r * r ? y : -1e9) });
const boxSolid = (x0, x1, z0, z1, y, kind = 'solid') => solids.push({ kind, top: (x, z) => (x > x0 && x < x1 && z > z0 && z < z1 ? y : -1e9) });
const ellSolid = (cx, cy, cz, rx, ry, rz, kind = 'solid') => solids.push({
  kind, top: (x, z) => { const q = 1 - ((x - cx) / rx) ** 2 - ((z - cz) / rz) ** 2; return q > 0 ? cy + ry * Math.sqrt(q) : -1e9; }
});
// true if (x,z) is open water with the given clearance from shore and obstacles
function waterFree(x, z, margin) {
  if (pondSDF(x, z) > -margin) return false;
  for (const o of waterObstacles) { const dx = x - o.x, dz = z - o.z, r = o.r + margin * 0.6; if (dx * dx + dz * dz < r * r) return false; }
  return true;
}
// push a point out of water obstacles / back inside the pond; returns true if corrected
const _g2 = new THREE.Vector2();
function constrainWater(p, margin, pads = false) {
  let hit = false;
  const d = pondSDF(p.x, p.z);
  if (d > -margin) { pondGrad(p.x, p.z, _g2); p.x -= _g2.x * (d + margin); p.z -= _g2.y * (d + margin); hit = true; }
  const lists = pads ? [waterObstacles, floatPads] : [waterObstacles];
  for (const L of lists) for (const o of L) {
    const dx = p.x - o.x, dz = p.z - o.z, r = o.r + margin * 0.5, q = dx * dx + dz * dz;
    if (q < r * r) { const l = Math.sqrt(q) || 1e-3; p.x = o.x + dx / l * r; p.z = o.z + dz / l * r; hit = true; }
  }
  return hit;
}

/* ---------- shared uniforms ---------- */
const G = {
  uTime: { value: 0 },
  uGold: { value: 0 },
  uLantern: { value: 1 },
  uHalo: { value: 1 },
  uRip: { value: Array.from({ length: 10 }, () => new THREE.Vector4(0, 0, -100, 0)) },
  uMoonDir: { value: MOON_DIR.clone() },
  uLightDir: { value: LIGHT_DIR.clone() },
  uLightCol: { value: new THREE.Color(0xdde2f0).multiplyScalar(1.0) },
  uSkyAmb: { value: new THREE.Color(0x2c3a6a).multiplyScalar(0.45) },
  uGndAmb: { value: new THREE.Color(0x1a1510).multiplyScalar(0.5) },
  uLantPos: { value: [new V3(0, -99, 0), new V3(0, -99, 0), new V3(0, -99, 0)] },
  uLantCol: { value: [new THREE.Color(0), new THREE.Color(0), new THREE.Color(0)] },
  uFogCol: { value: FOG_COL },
  uFogDen: { value: scene.fog.density },
};
let ripSlot = 0;
function addRipple(x, z, amp) {
  // reuse the oldest slot
  let best = 0, bestT = Infinity;
  for (let i = 0; i < 10; i++) { const r = G.uRip.value[i]; if (r.z < bestT) { bestT = r.z; best = i; } }
  ripSlot = best;
  G.uRip.value[best].set(x, z, G.uTime.value, amp);
}
// radial push of ripple fronts at a point (CPU mirror of the shader wave packet)
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
uniform float uTime; uniform float uGold;
uniform vec3 uLightDir; uniform vec3 uLightCol; uniform vec3 uSkyAmb; uniform vec3 uGndAmb;
uniform vec3 uLantPos[3]; uniform vec3 uLantCol[3];
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
vec3 lanternLight(vec3 N, vec3 W, float wrap){
  vec3 s=vec3(0.);
  for(int i=0;i<3;i++){ vec3 d=uLantPos[i]-W; float r2=dot(d,d); vec3 l=d*inversesqrt(r2);
    float nl=max((dot(N,l)+wrap)/(1.+wrap),0.); s+=uLantCol[i]*nl/(r2+0.25)*smoothstep(160.,40.,r2); }
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
// wind sway shared by branches / leaves / flowers (CPU mirror: windAt)
const GLSL_WIND = /* glsl */`
uniform float uWindAmp;
vec3 windDisp(vec3 w, float flutter){
  float h=max(w.y-2.0,0.); float k=h*h*.011*uWindAmp;
  float s1=sin(uTime*.85+w.x*.23+w.z*.17), s2=sin(uTime*2.1+w.x*.8+w.y*.6)*.35;
  float f=sin(uTime*7.3+w.x*5.1+w.z*4.3+w.y*3.7)*flutter*uWindAmp;
  return vec3((s1+s2)*k+f*.012, f*.008, (s1*.6+s2)*k*.7+f*.01);
}
`;
function windAt(x, y, z, t, out) {
  const h = Math.max(y - 2, 0), k = h * h * 0.011;
  const s1 = Math.sin(t * 0.85 + x * 0.23 + z * 0.17), s2 = Math.sin(t * 2.1 + x * 0.8 + y * 0.6) * 0.35;
  out.set((s1 + s2) * k, 0, (s1 * 0.6 + s2) * k * 0.7); return out;
}
const WIND = { uWindAmp: { value: 1 } };

/* ---------- lights ---------- */
const moonLight = new THREE.DirectionalLight(0xdde2f0, 1.0);
moonLight.position.copy(LIGHT_DIR).multiplyScalar(70).add(new V3(0, 0, -3));
moonLight.target.position.set(0, 0, -3);
moonLight.castShadow = true;
moonLight.shadow.mapSize.set(2048, 2048);
Object.assign(moonLight.shadow.camera, { left: -27, right: 27, top: 24, bottom: -24, near: 20, far: 130 });
moonLight.shadow.bias = -0.0004; moonLight.shadow.normalBias = 0.035;
scene.add(moonLight, moonLight.target);
const fillLight = new THREE.DirectionalLight(0x6a80c4, 0.22);
fillLight.position.set(-20, 18, 40);
scene.add(fillLight);
const hemi = new THREE.HemisphereLight(0x33447e, 0x1c1812, 0.7);
scene.add(hemi);
const LANTS = []; // { group, light|null, bulb (emissive material), phase }

/* ---------- loader ---------- */
const lbar = document.getElementById('lbar');
const setProgress = p => { lbar.style.width = (p * 100).toFixed(0) + '%'; };
const nextFrame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
