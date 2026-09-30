/* =====================================================================
   rabbit — the jade rabbit on the white pebble: sculpted anatomy,
            physical sheen skin + combed 3D fur shells with wrap-lit SSS,
            translucent veined ears, ruby eyes, whiskers,
            blinking, ear flicks, sniffing, breathing, curious look-at
   ===================================================================== */
const RABBIT = { shells: [] };

const ell = (cx, cy, cz, rx, ry, rz, rotZ = 0, seg = 36) => ({ g: new THREE.SphereGeometry(1, seg, Math.round(seg * 0.72)), m: M4(cx, cy, cz, 0, 0, rotZ, rx, ry, rz) });

const GLSL_FUR_LIGHT = /* glsl */`
  // wrap diffuse + back-scatter (SSS) + fibre sheen, shared by fur and ear skin
  vec3 furLight(vec3 alb, vec3 N, vec3 V, vec3 W, float ao, float sss, float tip){
    float w=.55, nl=dot(N,uLightDir);
    float diff=max((nl+w)/(1.+w),0.);
    float back=pow(clamp(dot(V,-uLightDir),0.,1.),3.)*(.35+.65*(1.-abs(dot(N,V))));
    float rim=pow(1.-max(dot(N,V),0.),2.5);
    vec3 lan=lanternLight(N,W,w);
    vec3 c=alb*(uLightCol*diff/3.14159+ambientLight(N)*.85+lan)*ao;
    c+=(uLightCol/3.14159+lanternLight(N,W,1.)*.5)*vec3(1.,.62,.55)*back*sss*alb;
    c+=(uLightCol/3.14159*.55+lanternLight(N,W,0.)*.4+uSkyAmb*.4)*rim*tip*vec3(1.,.96,.9);
    c+=alb*vec3(.010,.011,.014);                 // faint jade luminance
    return c;
  }
`;

function furMaterial({ len, den, sss, comb, eyes = [], tint = [0.95, 0.93, 0.9] }) {
  const E = [0, 1].map(i => eyes[i] ? eyes[i].clone() : new V3(9, 9, 9));
  return new THREE.ShaderMaterial({
    uniforms: { ...G, uLen: { value: len }, uDen: { value: den }, uSSS: { value: sss }, uComb: { value: comb }, uEyeA: { value: E[0] }, uEyeB: { value: E[1] }, uTint: { value: new THREE.Color(...tint) } },
    vertexColors: true,
    vertexShader: GLSL_COMMON + /* glsl */`
      attribute float aLayer; uniform float uLen; uniform vec3 uComb;
      varying vec3 vN; varying vec3 vW; varying vec3 vB; varying float vL; varying vec3 vCol;
      void main(){
        float L=aLayer, lv=.62+.62*vnoise3(position*26.);          // length varies over the coat
        vec3 p=position+normal*uLen*lv*L+uComb*uLen*lv*L*L;       // combed toward the back
        p.y-=uLen*.28*L*L;                                         // gravity droop
        vec4 w=modelMatrix*vec4(p,1.); vW=w.xyz; vN=normalize(mat3(modelMatrix)*normal); vB=position; vL=L/lv; vCol=color;
        gl_Position=projectionMatrix*viewMatrix*w;
      }`,
    fragmentShader: GLSL_COMMON + GLSL_FUR_LIGHT + /* glsl */`
      uniform float uDen, uSSS; uniform vec3 uEyeA, uEyeB, uTint;
      varying vec3 vN; varying vec3 vW; varying vec3 vB; varying float vL; varying vec3 vCol;
      void main(){
        vec3 q=vB*uDen;
        float s=vnoise3(q)*.42+hash13(floor(q*2.6))*.38+vnoise3(q*.22)*.2;   // strands + clumps
        float bare=step(vCol.g,.85);                                          // pink inner ear: almost bare
        if(s<min(vL,1.)*.9+.07+bare*.85) discard;
        if(length(vB-uEyeA)<.021||length(vB-uEyeB)<.021) discard;
        vec3 N=normalize(vN), V=normalize(cameraPosition-vW);
        float tip=clamp(vL,0.,1.);
        vec3 alb=vCol*uTint*mix(.72,1.06,tip)*(.94+.1*hash13(floor(q*2.6)+2.));
        float ao=mix(.45,1.,tip)*mix(.7,1.,N.y*.5+.5);
        gl_FragColor=vec4(applyFog(furLight(alb,N,V,vW,ao,uSSS,tip),vW),1.);
      }`,
  });
}
function furShells(geo, mat, layers) {
  const g = new THREE.InstancedBufferGeometry().copy(geo);
  const L = new Float32Array(layers); for (let i = 0; i < layers; i++) L[i] = (i + 1) / layers;
  g.setAttribute('aLayer', new THREE.InstancedBufferAttribute(L, 1)); g.instanceCount = layers;
  const m = new THREE.Mesh(g, mat); m.frustumCulled = false; RABBIT.shells.push(m); return m;
}

// ear: thin, cupped, rounded-tip volume; front (+x) side is pink skin
function earGeometry(L, W, T) {
  const g = new THREE.SphereGeometry(1, 28, 36), P = g.attributes.position, col = [];
  const wOf = v => W * (v < 0.42 ? lerp(0.55, 1, Math.sin(v / 0.42 * Math.PI / 2)) : Math.sqrt(Math.max(0, 1 - ((v - 0.42) / 0.58) ** 2)));
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i), v = (y + 1) / 2, w = wOf(v);
    const zz = z * w / W;
    P.setXYZ(i, x * T * (0.4 + 0.6 * w / W) + 0.014 * zz * zz - 0.012 * v * v, v * L, z * w);
    const inner = x > 0.25 && Math.abs(z) < 0.8 && v > 0.08 && v < 0.94;
    col.push(inner ? 0.97 : 1, inner ? 0.68 : 1, inner ? 0.7 : 1);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}
function earSkinMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { ...G },
    vertexColors: true,
    vertexShader: /* glsl */`
      varying vec3 vN; varying vec3 vW; varying vec3 vB; varying vec3 vCol;
      void main(){ vec4 w=modelMatrix*vec4(position,1.); vW=w.xyz; vN=normalize(mat3(modelMatrix)*normal); vB=position; vCol=color; gl_Position=projectionMatrix*viewMatrix*w; }`,
    fragmentShader: GLSL_COMMON + GLSL_FUR_LIGHT + /* glsl */`
      varying vec3 vN; varying vec3 vW; varying vec3 vB; varying vec3 vCol;
      void main(){
        vec3 N=normalize(vN), V=normalize(cameraPosition-vW);
        float pinkness=1.-vCol.g;
        // branching veins along the ear
        float vz=vB.z+.004*sin(vB.y*70.);
        float vein=exp(-abs(vz)*900.)+exp(-abs(vz-.008-vB.y*.06)*1400.)*.7+exp(-abs(vz+.008+vB.y*.06)*1400.)*.7;
        vec3 alb=mix(vCol,vec3(.78,.28,.32),vein*pinkness*.55);
        vec3 c=furLight(alb,N,V,vW,1.,.6+pinkness*2.4,.4);
        gl_FragColor=vec4(applyFog(c,vW),1.);
      }`,
  });
}

function buildRabbit() {
  const skin = new THREE.MeshPhysicalMaterial({ vertexColors: true, color: 0xf2eee8, roughness: 0.88, sheen: 1, sheenRoughness: 0.35, sheenColor: 0xfff0e6, emissive: 0x2a2622, envMapIntensity: 0.9 });
  const root = new THREE.Group(); scene.add(root);
  root.position.set(RS.x, RS.top - 0.008, RS.z); root.rotation.y = 2.61; root.scale.setScalar(1.5);

  /* body: sitting loaf with raised chest */
  const bodyG = mergeGeos([
    ell(-0.05, 0.1, 0, 0.13, 0.11, 0.12), ell(-0.06, 0.09, 0.055, 0.09, 0.085, 0.07), ell(-0.06, 0.09, -0.055, 0.09, 0.085, 0.07),
    ell(0.03, 0.135, 0, 0.11, 0.11, 0.095, 0.55), ell(0.095, 0.15, 0, 0.065, 0.085, 0.07), ell(0.1, 0.195, 0, 0.055, 0.05, 0.06),
    ell(0, 0.018, 0.08, 0.09, 0.022, 0.035, 0, 24), ell(0, 0.018, -0.08, 0.09, 0.022, 0.035, 0, 24),
    ell(0.12, 0.05, 0.035, 0.025, 0.05, 0.022, 0, 20), ell(0.12, 0.05, -0.035, 0.025, 0.05, 0.022, 0, 20),
    ell(0.142, 0.017, 0.036, 0.03, 0.018, 0.022, 0, 20), ell(0.142, 0.017, -0.036, 0.03, 0.018, 0.022, 0, 20),
  ].map(p => ({ ...p, c: WHITE })), true);
  const bodyGrp = new THREE.Group(); root.add(bodyGrp);
  const body = new THREE.Mesh(bodyG, skin); body.castShadow = true; bodyGrp.add(body);
  bodyGrp.add(furShells(bodyG, furMaterial({ len: 0.02, den: 420, sss: 0.45, comb: new V3(-0.7, -0.15, 0) }), 28));
  const tailG = mergeGeos([{ ...ell(-0.175, 0.1, 0, 0.038, 0.038, 0.038, 0, 20), c: WHITE }], true);
  const tail = new THREE.Mesh(tailG, skin); bodyGrp.add(tail);
  bodyGrp.add(furShells(tailG, furMaterial({ len: 0.03, den: 380, sss: 0.9, comb: new V3(-0.3, 0.3, 0) }), 22));

  /* head */
  const head = new THREE.Group(); head.position.set(0.11, 0.21, 0); head.rotation.order = 'YZX'; root.add(head);
  const eyeP = [new V3(0.088, 0.066, 0.052), new V3(0.088, 0.066, -0.052)];
  const headG = mergeGeos([
    ell(0.05, 0.055, 0, 0.078, 0.07, 0.066), ell(0.075, 0.08, 0, 0.05, 0.035, 0.05, 0, 28),
    ell(0.11, 0.03, 0, 0.045, 0.04, 0.047, 0, 28), ell(0.14, 0.018, 0.014, 0.018, 0.016, 0.016, 0, 16), ell(0.14, 0.018, -0.014, 0.018, 0.016, 0.016, 0, 16),
    ell(0.075, 0.022, 0.038, 0.042, 0.036, 0.03, 0, 24), ell(0.075, 0.022, -0.038, 0.042, 0.036, 0.03, 0, 24), ell(0.11, 0.005, 0, 0.025, 0.018, 0.022, 0, 16),
  ].map(p => ({ ...p, c: WHITE })), true);
  const headM = new THREE.Mesh(headG, skin); headM.castShadow = true; head.add(headM);
  head.add(furShells(headG, furMaterial({ len: 0.009, den: 520, sss: 0.4, comb: new V3(-0.8, 0.1, 0), eyes: eyeP }), 18));

  // ruby eyes with dark rims and catch-lights
  const eyeMat = new THREE.MeshPhysicalMaterial({ color: 0x5c0710, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.01, emissive: 0x1c0306, envMapIntensity: 2.5 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0x3a2224, roughness: 0.6 });
  const glint = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 2.3, 2.1) });
  RABBIT.eyes = eyeP.map((p, i) => {
    const s = i ? -1 : 1, e = new THREE.Mesh(new THREE.SphereGeometry(0.017, 24, 18), eyeMat); e.position.copy(p); head.add(e);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.0168, 0.0022, 8, 28), rimMat);
    rim.position.copy(p).add(new V3(0.001, 0, s * 0.006)); head.add(rim);
    rim.rotation.set(0, s > 0 ? -0.3 : Math.PI + 0.3, 0);
    const gl = new THREE.Mesh(new THREE.SphereGeometry(0.0032, 8, 6), glint); gl.position.set(0.007, 0.008, s * 0.013); e.add(gl);
    return e;
  });
  RABBIT.nose = new THREE.Mesh(new THREE.SphereGeometry(0.009, 14, 10), new THREE.MeshPhysicalMaterial({ color: 0xd98a8e, roughness: 0.35, clearcoat: 0.6 }));
  RABBIT.nose.position.set(0.155, 0.042, 0); RABBIT.nose.scale.set(0.8, 0.7, 1.25); head.add(RABBIT.nose);

  // whiskers
  const wh = new THREE.Group(); head.add(wh); RABBIT.whiskers = wh;
  const whMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.55, 0.55, 0.52), transparent: true, opacity: 0.8, depthWrite: false });
  for (const s of [1, -1]) for (let k = 0; k < 5; k++) {
    const b = new V3(0.138, 0.028 - k * 0.004, s * 0.022), a = (k - 2) * 0.16, pts = [];
    for (let i = 0; i <= 8; i++) { const t = i / 8; pts.push(new V3(b.x - t * 0.025, b.y + Math.sin(a) * t * 0.05 - t * t * 0.02, b.z + s * t * 0.1)); }
    wh.add(new THREE.Mesh(taperedTube(pts, (t) => 0.0007 * (1 - t * 0.7), 3, false), whMat));
  }

  // ears: translucent veined inner skin, furred back
  const earG = earGeometry(0.135, 0.032, 0.008), earSkin = earSkinMaterial();
  RABBIT.ears = [1, -1].map(s => {
    const piv = new THREE.Group(); piv.position.set(0.035, 0.11, 0.03 * s); piv.rotation.order = 'ZXY'; head.add(piv);
    const e = new THREE.Mesh(earG, earSkin); e.castShadow = true; piv.add(e);
    piv.add(furShells(earG, furMaterial({ len: 0.005, den: 650, sss: 1.2, comb: new V3(0, 0.6, 0) }), 10));
    return { piv, s, rx: 0.15 * s, rz: 0.3, trx: 0.15 * s, trz: 0.3, flick: -9 };
  });
  Object.assign(RABBIT, { root, bodyGrp, head, tail, yaw: 0, pitch: 0, roll: 0, tYaw: 0, tPitch: 0, tRoll: 0, blinkT: 2, blinkStart: -1, next: 2, sniff: 0, look: null });
}

const _rw = new V3();
function rabbitLookAt(x, z, t) {
  if (!RABBIT.root) return;
  if (Math.hypot(x - RS.x, z - RS.z) < 18) RABBIT.look = { x, z, until: t + 4.5 + rr(0, 1.5) };
}
function updateRabbit(dt, t) {
  const R = RABBIT; if (!R.root) return;
  // blink (sometimes a double blink)
  if (t > R.blinkT) { R.blinkStart = t; R.blinkT = t + (rng() < 0.2 ? 0.35 : rr(2.2, 6.5)); }
  const bp = (t - R.blinkStart) / 0.17, lid = bp >= 0 && bp <= 1 ? Math.sin(bp * Math.PI) : 0;
  for (const e of R.eyes) e.scale.y = 1 - 0.92 * lid;
  // idle behaviour
  if (t > R.next) {
    R.next = t + rr(2.5, 6);
    const a = rng();
    if (a < 0.3) { R.tYaw = rr(-0.7, 0.7); R.tPitch = rr(-0.22, 0.12); R.tRoll = rr(-0.12, 0.12); }
    else if (a < 0.55) { const ear = pick(R.ears); ear.trx = ear.s * rr(0.05, 0.5); ear.trz = rr(-0.05, 0.55); ear.flick = t; }
    else if (a < 0.75) { for (const e of R.ears) { e.trz = 0.62; e.trx = e.s * 0.25; } R.tPitch = -0.12; R.tYaw *= 0.5; R.tRoll = 0; }
    else { for (const e of R.ears) { e.trz = rr(-0.05, 0.1); e.trx = e.s * 0.1; } R.tPitch = 0.1; R.sniff = 1.5; R.tRoll = rr(-0.18, 0.18); }
  }
  let yaw = R.tYaw, pitch = R.tPitch, roll = R.tRoll;
  if (R.look && t < R.look.until) {
    _rw.set(R.look.x, 0, R.look.z); R.root.worldToLocal(_rw); _rw.sub(R.head.position);
    yaw = clamp(Math.atan2(-_rw.z, _rw.x), -1.2, 1.2); pitch = clamp(Math.atan2(_rw.y, Math.hypot(_rw.x, _rw.z)), -0.45, 0.2);
    roll = 0.15 * Math.sin(t * 0.8);                      // curious head tilt
    for (const e of R.ears) { e.trz = -0.03; e.trx = e.s * 0.08; }
    R.sniff = 1;
  } else if (R.look) { R.look = null; R.tYaw = yaw * 0.3; }
  R.yaw = damp(R.yaw, yaw, 3.5, dt); R.pitch = damp(R.pitch, pitch, 3, dt); R.roll = damp(R.roll, roll, 2.5, dt);
  R.head.rotation.set(R.roll, R.yaw, R.pitch);
  const br = Math.sin(t * 3.1);
  R.bodyGrp.scale.set(1, 1 + 0.012 * br, 1 + 0.01 * br);
  R.head.position.y = 0.21 + 0.0015 * br;
  for (const e of R.ears) {
    e.rx = damp(e.rx, e.trx, 6, dt); e.rz = damp(e.rz, e.trz, 5, dt);
    const f = t - e.flick, flick = f > 0 && f < 0.35 ? Math.sin(f / 0.35 * Math.PI * 3) * 0.12 * (1 - f / 0.35) : 0;
    e.piv.rotation.set(e.rx + Math.sin(t * 1.3 + e.s) * 0.02 + flick, 0, e.rz);
  }
  R.sniff = Math.max(0, R.sniff - dt * 0.25);
  const tw = Math.max(0, Math.sin(t * 16)) * (0.08 + 0.18 * Math.min(R.sniff, 1));
  R.nose.scale.set(0.8 + tw, 0.7 + tw * 0.6, 1.25);
  R.whiskers.rotation.y = tw * 0.12; R.whiskers.position.y = tw * 0.0015;
}
