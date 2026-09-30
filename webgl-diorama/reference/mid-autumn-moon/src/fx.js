/* =====================================================================
   fx — water mist, osmanthus motes, splash droplets, "Chang'e flies to
        the moon" golden event, HDR post (bloom, moon god-rays, ACES)
   ===================================================================== */
const FX = {};

function buildMist() {
  const N = 240, q = new THREE.PlaneGeometry(1, 1), g = new THREE.InstancedBufferGeometry().copy(q);
  const aF = new Float32Array(N * 4), aS = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    let x, z; do { x = rr(-22, 15); z = rr(-10, 10); } while (pondSDF(x, z) > 0.8);
    aF.set([x, rr(0.15, 1.0), z, rr(2.4, 5.2)], i * 4); aS.set([rr(0.03, 0.09), rr(0, TAU), rr(0.35, 1), rng()], i * 4);
  }
  g.setAttribute('aF', new THREE.InstancedBufferAttribute(aF, 4)); g.setAttribute('aS', new THREE.InstancedBufferAttribute(aS, 4)); g.instanceCount = N;
  FX.mist = new THREE.Mesh(g, new THREE.ShaderMaterial({
    uniforms: { ...G },
    vertexShader: GLSL_COMMON + /* glsl */`
      attribute vec4 aF; attribute vec4 aS; varying vec2 vUv; varying float vA; varying vec3 vC; varying float vSeed;
      void main(){
        vec3 c=aF.xyz+vec3(sin(uTime*aS.x+aS.y)*1.6,sin(uTime*aS.x*.7+aS.y*2.)*.08,cos(uTime*aS.x*.8+aS.y)*1.);
        vec4 mv=viewMatrix*vec4(c,1.); mv.xy+=position.xy*aF.w;
        float d=-mv.z; vA=aS.z*smoothstep(.6,3.5,d)*(1.-smoothstep(40.,70.,d));
        vec3 lan=lanternLight(vec3(0.,1.,0.),c,1.);
        vC=vec3(.52,.6,.82)*.045+lan*.04+vec3(.9,.6,.25)*uGold*.08;
        vUv=position.xy+.5; vSeed=aS.w;
        gl_Position=projectionMatrix*mv;
      }`,
    fragmentShader: GLSL_COMMON + /* glsl */`
      varying vec2 vUv; varying float vA; varying vec3 vC; varying float vSeed;
      void main(){
        vec2 p=vUv*2.-1.; float r=dot(p,p);
        float a=exp(-r*3.2)*(.45+.55*fbm(vUv*2.6+vSeed*9.+vec2(uTime*.015,0.)))*vA*.5;
        gl_FragColor=vec4(vC*a,a*.25);
      }`,
    transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  }));
  FX.mist.frustumCulled = false; FX.mist.renderOrder = 4; scene.add(FX.mist);

  // floating golden motes — the "fragrance" of the osmanthus
  const M = 420, mp = new Float32Array(M * 3), ma = new Float32Array(M * 4);
  for (let i = 0; i < M; i++) {
    const nearTree = rng() < 0.55, x = nearTree ? TR.x + rr(-6, 6) : rr(-20, 16), z = nearTree ? TR.z + 2 + rr(-5, 5) : rr(-10, 9);
    mp.set([x, nearTree ? rr(0.5, 8) : rr(0.2, 2.5), z], i * 3); ma.set([rr(0.6, 1.6), rr(0, TAU), rr(0.2, 0.6), rng()], i * 4);
  }
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.BufferAttribute(mp, 3)); pg.setAttribute('aM', new THREE.BufferAttribute(ma, 4));
  FX.motes = new THREE.Points(pg, new THREE.ShaderMaterial({
    uniforms: { ...G, uScale: { value: 400 } },
    vertexShader: /* glsl */`
      uniform float uTime, uGold, uScale; attribute vec4 aM; varying float vA;
      void main(){
        vec3 p=position+vec3(sin(uTime*.2*aM.x+aM.y)*.8,mod(uTime*.06*aM.x+aM.w*3.,3.)-1.5,cos(uTime*.17*aM.x+aM.y)*.8);
        vec4 mv=viewMatrix*vec4(p,1.);
        vA=(.5+.5*sin(uTime*aM.x*2.+aM.y*3.))*(1.+uGold*.8)*smoothstep(.3,2.,-mv.z);
        gl_PointSize=clamp(aM.z*.05*uScale/-mv.z,1.,24.);
        gl_Position=projectionMatrix*mv;
      }`,
    fragmentShader: /* glsl */`
      varying float vA;
      void main(){ vec2 q=gl_PointCoord-.5; float r=dot(q,q)*4.; gl_FragColor=vec4(vec3(1.,.72,.32)*exp(-r*4.)*vA*1.4,1.); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  FX.motes.frustumCulled = false; FX.motes.renderOrder = 5; scene.add(FX.motes);
}

/* ---- generic CPU particle pool rendered as distance-scaled additive points ---- */
function makePool(N, renderOrder) {
  const pool = { N, ptr: 0, pos: new Float32Array(N * 3), col: new Float32Array(N * 4), size: new Float32Array(N),
    vel: new Float32Array(N * 3), life: new Float32Array(N), age: new Float32Array(N), s0: new Float32Array(N), c0: new Float32Array(N * 3), grav: new Float32Array(N), kind: new Uint8Array(N) };
  const g = new THREE.BufferGeometry();
  pool.pa = new THREE.BufferAttribute(pool.pos, 3).setUsage(THREE.DynamicDrawUsage);
  pool.ca = new THREE.BufferAttribute(pool.col, 4).setUsage(THREE.DynamicDrawUsage);
  pool.sa = new THREE.BufferAttribute(pool.size, 1).setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('position', pool.pa); g.setAttribute('aC', pool.ca); g.setAttribute('aS', pool.sa);
  pool.mat = new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 400 } },
    vertexShader: /* glsl */`
      uniform float uScale; attribute vec4 aC; attribute float aS; varying vec4 vC;
      void main(){ vec4 mv=viewMatrix*vec4(position,1.); vC=aC; gl_PointSize=aS>0.?clamp(aS*uScale/-mv.z,1.5,90.):0.; gl_Position=projectionMatrix*mv; }`,
    fragmentShader: /* glsl */`
      varying vec4 vC;
      void main(){ vec2 q=gl_PointCoord-.5; float r=dot(q,q)*4.; if(r>1.) discard; gl_FragColor=vec4(vC.rgb*vC.a*(exp(-r*5.)+exp(-r*40.)),1.); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  pool.mesh = new THREE.Points(g, pool.mat); pool.mesh.frustumCulled = false; pool.mesh.renderOrder = renderOrder;
  scene.add(pool.mesh);
  return pool;
}
function emit(P, x, y, z, vx, vy, vz, life, size, r, g, b, grav = 0, kind = 0) {
  const i = P.ptr; P.ptr = (P.ptr + 1) % P.N;
  P.pos.set([x, y, z], i * 3); P.vel.set([vx, vy, vz], i * 3); P.c0.set([r, g, b], i * 3);
  P.life[i] = life; P.age[i] = 0; P.s0[i] = size; P.grav[i] = grav; P.kind[i] = kind;
}
function updatePool(P, dt, t) {
  for (let i = 0; i < P.N; i++) {
    if (P.life[i] <= 0) { P.size[i] = 0; continue; }
    const a = (P.age[i] += dt), f = a / P.life[i], k = i * 3;
    if (f >= 1) { P.life[i] = 0; P.size[i] = 0; continue; }
    P.vel[k + 1] += P.grav[i] * dt;
    if (P.kind[i] === 2) { P.vel[k] += Math.sin(a * 3 + i) * 0.4 * dt; P.vel[k + 2] += Math.cos(a * 2.6 + i) * 0.4 * dt; }
    P.pos[k] += P.vel[k] * dt; P.pos[k + 1] += P.vel[k + 1] * dt; P.pos[k + 2] += P.vel[k + 2] * dt;
    if (P.kind[i] >= 1) { // droplets / gold rain stop at any solid or water surface
      const sy = surfaceFast(P.pos[k], P.pos[k + 2]);
      if (P.pos[k + 1] <= sy) { P.life[i] = 0; P.size[i] = 0; continue; }
    }
    const fade = P.kind[i] === 2 ? (0.6 + 0.4 * Math.sin(a * 9 + i)) * (1 - f) : Math.pow(1 - f, 1.4);
    P.size[i] = P.s0[i] * (P.kind[i] === 0 ? (1 - f * 0.6) : 1);
    P.col[i * 4] = P.c0[k]; P.col[i * 4 + 1] = P.c0[k + 1]; P.col[i * 4 + 2] = P.c0[k + 2]; P.col[i * 4 + 3] = fade;
  }
  P.pa.needsUpdate = P.ca.needsUpdate = P.sa.needsUpdate = true;
}

function buildParticles() {
  FX.splash = makePool(500, 6);
  FX.gold = makePool(6000, 7);
}
function splashAt(x, z) {
  for (let i = 0; i < 70; i++) {
    const a = rr(0, TAU), s = rr(0.2, 1.1), up = rr(1.2, 2.8);
    emit(FX.splash, x + Math.cos(a) * 0.05, 0.02, z + Math.sin(a) * 0.05, Math.cos(a) * s, up, Math.sin(a) * s, rr(1, 1.8), rr(0.018, 0.04), 1.6, 1.35, 0.9, -6.5, 1);
  }
}

/* ---- 嫦娥奔月 · 金波狂想 ---- */
const EVT = { t0: -99, rip: 0, meteors: [] };
function triggerGold(t) {
  EVT.t0 = t; EVT.rip = 0; EVT.meteors = [];
  for (let k = 0; k < 4; k++) {
    const az = rr(-0.9, 0.6), el = rr(0.35, 0.8), d = 170;
    const start = new V3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).multiplyScalar(d);
    const dir = new V3(rr(-1, 1), rr(-0.9, -0.4), rr(-0.3, 0.3)).normalize();
    EVT.meteors.push({ t: rr(0.4, 7.5), p: start, v: dir.multiplyScalar(rr(70, 110)), life: rr(0.9, 1.5) });
  }
}
const _cb = new V3(), _c0 = new V3(), _c1 = new V3(), _c2 = new V3(), _c3 = new V3();
function updateGold(dt, t) {
  const e = t - EVT.t0, P = FX.gold;
  const g = smooth(0, 1.2, e) * (1 - smooth(6.5, 10.5, e));
  G.uGold.value = g;
  if (e >= 0 && e < 11) {
    // comet: a luminous trail rising from the pond toward the moon
    const T = 5.5;
    if (e < T) {
      const u = smooth(0, 1, e / T), iu = 1 - u;
      _c0.set(1.5, 1.0, -1.5); _c1.set(-3, 10, -6); _c2.set(-10, 34, -60); _c3.copy(MOON_DIR).multiplyScalar(300);
      _cb.set(0, 0, 0).addScaledVector(_c0, iu * iu * iu).addScaledVector(_c1, 3 * iu * iu * u).addScaledVector(_c2, 3 * iu * u * u).addScaledVector(_c3, u * u * u);
      const dist = _cb.distanceTo(camera.position), sc = Math.max(1, dist / 14), n = Math.round(240 * dt) + 1;
      for (let k = 0; k < n; k++) emit(P, _cb.x + rr(-0.08, 0.08) * sc, _cb.y + rr(-0.08, 0.08) * sc, _cb.z + rr(-0.08, 0.08) * sc, rr(-0.25, 0.25) * sc, rr(-0.35, 0.15) * sc, rr(-0.25, 0.25) * sc,
        rr(1.0, 2.2), rr(0.08, 0.2) * sc, 1.9, rr(1.1, 1.4), rr(0.4, 0.6), -0.12 * sc, 3);
      emit(P, _cb.x, _cb.y, _cb.z, 0, 0, 0, 0.08, 0.9 * sc, 3.0, 2.4, 1.5, 0, 0);
    }
    // gold rain drifting down onto the pond
    if (g > 0.05) {
      const n = Math.round(100 * g * dt + rng());
      for (let k = 0; k < n; k++) emit(P, rr(-16, 16), rr(9, 15), rr(-11, 8), rr(-0.2, 0.2), rr(-1.0, -0.6), rr(-0.2, 0.2), rr(7, 11), rr(0.025, 0.045), 1.5, 1.0, 0.36, 0, 2);
    }
    // meteors with fading trails
    for (const m of EVT.meteors) {
      const a = e - m.t; if (a < 0 || a > m.life) continue;
      _cb.copy(m.p).addScaledVector(m.v, a);
      const sc = Math.max(1, _cb.distanceTo(camera.position) / 14), n = Math.round(260 * dt) + 1;
      for (let k = 0; k < n; k++) { const b = rng() * dt; emit(P, _cb.x - m.v.x * b, _cb.y - m.v.y * b, _cb.z - m.v.z * b, 0, 0, 0, rr(0.35, 0.6), rr(0.07, 0.13) * sc, 1.7, 1.35, 0.8, 0, 0); }
    }
    // gentle golden ripples across the moon's reflection
    const ripAt = [0.6, 2.2, 4.0];
    while (EVT.rip < ripAt.length && e > ripAt[EVT.rip]) {
      let x, z; do { x = rr(-6, 8); z = rr(-6, 3); } while (!waterFree(x, z, 0.5));
      addRipple(x, z, 0.65); EVT.rip++;
    }
  }
  updatePool(P, dt, t);
  updatePool(FX.splash, dt, t);
}

/* ================= post-processing ================= */
const POST = {};
function fsMat(frag, uniforms) {
  return new THREE.ShaderMaterial({
    uniforms, depthTest: false, depthWrite: false,
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.,1.); }',
    fragmentShader: 'varying vec2 vUv;\n' + frag,
  });
}
function buildPost() {
  const mk = (samples = 0) => new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples, depthBuffer: samples > 0 });
  POST.scene = mk(4); POST.levels = 5;
  POST.down = [...Array(POST.levels + 1)].map(() => mk());
  POST.up = [...Array(POST.levels)].map(() => mk());
  POST.rays = mk();
  POST.fsScene = new THREE.Scene(); POST.fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  POST.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2)); POST.quad.frustumCulled = false; POST.fsScene.add(POST.quad);
  POST.pre = fsMat(`uniform sampler2D tIn; uniform vec2 uTx;
    void main(){ vec3 c=(texture2D(tIn,vUv+uTx*vec2(-1,-1)).rgb+texture2D(tIn,vUv+uTx*vec2(1,-1)).rgb+texture2D(tIn,vUv+uTx*vec2(-1,1)).rgb+texture2D(tIn,vUv+uTx*vec2(1,1)).rgb)*.25;
      c=min(c,vec3(40.)); float br=max(c.r,max(c.g,c.b)), T=1.0, K=.4;
      float s=clamp(br-T+K,0.,2.*K); s=s*s/(4.*K+1e-4); c*=max(s,br-T)/max(br,1e-4);
      gl_FragColor=vec4(c,1.); }`, { tIn: { value: null }, uTx: { value: new THREE.Vector2() } });
  POST.dn = fsMat(`uniform sampler2D tIn; uniform vec2 uTx;
    void main(){ vec3 c=texture2D(tIn,vUv).rgb*4.; c+=texture2D(tIn,vUv-uTx).rgb+texture2D(tIn,vUv+uTx).rgb+texture2D(tIn,vUv+vec2(uTx.x,-uTx.y)).rgb+texture2D(tIn,vUv-vec2(uTx.x,-uTx.y)).rgb;
      gl_FragColor=vec4(c/8.,1.); }`, { tIn: { value: null }, uTx: { value: new THREE.Vector2() } });
  POST.upM = fsMat(`uniform sampler2D tIn; uniform sampler2D tCur; uniform vec2 uTx; uniform float uW;
    void main(){ vec3 c=vec3(0.);
      c+=texture2D(tIn,vUv+vec2(-uTx.x*2.,0.)).rgb+texture2D(tIn,vUv+vec2(uTx.x*2.,0.)).rgb+texture2D(tIn,vUv+vec2(0.,-uTx.y*2.)).rgb+texture2D(tIn,vUv+vec2(0.,uTx.y*2.)).rgb;
      c+=(texture2D(tIn,vUv+uTx).rgb+texture2D(tIn,vUv-uTx).rgb+texture2D(tIn,vUv+vec2(uTx.x,-uTx.y)).rgb+texture2D(tIn,vUv+vec2(-uTx.x,uTx.y)).rgb)*2.;
      gl_FragColor=vec4(c/12.+texture2D(tCur,vUv).rgb*uW,1.); }`, { tIn: { value: null }, tCur: { value: null }, uTx: { value: new THREE.Vector2() }, uW: { value: 1 } });
  POST.raysM = fsMat(`uniform sampler2D tIn; uniform vec2 uMoon; uniform float uAsp, uVis;
    void main(){
      vec2 d=(vUv-uMoon); float acc=0.; vec3 sum=vec3(0.); float w=1.;
      for(int i=0;i<56;i++){
        vec2 p=vUv-d*(float(i)/56.)*.92;
        vec2 q=(p-uMoon)*vec2(uAsp,1.); float m=smoothstep(.42,.05,length(q));
        sum+=texture2D(tIn,p).rgb*m*w; w*=.965;
      }
      gl_FragColor=vec4(sum/56.*uVis,1.); }`, { tIn: { value: null }, uMoon: { value: new THREE.Vector2() }, uAsp: { value: 1 }, uVis: { value: 0 } });
  POST.comp = fsMat(`uniform sampler2D tScene, tBloom, tRays; uniform float uExp, uBloom, uRays, uTime, uGold; uniform vec2 uRes;
    vec3 rrt(vec3 v){ vec3 a=v*(v+.0245786)-.000090537; vec3 b=v*(.983729*v+.432951)+.238081; return a/b; }
    vec3 aces(vec3 c){ const mat3 I=mat3(.59719,.07600,.02840,.35458,.90834,.13383,.04823,.01566,.83777);
      const mat3 O=mat3(1.60475,-.10208,-.00327,-.53108,1.10813,-.07276,-.07367,-.00605,1.07602); return clamp(O*rrt(I*c),0.,1.); }
    float h(vec2 p){ return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453); }
    void main(){
      vec3 c=texture2D(tScene,vUv).rgb+texture2D(tBloom,vUv).rgb*uBloom+texture2D(tRays,vUv).rgb*uRays;
      c*=uExp;
      float l=dot(c,vec3(.2126,.7152,.0722));
      c=mix(c*vec3(.93,.98,1.1),c*vec3(1.06,1.,.9),smoothstep(.02,.6,l));   // cool shadows, warm highlights
      c=aces(c);
      vec2 v=vUv-.5; c*=1.-dot(v,v)*.62;
      c=pow(c,vec3(1./2.2));
      c+=(h(vUv*uRes+fract(uTime))-.5)*.022;
      gl_FragColor=vec4(c,1.);
    }`, { tScene: { value: null }, tBloom: { value: null }, tRays: { value: null }, uExp: { value: 1.8 }, uBloom: { value: 0.85 }, uRays: { value: 0.3 }, uTime: G.uTime, uGold: G.uGold, uRes: { value: new THREE.Vector2() } });
}
function resizePost(w, h) {
  POST.scene.setSize(w, h); POST.w = w; POST.h = h;
  let dw = w, dh = h;
  for (let i = 0; i <= POST.levels; i++) { dw = Math.max(1, dw >> 1); dh = Math.max(1, dh >> 1); POST.down[i].setSize(dw, dh); if (i < POST.levels) POST.up[i].setSize(dw, dh); }
  POST.rays.setSize(Math.max(1, w >> 2), Math.max(1, h >> 2));
  POST.comp.uniforms.uRes.value.set(w, h);
}
function pass(mat, target) { POST.quad.material = mat; renderer.setRenderTarget(target); renderer.render(POST.fsScene, POST.fsCam); }
const _mv = new V3();
function runPost() {
  const D = POST.down, U = POST.up;
  POST.pre.uniforms.tIn.value = POST.scene.texture; POST.pre.uniforms.uTx.value.set(1 / POST.w, 1 / POST.h); pass(POST.pre, D[0]);
  for (let i = 1; i <= POST.levels; i++) { POST.dn.uniforms.tIn.value = D[i - 1].texture; POST.dn.uniforms.uTx.value.set(1 / D[i - 1].width, 1 / D[i - 1].height); pass(POST.dn, D[i]); }
  let src = D[POST.levels];
  for (let i = POST.levels - 1; i >= 0; i--) {
    const u = POST.upM.uniforms; u.tIn.value = src.texture; u.tCur.value = D[i].texture; u.uTx.value.set(1 / src.width, 1 / src.height); u.uW.value = i === 0 ? 0.6 : 1;
    pass(POST.upM, U[i]); src = U[i];
  }
  // god-rays from the moon's screen position
  _mv.copy(camera.position).addScaledVector(MOON_DIR, MOON_D).project(camera);
  const r = POST.raysM.uniforms, onScreen = _mv.z < 1 ? smooth(1.6, 1.0, Math.max(Math.abs(_mv.x), Math.abs(_mv.y))) : 0;
  r.tIn.value = D[0].texture; r.uMoon.value.set(_mv.x * 0.5 + 0.5, _mv.y * 0.5 + 0.5); r.uAsp.value = POST.w / POST.h; r.uVis.value = onScreen;
  pass(POST.raysM, POST.rays);
  const c = POST.comp.uniforms; c.tScene.value = POST.scene.texture; c.tBloom.value = U[0].texture; c.tRays.value = POST.rays.texture;
  c.uBloom.value = 0.8 + G.uGold.value * 0.2;
  pass(POST.comp, null);
}
