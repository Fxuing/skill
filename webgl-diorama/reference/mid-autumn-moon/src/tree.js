/* =====================================================================
   tree — golden osmanthus: branches, instanced leaves & flower clusters,
          falling / floating petal system with baked collision surface
   ===================================================================== */
const TREE = { spots: [] };

function windMaterial(mat, flutter) {
  mat.onBeforeCompile = (s) => {
    s.uniforms.uTime = G.uTime; s.uniforms.uWindAmp = WIND.uWindAmp;
    s.vertexShader = 'uniform float uTime;\n' + GLSL_WIND + s.vertexShader.replace('#include <project_vertex>', `
      vec4 mvPosition = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        mvPosition = instanceMatrix * mvPosition;
      #endif
      mvPosition.xyz += windDisp(mvPosition.xyz, ${flutter.toFixed(2)});
      mvPosition = modelViewMatrix * mvPosition;
      gl_Position = projectionMatrix * mvPosition;`);
  };
  return mat;
}

// small four-lobed osmanthus flower lying in the XZ plane, cupped upward (normal +y)
function flowerGeometry(size) {
  const g = new THREE.PlaneGeometry(size, size, 2, 2); g.rotateX(-Math.PI / 2);
  const P = g.attributes.position;
  for (let i = 0; i < P.count; i++) { const x = P.getX(i), z = P.getZ(i); P.setY(i, (x * x + z * z) / (size * size) * size * 0.9); }
  g.computeVertexNormals(); return g;
}
function flowerTexture() {
  return canvasTex(128, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h); g.translate(w / 2, h / 2);
    for (let k = 0; k < 4; k++) {
      g.save(); g.rotate(k * Math.PI / 2 + 0.2);
      const gr = g.createRadialGradient(0, -26, 2, 0, -26, 30);
      gr.addColorStop(0, '#ffd978'); gr.addColorStop(0.7, '#f1a93a'); gr.addColorStop(1, '#d98a22');
      g.fillStyle = gr; g.beginPath(); g.ellipse(0, -27, 21, 29, 0, 0, TAU); g.fill(); g.restore();
    }
    g.fillStyle = '#c86e14'; g.beginPath(); g.arc(0, 0, 9, 0, TAU); g.fill();
    g.fillStyle = '#ffe9a8'; for (let k = 0; k < 2; k++) { g.beginPath(); g.arc((k - 0.5) * 7, 0, 2.5, 0, TAU); g.fill(); }
  }, { srgb: true });
}

function buildTree() {
  const baseY = groundH(TR.x, TR.z) - 0.2;
  const C = new V3(-3.3, 6.1, -8.5), CR = new V3(4.9, 2.9, 4.4);
  const segs = [], tips = [];
  const inCanopy = (p) => ((p.x - C.x) / CR.x) ** 2 + ((p.y - C.y) / CR.y) ** 2 + ((p.z - C.z) / CR.z) ** 2;
  const tmp = new V3();
  function branch(start, dir, len, r0, depth) {
    const n = Math.max(3, Math.round(len / 0.3)), pts = [start.clone()], d = dir.clone(), p = start.clone();
    for (let i = 1; i <= n; i++) {
      d.x += rr(-0.14, 0.14); d.z += rr(-0.14, 0.14); d.y += 0.03 + (depth < 2 ? 0.03 : 0);
      if (depth < 3 && inCanopy(p) > 0.85) d.addScaledVector(tmp.subVectors(C, p).normalize(), 0.3);
      if (p.z < WALL_Z + 2.5) d.z += 0.25;
      d.normalize(); p.addScaledVector(d, len / n); pts.push(p.clone());
    }
    const r1 = r0 * (depth === 0 ? 0.35 : 0.62);
    segs.push({ pts, r0, r1 });
    if (depth === 0) { tips.push(pts); return; }
    const kids = depth >= 3 ? 3 : (rng() < 0.55 ? 2 : 3);
    for (let k = 0; k < kids; k++) {
      const t = k === 0 ? 1 : rr(0.45, 0.95), idx = Math.min(n, Math.round(t * n));
      const axis = new V3(rr(-1, 1), rr(-0.3, 0.3), rr(-1, 1)).cross(d).normalize();
      const nd = d.clone().applyAxisAngle(axis, k === 0 ? rr(0.15, 0.35) : rr(0.5, 0.85));
      const out = tmp.subVectors(pts[idx], new V3(TR.x, pts[idx].y, TR.z)).normalize();
      nd.addScaledVector(out, 0.25).normalize();
      branch(pts[idx], nd, len * rr(0.64, 0.78), lerp(r0, r1, t) * 0.78, depth - 1);
    }
  }
  // trunk leaning toward the water, then main limbs
  const trunk = [], tp = new V3(TR.x, baseY, TR.z);
  for (let i = 0; i <= 10; i++) { const t = i / 10; trunk.push(new V3(TR.x + Math.sin(t * 2.2) * 0.35, baseY + t * 2.6, TR.z + t * t * 0.9)); }
  segs.push({ pts: trunk, r0: 0.34, r1: 0.22, trunk: true });
  const top = trunk[10];
  const limbs = [[0.9, 0.25], [-0.8, 0.5], [0.2, 1.0], [0.1, -0.9], [-0.5, -0.3]];
  for (const [lx, lz] of limbs) branch(top.clone().add(new V3(0, -rr(0, 0.4), 0)), new V3(lx, 1.15, lz).normalize(), rr(1.9, 2.4), 0.17, 3);
  // root flare
  for (let k = 0; k < 6; k++) {
    const a = k / 6 * TAU + rr(-0.3, 0.3), pts = [];
    for (let i = 0; i <= 6; i++) { const t = i / 6, x = TR.x + Math.cos(a) * t * 1.1, z = TR.z + Math.sin(a) * t * 1.1; pts.push(new V3(x, groundH(x, z) - 0.05 + (1 - t) * 0.5, z)); }
    segs.push({ pts, r0: 0.16, r1: 0.03 });
  }
  const bark = pixelTex(256, 512, (u, v) => {
    const n = fbm2(u * 7, v * 2.2, 5), f = Math.abs(Math.sin((u * 9 + n * 2.6) * Math.PI));
    const l = 60 + n * 70 - (f < 0.18 ? 38 : 0) + (noise2(u * 60, v * 40) - 0.5) * 16; return [l * 1.05, l * 0.95, l * 0.84];
  }, { repeat: true });
  const geos = segs.map(s => ({ g: taperedTube(s.pts, (t) => lerp(s.r0, s.r1, t) * (1 + (s.trunk ? 0.12 * Math.pow(1 - t, 6) : 0)), s.r0 > 0.1 ? 14 : s.r0 > 0.04 ? 8 : 5, true) }));
  const bg = mergeGeos(geos); const uvs = bg.attributes.uv;
  for (let i = 0; i < uvs.count; i++) uvs.setY(i, uvs.getY(i) * 0.6);
  const barkMat = windMaterial(new THREE.MeshStandardMaterial({ map: bark, bumpMap: bark, bumpScale: 2, color: 0x9a8e80, roughness: 0.92 }), 0);
  const wood = new THREE.Mesh(bg, barkMat); wood.castShadow = wood.receiveShadow = true; scene.add(wood);

  /* ---- leaves ---- */
  const leafG = (() => {
    const g = new THREE.PlaneGeometry(1, 1, 2, 6); g.translate(0, 0.5, 0);
    const P = g.attributes.position;
    for (let i = 0; i < P.count; i++) {
      const x = P.getX(i), y = P.getY(i), w = 0.36 * Math.pow(Math.sin(Math.PI * clamp(y, 0, 1)), 0.85) * (1 - 0.25 * y);
      P.setXYZ(i, x * 2 * w, y, Math.abs(x) * 0.18 - y * y * 0.14);
    }
    g.computeVertexNormals(); return g;
  })();
  const leafTex = canvasTex(64, 128, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, '#26361c'); gr.addColorStop(0.5, '#4f6a33'); gr.addColorStop(1, '#26361c');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(190,210,140,.55)'; g.lineWidth = 2; g.beginPath(); g.moveTo(w / 2, h); g.lineTo(w / 2, 0); g.stroke();
    g.lineWidth = 1; g.strokeStyle = 'rgba(160,190,120,.3)';
    for (let y = 12; y < h; y += 14) { g.beginPath(); g.moveTo(w / 2, y); g.lineTo(4, y - 12); g.moveTo(w / 2, y); g.lineTo(w - 4, y - 12); g.stroke(); }
  });
  const leafMat = windMaterial(new THREE.MeshStandardMaterial({ map: leafTex, side: THREE.DoubleSide, roughness: 0.38, metalness: 0, envMapIntensity: 1.2 }), 1);
  const leaves = [], flowers = [];
  const X = new V3(), Y = new V3(), Z = new V3(), out = new V3(), m = new THREE.Matrix4(), up = new V3(0, 1, 0);
  const place = (list, p, yAxis, zHint, s) => {
    Y.copy(yAxis).normalize(); X.crossVectors(Y, zHint).normalize(); Z.crossVectors(X, Y);
    list.push(new THREE.Matrix4().makeBasis(X, Y, Z).scale(new V3(s, s, s)).setPosition(p));
  };
  for (const pts of segs.filter(s => s.r0 < 0.075 && s.r0 > 0.02).map(s => s.pts)) {
    for (let k = 0; k < 56; k++) {
      const t = rr(0.1, 1), i = Math.min(pts.length - 1, Math.floor(t * (pts.length - 1)));
      const p = pts[i].clone(); out.subVectors(p, C).normalize();
      const off = new V3(rr(-1, 1), rr(-0.6, 1), rr(-1, 1)).normalize().addScaledVector(out, 0.9).normalize();
      p.addScaledVector(off, rr(0.08, 0.55));
      if (p.z < WALL_Z + 0.4 || p.y < groundH(p.x, p.z) + 1.2) continue;
      place(leaves, p, off.clone().add(new V3(rr(-0.5, 0.5), rr(-0.3, 0.3), rr(-0.5, 0.5))), up.clone().multiplyScalar(0.8).addScaledVector(out, 0.6).add(new V3(rr(-0.4, 0.4), 0, rr(-0.4, 0.4))).normalize(), rr(0.2, 0.3));
      if (rng() < 0.3) { // flower cluster in the leaf axil
        const cp = pts[i].clone().addScaledVector(off, rr(0.05, 0.3));
        TREE.spots.push(cp.x, cp.y, cp.z);
        const nF = 4 + Math.floor(rng() * 5);
        for (let f = 0; f < nF; f++) {
          const fp = cp.clone().add(new V3(rr(-0.06, 0.06), rr(-0.05, 0.05), rr(-0.06, 0.06)));
          const fo = new V3(rr(-1, 1), rr(-0.5, 1), rr(-1, 1)).addScaledVector(out, 0.8).normalize();
          place(flowers, fp, fo, new V3(rr(-1, 1), rr(-1, 1), rr(-1, 1)), rr(0.8, 1.2));
        }
      }
    }
  }
  const leafMesh = new THREE.InstancedMesh(leafG, leafMat, leaves.length), c = new THREE.Color();
  leaves.forEach((mm, i) => { leafMesh.setMatrixAt(i, mm); c.setHSL(0.24 + rr(-0.04, 0.04), rr(0.25, 0.45), rr(0.32, 0.55)); leafMesh.setColorAt(i, c); });
  leafMesh.castShadow = true; leafMesh.receiveShadow = true; scene.add(leafMesh);

  TREE.flowerTex = flowerTexture();
  TREE.flowerMat = windMaterial(new THREE.MeshStandardMaterial({ map: TREE.flowerTex, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.45, emissive: 0xffa53a, emissiveMap: TREE.flowerTex, emissiveIntensity: 0.5 }), 1);
  const flowerMesh = new THREE.InstancedMesh(flowerGeometry(0.075), TREE.flowerMat, flowers.length);
  flowers.forEach((mm, i) => flowerMesh.setMatrixAt(i, mm));
  scene.add(flowerMesh);
  TREE.counts = { leaves: leaves.length, flowers: flowers.length };
}

/* ---------------- baked collision surface (0.1 m grid) ---------------- */
const SURF = { x0: -30, z0: -16, n: 0, m: 0, cell: 0.1 };
const KIND = { ground: 0, water: 1, pad: 2 };
function bakeSurface() {
  SURF.n = Math.ceil(56 / SURF.cell); SURF.m = Math.ceil(31 / SURF.cell);
  const N = SURF.n * SURF.m;
  SURF.h = new Float32Array(N); SURF.k = new Uint8Array(N); SURF.pad = new Int16Array(N).fill(-1);
  SURF.h2 = new Float32Array(N); SURF.k2 = new Uint8Array(N); // same, without the roof (camera & picking)
  for (let j = 0; j < SURF.m; j++) for (let i = 0; i < SURF.n; i++) {
    const x = SURF.x0 + (i + 0.5) * SURF.cell, z = SURF.z0 + (j + 0.5) * SURF.cell, k = j * SURF.n + i;
    SURF.h[k] = surfaceAt(x, z);
    SURF.k[k] = SURF_KIND === 'water' ? 1 : SURF_KIND === 'pad' ? 2 : 0;
    if (SURF_KIND === 'pad') SURF.pad[k] = floatPads.indexOf(SURF_REF);
    if (roofTopAt(x, z) > -1e8) {
      SKIP_ROOF = true; SURF.h2[k] = surfaceAt(x, z); SKIP_ROOF = false;
      SURF.k2[k] = SURF_KIND === 'water' ? 1 : SURF_KIND === 'pad' ? 2 : 0;
    } else { SURF.h2[k] = SURF.h[k]; SURF.k2[k] = SURF.k[k]; }
  }
}
let SURF_IDX = -1;
function surfaceFast(x, z) {
  const i = Math.floor((x - SURF.x0) / SURF.cell), j = Math.floor((z - SURF.z0) / SURF.cell);
  if (i < 0 || j < 0 || i >= SURF.n || j >= SURF.m) { SURF_IDX = -1; return groundH(x, z); }
  SURF_IDX = j * SURF.n + i; return SURF.h[SURF_IDX];
}
function surfaceCam(x, z) {
  const i = Math.floor((x - SURF.x0) / SURF.cell), j = Math.floor((z - SURF.z0) / SURF.cell);
  if (i < 0 || j < 0 || i >= SURF.n || j >= SURF.m) { SURF_IDX = -1; return Math.max(groundH(x, z), 0); }
  SURF_IDX = j * SURF.n + i; return SURF.h2[SURF_IDX];
}

/* ---------------- falling & floating petals (custom instanced shader) ---------------- */
const PET = { N: 3600, ptr: 0, acc: 0, alive: 0 };
const M_DEAD = 0, M_FALL = 1, M_FLOAT = 2, M_REST = 3, M_PAD = 4;
function buildPetals() {
  const N = PET.N, geo = new THREE.InstancedBufferGeometry().copy(flowerGeometry(0.07));
  PET.aP = new Float32Array(N * 4); PET.aR = new Float32Array(N * 4);
  PET.vel = new Float32Array(N * 3); PET.spin = new Float32Array(N * 3); PET.age = new Float32Array(N); PET.life = new Float32Array(N);
  PET.ph = new Float32Array(N); PET.mode = new Uint8Array(N); PET.pad = new Int16Array(N); PET.s0 = new Float32Array(N);
  PET.attrP = new THREE.InstancedBufferAttribute(PET.aP, 4); PET.attrR = new THREE.InstancedBufferAttribute(PET.aR, 4);
  PET.attrP.setUsage(THREE.DynamicDrawUsage); PET.attrR.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aP', PET.attrP); geo.setAttribute('aR', PET.attrR); geo.instanceCount = N;
  PET.mat = new THREE.ShaderMaterial({
    uniforms: { ...G, tMap: { value: TREE.flowerTex } },
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
      uniform sampler2D tMap; varying vec2 vUv; varying vec3 vN; varying vec3 vW;
      void main(){
        vec4 tx=texture2D(tMap,vUv); if(tx.a<.45) discard;
        vec3 alb=tx.rgb;
        vec3 N=normalize(vN); vec3 V=normalize(cameraPosition-vW); if(dot(N,V)<0.) N=-N;
        float nl=dot(N,uLightDir);
        vec3 col=alb*(uLightCol*(max(nl,0.)*.8+max(-nl,0.)*.35)/3.14159+ambientLight(N)*.35+lanternLight(N,vW,.4)*.9);
        float sp=pow(max(dot(reflect(-uLightDir,N),V),0.),18.);
        col+=vec3(1.,.8,.45)*sp*.35+alb*vec3(1.,.62,.2)*(.07+uGold*.35);
        gl_FragColor=vec4(applyFog(col,vW),1.);
      }`,
    side: THREE.DoubleSide,
  });
  PET.mesh = new THREE.Mesh(geo, PET.mat); PET.mesh.frustumCulled = false;
  scene.add(PET.mesh);
}

function spawnPetal() {
  const S = TREE.spots, n = S.length / 3; if (!n) return;
  const i = PET.ptr; PET.ptr = (PET.ptr + 1) % PET.N;
  const s = Math.floor(rng() * n) * 3;
  PET.aP[i * 4] = S[s] + rr(-0.1, 0.1); PET.aP[i * 4 + 1] = S[s + 1]; PET.aP[i * 4 + 2] = S[s + 2] + rr(-0.1, 0.1);
  PET.s0[i] = rr(0.75, 1.2); PET.aP[i * 4 + 3] = PET.s0[i];
  PET.aR.set([rr(0, TAU), rr(0, TAU), rr(0, TAU), 0], i * 4);
  PET.vel.set([0, -0.1, 0], i * 3); PET.spin.set([rr(-3, 3), rr(-2, 2), rr(-3, 3)], i * 3);
  PET.age[i] = 0; PET.life[i] = rr(38, 62); PET.ph[i] = rr(0, TAU); PET.mode[i] = M_FALL; PET.pad[i] = -1;
}

const _pp = { x: 0, z: 0 }, _push = new THREE.Vector2(), _w = new V3();
function updatePetals(dt, t, rate) {
  PET.acc += rate * dt;
  let guard = 0; while (PET.acc >= 1 && guard++ < 200) { spawnPetal(); PET.acc -= 1; }
  const P = PET.aP, R = PET.aR, V = PET.vel, gust = 0.6 + 0.4 * Math.sin(t * 0.31) * Math.sin(t * 0.13 + 1);
  let alive = 0;
  for (let i = 0; i < PET.N; i++) {
    const mode = PET.mode[i]; if (mode === M_DEAD) continue;
    alive++;
    const a = (PET.age[i] += dt), k4 = i * 4, k3 = i * 3, ph = PET.ph[i];
    if (mode === M_FALL) {
      const tvx = 0.26 * gust + Math.sin(a * 1.7 + ph) * 0.32, tvz = 0.16 * gust + Math.cos(a * 1.3 + ph) * 0.28, tvy = -0.4 + Math.sin(a * 2.3 + ph) * 0.14;
      const kk = 1 - Math.exp(-2.2 * dt);
      V[k3] += (tvx - V[k3]) * kk; V[k3 + 1] += (tvy - V[k3 + 1]) * kk; V[k3 + 2] += (tvz - V[k3 + 2]) * kk;
      P[k4] += V[k3] * dt; P[k4 + 1] += V[k3 + 1] * dt; P[k4 + 2] += V[k3 + 2] * dt;
      R[k4] += PET.spin[k3] * dt; R[k4 + 1] += PET.spin[k3 + 1] * dt; R[k4 + 2] += PET.spin[k3 + 2] * dt;
      const x = P[k4], z = P[k4 + 2];
      if (Math.abs(x) > 60 || Math.abs(z) > 60) { PET.mode[i] = M_DEAD; P[k4 + 3] = 0; continue; }
      const sy = surfaceFast(x, z);
      if (P[k4 + 1] <= sy + 0.006) {
        const kind = SURF_IDX >= 0 ? SURF.k[SURF_IDX] : 0;
        R[k4] = rr(-0.08, 0.08); R[k4 + 2] = rr(-0.08, 0.08);
        if (kind === 1) { PET.mode[i] = M_FLOAT; R[k4 + 3] = 1; P[k4 + 1] = 0.01; }
        else if (kind === 2) { PET.mode[i] = M_PAD; PET.pad[i] = SURF.pad[SURF_IDX]; R[k4 + 3] = 2; }
        else { PET.mode[i] = M_REST; R[k4 + 3] = 2; P[k4 + 1] = sy + 0.004; }
      }
    } else if (mode === M_FLOAT) {
      const x = P[k4], z = P[k4 + 2];
      let vx = -z * 0.005 + (noise2(x * 0.15 + t * 0.02, z * 0.15) - 0.5) * 0.14 + 0.02 * gust;
      let vz = (x - 3) * 0.005 + (noise2(x * 0.15 + 30, z * 0.15 - t * 0.02) - 0.5) * 0.14;
      ripplePush(x, z, t, _push); vx += _push.x; vz += _push.y;
      _pp.x = x + vx * dt; _pp.z = z + vz * dt;
      constrainWater(_pp, 0.06, true);
      P[k4] = _pp.x; P[k4 + 2] = _pp.z; R[k4 + 1] += dt * 0.15 * Math.sin(ph);
    } else if (mode === M_PAD) {
      const pad = floatPads[PET.pad[i]]; if (pad) P[k4 + 1] = pad.y + 0.014;
    }
    const life = PET.life[i];
    if (a > life) {
      const f = 1 - (a - life) / 2.5;
      if (f <= 0) { PET.mode[i] = M_DEAD; P[k4 + 3] = 0; continue; }
      P[k4 + 3] = PET.s0[i] * f; if (mode === M_FLOAT) P[k4 + 1] = 0.01 - (1 - f) * 0.05;
    }
  }
  PET.alive = alive;
  PET.attrP.needsUpdate = true; PET.attrR.needsUpdate = true;
}
