/* =====================================================================
   fx — CPU particle pools (sparks / droplets / drifting motes),
        drifters (instanced falling things that land, float, rest),
        Space-key burst envelope, HDR post (bloom, god-rays, ACES grade)
   ===================================================================== */
const FX = {};

/* ---- generic CPU particle pool rendered as distance-scaled additive points ----
   kind 0: spark (no collision) · 1: droplet (dies on any surface) · 2: drifting mote (sways, dies on surface) */
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
  FX.pools = FX.pools || []; FX.pools.push(pool);
  return pool;
}
function emit(P, x, y, z, vx, vy, vz, life, size, r, g, b, grav = 0, kind = 0) {
  const i = P.ptr; P.ptr = (P.ptr + 1) % P.N;
  P.pos.set([x, y, z], i * 3); P.vel.set([vx, vy, vz], i * 3); P.c0.set([r, g, b], i * 3);
  P.life[i] = life; P.age[i] = 0; P.s0[i] = size; P.grav[i] = grav; P.kind[i] = kind;
}
function updatePool(P, dt) {
  for (let i = 0; i < P.N; i++) {
    if (P.life[i] <= 0) { P.size[i] = 0; continue; }
    const a = (P.age[i] += dt), f = a / P.life[i], k = i * 3;
    if (f >= 1) { P.life[i] = 0; P.size[i] = 0; continue; }
    P.vel[k + 1] += P.grav[i] * dt;
    if (P.kind[i] === 2) { P.vel[k] += Math.sin(a * 3 + i) * 0.4 * dt; P.vel[k + 2] += Math.cos(a * 2.6 + i) * 0.4 * dt; }
    P.pos[k] += P.vel[k] * dt; P.pos[k + 1] += P.vel[k + 1] * dt; P.pos[k + 2] += P.vel[k + 2] * dt;
    if (P.kind[i] >= 1) { // droplets / drifting motes stop at any solid or water surface
      const sy = surfaceFast(P.pos[k], P.pos[k + 2]);
      if (P.pos[k + 1] <= sy) { P.life[i] = 0; P.size[i] = 0; continue; }
    }
    const fade = P.kind[i] === 2 ? (0.6 + 0.4 * Math.sin(a * 9 + i)) * (1 - f) : Math.pow(1 - f, 1.4);
    P.size[i] = P.s0[i] * (P.kind[i] === 0 ? (1 - f * 0.6) : 1);
    P.col[i * 4] = P.c0[k]; P.col[i * 4 + 1] = P.c0[k + 1]; P.col[i * 4 + 2] = P.c0[k + 2]; P.col[i * 4 + 3] = fade;
  }
  P.pa.needsUpdate = P.ca.needsUpdate = P.sa.needsUpdate = true;
}
function splashAt(x, z, n = 70) {
  for (let i = 0; i < n; i++) {
    const a = rr(0, TAU), s = rr(0.2, 1.1), up = rr(1.2, 2.8);
    emit(FX.splash, x + Math.cos(a) * 0.05, 0.02, z + Math.sin(a) * 0.05, Math.cos(a) * s, up, Math.sin(a) * s, rr(1, 1.8), rr(0.018, 0.04), 1.4, 1.3, 1.2, -6.5, 1);
  }
}

/* ---- drifters: petals / leaves / flakes — one draw call, CPU state machine, custom instanced shader ----
   FALL → lands on the baked surface → FLOAT (water: rides waves & ripples, stays inside the water)
                                     → REST  (ground / solids)  → fades out after `life` seconds */
const D_DEAD = 0, D_FALL = 1, D_FLOAT = 2, D_REST = 3;
function makeDrifters({ N, geo, map, tint = new THREE.Color(1, 1, 1), glow = 0.05, fall = -0.4, sway = 0.3 }) {
  const D = { N, ptr: 0, acc: 0, alive: 0, fall, sway };
  const g = new THREE.InstancedBufferGeometry().copy(geo);
  D.aP = new Float32Array(N * 4); D.aR = new Float32Array(N * 4);    // aP: xyz, scale · aR: euler xyz, mode
  D.vel = new Float32Array(N * 3); D.spin = new Float32Array(N * 3); D.age = new Float32Array(N); D.life = new Float32Array(N);
  D.ph = new Float32Array(N); D.mode = new Uint8Array(N); D.s0 = new Float32Array(N);
  D.attrP = new THREE.InstancedBufferAttribute(D.aP, 4).setUsage(THREE.DynamicDrawUsage);
  D.attrR = new THREE.InstancedBufferAttribute(D.aR, 4).setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('aP', D.attrP); g.setAttribute('aR', D.attrR); g.instanceCount = N;
  D.mat = new THREE.ShaderMaterial({
    uniforms: { ...G, tMap: { value: map }, uTint: { value: tint }, uGlow: { value: glow } },
    vertexShader: GLSL_COMMON + GLSL_RIPPLE + /* glsl */`
      attribute vec4 aP; attribute vec4 aR;
      varying vec2 vUv; varying vec3 vN; varying vec3 vW;
      mat3 rotXYZ(vec3 a){ vec3 s=sin(a), c=cos(a);
        return mat3(c.z,s.z,0.,-s.z,c.z,0.,0.,0.,1.)*mat3(c.y,0.,-s.y,0.,1.,0.,s.y,0.,c.y)*mat3(1.,0.,0.,0.,c.x,s.x,0.,-s.x,c.x); }
      void main(){
        mat3 R=rotXYZ(aR.xyz); vec3 p=R*(position*aP.w); vec3 n=R*normal; vec3 wp=aP.xyz;
        if(aR.w>.5&&aR.w<1.5){               // floating: ride waves & ripple rings
          vec3 rp=ripple(wp.xz);
          wp.y+=rp.x*.9+sin(dot(wp.xz,vec2(.3,.12))+uTime*.55)*.008+sin(dot(wp.xz,vec2(-.18,.34))*1.3+uTime*.7)*.006;
          p.y+=dot(p.xz,-rp.yz)*.9;
          n=normalize(n+vec3(-rp.y,0.,-rp.z)*.9);
        }
        vec4 w=vec4(wp+p,1.); vW=w.xyz; vN=n; vUv=uv;
        gl_Position=projectionMatrix*viewMatrix*w;
      }`,
    fragmentShader: GLSL_COMMON + /* glsl */`
      uniform sampler2D tMap; uniform vec3 uTint; uniform float uGlow; varying vec2 vUv; varying vec3 vN; varying vec3 vW;
      void main(){
        vec4 tx=texture2D(tMap,vUv); if(tx.a<.45) discard;
        vec3 alb=tx.rgb*uTint;
        vec3 N=normalize(vN); vec3 V=normalize(cameraPosition-vW); if(dot(N,V)<0.) N=-N;
        float nl=dot(N,uLightDir);
        vec3 col=alb*(uLightCol*(max(nl,0.)*.8+max(-nl,0.)*.35)/3.14159+ambientLight(N)*.35+lampLight(N,vW,.4)*.9);  // back-lit translucency
        float sp=pow(max(dot(reflect(-uLightDir,N),V),0.),18.);
        col+=uLightCol*sp*.15+alb*(uGlow+uBurst*.3);
        gl_FragColor=vec4(applyFog(col,vW),1.);
      }`,
    side: THREE.DoubleSide,
  });
  D.mesh = new THREE.Mesh(g, D.mat); D.mesh.frustumCulled = false;
  scene.add(D.mesh);
  return D;
}
function spawnDrifter(D, x, y, z, scale = 1) {
  const i = D.ptr; D.ptr = (D.ptr + 1) % D.N;
  D.aP.set([x, y, z, scale], i * 4); D.s0[i] = scale;
  D.aR.set([rr(0, TAU), rr(0, TAU), rr(0, TAU), 0], i * 4);
  D.vel.set([0, -0.1, 0], i * 3); D.spin.set([rr(-3, 3), rr(-2, 2), rr(-3, 3)], i * 3);
  D.age[i] = 0; D.life[i] = rr(30, 50); D.ph[i] = rr(0, TAU); D.mode[i] = D_FALL;
}
const _dp = { x: 0, z: 0 }, _push = new THREE.Vector2();
function updateDrifters(D, dt, t) {
  const P = D.aP, R = D.aR, V = D.vel, gust = 0.6 + 0.4 * Math.sin(t * 0.31) * Math.sin(t * 0.13 + 1);
  let alive = 0;
  for (let i = 0; i < D.N; i++) {
    const mode = D.mode[i]; if (mode === D_DEAD) continue;
    alive++;
    const a = (D.age[i] += dt), k4 = i * 4, k3 = i * 3, ph = D.ph[i];
    if (mode === D_FALL) {
      const tvx = 0.26 * gust + Math.sin(a * 1.7 + ph) * D.sway, tvz = 0.16 * gust + Math.cos(a * 1.3 + ph) * D.sway * 0.9, tvy = D.fall + Math.sin(a * 2.3 + ph) * 0.14;
      const kk = 1 - Math.exp(-2.2 * dt);
      V[k3] += (tvx - V[k3]) * kk; V[k3 + 1] += (tvy - V[k3 + 1]) * kk; V[k3 + 2] += (tvz - V[k3 + 2]) * kk;
      P[k4] += V[k3] * dt; P[k4 + 1] += V[k3 + 1] * dt; P[k4 + 2] += V[k3 + 2] * dt;
      R[k4] += D.spin[k3] * dt; R[k4 + 1] += D.spin[k3 + 1] * dt; R[k4 + 2] += D.spin[k3 + 2] * dt;
      const x = P[k4], z = P[k4 + 2];
      if (x * x + z * z > WORLD_R * WORLD_R) { D.mode[i] = D_DEAD; P[k4 + 3] = 0; continue; }   // left the diorama
      const sy = surfaceFast(x, z);
      if (P[k4 + 1] <= sy + 0.006) {
        const kind = SURF_IDX >= 0 ? SURF.k[SURF_IDX] : KIND.ground;
        R[k4] = rr(-0.08, 0.08); R[k4 + 2] = rr(-0.08, 0.08);    // lie flat
        if (kind === KIND.water) { D.mode[i] = D_FLOAT; R[k4 + 3] = 1; P[k4 + 1] = 0.01; }
        else { D.mode[i] = D_REST; R[k4 + 3] = 2; P[k4 + 1] = sy + 0.004; }
      }
    } else if (mode === D_FLOAT) {
      const x = P[k4], z = P[k4 + 2];
      let vx = -(z - POND.z) * 0.005 + (noise2(x * 0.15 + t * 0.02, z * 0.15) - 0.5) * 0.14 + 0.02 * gust;
      let vz = (x - POND.x) * 0.005 + (noise2(x * 0.15 + 30, z * 0.15 - t * 0.02) - 0.5) * 0.14;
      ripplePush(x, z, t, _push); vx += _push.x; vz += _push.y;
      _dp.x = x + vx * dt; _dp.z = z + vz * dt;
      constrainWater(_dp, 0.06);
      P[k4] = _dp.x; P[k4 + 2] = _dp.z; R[k4 + 1] += dt * 0.15 * Math.sin(ph);
    }
    const life = D.life[i];
    if (a > life) {
      const f = 1 - (a - life) / 2.5;
      if (f <= 0) { D.mode[i] = D_DEAD; P[k4 + 3] = 0; continue; }
      P[k4 + 3] = D.s0[i] * f; if (mode === D_FLOAT) P[k4 + 1] = 0.01 - (1 - f) * 0.05;   // sink away
    }
  }
  D.alive = alive;
  D.attrP.needsUpdate = true; D.attrR.needsUpdate = true;
}

/* ---- Space-key burst: a 0→1→0 envelope in G.uBurst; scene code reads EVT / G.uBurst to add its own spectacle ---- */
const EVT = { t0: -99 };
const BURST_LEN = 10.5;
function triggerBurst(t) { EVT.t0 = t; }
function updateBurst(dt, t) {
  const e = t - EVT.t0;
  G.uBurst.value = smooth(0, 1.2, e) * (1 - smooth(BURST_LEN - 4, BURST_LEN, e));
  for (const P of FX.pools || []) updatePool(P, dt);
}

/* ================= post-processing: HDR scene → bloom mip chain → god-rays → ACES composite ================= */
const POST = { rayDir: null, rayDist: 400 };   // rayDir: world direction of the bright source for god-rays (null = off)
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
  POST.raysM = fsMat(`uniform sampler2D tIn; uniform vec2 uSrc; uniform float uAsp, uVis;
    void main(){
      vec2 d=(vUv-uSrc); vec3 sum=vec3(0.); float w=1.;
      for(int i=0;i<56;i++){
        vec2 p=vUv-d*(float(i)/56.)*.92;
        vec2 q=(p-uSrc)*vec2(uAsp,1.); float m=smoothstep(.42,.05,length(q));
        sum+=texture2D(tIn,p).rgb*m*w; w*=.965;
      }
      gl_FragColor=vec4(sum/56.*uVis,1.); }`, { tIn: { value: null }, uSrc: { value: new THREE.Vector2() }, uAsp: { value: 1 }, uVis: { value: 0 } });
  POST.comp = fsMat(`uniform sampler2D tScene, tBloom, tRays; uniform float uExp, uBloom, uRays, uTime; uniform vec2 uRes;
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
      vec2 v=vUv-.5; c*=1.-dot(v,v)*.62;                                     // vignette
      c=pow(c,vec3(1./2.2));
      c+=(h(vUv*uRes+fract(uTime))-.5)*.022;                                 // film grain, kills banding
      gl_FragColor=vec4(c,1.);
    }`, { tScene: { value: null }, tBloom: { value: null }, tRays: { value: null }, uExp: { value: 1.6 }, uBloom: { value: 0.8 }, uRays: { value: 0.3 }, uTime: G.uTime, uRes: { value: new THREE.Vector2() } });
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
  // god-rays: radial blur of the bright pass toward the light source's screen position
  const r = POST.raysM.uniforms;
  let vis = 0;
  if (POST.rayDir) {
    _mv.copy(camera.position).addScaledVector(POST.rayDir, POST.rayDist).project(camera);
    vis = _mv.z < 1 ? smooth(1.6, 1.0, Math.max(Math.abs(_mv.x), Math.abs(_mv.y))) : 0;
    r.uSrc.value.set(_mv.x * 0.5 + 0.5, _mv.y * 0.5 + 0.5);
  }
  r.tIn.value = D[0].texture; r.uAsp.value = POST.w / POST.h; r.uVis.value = vis;
  pass(POST.raysM, POST.rays);
  const c = POST.comp.uniforms; c.tScene.value = POST.scene.texture; c.tBloom.value = U[0].texture; c.tRays.value = POST.rays.texture;
  pass(POST.comp, null);
}
