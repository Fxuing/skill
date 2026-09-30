/* =====================================================================
   world — terrain, baked pond heightmap, planar-reflection water
   ===================================================================== */
const WORLD = { rocks: [], pathPts: [] };

function buildTerrain() {
  // non-uniform grid: dense around the pond, sparse toward the horizon
  const SEG = 320, S = 150, K = 3.0, sk = Math.sinh(K);
  const map = u => S * Math.sinh(K * u) / sk;
  const nv = (SEG + 1) * (SEG + 1);
  const pos = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), col = new Float32Array(nv * 3);
  const c = new THREE.Color(), silt = new THREE.Color(0x3a3a2b), deepSilt = new THREE.Color(0x1d2119);
  const moss = new THREE.Color(0x2e3c20), lawn = new THREE.Color(0x3a4523), soil = new THREE.Color(0x4a3e2b), pave = new THREE.Color(0x77736a);
  let k = 0;
  for (let j = 0; j <= SEG; j++) for (let i = 0; i <= SEG; i++, k++) {
    const x = map(i / SEG * 2 - 1), z = map(j / SEG * 2 - 1);
    const y = groundH(x, z), d = pondSDF(x, z);
    pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
    uv[k * 2] = x / 5; uv[k * 2 + 1] = z / 5;
    if (d < 0) c.copy(silt).lerp(deepSilt, smooth(0, 3, -d));
    else {
      c.copy(moss).lerp(lawn, smooth(0.4, 3, d)).lerp(soil, fbm2(x * 0.3 + 40, z * 0.3, 3) * 0.7);
      // worn earth path along the back bank, paved landing at the pavilion steps
      const pathD = Math.abs(z - lerp(-8.4, -10.6, smooth(-12, 0, x)) + 2.2 * smooth(6, 14.5, x) * (x > 6 ? 1 : 0));
      c.lerp(soil, smooth(1.4, 0.3, pathD) * 0.5 * smooth(-12, -9, x));
      const pd = Math.max(Math.abs(x - 15.2) - 1.6, Math.abs(z + 5) - 2.2);
      c.lerp(pave, smooth(0.3, -0.1, pd));
    }
    c.multiplyScalar(0.85 + 0.3 * noise2(x * 1.3, z * 1.3));
    col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
  }
  const idx = new Uint32Array(SEG * SEG * 6); k = 0;
  for (let j = 0; j < SEG; j++) for (let i = 0; i < SEG; i++) {
    const a = j * (SEG + 1) + i, b = a + 1, cc = a + SEG + 1, d = cc + 1;
    idx.set([a, cc, b, b, cc, d], k); k += 6;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();

  const tex = pixelTex(512, 512, (u, v) => {
    const n = fbm2(u * 16, v * 16, 4), p = noise2(u * 90, v * 90), gr = noise2(u * 200, v * 60);
    let l = 150 + (n - 0.5) * 120 + (p > 0.72 ? 40 : 0) - (p < 0.2 ? 25 : 0) + (gr - 0.5) * 30;
    return [l, l * 0.98, l * 0.9];
  }, { repeat: true });
  const bump = pixelTex(512, 512, (u, v) => {
    const p = noise2(u * 90, v * 90), n = fbm2(u * 30, v * 30, 3);
    const l = 90 + n * 90 + (p > 0.7 ? 70 : 0); return [l, l, l];
  }, { repeat: true, srgb: false });
  const mat = new THREE.MeshStandardMaterial({ map: tex, bumpMap: bump, bumpScale: 1.2, vertexColors: true, roughness: 0.96, metalness: 0, envMapIntensity: 0.6 });
  WORLD.terrain = new THREE.Mesh(g, mat);
  WORLD.terrain.receiveShadow = true;
  scene.add(WORLD.terrain);
}

/* ---- baked pond bed height (R) + shore distance (G) for the water shader ---- */
const HM = { x0: -25, z0: -13, sx: 44, sz: 26 };
function bakeHeightmap() {
  const W = 256, H = 152, data = new Uint8Array(W * H * 4);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const x = HM.x0 + (i + 0.5) / W * HM.sx, z = HM.z0 + (j + 0.5) / H * HM.sz, k = (j * W + i) * 4;
    data[k] = clamp((groundH(x, z) + 2) / 3, 0, 1) * 255;
    data[k + 1] = clamp((pondSDF(x, z) + 4) / 8, 0, 1) * 255;
    data[k + 3] = 255;
  }
  const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  t.magFilter = t.minFilter = THREE.LinearFilter; t.needsUpdate = true;
  return t;
}

/* ---- water with planar reflection (oblique-clipped mirrored camera) ---- */
const reflCam = new THREE.PerspectiveCamera();
const reflTexMat = new THREE.Matrix4();
let reflRT = null;
function buildWater() {
  reflRT = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: true });
  WORLD.waterMat = new THREE.ShaderMaterial({
    uniforms: {
      ...G, tRefl: { value: reflRT.texture }, uTexMat: { value: reflTexMat }, tHM: { value: bakeHeightmap() },
      uHMo: { value: new THREE.Vector4(HM.x0, HM.z0, 1 / HM.sx, 1 / HM.sz) },
    },
    vertexShader: /* glsl */`
      uniform mat4 uTexMat; varying vec3 vW; varying vec4 vR;
      void main(){ vec4 w=modelMatrix*vec4(position,1.); vW=w.xyz; vR=uTexMat*w; gl_Position=projectionMatrix*viewMatrix*w; }`,
    fragmentShader: GLSL_COMMON + GLSL_RIPPLE + /* glsl */`
      uniform sampler2D tRefl, tHM; uniform vec4 uHMo; uniform vec3 uMoonDir;
      varying vec3 vW; varying vec4 vR;
      void main(){
        vec2 p=vW.xz; float t=uTime;
        vec2 g=vec2(0.);
        g+=vec2(.30,.12)*cos(dot(p,vec2(.30,.12))+t*.55)*.020;
        g+=vec2(-.18,.34)*cos(dot(p,vec2(-.18,.34))*1.3+t*.7)*.016;
        g+=vec2(.52,-.28)*cos(dot(p,vec2(.52,-.28))*1.1+t*.9)*.011;
        vec2 fp=p*1.5+vec2(t*.05,t*.032); float e=.09, n0=fbm(fp);
        g+=vec2(fbm(fp+vec2(e,0.))-n0,fbm(fp+vec2(0.,e))-n0)/e*.030;
        vec2 fp2=p*4.6-vec2(t*.10,-t*.07); float m0=vnoise(fp2);
        g+=vec2(vnoise(fp2+vec2(e,0.))-m0,vnoise(fp2+vec2(0.,e))-m0)/e*.010;
        g*=1.+uGold*.5;
        vec3 rp=ripple(p); g+=rp.yz;
        vec3 N=normalize(vec3(-g.x,1.,-g.y));
        // capillary micro-facets: break the mirrored moon into shimmering fragments
        vec2 mp=p*vec2(7.,11.)+vec2(t*.32,-t*.45); float q0=vnoise(mp); const float ee=.06;
        vec2 mg=vec2(vnoise(mp+vec2(ee,0.))-q0,vnoise(mp+vec2(0.,ee))-q0)/ee*.022;
        vec2 mp2=p*vec2(19.,27.)-vec2(t*.55,t*.38); float q1=vnoise(mp2);
        mg+=vec2(vnoise(mp2+vec2(ee,0.))-q1,vnoise(mp2+vec2(0.,ee))-q1)/ee*.011;
        vec3 Nm=normalize(vec3(-(g.x+mg.x),1.,-(g.y+mg.y)));
        vec3 V=normalize(cameraPosition-vW); float NdV=max(dot(N,V),0.);
        const float F0=.02;                      // ((1.33-1)/(1.33+1))^2 : water, IOR 1.33
        float fres=F0+(1.-F0)*pow(1.-NdV,5.);
        float R=mix(.30,1.,fres);
        vec2 ruv=vR.xy/vR.w+vec2(Nm.x*.06,Nm.z*.3);
        vec3 refl=texture2D(tRefl,ruv).rgb;
        float rl=dot(refl,vec3(.2126,.7152,.0722)); refl*=1./(1.+max(rl-.35,0.)*.9);   // soft-cap the mirrored moon
        vec4 hm=texture2D(tHM,(p-uHMo.xy)*uHMo.zw); float depth=max(-(hm.r*3.-2.),0.);
        float trans=exp(-depth*1.5);
        vec3 body=vec3(.003,.010,.016)*(.4+.6*max(dot(N,uLightDir),0.))+lanternLight(N,vW,.3)*vec3(.016,.02,.02);
        vec3 col=refl*R+body*(1.-R);
        float alpha=clamp(mix(1.-trans*.82,1.,R),0.,1.);
        // moon glitter path: facet-slope distribution around the mirror direction
        vec3 H=normalize(uMoonDir+V); float nh=max(dot(Nm,H),0.);
        float t2=(1.-H.y*H.y)/max(H.y*H.y,1e-4);
        float path=exp(-t2/(.0030*(1.+uGold*.6)));
        float brk=smoothstep(.45,.9,vnoise(p*vec2(5.,13.)+vec2(0.,t*.9))*vnoise(p*vec2(12.,4.)-vec2(t*.7,0.))*1.9);
        vec3 moonC=vec3(1.,.87,.64);
        col+=moonC*path*(.012+brk*.16)*(1.+uGold*1.2);
        float glint=pow(nh,2600.)*brk;                 // sparse facet sparkles, never a solid disc
        col+=moonC*glint*(.6+2.2*path)*(1.+uGold*1.2);
        float crest=clamp(abs(rp.x)*26.,0.,1.);
        col+=vec3(1.,.66,.26)*crest*(.5+uGold*.25);
        float sp=smoothstep(.9,1.,vnoise(p*24.+vec2(t*1.3,-t)))*smoothstep(.55,1.,vnoise(p*2.6-t*.2));
        col+=vec3(1.,.72,.3)*sp*uGold*2.;
        col=applyFog(col,vW);
        float shore=smoothstep(0.,.06,depth);
        gl_FragColor=vec4(col*shore,alpha*shore);
      }`,
    transparent: true, depthWrite: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  const wg = new THREE.PlaneGeometry(HM.sx - 2, HM.sz - 2, 1, 1); wg.rotateX(-Math.PI / 2);
  WORLD.water = new THREE.Mesh(wg, WORLD.waterMat);
  WORLD.water.position.set(HM.x0 + HM.sx / 2, 0, HM.z0 + HM.sz / 2);
  WORLD.water.renderOrder = 1;
  scene.add(WORLD.water);
}

const _rp = new V3(), _rt = new V3(), _ru = new V3(), _q4 = new THREE.Vector4(), _plane = new THREE.Plane();
function updateReflectionCamera(cam) {
  _rp.setFromMatrixPosition(cam.matrixWorld);
  _rt.set(0, 0, -1).applyQuaternion(cam.quaternion).add(_rp);
  _ru.set(0, 1, 0).applyQuaternion(cam.quaternion);
  reflCam.position.set(_rp.x, -_rp.y, _rp.z);
  _rt.y = -_rt.y; _ru.y = -_ru.y;
  reflCam.up.copy(_ru); reflCam.lookAt(_rt);
  reflCam.fov = cam.fov; reflCam.aspect = cam.aspect; reflCam.near = cam.near; reflCam.far = cam.far;
  reflCam.updateProjectionMatrix(); reflCam.updateMatrixWorld();
  reflTexMat.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
    .multiply(reflCam.projectionMatrix).multiply(reflCam.matrixWorldInverse);
  // oblique near plane = water surface, so nothing below the water leaks into the mirror
  _plane.setFromNormalAndCoplanarPoint(new V3(0, 1, 0), new V3(0, 0.0, 0)).applyMatrix4(reflCam.matrixWorldInverse);
  _q4.set(_plane.normal.x, _plane.normal.y, _plane.normal.z, _plane.constant);
  const P = reflCam.projectionMatrix.elements, q = new THREE.Vector4(
    (Math.sign(_q4.x) + P[8]) / P[0], (Math.sign(_q4.y) + P[9]) / P[5], -1, (1 + P[10]) / P[14]);
  _q4.multiplyScalar(2 / _q4.dot(q));
  P[2] = _q4.x; P[6] = _q4.y; P[10] = _q4.z + 1 - 0.003; P[14] = _q4.w;
  reflCam.projectionMatrixInverse.copy(reflCam.projectionMatrix).invert();
}
