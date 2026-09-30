/* =====================================================================
   life — lotus pads, raised leaves & blossoms, goldfish
   ===================================================================== */
const LOTUS = { pads: [], padMesh: null, flowers: [] };

function lotusLeafGeometry(cup, ruffle) {
  const rings = 12, segs = 56, notch = 0.26, pos = [], uv = [], idx = [];
  for (let r = 0; r <= rings; r++) for (let s = 0; s <= segs; s++) {
    const t = r / rings, a = notch / 2 + s / segs * (TAU - notch);
    const y = cup * t * t + ruffle * Math.sin(a * 9) * t * t * t + (r === 0 ? 0.01 : 0);
    pos.push(Math.cos(a) * t, y, Math.sin(a) * t); uv.push(0.5 + Math.cos(a) * t * 0.5, 0.5 + Math.sin(a) * t * 0.5);
  }
  for (let r = 0; r < rings; r++) for (let s = 0; s < segs; s++) {
    const a = r * (segs + 1) + s, b = a + segs + 1; idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals(); return g;
}
function lotusLeafTexture() {
  return canvasTex(512, 512, (g, w, h) => {
    const cx = w / 2, cy = h / 2, gr = g.createRadialGradient(cx, cy, 4, cx, cy, w / 2);
    gr.addColorStop(0, '#9fb05a'); gr.addColorStop(0.08, '#4f7a34'); gr.addColorStop(0.7, '#3a6428'); gr.addColorStop(0.97, '#2a4a1d'); gr.addColorStop(1, '#5a6a2a');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(170,200,120,.35)'; g.lineWidth = 3;
    for (let i = 0; i < 22; i++) {
      const a = i / 22 * TAU; g.beginPath(); g.moveTo(cx, cy);
      for (let r = 0; r <= 1; r += 0.1) g.lineTo(cx + Math.cos(a + Math.sin(r * 5) * 0.03) * r * w / 2, cy + Math.sin(a + Math.sin(r * 5) * 0.03) * r * h / 2);
      g.stroke();
    }
    const img = g.getImageData(0, 0, w, h), d = img.data;
    for (let i = 0; i < d.length; i += 4) { const n = 0.88 + Math.random() * 0.12; d[i] *= n; d[i + 1] *= n; d[i + 2] *= n; }
    g.putImageData(img, 0, 0);
  });
}
function lotusPetalGeometry(L, W) {
  const g = new THREE.PlaneGeometry(1, 1, 5, 9); g.translate(0, 0.5, 0);
  const P = g.attributes.position, col = [];
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), v = P.getY(i), w = Math.pow(Math.sin(Math.PI * clamp(v * 0.98 + 0.02, 0, 1)), 0.7) * (1 - 0.35 * v) * W;
    const X = x * 2 * w;
    P.setXYZ(i, X, v * L, -X * X * 5.5 + 0.3 * v * v * L);
    const pink = Math.pow(v, 1.5) * 0.85 + Math.abs(x) * 0.25;
    col.push(lerp(1, 0.95, pink), lerp(0.97, 0.52, pink), lerp(0.9, 0.66, pink));
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals(); return g;
}

function buildLotus() {
  const leafTex = lotusLeafTexture();
  const leafMat = new THREE.MeshPhysicalMaterial({ map: leafTex, roughness: 0.42, side: THREE.DoubleSide, sheen: 0.5, sheenColor: 0x9fc0a0, sheenRoughness: 0.4, envMapIntensity: 1 });
  const inMoonPath = (x, z) => ((x - 0.5) / 5.2) ** 2 + ((z + 2.6) / 3.4) ** 2 < 1;
  const underBridge = (x, z) => Math.abs(x - BR.x) < 2 && Math.abs(z) < 4;
  const clusters = [[-3.6, 4.9, 6], [9.6, 3.6, 5], [-16.4, 2.3, 5], [-6.2, -4.3, 4], [4.6, 5.9, 4], [-18.6, -1.3, 3], [12.2, -0.6, 2]];
  const pads = [];
  for (const [cx, cz, n] of clusters) {
    let made = 0;
    for (let tries = 0; tries < 200 && made < n; tries++) {
      const r = rr(0.36, 0.78), x = cx + rr(-1.7, 1.7), z = cz + rr(-1.4, 1.4);
      if (!waterFree(x, z, r + 0.25) || inMoonPath(x, z) || underBridge(x, z)) continue;
      if (pads.some(p => Math.hypot(p.x - x, p.z - z) < p.r + r + 0.05)) continue;
      pads.push({ x, z, r, y: 0.02, rot: rr(0, TAU), ph: rr(0, TAU) }); made++;
    }
  }
  const padMesh = new THREE.InstancedMesh(lotusLeafGeometry(0.05, 0.02), leafMat, pads.length);
  const c = new THREE.Color();
  pads.forEach((p, i) => { c.setHSL(0.26 + rr(-0.03, 0.03), rr(0.3, 0.5), rr(0.45, 0.62)); padMesh.setColorAt(i, c); floatPads.push(p); });
  padMesh.castShadow = true; padMesh.receiveShadow = true;
  scene.add(padMesh);
  LOTUS.pads = pads; LOTUS.padMesh = padMesh;

  // raised leaves and blossoms on stems
  const stemMat = new THREE.MeshStandardMaterial({ color: 0x4d6b2c, roughness: 0.6 });
  const raised = [];
  const free = (x, z, r) => waterFree(x, z, 0.3) && !inMoonPath(x, z) && !underBridge(x, z)
    && !pads.some(p => Math.hypot(p.x - x, p.z - z) < p.r + 0.16)
    && !raised.some(o => Math.hypot(o.x - x, o.z - z) < o.r + r + 0.15);
  const stem = (x, z, h, lean) => {
    const bed = groundH(x, z), pts = [];
    for (let i = 0; i <= 10; i++) { const t = i / 10; pts.push(new V3(x + lean.x * t * t, lerp(bed, h, t), z + lean.y * t * t)); }
    const m = new THREE.Mesh(taperedTube(pts, (t) => 0.018 - t * 0.006, 6, false), stemMat); scene.add(m);
    waterObstacles.push({ x, z, r: 0.06 });
    return pts[10];
  };
  const raisedG = lotusLeafGeometry(0.28, 0.05), raisedList = [];
  for (const [cx, cz] of [[-3.2, 5.6], [9.2, 4.4], [-16, 3.2], [-6.8, -4.9], [5.2, 6.4]]) {
    for (let tries = 0; tries < 60; tries++) {
      const x = cx + rr(-1.2, 1.2), z = cz + rr(-1, 1), r = rr(0.38, 0.55);
      if (!free(x, z, r)) continue;
      const top = stem(x, z, rr(0.35, 0.72), new THREE.Vector2(rr(-0.1, 0.1), rr(-0.1, 0.1)));
      raised.push({ x, z, r }); raisedList.push({ top, r, rot: rr(0, TAU), tilt: rr(-0.25, 0.25) });
      break;
    }
  }
  const rm = new THREE.InstancedMesh(raisedG, leafMat, raisedList.length), mm = new THREE.Matrix4();
  raisedList.forEach((o, i) => {
    mm.compose(o.top, new THREE.Quaternion().setFromEuler(new THREE.Euler(o.tilt, o.rot, o.tilt * 0.6)), new V3(o.r, o.r, o.r));
    rm.setMatrixAt(i, mm); c.setHSL(0.27, 0.4, 0.5); rm.setColorAt(i, c);
  });
  rm.castShadow = true; scene.add(rm);

  // blossoms: three rings of petals + seed pod + stamens
  const petalG = lotusPetalGeometry(0.17, 0.095);
  const petalMat = new THREE.MeshPhysicalMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.5, sheen: 1, sheenColor: 0xffc4d4, sheenRoughness: 0.45, emissive: 0x3a1420, emissiveIntensity: 0.35, envMapIntensity: 0.9 });
  const podMat = new THREE.MeshStandardMaterial({ color: 0xc9c35a, roughness: 0.6, emissive: 0x2a2408 });
  const stamenMat = new THREE.MeshStandardMaterial({ color: 0xf2c440, roughness: 0.5, emissive: 0x4a3008 });
  const stamenG = new THREE.CylinderGeometry(0.0022, 0.0022, 0.035, 4); stamenG.translate(0, 0.0175, 0);
  const blossomSpots = [[-2.4, 4.3, 0.62], [10.4, 3.1, 0.75], [-15.4, 1.6, 0.55], [-5.4, -3.6, 0.68], [4.0, 5.2, 0.5], [-17.4, -0.2, 0.42, true]];
  for (const [cx, cz, h, bud] of blossomSpots) {
    for (let tries = 0; tries < 80; tries++) {
      const x = cx + rr(-0.8, 0.8), z = cz + rr(-0.8, 0.8);
      if (!free(x, z, 0.25)) continue;
      const top = stem(x, z, h, new THREE.Vector2(rr(-0.08, 0.08), rr(-0.08, 0.08)));
      raised.push({ x, z, r: 0.25 });
      const grp = new THREE.Group(); grp.position.copy(top); scene.add(grp);
      const rings = bud ? [[0.12, 8, 0.8]] : [[0.3, 6, 0.85], [0.72, 8, 0.97], [1.12, 8, 1.05]];
      const count = rings.reduce((s, r) => s + r[1], 0), pm = new THREE.InstancedMesh(petalG, petalMat, count);
      let k = 0; const q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YXZ');
      rings.forEach(([tilt, n, s], ri) => {
        for (let j = 0; j < n; j++) {
          e.set(tilt + rr(-0.06, 0.06), j / n * TAU + ri * 0.4 + rr(-0.05, 0.05), 0); q.setFromEuler(e);
          const a = e.y; mm.compose(new V3(Math.sin(a) * 0.022, 0, Math.cos(a) * 0.022), q, new V3(s, s, s));
          pm.setMatrixAt(k++, mm);
        }
      });
      pm.castShadow = true; grp.add(pm);
      if (!bud) {
        const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.024, 0.04, 20), podMat); pod.position.y = 0.035; grp.add(pod);
        const st = new THREE.InstancedMesh(stamenG, stamenMat, 36);
        for (let j = 0; j < 36; j++) { const a = j / 36 * TAU; e.set(0.5, a, 0); q.setFromEuler(e); mm.compose(new V3(Math.sin(a) * 0.036, 0.02, Math.cos(a) * 0.036), q, new V3(1, 1, 1)); st.setMatrixAt(j, mm); }
        grp.add(st);
      }
      LOTUS.flowers.push({ grp, ph: rr(0, TAU) });
      break;
    }
  }
}

const _lm = new THREE.Matrix4(), _lq = new THREE.Quaternion(), _le = new THREE.Euler(), _ls = new V3(), _lv = new V3();
function updateLotus(t) {
  const P = LOTUS.pads;
  for (let i = 0; i < P.length; i++) {
    const p = P[i], rp = ripplePush(p.x, p.z, t, _push);
    p.y = 0.02 + Math.sin(t * 0.8 + p.ph) * 0.006 + Math.hypot(rp.x, rp.y) * 0.05;
    _le.set(Math.sin(t * 0.7 + p.ph) * 0.02 + rp.y * 0.3, p.rot + Math.sin(t * 0.1 + p.ph) * 0.05, Math.cos(t * 0.6 + p.ph) * 0.02 - rp.x * 0.3);
    _lm.compose(_lv.set(p.x, p.y, p.z), _lq.setFromEuler(_le), _ls.set(p.r, p.r, p.r));
    LOTUS.padMesh.setMatrixAt(i, _lm);
  }
  LOTUS.padMesh.instanceMatrix.needsUpdate = true;
  for (const f of LOTUS.flowers) { f.grp.rotation.x = Math.sin(t * 0.9 + f.ph) * 0.04; f.grp.rotation.z = Math.cos(t * 0.7 + f.ph) * 0.04; }
}

/* ---------------- goldfish ---------------- */
const FISH = { list: [], mesh: null };
function fishGeometry() {
  const body = new THREE.SphereGeometry(1, 22, 14), P = body.attributes.position;
  for (let i = 0; i < P.count; i++) {
    let x = P.getX(i) * 0.08, y = P.getY(i) * 0.042, z = P.getZ(i) * 0.03;
    if (x < 0) { const k = 1 + x / 0.08 * 0.6; y *= k; z *= k; }
    else { y *= 1 - x / 0.08 * 0.15; }
    P.setXYZ(i, x, y + 0.004, z);
  }
  body.computeVertexNormals();
  const shape = (pts) => new THREE.ShapeGeometry(new THREE.Shape(pts.map(p => new THREE.Vector2(...p))));
  const tail = shape([[-0.07, 0.01], [-0.15, 0.07], [-0.21, 0.065], [-0.17, 0.02], [-0.19, 0], [-0.17, -0.02], [-0.21, -0.065], [-0.15, -0.07], [-0.07, -0.01]]);
  const dorsal = shape([[0.03, 0.04], [-0.02, 0.075], [-0.07, 0.06], [-0.07, 0.025]]);
  const pect = shape([[0, 0], [-0.04, 0.02], [-0.05, -0.01]]);
  const fin = new THREE.Color(1, 0.62, 0.3);
  return mergeGeos([
    { g: body, cf: (x, y) => new THREE.Color().setRGB(1, lerp(0.34, 0.95, smooth(0.0, -0.03, y)), lerp(0.1, 0.9, smooth(0.0, -0.03, y))) },
    { g: tail, c: fin }, { g: dorsal, c: fin },
    { g: pect, m: M4(0.03, -0.02, 0.028, -0.6, 0.5, 0), c: fin }, { g: pect, m: M4(0.03, -0.02, -0.028, 0.6, -0.5, 0), c: fin },
  ], true);
}
function buildFish() {
  const N = 8, geo = fishGeometry();
  FISH.phase = new Float32Array(N); FISH.swim = new Float32Array(N);
  geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(FISH.phase, 1));
  FISH.swimAttr = new THREE.InstancedBufferAttribute(FISH.swim, 1); FISH.swimAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aSwim', FISH.swimAttr);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, side: THREE.DoubleSide, emissive: 0x401004, emissiveIntensity: 0.6, envMapIntensity: 1.2 });
  mat.onBeforeCompile = (s) => {
    s.uniforms.uTime = G.uTime;
    s.vertexShader = 'uniform float uTime; attribute float aPhase; attribute float aSwim;\n' + s.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      float bend=smoothstep(.04,-.2,position.x);
      transformed.z+=sin(uTime*(5.+aSwim*7.)+aPhase-position.x*24.)*(.012+.03*aSwim)*bend;`);
  };
  FISH.mesh = new THREE.InstancedMesh(geo, mat, N);
  const tints = [0xffffff, 0xffd0b0, 0xff9a70, 0xffffff, 0xfff2e8, 0xffb080, 0xffffff, 0xffe0c0];
  for (let i = 0; i < N; i++) {
    let x, z; do { x = rr(-15, 12); z = rr(-6, 6); } while (!waterFree(x, z, 1.0));
    FISH.list.push({ x, z, y: -0.3, h: rr(0, TAU), sp: rr(0.12, 0.25), turn: 0, tgt: null, tNext: 0, rise: 0, s: rr(0.85, 1.25) });
    FISH.phase[i] = rr(0, TAU);
    FISH.mesh.setColorAt(i, new THREE.Color(tints[i]));
  }
  FISH.mesh.frustumCulled = false;
  scene.add(FISH.mesh);
}
const _fp = { x: 0, z: 0 }, _fm = new THREE.Matrix4(), _fq = new THREE.Quaternion(), _fe = new THREE.Euler(0, 0, 0, 'YZX');
function updateFish(dt, t) {
  FISH.list.forEach((f, i) => {
    if (t > f.tNext || !f.tgt) {
      let x, z, n = 0;
      do {
        if (LOTUS.pads.length && rng() < 0.55) { const p = pick(LOTUS.pads); x = p.x + rr(-0.6, 0.6); z = p.z + rr(-0.6, 0.6); }
        else { x = f.x + rr(-5, 5); z = f.z + rr(-4, 4); }
      } while (!waterFree(x, z, 0.6) && ++n < 30);
      if (n < 30) f.tgt = { x, z };
      f.tNext = t + rr(4, 11); f.sp = rr(0.1, 0.28);
      f.rise = rng() < 0.12 ? 1 : 0;
    }
    let desired = f.tgt ? Math.atan2(f.tgt.z - f.z, f.tgt.x - f.x) : f.h;
    // look-ahead: steer away from the shore and obstacles
    const ax = f.x + Math.cos(f.h) * 0.9, az = f.z + Math.sin(f.h) * 0.9;
    if (!waterFree(ax, az, 0.45)) { pondGrad(ax, az, _g2); desired = Math.atan2(-_g2.y, -_g2.x) + 0.5; }
    for (const o of FISH.list) if (o !== f) { const dx = f.x - o.x, dz = f.z - o.z, d2 = dx * dx + dz * dz; if (d2 < 0.16) desired = Math.atan2(dz, dx); }
    let dh = Math.atan2(Math.sin(desired - f.h), Math.cos(desired - f.h));
    f.turn = damp(f.turn, clamp(dh * 1.6, -1.6, 1.6), 3, dt); f.h += f.turn * dt;
    const near = f.tgt ? Math.hypot(f.tgt.x - f.x, f.tgt.z - f.z) : 1;
    const spd = f.sp * smooth(0.05, 0.6, near) + 0.03;
    _fp.x = f.x + Math.cos(f.h) * spd * dt; _fp.z = f.z + Math.sin(f.h) * spd * dt;
    constrainWater(_fp, 0.4, false); f.x = _fp.x; f.z = _fp.z;
    const bed = groundH(f.x, f.z);
    const wantY = f.rise ? -0.07 : -0.26 + Math.sin(t * 0.3 + i) * 0.06;
    f.y = clamp(damp(f.y, wantY, 1.2, dt), bed + 0.09, -0.06);
    if (f.rise && f.y > -0.09) { addRipple(f.x + Math.cos(f.h) * 0.08, f.z + Math.sin(f.h) * 0.08, 0.22); f.rise = 0; }
    FISH.swim[i] = clamp(spd * 4 + Math.abs(f.turn) * 0.4, 0.15, 1.4);
    _fe.set(0, -f.h, Math.sin(t * 1.3 + i) * 0.05);
    _fm.compose(_lv.set(f.x, f.y, f.z), _fq.setFromEuler(_fe), _ls.set(f.s, f.s, f.s));
    FISH.mesh.setMatrixAt(i, _fm);
  });
  FISH.mesh.instanceMatrix.needsUpdate = true; FISH.swimAttr.needsUpdate = true;
}
