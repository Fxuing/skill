/* =====================================================================
   water — planar-reflection water (oblique-clipped mirrored camera),
           fresnel (IOR 1.33), depth tint from a baked bed heightmap,
           wave + ripple normals, glitter path toward the light source
   Dry scene: simply never call buildWater() — main.js skips the mirror
   pass when WORLD.water is unset.
   ===================================================================== */
const WORLD = {};
const NO_REFLECT = [];   // objects hidden during the mirror pass (the water itself, particles, fur shells…)

/* ---- baked bed height (R) + shore distance (G) for the water shader ---- */
const HM = { x0: -WORLD_R, z0: -WORLD_R, sx: WORLD_R * 2, sz: WORLD_R * 2 };
function bakeHeightmap() {
  const W = 256, H = 256, data = new Uint8Array(W * H * 4);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const x = HM.x0 + (i + 0.5) / W * HM.sx, z = HM.z0 + (j + 0.5) / H * HM.sz, k = (j * W + i) * 4;
    data[k] = clamp((groundH(x, z) + 2) / 3, 0, 1) * 255;
    data[k + 1] = clamp((waterSDF(x, z) + 4) / 8, 0, 1) * 255;
    data[k + 3] = 255;
  }
  const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  t.magFilter = t.minFilter = THREE.LinearFilter; t.needsUpdate = true;
  return t;
}

const reflCam = new THREE.PerspectiveCamera();
const reflTexMat = new THREE.Matrix4();
let reflRT = null;
function buildWater({ glintDir = LIGHT_DIR, glintCol = new THREE.Color(1, 0.87, 0.64), deep = new THREE.Color(0.003, 0.010, 0.016) } = {}) {
  reflRT = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: true });
  WORLD.waterMat = new THREE.ShaderMaterial({
    uniforms: {
      ...G, tRefl: { value: reflRT.texture }, uTexMat: { value: reflTexMat }, tHM: { value: bakeHeightmap() },
      uHMo: { value: new THREE.Vector4(HM.x0, HM.z0, 1 / HM.sx, 1 / HM.sz) },
      uGlintDir: { value: glintDir.clone().normalize() }, uGlintCol: { value: glintCol }, uDeep: { value: deep },
    },
    vertexShader: /* glsl */`
      uniform mat4 uTexMat; varying vec3 vW; varying vec4 vR;
      void main(){ vec4 w=modelMatrix*vec4(position,1.); vW=w.xyz; vR=uTexMat*w; gl_Position=projectionMatrix*viewMatrix*w; }`,
    fragmentShader: GLSL_COMMON + GLSL_RIPPLE + /* glsl */`
      uniform sampler2D tRefl, tHM; uniform vec4 uHMo; uniform vec3 uGlintDir, uGlintCol, uDeep;
      varying vec3 vW; varying vec4 vR;
      void main(){
        vec2 p=vW.xz; float t=uTime;
        // large swell + fbm chop, as analytic slopes
        vec2 g=vec2(0.);
        g+=vec2(.30,.12)*cos(dot(p,vec2(.30,.12))+t*.55)*.020;
        g+=vec2(-.18,.34)*cos(dot(p,vec2(-.18,.34))*1.3+t*.7)*.016;
        g+=vec2(.52,-.28)*cos(dot(p,vec2(.52,-.28))*1.1+t*.9)*.011;
        vec2 fp=p*1.5+vec2(t*.05,t*.032); float e=.09, n0=fbm(fp);
        g+=vec2(fbm(fp+vec2(e,0.))-n0,fbm(fp+vec2(0.,e))-n0)/e*.030;
        g*=1.+uBurst*.5;
        vec3 rp=ripple(p); g+=rp.yz;
        vec3 N=normalize(vec3(-g.x,1.,-g.y));
        // capillary micro-facets: break mirrored highlights into shimmering fragments
        vec2 mp=p*vec2(7.,11.)+vec2(t*.32,-t*.45); float q0=vnoise(mp); const float ee=.06;
        vec2 mg=vec2(vnoise(mp+vec2(ee,0.))-q0,vnoise(mp+vec2(0.,ee))-q0)/ee*.022;
        vec3 Nm=normalize(vec3(-(g.x+mg.x),1.,-(g.y+mg.y)));
        vec3 V=normalize(cameraPosition-vW); float NdV=max(dot(N,V),0.);
        const float F0=.02;                      // ((1.33-1)/(1.33+1))^2 : water, IOR 1.33
        float fres=F0+(1.-F0)*pow(1.-NdV,5.);
        float R=mix(.30,1.,fres);
        vec2 ruv=vR.xy/vR.w+vec2(Nm.x*.06,Nm.z*.3);
        vec3 refl=texture2D(tRefl,ruv).rgb;
        float rl=dot(refl,vec3(.2126,.7152,.0722)); refl*=1./(1.+max(rl-.35,0.)*.9);   // soft-cap mirrored highlights
        vec4 hm=texture2D(tHM,(p-uHMo.xy)*uHMo.zw); float depth=max(-(hm.r*3.-2.),0.);
        float trans=exp(-depth*1.5);
        vec3 body=uDeep*(.4+.6*max(dot(N,uLightDir),0.))+lampLight(N,vW,.3)*vec3(.016,.02,.02);
        vec3 col=refl*R+body*(1.-R);
        float alpha=clamp(mix(1.-trans*.82,1.,R),0.,1.);
        // glitter path: facet-slope distribution around the mirror direction of the light source
        vec3 H=normalize(uGlintDir+V); float nh=max(dot(Nm,H),0.);
        float t2=(1.-H.y*H.y)/max(H.y*H.y,1e-4);
        float path=exp(-t2/(.0030*(1.+uBurst*.6)));
        float brk=smoothstep(.45,.9,vnoise(p*vec2(5.,13.)+vec2(0.,t*.9))*vnoise(p*vec2(12.,4.)-vec2(t*.7,0.))*1.9);
        col+=uGlintCol*path*(.012+brk*.16)*(1.+uBurst*1.2);
        col+=uGlintCol*pow(nh,2600.)*brk*(.6+2.2*path)*(1.+uBurst*1.2);
        float crest=clamp(abs(rp.x)*26.,0.,1.);
        col+=uGlintCol*crest*.5;                 // ripple crests catch the light
        col=applyFog(col,vW);
        float shore=smoothstep(0.,.06,depth);
        gl_FragColor=vec4(col*shore,alpha*shore);
      }`,
    transparent: true, depthWrite: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  const wg = new THREE.PlaneGeometry(HM.sx, HM.sz, 1, 1); wg.rotateX(-Math.PI / 2);
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
