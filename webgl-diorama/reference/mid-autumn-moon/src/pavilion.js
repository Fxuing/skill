/* =====================================================================
   pavilion — lacquered timber waterside pavilion with a curved
              pyramidal roof and upswept flying eaves (翘角飞檐)
   ===================================================================== */
const PAV = { piers: [], mats: {} };

// tube along a polyline with per-point radius (parallel-transport frames)
function taperedTube(points, radius, radial = 8, capEnd = true) {
  const n = points.length, pos = [], nor = [], uv = [], idx = [];
  const T = new V3(), N = new V3(), B = new V3(), tmp = new V3();
  let len = 0;
  for (let i = 0; i < n; i++) {
    const a = points[Math.max(i - 1, 0)], b = points[Math.min(i + 1, n - 1)];
    T.subVectors(b, a).normalize();
    if (i === 0) { tmp.set(0, 1, 0); if (Math.abs(T.y) > 0.9) tmp.set(1, 0, 0); N.crossVectors(T, tmp).normalize(); }
    else { N.sub(tmp.copy(T).multiplyScalar(N.dot(T))).normalize(); len += points[i].distanceTo(points[i - 1]); }
    B.crossVectors(T, N);
    const r = typeof radius === 'function' ? radius(i / (n - 1), i) : radius;
    for (let j = 0; j <= radial; j++) {
      const a2 = j / radial * TAU, cx = Math.cos(a2), sy = Math.sin(a2);
      const nx = N.x * cx + B.x * sy, ny = N.y * cx + B.y * sy, nz = N.z * cx + B.z * sy;
      pos.push(points[i].x + nx * r, points[i].y + ny * r, points[i].z + nz * r);
      nor.push(nx, ny, nz); uv.push(j / radial, len);
    }
  }
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < radial; j++) {
    const a = i * (radial + 1) + j, b = a + radial + 1;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  if (capEnd) {
    const c = pos.length / 3, p = points[n - 1];
    pos.push(p.x, p.y, p.z); nor.push(T.x, T.y, T.z); uv.push(0.5, len);
    for (let j = 0; j < radial; j++) { const a = (n - 1) * (radial + 1) + j; idx.push(a, c, a + 1); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

function woodTextures() {
  const grain = pixelTex(128, 512, (u, v) => {
    const n = fbm2(u * 6, v * 40, 4), r = Math.sin((u * 30 + n * 6) * 1.0) * 0.5 + 0.5;
    const l = 175 + r * 40 + (n - 0.5) * 60; return [l, l * 0.93, l * 0.86];
  }, { repeat: true });
  const planks = canvasTex(512, 512, (g, w, h) => {
    const img = g.createImageData(w, h), d = img.data, rows = 8, rh = h / rows;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const row = Math.floor(y / rh), off = h2(row, 7) * 400, k = (y * w + x) * 4;
      const n = fbm2((x + off) / 90, y / 7 + row * 13, 4), ring = Math.sin(((x + off) / 18 + n * 7)) * 0.5 + 0.5;
      const edge = Math.min(y % rh, rh - (y % rh)) < 2 ? 0.35 : 1, joint = ((x + off * 2) % 380) < 2 ? 0.4 : 1;
      const tone = 0.8 + h2(row, 3) * 0.25, l = (120 + ring * 45 + (n - 0.5) * 60) * edge * joint * tone;
      d[k] = l; d[k + 1] = l * 0.72; d[k + 2] = l * 0.5; d[k + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }, { repeat: true });
  const lattice = canvasTex(512, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h); g.strokeStyle = '#fff'; g.lineWidth = 7;
    g.strokeRect(4, 4, w - 8, h - 8);
    for (let x = 0; x < w; x += 64) {
      g.strokeRect(x + 14, 16, 36, 30); g.strokeRect(x + 22, 56, 20, 22);
      g.beginPath(); g.moveTo(x + 32, 46); g.lineTo(x + 32, 56); g.moveTo(x + 32, 78); g.lineTo(x + 32, h - 4);
      g.moveTo(x + 50, 31); g.lineTo(x + 78, 31); g.stroke();
    }
    // scalloped lower edge
    g.lineWidth = 6; g.beginPath();
    for (let x = 0; x <= w; x += 32) g.arc(x + 16, h - 22, 16, Math.PI, 0);
    g.stroke();
  }, { repeat: true });
  return { grain, planks, lattice };
}

// ---- roof surface: face 0..3 (+z,+x,-z,-x), u∈[-1,1] along the eave, v∈[0,1] eave→apex ----
function roofPoint(face, u, v, off, out) {
  const s = 1 - v, au = Math.abs(u);
  const lift = 0.62 * Math.pow(au, 3.2) * Math.pow(Math.max(s, 0), 2.2);
  const flare = 1 + 0.07 * Math.pow(au, 4) * s;
  const y = PV.eaveY + PV.H * Math.pow(Math.max(v, 0), 1.5) + lift + off;
  const a = PV.E * s * flare, lx = u * a, lz = a;
  const X = [lx, lz, -lx, -lz][face], Z = [lz, -lx, -lz, lx][face];
  return out.set(PV.x + X, y, PV.z + Z);
}
function roofTopAt(x, z) {
  const lx = x - PV.x, lz = z - PV.z, m = Math.max(Math.abs(lx), Math.abs(lz));
  if (m > PV.E * 1.03 || m < 1e-4) return m < 1e-4 ? PV.eaveY + PV.H : -1e9;
  const s = Math.min(m / PV.E, 1), u = Math.abs(lx) > Math.abs(lz) ? lz / m : lx / m;
  return PV.eaveY + PV.H * Math.pow(1 - s, 1.5) + 0.62 * Math.pow(Math.abs(u), 3.2) * Math.pow(s, 2.2) + 0.06;
}

function buildRoof(mats) {
  const NU = 44, NV = 26, top = [], under = [], v3 = new V3();
  const surf = (off, flip) => {
    const pos = [], uv = [], idx = [];
    for (let f = 0; f < 4; f++) {
      const base = pos.length / 3;
      for (let j = 0; j <= NV; j++) for (let i = 0; i <= NU; i++) {
        const u = i / NU * 2 - 1, v = j / NV * 0.985;
        roofPoint(f, u, v, off, v3); pos.push(v3.x, v3.y, v3.z);
        uv.push(u * PV.E * (1 - v) / 1.76, v * Math.hypot(PV.E, PV.H) / 1.76);
      }
      for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) {
        const a = base + j * (NU + 1) + i, b = a + 1, c = a + NU + 1, d = c + 1;
        if (flip) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals(); return g;
  };
  const tg = surf(0, false), ug = surf(-0.2, true);
  // make sure the outer surface faces up/out
  tg.computeBoundingBox();
  const n0 = new V3().fromBufferAttribute(tg.attributes.normal, Math.floor(NU / 2));
  if (n0.y < 0) { const I = tg.index.array; for (let i = 0; i < I.length; i += 3) { const t = I[i + 1]; I[i + 1] = I[i + 2]; I[i + 2] = t; } tg.computeVertexNormals(); }
  const nU = new V3().fromBufferAttribute(ug.attributes.normal, Math.floor(NU / 2));
  if (nU.y > 0) { const I = ug.index.array; for (let i = 0; i < I.length; i += 3) { const t = I[i + 1]; I[i + 1] = I[i + 2]; I[i + 2] = t; } ug.computeVertexNormals(); }
  const roof = new THREE.Mesh(tg, mats.roof), ceil = new THREE.Mesh(ug, mats.ceiling);
  roof.castShadow = true; roof.receiveShadow = true; ceil.receiveShadow = true;
  scene.add(roof, ceil);
  // eave fascia strip joining the two shells
  const pos = [], idx = [], a = new V3(), b = new V3();
  for (let f = 0; f < 4; f++) for (let i = 0; i <= NU; i++) {
    const u = i / NU * 2 - 1; roofPoint(f, u, 0, 0.0, a); roofPoint(f, u, 0, -0.2, b);
    pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
    if (i < NU) { const k = (f * (NU + 1) + i) * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const fg = new THREE.BufferGeometry(); fg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); fg.setIndex(idx); fg.computeVertexNormals();
  scene.add(new THREE.Mesh(fg, mats.fascia));
  // hip ridges sweeping up into the flying corners
  for (let f = 0; f < 4; f++) {
    const pts = [];
    for (let k = 0; k <= 30; k++) pts.push(roofPoint(f, 1, -0.16 + k / 30 * 1.13, 0.06, new V3()));
    const rg = taperedTube(pts, (t) => 0.05 + 0.045 * smooth(0, 0.25, t), 10, false);
    const ridge = new THREE.Mesh(rg, mats.ridge); ridge.castShadow = true; scene.add(ridge);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), mats.ridge); tip.position.copy(pts[0]); scene.add(tip);
  }
  // gourd finial
  const prof = [[0, 0], [0.2, 0.02], [0.24, 0.12], [0.14, 0.26], [0.08, 0.34], [0.16, 0.48], [0.17, 0.58], [0.09, 0.71], [0.03, 0.8], [0, 0.84]].map(([x, y]) => new THREE.Vector2(x, y));
  const fin = new THREE.Mesh(new THREE.LatheGeometry(prof, 28), mats.finial);
  fin.position.set(PV.x, PV.eaveY + PV.H - 0.12, PV.z); fin.castShadow = true; scene.add(fin);
  solids.push({ kind: 'roof', top: roofTopAt });
}

function buildPavilion() {
  const { grain, planks, lattice } = woodTextures();
  const lac = new THREE.MeshPhysicalMaterial({ color: 0x7a2216, map: grain, roughness: 0.4, clearcoat: 0.85, clearcoatRoughness: 0.2, envMapIntensity: 1.2 });
  const dark = new THREE.MeshPhysicalMaterial({ color: 0x4a2a1a, map: grain, roughness: 0.5, clearcoat: 0.6, clearcoatRoughness: 0.3 });
  const pl = planks.clone(); pl.repeat.set(1.6, 1.6); pl.needsUpdate = true;
  const floorM = new THREE.MeshPhysicalMaterial({ map: pl, color: 0xd8b48a, roughness: 0.5, clearcoat: 0.5, clearcoatRoughness: 0.28, envMapIntensity: 1 });
  const stone = new THREE.MeshStandardMaterial({ map: TEX.stone, color: 0xa39e93, roughness: 0.88 });
  const rt = TEX.tile.clone(); rt.needsUpdate = true; const rb = TEX.tileBump.clone(); rb.needsUpdate = true;
  const mats = {
    roof: new THREE.MeshStandardMaterial({ map: rt, bumpMap: rb, bumpScale: 3, color: 0x9da3ab, roughness: 0.6, envMapIntensity: 1.1 }),
    ceiling: new THREE.MeshStandardMaterial({ color: 0x3a2014, map: grain, roughness: 0.7 }),
    fascia: new THREE.MeshStandardMaterial({ color: 0x5e1c12, roughness: 0.55, side: THREE.DoubleSide }),
    ridge: new THREE.MeshStandardMaterial({ color: 0x2a2e33, roughness: 0.5, envMapIntensity: 1.2 }),
    finial: new THREE.MeshPhysicalMaterial({ color: 0x9a7431, metalness: 0.75, roughness: 0.32, clearcoat: 0.5 }),
  };
  PAV.mats = { lac, dark, stone, floorM };
  const add = (g, m, x, y, z, cast = true) => { const o = new THREE.Mesh(g, m); o.position.set(PV.x + x, y, PV.z + z); o.castShadow = cast; o.receiveShadow = true; scene.add(o); return o; };
  const F = PV.floor, h = PV.half;

  // stone piers (3×3) down into the pond bed / ground
  for (const px of [-2.9, 0, 2.9]) for (const pz of [-2.9, 0, 2.9]) {
    const x = PV.x + px, z = PV.z + pz, bot = Math.min(groundH(x, z), 0) - 0.5, top = F - 0.36;
    const o = add(new THREE.CylinderGeometry(0.22, 0.26, top - bot, 16), stone, px, (top + bot) / 2, pz);
    PAV.piers.push({ x, z, r: 0.28 });
    if (pondSDF(x, z) < 0.35) waterObstacles.push({ x, z, r: 0.3 });
  }
  // joists + deck + edge frame
  for (const pz of [-2.9, 0, 2.9]) add(new THREE.BoxGeometry(6.5, 0.22, 0.2), dark, 0, F - 0.27, pz);
  add(new THREE.BoxGeometry(6.4, 0.16, 6.4), floorM, 0, F - 0.08, 0);
  for (const s of [-1, 1]) {
    add(new THREE.BoxGeometry(6.56, 0.2, 0.1), lac, 0, F - 0.1, s * 3.23);
    add(new THREE.BoxGeometry(0.1, 0.2, 6.56), lac, s * 3.23, F - 0.1, 0);
  }
  boxSolid(PV.x - h, PV.x + h, PV.z - h, PV.z + h, F + 0.005, 'floor');

  // columns reach the underside of the roof
  const cTop = (lx, lz) => { const s = Math.max(Math.abs(lx), Math.abs(lz)) / PV.E; return PV.eaveY + PV.H * Math.pow(1 - s, 1.5) + 0.62 * Math.pow(s, 2.2) - 0.15; };
  const C = PV.col;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const top = cTop(C, C), hgt = top - F;
    add(new THREE.CylinderGeometry(0.125, 0.14, hgt, 24), lac, sx * C, F + hgt / 2, sz * C);
    add(new THREE.CylinderGeometry(0.2, 0.23, 0.14, 20), stone, sx * C, F + 0.07, sz * C);
  }
  // beams + lattice frieze on four sides
  const latM = new THREE.MeshStandardMaterial({ map: lattice, color: 0x8a2c1a, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.5 });
  for (let f = 0; f < 4; f++) {
    const ang = f * Math.PI / 2, ca = Math.cos(ang), sa = Math.sin(ang);
    const put = (g, m, y, out = 0) => { const o = add(g, m, sa * (C + out), y, ca * (C + out)); o.rotation.y = ang; return o; };
    put(new THREE.BoxGeometry(2 * C + 0.3, 0.26, 0.16), lac, 4.3);
    put(new THREE.BoxGeometry(2 * C + 0.5, 0.2, 0.2), dark, 4.86);
    put(new THREE.PlaneGeometry(2 * C - 0.3, 0.34), latM, 4.0, 0.0);
    for (let k = -2; k <= 2; k++) { const o = put(new THREE.BoxGeometry(0.16, 0.26, 0.26), mats.fascia, 4.62); o.position.x += ca * k * 1.3; o.position.z -= sa * k * 1.3; }
  }
  // benches with outward-curving backrests (美人靠); the +x side leaves an entrance
  const seatSpans = [];
  for (let f = 0; f < 4; f++) {
    if (f === 1) { seatSpans.push([f, -C + 0.15, -0.8], [f, 0.8, C - 0.15]); } else seatSpans.push([f, -C + 0.15, C - 0.15]);
  }
  const slatG = new THREE.BoxGeometry(0.035, 0.52, 0.03); slatG.translate(0, 0.26, 0);
  const slats = [];
  for (const [f, a0, a1] of seatSpans) {
    const ang = f * Math.PI / 2, ca = Math.cos(ang), sa = Math.sin(ang), L = a1 - a0, mid = (a0 + a1) / 2;
    const wx = (t, out) => PV.x + ca * t + sa * out, wz = (t, out) => PV.z - sa * t + ca * out;
    const seat = new THREE.Mesh(new THREE.BoxGeometry(L, 0.06, 0.34), dark);
    seat.position.set(wx(mid, C - 0.04), F + 0.45, wz(mid, C - 0.04)); seat.rotation.y = ang; seat.castShadow = seat.receiveShadow = true; scene.add(seat);
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(L, 0.42, 0.05), lac);
    skirt.position.set(wx(mid, C + 0.1), F + 0.21, wz(mid, C + 0.1)); skirt.rotation.y = ang; scene.add(skirt);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(L, 0.06, 0.08), lac);
    rail.position.set(wx(mid, C + 0.36), F + 0.95, wz(mid, C + 0.36)); rail.rotation.y = ang; rail.castShadow = true; scene.add(rail);
    const n = Math.floor(L / 0.11);
    for (let i = 0; i <= n; i++) slats.push({ x: wx(a0 + i * L / n, C + 0.12), z: wz(a0 + i * L / n, C + 0.12), ang });
    const x0 = Math.min(wx(a0, C - 0.21), wx(a1, C + 0.13)), x1 = Math.max(wx(a0, C - 0.21), wx(a1, C + 0.13));
    const z0 = Math.min(wz(a0, C - 0.21), wz(a1, C + 0.13)), z1 = Math.max(wz(a0, C - 0.21), wz(a1, C + 0.13));
    boxSolid(x0, x1, z0, z1, F + 0.48, 'floor');
  }
  const sm = new THREE.InstancedMesh(slatG, lac, slats.length), m = new THREE.Matrix4(), q = new THREE.Quaternion();
  slats.forEach((s, i) => { q.setFromEuler(new THREE.Euler(0.42, s.ang, 0, 'YXZ')); m.compose(new V3(s.x, F + 0.47, s.z), q, new V3(1, 1, 1)); sm.setMatrixAt(i, m); });
  sm.castShadow = true; scene.add(sm);

  // entrance steps on the land side
  for (let i = 0; i < 3; i++) {
    const topY = F - 0.29 * (i + 1), x0 = h + 0.36 * i, gy = groundH(PV.x + x0 + 0.2, PV.z) - 0.3;
    add(new THREE.BoxGeometry(0.38, topY - gy, 1.7), stone, x0 + 0.19, (topY + gy) / 2, 0);
    boxSolid(PV.x + x0, PV.x + x0 + 0.36, PV.z - 0.85, PV.z + 0.85, topY, 'stone');
  }
  // plaque 「桂月榭」 on the front beam
  const plaqueTex = canvasTex(512, 170, (g, w, hh) => {
    g.fillStyle = '#1b1f2c'; g.fillRect(0, 0, w, hh);
    g.strokeStyle = '#b8914a'; g.lineWidth = 10; g.strokeRect(8, 8, w - 16, hh - 16);
    g.lineWidth = 2; g.strokeRect(22, 22, w - 44, hh - 44);
    g.fillStyle = '#e2bd6c'; g.font = '104px "KaiTi","STKaiti","Kaiti SC",serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('桂 月 榭', w / 2, hh / 2 + 6);
  });
  const plaque = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.5, 0.06), [dark, dark, dark, dark, new THREE.MeshStandardMaterial({ map: plaqueTex, roughness: 0.45, emissive: 0x3a2a10, emissiveMap: plaqueTex, emissiveIntensity: 0.15 }), dark]);
  plaque.position.set(PV.x, 4.62, PV.z + C + 0.2); plaque.rotation.x = -0.08; scene.add(plaque);

  buildRoof(mats);
}
