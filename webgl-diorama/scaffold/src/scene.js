/* =====================================================================
   scene — EXAMPLE SCENE「暮色池塘」: replace this module per theme.
   Shows every pattern a diorama needs, at minimum size:
     sky dome anchored to the camera · PMREM environment · terrain built
     from groundH · instanced rocks registered as solids / water obstacles
     · wind-swayed instanced canopy · drifters (falling leaves that land,
     float, rest) · warm lamp mirrored into custom shaders · a critter
     with idle micro-actions that reacts to interaction · presets lerped
     over time · Space burst spectacle
   Split into more modules as it grows (add them to MODULES in build.js).
   ===================================================================== */
const SCN = { density: 1, lamp: 1, preset: 'dusk', rip: 0, t0: -99 };
const TREE_P = { x: -5.6, z: -4.6 };
const LAMP_P = { x: 6.2, z: 3.2 };

/* ---------- scene contract (consumed by main.js) ---------- */
const SCENE = {
  burstName: '示例彩蛋 · 流萤乱舞',
  cam: { target: new V3(0.3, 0.9, -0.8), theta: 0.35, phi: 1.3, dist: 17 },
  lim: { phi0: 0.55, phi1: 1.53, th: 1.4, d0: 0.4, d1: 30 },
  box: [-12, 12, 0.1, 5, -12, 12],
  stat: () => '落叶 ' + (LEAVES ? LEAVES.alive : 0),
};
const PANEL = [
  { label: '落叶密度', min: 0, max: 2.5, step: 0.01, value: 1, on: v => SCN.density = v },
  { label: '灯光亮度', min: 0, max: 2, step: 0.01, value: 1, on: v => SCN.lamp = v },
  { label: '时段色温', options: [['dusk', '夕阳黄昏'], ['night', '夜间月光']], value: 'dusk', on: v => SCN.preset = v },
];
const BUILD_STEPS = [
  () => { buildSky(); buildEnvironment(); },
  buildTerrain, () => buildWater({ glintDir: SUN_DIR }),
  () => { buildLamp(); buildRocks(); },
  buildTree, buildCritter, () => { buildLeaves(); FX.fire = makePool(2500, 7); },
];
const UPDATERS = [updatePresets, updateLamp, updateCritter, updateLeafFall, updateSpectacle];
const INTERACT = {
  water: p => { addRipple(p.x, p.z, 1.0); splashAt(p.x, p.z); critterLookAt(p, STATE.t); },
  critter: () => { CRIT.hopT = STATE.t; toast('它跳了一下'); },
};
const _cc = new V3();
const PICK_VOLUMES = [{ c: () => CRIT.root.localToWorld(_cc.set(0, 0.16, 0)), r: 0.28, kind: 'critter' }];

/* ---------- time-of-day presets: every value damps toward the chosen preset ---------- */
const C = hex => new THREE.Color(hex);
const PRESETS = {
  dusk: { zen: C(0x1d2b58), hor: C(0xd29066), sun: C(0xffb070).multiplyScalar(1.4), fog: C(0x6a5a68), light: C(0xffc28a).multiplyScalar(1.7), sky: C(0x5a6a9a).multiplyScalar(0.5), gnd: C(0x3a2a1a).multiplyScalar(0.5), lamp: 0.6 },
  night: { zen: C(0x03060f), hor: C(0x1b2742), sun: C(0xbcd0ff).multiplyScalar(0.7), fog: C(0x121a2c), light: C(0x9fb4e8).multiplyScalar(0.55), sky: C(0x2c3a6a).multiplyScalar(0.4), gnd: C(0x1a1510).multiplyScalar(0.4), lamp: 1.5 },
};
const SKYU = { uZen: { value: PRESETS.dusk.zen.clone() }, uHor: { value: PRESETS.dusk.hor.clone() }, uSunCol: { value: PRESETS.dusk.sun.clone() }, uSunDir: { value: SUN_DIR } };
let presetLamp = PRESETS.dusk.lamp;
function updatePresets(dt) {
  const P = PRESETS[SCN.preset], k = 1 - Math.exp(-dt * 1.2);
  SKYU.uZen.value.lerp(P.zen, k); SKYU.uHor.value.lerp(P.hor, k); SKYU.uSunCol.value.lerp(P.sun, k);
  FOG_COL.lerp(P.fog, k); scene.fog.color.copy(FOG_COL);
  G.uLightCol.value.lerp(P.light, k); G.uSkyAmb.value.lerp(P.sky, k); G.uGndAmb.value.lerp(P.gnd, k);
  keyLight.color.copy(G.uLightCol.value); keyLight.intensity = 1;
  hemi.color.copy(G.uSkyAmb.value).multiplyScalar(2); hemi.groundColor.copy(G.uGndAmb.value).multiplyScalar(2);
  presetLamp = lerp(presetLamp, P.lamp, k);
}

/* ---------- sky: gradient dome + sun disc + distant hills, anchored to whichever camera renders it ---------- */
function buildSky() {
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...G, ...SKYU },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main(){ vDir=position; gl_Position=projectionMatrix*viewMatrix*vec4(position+cameraPosition,1.); }`,
    fragmentShader: GLSL_COMMON + /* glsl */`
      uniform vec3 uZen, uHor, uSunCol, uSunDir; varying vec3 vDir;
      float ridge(float az, float s, float o){ return vnoise(vec2(az*s+o, o))*.6+vnoise(vec2(az*s*2.7+o*3., o))*.3+vnoise(vec2(az*s*7.+o, o*2.))*.1; }
      void main(){
        vec3 d=normalize(vDir); float e=d.y;
        vec3 col=mix(uHor,uZen,smoothstep(0.,.55,e));
        float sd=max(dot(d,uSunDir),0.);
        col+=uSunCol*(pow(sd,6.)*.35+pow(sd,90.)*1.2)+uSunCol*smoothstep(.9994,.9997,sd)*18.;   // HDR disc feeds bloom & god-rays
        float az=atan(d.x,d.z);
        float r1=.015+.05*ridge(az,1.3,3.1), r2=.006+.03*ridge(az,2.4,11.7);
        col=mix(col,uFogCol*1.1,smoothstep(r1+.002,r1-.002,e));
        col=mix(col,uFogCol*.8,smoothstep(r2+.002,r2-.002,e));
        if(e<0.) col=uFogCol;
        gl_FragColor=vec4(col,1.);
      }`,
    side: THREE.BackSide, depthWrite: false, fog: false,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(900, 48, 24), mat);
  dome.frustumCulled = false; dome.renderOrder = -10; scene.add(dome);
  POST.rayDir = SUN_DIR;
}
// image-based lighting from a tiny env scene: gives every built-in material sky-coloured reflections
function buildEnvironment() {
  const env = new THREE.Scene(), sg = new THREE.SphereGeometry(50, 32, 16), cols = [], P = sg.attributes.position, d = new V3(), c = new THREE.Color();
  for (let i = 0; i < P.count; i++) {
    d.fromBufferAttribute(P, i).normalize();
    c.copy(PRESETS.dusk.hor).lerp(PRESETS.dusk.zen, Math.pow(Math.max(d.y, 0), 0.6)).multiplyScalar(d.y < 0 ? 0.3 : 1);
    const s = Math.pow(Math.max(d.dot(SUN_DIR), 0), 8); c.r += s * 0.8; c.g += s * 0.5; c.b += s * 0.3;
    cols.push(c.r, c.g, c.b);
  }
  sg.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  env.add(new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(env, 0.02).texture; pm.dispose();
}

/* ---------- terrain: non-uniform grid (dense near the centre) displaced by groundH ---------- */
function buildTerrain() {
  const SEG = 256, S = 60, K = 2.6, sk = Math.sinh(K), map = u => S * Math.sinh(K * u) / sk;
  const nv = (SEG + 1) * (SEG + 1), pos = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), col = new Float32Array(nv * 3);
  const c = new THREE.Color(), silt = C(0x3a3a2b), deep = C(0x1d2119), moss = C(0x2e3c20), lawn = C(0x46502a), soil = C(0x4a3e2b);
  let k = 0;
  for (let j = 0; j <= SEG; j++) for (let i = 0; i <= SEG; i++, k++) {
    const x = map(i / SEG * 2 - 1), z = map(j / SEG * 2 - 1), y = groundH(x, z), d = waterSDF(x, z);
    pos.set([x, y, z], k * 3); uv.set([x / 5, z / 5], k * 2);
    if (d < 0) c.copy(silt).lerp(deep, smooth(0, 3, -d));
    else c.copy(moss).lerp(lawn, smooth(0.4, 3, d)).lerp(soil, fbm2(x * 0.3 + 40, z * 0.3, 3) * 0.7);
    c.multiplyScalar(0.85 + 0.3 * noise2(x * 1.3, z * 1.3));
    col.set([c.r, c.g, c.b], k * 3);
  }
  const idx = new Uint32Array(SEG * SEG * 6); k = 0;
  for (let j = 0; j < SEG; j++) for (let i = 0; i < SEG; i++) {
    const a = j * (SEG + 1) + i, b = a + 1, cc = a + SEG + 1, d = cc + 1;
    idx.set([a, cc, b, b, cc, d], k); k += 6;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  const tex = pixelTex(512, 512, (u, v) => {
    const n = fbm2(u * 16, v * 16, 4), p = noise2(u * 90, v * 90), gr = noise2(u * 200, v * 60);
    const l = 150 + (n - 0.5) * 120 + (p > 0.72 ? 40 : 0) - (p < 0.2 ? 25 : 0) + (gr - 0.5) * 30;
    return [l, l * 0.98, l * 0.9];
  }, { repeat: true });
  const bump = pixelTex(512, 512, (u, v) => { const l = 90 + fbm2(u * 30, v * 30, 3) * 90 + (noise2(u * 90, v * 90) > 0.7 ? 70 : 0); return [l, l, l]; }, { repeat: true, srgb: false });
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex, bumpMap: bump, bumpScale: 1.2, vertexColors: true, roughness: 0.96, envMapIntensity: 0.6 }));
  mesh.receiveShadow = true; scene.add(mesh);
}

/* ---------- lamp: real PointLight for built-in materials + uLampPos/uLampCol slot 0 for custom shaders ---------- */
function buildLamp() {
  const y0 = groundH(LAMP_P.x, LAMP_P.z), stone = new THREE.MeshStandardMaterial({ color: 0x7a746a, roughness: 0.85 });
  const post = new THREE.Mesh(mergeGeos([
    { g: new THREE.CylinderGeometry(0.09, 0.12, 1.1, 10), m: M4(0, 0.55, 0) },
    { g: new THREE.BoxGeometry(0.34, 0.06, 0.34), m: M4(0, 1.12, 0) },
    { g: new THREE.ConeGeometry(0.28, 0.2, 4), m: M4(0, 1.5, 0, 0, Math.PI / 4) },
  ]), stone);
  post.position.set(LAMP_P.x, y0, LAMP_P.z); post.castShadow = post.receiveShadow = true; scene.add(post);
  const bulbMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffa040, emissiveIntensity: 4 });
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.08, 16, 12), bulbMat);
  bulb.position.set(LAMP_P.x, y0 + 1.28, LAMP_P.z); scene.add(bulb);
  const light = new THREE.PointLight(0xffa050, 3, 9, 2); light.position.copy(bulb.position); scene.add(light);
  LAMPS.push({ light, bulb: bulbMat, phase: rr(0, TAU) });
  discSolid(LAMP_P.x, LAMP_P.z, 0.2, y0 + 1.6);          // the cap is a surface leaves can rest on
}
function updateLamp(dt, t) {
  const level = SCN.lamp * presetLamp;
  LAMPS.forEach((L, i) => {
    const f = 0.92 + 0.05 * Math.sin(t * 7.3 + L.phase) + 0.03 * Math.sin(t * 17.1 + L.phase * 2);   // candle flicker
    L.light.intensity = 3 * level * f; L.bulb.emissiveIntensity = 4 * level * f;
    G.uLampPos.value[i].copy(L.light.position);
    G.uLampCol.value[i].copy(L.light.color).multiplyScalar(0.5 * level * f);
  });
}

/* ---------- rocks: scattered without overlap, each registered as a solid (and water obstacle if wet) ---------- */
function rockGeometry() {
  const g = new THREE.SphereGeometry(1, 28, 20), P = g.attributes.position, v = new V3();
  for (let i = 0; i < P.count; i++) {
    v.fromBufferAttribute(P, i).multiplyScalar(0.72 + fbm3(v.x * 1.4 + 5, v.y * 1.4, v.z * 1.4, 4) * 0.56);
    if (v.y < -0.2) v.y = -0.2 + (v.y + 0.2) * 0.3;        // flat underside sits on the ground
    P.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals(); return g;
}
let ROCKS = [];
function buildRocks() {
  const nearLandmark = (x, z, r) => Math.hypot(x - TREE_P.x, z - TREE_P.z) < 0.9 + r || Math.hypot(x - LAMP_P.x, z - LAMP_P.z) < 0.5 + r;
  const shore = scatter(24, () => rr(0.25, 0.6), () => { const a = rr(0, TAU), r = POND.r * rr(0.9, 1.2); return [POND.x + Math.cos(a) * r * 1.25, POND.z + Math.sin(a) * r]; },
    (x, z, r) => Math.abs(waterSDF(x, z)) > 0.8 || nearLandmark(x, z, r));
  const wet = scatter(3, () => rr(0.3, 0.5), () => [POND.x + rr(-3, 3), POND.z + rr(-2.5, 2.5)], (x, z, r) => !waterFree(x, z, r + 0.8));
  ROCKS = [...shore, ...wet];
  const tex = pixelTex(256, 256, (u, v) => { const n = fbm2(u * 8, v * 8, 5), s = noise2(u * 60, v * 60); const l = 95 + n * 90 + (s > 0.75 ? 25 : 0); return [l, l * 0.97, l * 0.92]; }, { repeat: true });
  const mesh = new THREE.InstancedMesh(rockGeometry(), new THREE.MeshStandardMaterial({ map: tex, bumpMap: tex, bumpScale: 2, roughness: 0.88 }), ROCKS.length);
  const col = new THREE.Color();
  ROCKS.forEach((R, i) => {
    const h = R.r * rr(0.5, 0.8), y0 = groundH(R.x, R.z) - h * 0.25;
    mesh.setMatrixAt(i, M4(R.x, y0, R.z, rr(-0.2, 0.2), rr(0, TAU), rr(-0.2, 0.2), R.r, h, R.r * rr(0.85, 1.1)));
    mesh.setColorAt(i, col.setHSL(0.08 + rr(-0.03, 0.03), rr(0.05, 0.15), rr(0.45, 0.7)));
    ellSolid(R.x, y0, R.z, R.r * 0.8, h * 0.95, R.r * 0.8);
    if (groundH(R.x, R.z) < 0.05) waterObstacles.push({ x: R.x, z: R.z, r: R.r * 0.9 });
  });
  mesh.castShadow = mesh.receiveShadow = true; scene.add(mesh);
}

/* ---------- tree: merged bark geometry + instanced wind-swayed canopy; its leaves are the drifter spawn spots ---------- */
const TREE = { spots: [] };
function leafTexture() {
  return canvasTex(64, 64, (g, w, h) => {
    g.clearRect(0, 0, w, h); g.fillStyle = '#fff';
    g.beginPath(); g.ellipse(w / 2, h / 2, w * 0.2, h * 0.46, 0, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(120,120,120,.8)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(w / 2, h * 0.08); g.lineTo(w / 2, h * 0.94); g.stroke();
  });
}
function buildTree() {
  const y0 = groundH(TREE_P.x, TREE_P.z) - 0.1, parts = [{ g: new THREE.CylinderGeometry(0.13, 0.24, 3.6, 12, 4), m: M4(TREE_P.x, y0 + 1.8, TREE_P.z, 0, 0, 0.05) }];
  for (let k = 0; k < 5; k++) {
    const a = k / 5 * TAU + rr(-0.3, 0.3);
    parts.push({ g: new THREE.CylinderGeometry(0.035, 0.08, 1.9, 8), m: M4(TREE_P.x + Math.cos(a) * 0.45, y0 + 3.4, TREE_P.z + Math.sin(a) * 0.45, Math.sin(a) * 0.8, 0, -Math.cos(a) * 0.8) });
  }
  const bark = new THREE.Mesh(mergeGeos(parts), windMaterial(new THREE.MeshStandardMaterial({ color: 0x5a4636, roughness: 0.92 }), 0));
  bark.castShadow = bark.receiveShadow = true; scene.add(bark);
  discSolid(TREE_P.x, TREE_P.z, 0.2, y0 + 3.6);

  TREE.leafTex = leafTexture();
  const Cc = new V3(TREE_P.x + 0.3, y0 + 4.3, TREE_P.z + 0.4), CR = new V3(2.7, 1.5, 2.5), N = 2600;
  const g = new THREE.PlaneGeometry(0.16, 0.24); g.translate(0, 0.12, 0);
  const mesh = new THREE.InstancedMesh(g, windMaterial(new THREE.MeshStandardMaterial({ map: TREE.leafTex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.6 }), 1), N);
  const d = new V3(), X = new V3(), Y = new V3(), Z = new V3(), p = new V3(), s = new V3(), m = new THREE.Matrix4(), col = new THREE.Color();
  for (let i = 0; i < N; i++) {
    d.set(rr(-1, 1), rr(-0.6, 1), rr(-1, 1)).normalize();
    p.set(Cc.x + d.x * CR.x * rr(0.6, 1), Cc.y + d.y * CR.y * rr(0.6, 1), Cc.z + d.z * CR.z * rr(0.6, 1));
    Y.copy(d).add(new V3(rr(-0.5, 0.5), 0.6, rr(-0.5, 0.5))).normalize(); X.set(rr(-1, 1), rr(-1, 1), rr(-1, 1)).cross(Y).normalize(); Z.crossVectors(X, Y);
    m.makeBasis(X, Y, Z).scale(s.setScalar(rr(0.8, 1.25))).setPosition(p);
    mesh.setMatrixAt(i, m); mesh.setColorAt(i, col.setHSL(rr(0.06, 0.2), rr(0.45, 0.7), rr(0.3, 0.5)));
    if (i % 12 === 0) TREE.spots.push(p.x, p.y, p.z);
  }
  mesh.castShadow = true; mesh.receiveShadow = true; scene.add(mesh);
}

/* ---------- falling leaves (drifters) ---------- */
let LEAVES = null;
function buildLeaves() {
  const g = new THREE.PlaneGeometry(0.13, 0.13, 2, 2); g.rotateX(-Math.PI / 2);   // lies in XZ with normal +y (required by drifters)
  const P = g.attributes.position; for (let i = 0; i < P.count; i++) P.setY(i, (P.getX(i) ** 2) * 1.5);   // slight curl
  g.computeVertexNormals();
  LEAVES = makeDrifters({ N: 2400, geo: g, map: TREE.leafTex, tint: C(0xe0a050), glow: 0.04 });
}
function updateLeafFall(dt, t) {
  LEAVES.acc += 6 * SCN.density * (1 + 2.5 * G.uBurst.value) * dt;
  const S = TREE.spots, n = S.length / 3;
  let guard = 0;
  while (LEAVES.acc >= 1 && guard++ < 200) { const s = Math.floor(rng() * n) * 3; spawnDrifter(LEAVES, S[s], S[s + 1], S[s + 2], rr(0.75, 1.2)); LEAVES.acc -= 1; }
  updateDrifters(LEAVES, dt, t);
  WIND.uWindAmp.value = 1 + 0.35 * Math.sin(t * 0.21) * Math.sin(t * 0.13) + G.uBurst.value * 0.8;
}

/* ---------- critter: idle micro-actions (blink, look around, ear flick, breathe) + curious look-at ---------- */
const CRIT = {};
function buildCritter() {
  const R = ROCKS.filter(r => groundH(r.x, r.z) > 0.05).sort((a, b) => (b.z + b.x * 0.5) - (a.z + a.x * 0.5))[0];   // front-most shore rock
  const fur = new THREE.MeshPhysicalMaterial({ color: 0xd9cbb5, roughness: 0.9, sheen: 1, sheenRoughness: 0.45, sheenColor: 0xfff2e0 });
  const root = new THREE.Group(); root.position.set(R.x, surfaceAt(R.x, R.z) - 0.01, R.z);
  root.rotation.y = Math.atan2(POND.x - R.x, POND.z - R.z);   // local +z faces the pond
  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 24), fur); body.scale.set(0.13, 0.11, 0.16); body.position.y = 0.1;
  const tail = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), fur); tail.position.set(0, 0.1, -0.16);
  const head = new THREE.Group(); head.position.set(0, 0.2, 0.1); head.rotation.order = 'YXZ';
  const skull = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 20), fur); skull.scale.set(0.085, 0.08, 0.09); head.add(skull);
  const eyeMat = new THREE.MeshPhysicalMaterial({ color: 0x120808, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.02 });
  const eyes = [1, -1].map(s => { const e = new THREE.Mesh(new THREE.SphereGeometry(0.014, 14, 10), eyeMat); e.position.set(s * 0.045, 0.015, 0.07); head.add(e); return e; });
  const ears = [1, -1].map(s => {
    const piv = new THREE.Group(); piv.position.set(s * 0.04, 0.06, -0.01); head.add(piv);
    const e = new THREE.Mesh(new THREE.CapsuleGeometry(0.018, 0.08, 4, 8), fur); e.position.y = 0.05; e.scale.z = 0.5; piv.add(e);
    return { piv, s, flick: -9 };
  });
  for (const o of [body, tail, skull, ...ears.map(e => e.piv.children[0])]) o.castShadow = true;
  root.add(body, tail, head); scene.add(root);
  Object.assign(CRIT, { root, body, head, eyes, ears, baseY: root.position.y, yaw: 0, pitch: 0, tYaw: 0, tPitch: 0, blinkT: 2, blinkStart: -1, next: 2, look: null, hopT: -9 });
}
function critterLookAt(p, t) { CRIT.look = { x: p.x, z: p.z, until: t + 4.5 }; }
const _cw = new V3();
function updateCritter(dt, t) {
  const R = CRIT;
  if (t > R.blinkT) { R.blinkStart = t; R.blinkT = t + (rng() < 0.2 ? 0.35 : rr(2.2, 6.5)); }   // sometimes a double blink
  const bp = (t - R.blinkStart) / 0.16, lid = bp >= 0 && bp <= 1 ? Math.sin(bp * Math.PI) : 0;
  for (const e of R.eyes) e.scale.y = 1 - 0.9 * lid;
  if (t > R.next) { R.next = t + rr(2.5, 6); R.tYaw = rr(-0.7, 0.7); R.tPitch = rr(-0.2, 0.15); pick(R.ears).flick = t; }
  let yaw = R.tYaw, pitch = R.tPitch;
  if (R.look && t < R.look.until) {
    _cw.set(R.look.x, 0, R.look.z); R.root.worldToLocal(_cw); _cw.sub(R.head.position);
    yaw = clamp(Math.atan2(_cw.x, _cw.z), -1.2, 1.2); pitch = clamp(Math.atan2(-_cw.y, Math.hypot(_cw.x, _cw.z)), -0.3, 0.5);
  } else if (R.look) R.look = null;
  R.yaw = damp(R.yaw, yaw, 3.5, dt); R.pitch = damp(R.pitch, pitch, 3, dt);
  R.head.rotation.set(R.pitch, R.yaw, 0);
  for (const e of R.ears) {
    const f = t - e.flick, flick = f > 0 && f < 0.35 ? Math.sin(f / 0.35 * Math.PI * 3) * 0.15 * (1 - f / 0.35) : 0;
    e.piv.rotation.set(-0.15 + flick, 0, -e.s * 0.25);
  }
  const br = Math.sin(t * 3.1); R.body.scale.set(0.13, 0.11 * (1 + 0.015 * br), 0.16);
  const h = t - R.hopT; R.root.position.y = R.baseY + (h > 0 && h < 0.45 ? Math.sin(h / 0.45 * Math.PI) * 0.12 : 0);   // hops up only: never into the rock
}

/* ---------- Space burst spectacle: fireflies over the pond, leaf storm (via uBurst), golden ripples ---------- */
function updateSpectacle(dt, t) {
  if (EVT.t0 !== SCN.t0) { SCN.t0 = EVT.t0; SCN.rip = 0; }
  const e = t - EVT.t0, g = G.uBurst.value;
  if (g > 0.02) {
    const n = Math.round(120 * g * dt + rng());
    for (let k = 0; k < n; k++) emit(FX.fire, POND.x + rr(-6, 6), rr(0.3, 2.4), POND.z + rr(-5, 5), rr(-0.3, 0.3), rr(-0.1, 0.25), rr(-0.3, 0.3), rr(3, 6), rr(0.03, 0.06), 1.8, 1.5, 0.5, 0, 2);
  }
  const ripAt = [0.6, 2.2, 4.0];
  while (SCN.rip < ripAt.length && e > ripAt[SCN.rip]) {
    let x, z, tries = 0; do { x = POND.x + rr(-3, 3); z = POND.z + rr(-3, 3); } while (!waterFree(x, z, 0.5) && ++tries < 30);
    addRipple(x, z, 0.65); SCN.rip++;
  }
}
