/* =====================================================================
   sky — night dome, distant hills, stars, full moon, halo, thin clouds
   All sky objects are anchored to whichever camera renders them
   (main or mirrored reflection camera), so they behave as infinitely far.
   ===================================================================== */
const SKY = {};

function buildSky() {
  /* ---- dome ---- */
  const skyMat = new THREE.ShaderMaterial({
    uniforms: { ...G },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main(){ vDir=position; gl_Position=projectionMatrix*viewMatrix*vec4(position+cameraPosition,1.); }`,
    fragmentShader: GLSL_COMMON + /* glsl */`
      uniform vec3 uMoonDir;
      varying vec3 vDir;
      float ridge(float az, float s, float o){ return vnoise(vec2(az*s+o, o))*.6+vnoise(vec2(az*s*2.7+o*3., o))*.3+vnoise(vec2(az*s*7.+o, o*2.))*.1; }
      void main(){
        vec3 d=normalize(vDir); float e=d.y;
        vec3 hor=uFogCol*1.45, mid=vec3(.010,.017,.046), zen=vec3(.0028,.0048,.016);
        vec3 col=mix(hor,mid,smoothstep(0.,.22,e)); col=mix(col,zen,smoothstep(.18,.95,e));
        float md=max(dot(d,uMoonDir),0.);
        col+=vec3(.030,.025,.018)*pow(md,5.)+vec3(.05,.042,.03)*pow(md,48.);
        col+=vec3(.03,.018,.004)*uGold*pow(md,3.);
        // faint cirrus veil
        vec2 sp=d.xz/(e+.25);
        col+=vec3(.012,.013,.02)*smoothstep(.55,.9,fbm(sp*1.3+vec2(uTime*.004,0.)))*smoothstep(.0,.3,e)*(1.+4.*pow(md,8.));
        // two layers of distant ink-wash hills
        float az=atan(d.x,d.z);
        float r1=.012+.050*ridge(az,1.3,3.1), r2=.006+.028*ridge(az,2.4,11.7);
        vec3 far=uFogCol*1.12, near=uFogCol*.78;
        col=mix(col,far,smoothstep(r1+.002,r1-.002,e));
        col=mix(col,near,smoothstep(r2+.002,r2-.002,e));
        col=mix(col,uFogCol,smoothstep(.02,-.004,e)*.85);
        if(e<0.) col=uFogCol;
        gl_FragColor=vec4(col,1.);
      }`,
    side: THREE.BackSide, depthWrite: false, fog: false,
  });
  SKY.dome = new THREE.Mesh(new THREE.SphereGeometry(900, 64, 32), skyMat);
  SKY.dome.frustumCulled = false; SKY.dome.renderOrder = -10;
  scene.add(SKY.dome);

  /* ---- stars ---- */
  const N = 2600, pos = new Float32Array(N * 3), at = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    let x, y, z;
    do { x = rr(-1, 1); y = rr(0.03, 1); z = rr(-1, 1); } while (x * x + y * y + z * z > 1);
    const l = Math.hypot(x, y, z); pos.set([x / l, y / l, z / l], i * 3);
    const m = Math.pow(rng(), 6);
    at.set([0.6 + m * 3.2, rr(0.4, 2.4), rr(0, TAU), rng()], i * 4);
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  sg.setAttribute('aStar', new THREE.BufferAttribute(at, 4));
  SKY.starMat = new THREE.ShaderMaterial({
    uniforms: { ...G, uPR: { value: renderer.getPixelRatio() } },
    vertexShader: /* glsl */`
      uniform float uTime; uniform float uPR; uniform vec3 uMoonDir; attribute vec4 aStar; varying float vA; varying vec3 vC;
      void main(){
        vec3 d=normalize(position);
        float tw=.65+.35*sin(uTime*aStar.y+aStar.z)*sin(uTime*aStar.y*.37+aStar.z*2.);
        float mf=smoothstep(.985,.93,dot(d,uMoonDir));
        vA=tw*mf*smoothstep(.02,.18,d.y)*(.35+aStar.x*.35);
        vC=mix(vec3(.75,.82,1.),vec3(1.,.86,.66),aStar.w);
        gl_PointSize=aStar.x*uPR*1.3;
        gl_Position=projectionMatrix*viewMatrix*vec4(cameraPosition+d*820.,1.);
      }`,
    fragmentShader: /* glsl */`
      varying float vA; varying vec3 vC;
      void main(){ vec2 q=gl_PointCoord-.5; float r=dot(q,q)*4.; gl_FragColor=vec4(vC*vA*exp(-r*3.)*1.6,1.); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  });
  SKY.stars = new THREE.Points(sg, SKY.starMat);
  SKY.stars.frustumCulled = false; SKY.stars.renderOrder = -9;
  scene.add(SKY.stars);

  /* ---- the moon: recognisable maria layout (the "jade rabbit"), craters, Tycho & Copernicus rays ---- */
  const moonMat = new THREE.ShaderMaterial({
    uniforms: { ...G, uD: { value: MOON_D }, uR: { value: MOON_R } },
    vertexShader: /* glsl */`
      uniform vec3 uMoonDir; uniform float uD, uR; varying vec3 vP;
      void main(){
        vec3 f=-uMoonDir, r=normalize(cross(vec3(0.,1.,0.),f)), u=cross(f,r);
        vP=position;
        vec3 w=cameraPosition+uMoonDir*uD+(r*position.x+u*position.y+f*position.z)*uR;
        gl_Position=projectionMatrix*viewMatrix*vec4(w,1.);
      }`,
    fragmentShader: GLSL_COMMON + /* glsl */`
      varying vec3 vP;
      float blob(vec2 q, vec2 c, vec2 r, float n){ vec2 d=(q-c)/r; return smoothstep(1.05,.55,length(d)+n); }
      vec3 craters(vec3 p, float s, float dens, out float rimOut){
        vec3 P=p*s, I=floor(P); float shade=1.; rimOut=0.;
        for(int x=-1;x<=1;x++) for(int y=-1;y<=1;y++) for(int z=-1;z<=1;z++){
          vec3 c=I+vec3(x,y,z); float h=hash13(c); if(h>dens) continue;
          vec3 o=c+vec3(hash13(c+3.1),hash13(c+7.7),hash13(c+1.3));
          float rad=.18+.32*hash13(c+5.5); float dd=length(P-o)/rad;
          shade*=mix(1.,.78+.14*dd,smoothstep(1.,.85,dd));
          rimOut+=exp(-pow((dd-1.)*4.,2.));
        }
        return vec3(shade);
      }
      void main(){
        vec3 p=normalize(vP); vec2 q=p.xy;
        float n=(fbm(q*6.)-.5)*.35, n2=(fbm(q*14.+4.)-.5)*.12;
        float m=0.;
        m=max(m,blob(q,vec2(-.56,.12),vec2(.30,.42),n));          // Oceanus Procellarum
        m=max(m,blob(q,vec2(-.30,.46),vec2(.26,.20),n));          // Imbrium
        m=max(m,blob(q,vec2(.14,.42),vec2(.14,.13),n2));          // Serenitatis
        m=max(m,blob(q,vec2(.33,.13),vec2(.18,.15),n));           // Tranquillitatis
        m=max(m,blob(q,vec2(.68,.30),vec2(.10,.085),n2));         // Crisium
        m=max(m,blob(q,vec2(.58,-.12),vec2(.10,.14),n));          // Fecunditatis
        m=max(m,blob(q,vec2(.38,-.26),vec2(.08,.07),n2));         // Nectaris
        m=max(m,blob(q,vec2(-.20,-.34),vec2(.16,.13),n));         // Nubium
        m=max(m,blob(q,vec2(-.52,-.40),vec2(.09,.08),n2));        // Humorum
        m=max(m,blob(q,vec2(.03,.22),vec2(.09,.07),n2));          // Vaporum / Medii
        m=max(m,blob(q,vec2(-.05,.74),vec2(.38,.05),n*.5));       // Frigoris
        m*=.55+.45*fbm(q*9.+2.);
        float rimA, rimB, rimC;
        vec3 cr=craters(p,9.,.35,rimA)*craters(p,19.,.45,rimB)*craters(p,42.,.55,rimC);
        float hi=1.-m;
        vec3 high=vec3(.93,.90,.83), mare=vec3(.50,.52,.53);
        vec3 alb=mix(mare,high,hi)*(.9+.2*fbm3(p*24.));
        alb*=mix(vec3(1.),cr,.35+.65*hi);
        alb+=vec3(.06)*(rimA+rimB*.7+rimC*.5)*(.3+.7*hi);
        // bright ray craters
        vec2 ty=q-vec2(-.12,-.70); float tr=length(ty);
        float rays=pow(abs(sin(atan(ty.y,ty.x)*9.+fbm(q*5.)*6.)),14.)*exp(-tr*2.2)*.35+exp(-tr*tr*900.)*.6;
        vec2 cp=q-vec2(-.30,.16); float crd=length(cp);
        rays+=pow(abs(sin(atan(cp.y,cp.x)*7.+fbm(q*7.)*5.)),12.)*exp(-crd*5.)*.25+exp(-crd*crd*1600.)*.5;
        alb+=vec3(rays);
        float limb=.86+.14*p.z;
        vec3 tint=mix(vec3(1.,.94,.82),vec3(1.,.8,.52),uGold*.6);
        gl_FragColor=vec4(alb*limb*tint*1.2,1.);
      }`,
    depthWrite: false, fog: false,
  });
  SKY.moon = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), moonMat);
  SKY.moon.frustumCulled = false; SKY.moon.renderOrder = -7;
  scene.add(SKY.moon);

  /* ---- halo: soft golden corona + faint 22° ice ring ---- */
  SKY.haloMat = new THREE.ShaderMaterial({
    uniforms: { ...G, uD: { value: MOON_D - 2 }, uR: { value: MOON_R } },
    vertexShader: /* glsl */`
      uniform vec3 uMoonDir; uniform float uD, uR, uHalo; varying vec2 vQ;
      void main(){
        float S=uR*11.*max(uHalo,.6); vQ=position.xy*S/uR;
        vec4 mv=viewMatrix*vec4(cameraPosition+uMoonDir*uD,1.); mv.xy+=position.xy*S;
        gl_Position=projectionMatrix*mv;
      }`,
    fragmentShader: /* glsl */`
      uniform float uHalo, uGold, uTime; varying vec2 vQ;
      void main(){
        float x=length(vQ); float o=max(x-1.,0.);
        float H=uHalo;
        float g=.26*exp(-o*1.9/sqrt(H))+.08*exp(-o*.5/H)+.018*exp(-o*.14/H);
        g*=smoothstep(.96,1.08,x)*.85+.15;
        vec3 col=vec3(1.,.8,.52)*g;
        float R=4.7*H, w=.3*H;
        col+=vec3(exp(-pow((x-R*.975)/w,2.)),exp(-pow((x-R)/w,2.))*.9,exp(-pow((x-R*1.03)/w,2.))*.8)*.009*smoothstep(.4,1.,H);
        col*=1.+uGold*.5;
        col*=smoothstep(11.*max(H,.6),8.*max(H,.6),x);
        gl_FragColor=vec4(col,1.);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  });
  SKY.halo = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), SKY.haloMat);
  SKY.halo.frustumCulled = false; SKY.halo.renderOrder = -8;
  scene.add(SKY.halo);

  /* ---- thin clouds drifting across the moon (silver-gold lit edges) ---- */
  const cloudMat = new THREE.ShaderMaterial({
    uniforms: { ...G },
    vertexShader: /* glsl */`
      uniform vec3 uMoonDir; attribute vec4 aCloud; attribute vec2 aOff;
      varying vec2 vUv; varying vec3 vDir; varying float vSeed;
      void main(){
        vec3 f=-uMoonDir, r=normalize(cross(vec3(0.,1.,0.),f)), u=cross(f,r);
        vec3 c=normalize(uMoonDir+r*aOff.x+u*aOff.y)*400.;
        vec3 w=cameraPosition+c+(r*position.x*aCloud.x+u*position.y*aCloud.y);
        vUv=position.xy; vDir=normalize(w-cameraPosition); vSeed=aCloud.z;
        gl_Position=projectionMatrix*viewMatrix*vec4(w,1.);
      }`,
    fragmentShader: GLSL_COMMON + /* glsl */`
      uniform vec3 uMoonDir; varying vec2 vUv; varying vec3 vDir; varying float vSeed;
      void main(){
        float mask=smoothstep(1.,.25,length(vUv*vec2(1.,1.15)));
        vec2 p=vUv*vec2(2.4,4.2)+vSeed*17.+vec2(uTime*.012,0.);
        float den=fbm(p+fbm(p*1.7)*.8);
        float d=smoothstep(.40,.82,den*mask+mask*.18);
        float ang=acos(clamp(dot(vDir,uMoonDir),-1.,1.));
        float lit=exp(-ang*14.)*(1.25-d*.75)+exp(-ang*4.)*.12;
        vec3 col=mix(vec3(.012,.015,.03),vec3(1.,.86,.62)*.85,clamp(lit,0.,1.));
        col+=vec3(.9,.6,.2)*uGold*lit*.8;
        gl_FragColor=vec4(col,d*.62);
      }`,
    transparent: true, depthWrite: false, fog: false,
  });
  const cg = new THREE.InstancedBufferGeometry().copy(new THREE.PlaneGeometry(2, 2));
  const CL = [ // offX, offY (radians-ish around moon), width, height, seed
    [-0.14, -0.035, 150, 26], [0.10, -0.06, 170, 30], [0.34, -0.01, 120, 22], [-0.38, 0.07, 140, 30],
    [0.30, 0.14, 110, 20], [-0.02, 0.2, 190, 26], [-0.55, -0.08, 160, 28],
  ];
  cg.setAttribute('aOff', new THREE.InstancedBufferAttribute(new Float32Array(CL.flatMap(c => [c[0], c[1]])), 2));
  cg.setAttribute('aCloud', new THREE.InstancedBufferAttribute(new Float32Array(CL.flatMap((c, i) => [c[2], c[3], i * 0.37 + 0.1, 0])), 4));
  cg.instanceCount = CL.length;
  SKY.clouds = new THREE.Mesh(cg, cloudMat);
  SKY.clouds.frustumCulled = false; SKY.clouds.renderOrder = -6;
  scene.add(SKY.clouds);
}

/* ---- image-based lighting: a tiny night environment (sky, moon, lantern glows) ---- */
function buildEnvironment() {
  const envScene = new THREE.Scene();
  const sg = new THREE.SphereGeometry(50, 48, 24), cols = [];
  const P = sg.attributes.position, d = new V3();
  const hor = new THREE.Color(0x1d2748), zen = new THREE.Color(0x03060f), gnd = new THREE.Color(0x07080a), c = new THREE.Color();
  for (let i = 0; i < P.count; i++) {
    d.fromBufferAttribute(P, i).normalize();
    if (d.y < 0) c.copy(gnd).lerp(hor, Math.exp(d.y * 14) * 0.5);
    else c.copy(hor).lerp(zen, Math.pow(d.y, 0.55));
    const md = Math.max(d.dot(MOON_DIR), 0);
    c.r += 0.25 * Math.pow(md, 6); c.g += 0.21 * Math.pow(md, 6); c.b += 0.15 * Math.pow(md, 6);
    cols.push(c.r, c.g, c.b);
  }
  sg.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  envScene.add(new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  const moon = new THREE.Mesh(new THREE.SphereGeometry(3.6, 24, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 3.6, 2.9) }));
  moon.position.copy(MOON_DIR).multiplyScalar(44); envScene.add(moon);
  for (const [x, y, z] of [[10, 4, -5], [6, 4, -1], [14, 4, -1], [8, 3, -9]]) {
    const l = new THREE.Mesh(new THREE.SphereGeometry(1.4, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 0.9, 0.25) }));
    l.position.set(x, y, z).normalize().multiplyScalar(40); envScene.add(l);
  }
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(envScene, 0.02).texture;
  pm.dispose();
}
