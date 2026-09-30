/* =====================================================================
   decor — red paper lanterns, palace lantern, stone table & stools,
           blue-and-white porcelain tea set, embossed mooncakes
   ===================================================================== */
const LANTERN_COL = new THREE.Color(0xff8a42);

function lanternTexture() {
  return canvasTex(512, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#5a0d06'); gr.addColorStop(0.18, '#c4321a'); gr.addColorStop(0.5, '#ff6a2c'); gr.addColorStop(0.82, '#c4321a'); gr.addColorStop(1, '#5a0d06');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(60,5,0,.35)';
    for (let i = 0; i < 24; i++) g.fillRect(i * w / 24, 0, 3, h);
    for (const y of [0.1, 0.9]) { g.fillStyle = 'rgba(255,200,90,.55)'; g.fillRect(0, y * h - 3, w, 6); }
    g.font = 'bold 118px "KaiTi","STKaiti","Kaiti SC",serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const u of [0.25, 0.75]) {
      g.fillStyle = 'rgba(255,215,120,.9)'; g.beginPath(); g.arc(u * w, h / 2, 70, 0, TAU); g.fill();
      g.fillStyle = '#3a0602'; g.fillText('福', u * w, h / 2 + 6);
    }
  });
}
function glowTexture() {
  return canvasTex(128, 128, (g, w, h) => {
    const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.2, 'rgba(255,255,255,.45)'); r.addColorStop(0.55, 'rgba(255,255,255,.08)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, w, h);
  }, { srgb: false });
}

function buildLanterns() {
  const tex = lanternTexture(), glow = glowTexture();
  const gold = new THREE.MeshStandardMaterial({ color: 0xb08a3c, metalness: 0.8, roughness: 0.35 });
  const blackWood = new THREE.MeshStandardMaterial({ color: 0x1a1210, roughness: 0.5 });
  const tassel = new THREE.MeshStandardMaterial({ color: 0x9a1208, roughness: 0.8, emissive: 0x400800, emissiveIntensity: 0.4 });
  const cord = new THREE.MeshStandardMaterial({ color: 0x2a0a06, roughness: 0.8 });

  // round paper lantern: lathe with rib ripples
  const prof = []; for (let i = 0; i <= 24; i++) { const t = i / 24, y = (t - 0.5) * 0.44; prof.push(new THREE.Vector2(0.27 * Math.pow(Math.max(1 - Math.pow(y / 0.235, 2), 0), 0.5) + 0.06, y)); }
  const bodyG = new THREE.LatheGeometry(prof, 64), P = bodyG.attributes.position, v = new V3();
  for (let i = 0; i < P.count; i++) { v.fromBufferAttribute(P, i); const a = Math.atan2(v.z, v.x), k = 1 + 0.028 * Math.pow(Math.abs(Math.cos(a * 12)), 0.6); P.setXYZ(i, v.x * k, v.y, v.z * k); }
  bodyG.computeVertexNormals();

  const make = (x, y, z, strLen, withLight, palace = false) => {
    const pivot = new THREE.Group(); pivot.position.set(x, y, z); scene.add(pivot);
    const mat = new THREE.MeshStandardMaterial({ color: 0x3a0804, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 2.4, roughness: 0.75, side: THREE.DoubleSide });
    const add = (g, m, py, rx = 0) => { const o = new THREE.Mesh(g, m); o.position.y = py; o.rotation.x = rx; pivot.add(o); return o; };
    add(new THREE.CylinderGeometry(0.006, 0.006, strLen, 6), cord, -strLen / 2);
    let cy, bottom;
    if (!palace) {
      cy = -strLen - 0.27;
      add(new THREE.CylinderGeometry(0.1, 0.12, 0.05, 20), gold, -strLen - 0.025);
      const body = add(bodyG, mat, cy); body.castShadow = false;
      add(new THREE.CylinderGeometry(0.12, 0.1, 0.05, 20), gold, cy - 0.245);
      bottom = cy - 0.27;
    } else {
      cy = -strLen - 0.3;
      const pg = new THREE.CylinderGeometry(0.25, 0.25, 0.42, 6, 1, true);
      add(pg, mat, cy);
      add(new THREE.CylinderGeometry(0.33, 0.28, 0.07, 6), blackWood, cy + 0.245);
      add(new THREE.CylinderGeometry(0.2, 0.33, 0.1, 6), blackWood, cy + 0.32);
      add(new THREE.CylinderGeometry(0.28, 0.33, 0.07, 6), blackWood, cy - 0.245);
      add(new THREE.SphereGeometry(0.05, 12, 8), gold, cy + 0.4);
      for (let k = 0; k < 6; k++) {
        const a = k / 6 * TAU;
        const post = add(new THREE.BoxGeometry(0.03, 0.44, 0.03), blackWood, cy); post.position.x = Math.cos(a) * 0.25; post.position.z = Math.sin(a) * 0.25; post.rotation.y = -a;
        const ts = add(new THREE.CylinderGeometry(0.004, 0.028, 0.26, 8), tassel, cy - 0.41); ts.position.x = Math.cos(a) * 0.31; ts.position.z = Math.sin(a) * 0.31;
      }
      bottom = cy - 0.28;
    }
    add(new THREE.SphereGeometry(0.025, 10, 8), gold, bottom - 0.03);
    add(new THREE.CylinderGeometry(0.006, 0.045, 0.3, 10), tassel, bottom - 0.2);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xff7a30, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
    sp.scale.setScalar(palace ? 2.2 : 1.8); sp.position.y = cy; sp.renderOrder = 3; pivot.add(sp);
    let light = null;
    if (withLight) {
      light = new THREE.PointLight(LANTERN_COL, 1, 16, 2); light.position.y = cy; pivot.add(light);
    }
    const anchor = new THREE.Object3D(); anchor.position.y = cy; pivot.add(anchor);
    LANTS.push({ pivot, mat, sprite: sp, light, anchor, base: palace ? 10 : 6.2, phase: rr(0, TAU), amp: palace ? 0.025 : rr(0.04, 0.06) });
  };
  // palace lantern above the table, then the four eave corners (front two carry lights)
  make(PV.x, PV.eaveY + PV.H - 0.32, PV.z, 2.5, true, true);
  const v3 = new V3();
  for (const [f, lit] of [[0, true], [1, false], [2, false], [3, true]]) {
    roofPoint(f, 1, 0.02, -0.22, v3);
    make(v3.x, v3.y, v3.z, 0.5, lit);
  }
}

const _lp = new V3();
function updateLanterns(t, level) {
  let k = 0;
  for (const L of LANTS) {
    L.pivot.rotation.x = Math.sin(t * 0.9 + L.phase) * L.amp;
    L.pivot.rotation.z = Math.sin(t * 0.7 + L.phase * 1.7) * L.amp * 0.8;
    const fl = 1 + 0.05 * Math.sin(t * 11 + L.phase) * Math.sin(t * 5.3 + L.phase * 2) + 0.03 * Math.sin(t * 23 + L.phase);
    L.mat.emissiveIntensity = 2.7 * level * fl;
    L.sprite.material.color.copy(LANTERN_COL).multiplyScalar(0.55 * level * fl);
    L.sprite.visible = level > 0.01;
    if (L.light) {
      L.light.intensity = L.base * level * fl;
      L.anchor.getWorldPosition(_lp);
      if (k < 3) { G.uLantPos.value[k].copy(_lp); G.uLantCol.value[k].copy(LANTERN_COL).multiplyScalar(L.light.intensity / Math.PI); k++; }
    }
  }
}

/* ---------------- stone table, stools, tea set, mooncakes ---------------- */
function mooncakeTextures(ch) {
  const draw = (bump) => (g, w, h) => {
    const cx = w / 2, cy = h / 2;
    if (bump) { g.fillStyle = '#404040'; g.fillRect(0, 0, w, h); }
    else {
      const r = g.createRadialGradient(cx, cy, 20, cx, cy, w / 2);
      r.addColorStop(0, '#d9a052'); r.addColorStop(0.7, '#c1802f'); r.addColorStop(0.93, '#9a5a1e'); r.addColorStop(1, '#6d3a12');
      g.fillStyle = r; g.fillRect(0, 0, w, h);
    }
    const hi = bump ? '#f0f0f0' : 'rgba(255,215,140,.55)', lo = bump ? '#202020' : 'rgba(90,40,8,.55)';
    g.lineWidth = 7; g.strokeStyle = hi;
    for (let i = 0; i < 12; i++) { const a = i / 12 * TAU; g.beginPath(); g.arc(cx + Math.cos(a) * 205, cy + Math.sin(a) * 205, 34, a + 1.2, a - 1.2 + TAU); g.stroke(); }
    g.beginPath(); g.arc(cx, cy, 168, 0, TAU); g.stroke();
    g.lineWidth = 4; g.strokeStyle = lo; g.beginPath(); g.arc(cx, cy, 160, 0, TAU); g.stroke();
    g.strokeStyle = hi; g.lineWidth = 6;
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * TAU + TAU / 16; g.save(); g.translate(cx + Math.cos(a) * 128, cy + Math.sin(a) * 128); g.rotate(a);
      g.beginPath(); g.ellipse(0, 0, 26, 12, 0, 0, TAU); g.stroke(); g.restore();
    }
    g.beginPath(); g.arc(cx, cy, 92, 0, TAU); g.stroke();
    g.fillStyle = hi; g.font = 'bold 120px "KaiTi","STKaiti","Kaiti SC",serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(ch, cx, cy + 6);
    if (!bump) { // oven speckle
      const img = g.getImageData(0, 0, w, h), d = img.data;
      for (let i = 0; i < d.length; i += 4) { const n = 0.9 + Math.random() * 0.14; d[i] *= n; d[i + 1] *= n; d[i + 2] *= n; }
      g.putImageData(img, 0, 0);
    }
  };
  return { map: canvasTex(512, 512, draw(false)), bump: canvasTex(512, 512, draw(true), { srgb: false }) };
}
function mooncakeGeometry(R, h) {
  const g = new THREE.CylinderGeometry(R, R, h, 120, 2), P = g.attributes.position, v = new V3();
  for (let i = 0; i < P.count; i++) {
    v.fromBufferAttribute(P, i); const r = Math.hypot(v.x, v.z); if (r < R * 0.5) continue;
    const a = Math.atan2(v.z, v.x), k = (0.94 + 0.06 * Math.pow(Math.abs(Math.cos(a * 6)), 0.6)) * (v.y > h / 2 - 1e-5 || v.y < -h / 2 + 1e-5 ? 0.95 : 1.02);
    P.setXYZ(i, v.x * k, v.y, v.z * k);
  }
  g.computeVertexNormals();
  return g;
}

function buildTableSet() {
  const F = PV.floor, T = F + 0.8, TX = PV.x, TZ = PV.z;
  const granite = pixelTex(256, 256, (u, v) => { const s = noise2(u * 140, v * 140), n = fbm2(u * 6, v * 6, 3); const l = 150 + (n - 0.5) * 50 + (s > 0.75 ? 50 : s < 0.2 ? -45 : 0); return [l, l * 0.97, l * 0.92]; }, { repeat: true });
  const stoneM = new THREE.MeshPhysicalMaterial({ map: granite, color: 0xc2bdb2, roughness: 0.5, clearcoat: 0.25, clearcoatRoughness: 0.4 });
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.78, 0.76, 0.09, 72), stoneM);
  top.position.set(TX, T - 0.045, TZ); top.castShadow = top.receiveShadow = true; scene.add(top);
  const ped = new THREE.Mesh(new THREE.LatheGeometry([[0.3, 0], [0.34, 0.05], [0.2, 0.14], [0.16, 0.4], [0.2, 0.62], [0.32, 0.71], [0, 0.71]].map(p => new THREE.Vector2(...p)), 40), stoneM);
  ped.position.set(TX, F, TZ); ped.castShadow = true; scene.add(ped);
  discSolid(TX, TZ, 0.78, T, 'table');
  const stoolG = new THREE.LatheGeometry([[0, 0], [0.19, 0], [0.22, 0.05], [0.25, 0.22], [0.22, 0.4], [0.19, 0.45], [0, 0.45]].map(p => new THREE.Vector2(...p)), 36);
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + k * Math.PI / 2, x = TX + Math.cos(a) * 1.22, z = TZ + Math.sin(a) * 1.22;
    const s = new THREE.Mesh(stoolG, stoneM); s.position.set(x, F, z); s.castShadow = s.receiveShadow = true; scene.add(s);
    discSolid(x, z, 0.2, F + 0.45, 'table');
  }

  // porcelain: blue-and-white glaze (MeshPhysicalMaterial clearcoat)
  const qh = canvasTex(512, 256, (g, w, h) => {
    g.fillStyle = '#f6f3ec'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#1f3f8a'; g.fillStyle = '#284f9e';
    for (const y of [0.18, 0.24, 0.62]) { g.lineWidth = y === 0.24 ? 2 : 5; g.beginPath(); g.moveTo(0, y * h); g.lineTo(w, y * h); g.stroke(); }
    g.lineWidth = 3;
    for (let i = 0; i < 8; i++) {
      const x = i * w / 8 + 32, y = 0.43 * h;
      g.beginPath(); g.moveTo(x - 32, y); g.bezierCurveTo(x - 16, y - 30, x + 16, y + 30, x + 32, y); g.stroke();
      for (let p = 0; p < 5; p++) { const a = p / 5 * TAU; g.beginPath(); g.ellipse(x + Math.cos(a) * 9, y - 4 + Math.sin(a) * 9, 7, 4, a, 0, TAU); g.fill(); }
    }
  });
  const porcelain = new THREE.MeshPhysicalMaterial({ map: qh, color: 0xffffff, roughness: 0.16, clearcoat: 1, clearcoatRoughness: 0.03, sheen: 0.25, sheenColor: 0xdfe8ff, envMapIntensity: 1.5 });
  const white = new THREE.MeshPhysicalMaterial({ color: 0xf5f2ea, roughness: 0.14, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.5 });
  const tea = new THREE.MeshPhysicalMaterial({ color: 0x6e4210, roughness: 0.03, ior: 1.33, clearcoat: 1, clearcoatRoughness: 0.02, specularIntensity: 1 });
  const place = (g, m, x, y, z, ry = 0) => { const o = new THREE.Mesh(g, m); o.position.set(TX + x, y, TZ + z); o.rotation.y = ry; o.castShadow = true; o.receiveShadow = true; scene.add(o); return o; };
  const V2 = (a) => a.map(p => new THREE.Vector2(...p));

  // plate + stacked mooncakes
  const PX = -0.22, PZ = 0.14;
  place(new THREE.LatheGeometry(V2([[0, 0.004], [0.15, 0.004], [0.16, 0], [0.2, 0.012], [0.225, 0.026], [0.22, 0.03], [0.19, 0.018], [0.15, 0.012], [0, 0.012]]), 64), porcelain, PX, T, PZ);
  const chars = ['桂', '月', '圆', '福'], R = 0.062, H = 0.042;
  const cakeG = mooncakeGeometry(R, H);
  const sideTex = canvasTex(256, 64, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#8c4a16'); gr.addColorStop(0.25, '#c78a3e'); gr.addColorStop(0.8, '#d6a55a'); gr.addColorStop(1, '#a8672a'); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
  const sideM = new THREE.MeshPhysicalMaterial({ map: sideTex, roughness: 0.55, clearcoat: 0.25, clearcoatRoughness: 0.5 });
  const botM = new THREE.MeshStandardMaterial({ color: 0x7a4418, roughness: 0.8 });
  const spots = [[0.08, 0], [-0.04, 0.0693], [-0.04, -0.0693]];
  chars.forEach((c, i) => {
    const t = mooncakeTextures(c);
    const topM = new THREE.MeshPhysicalMaterial({ map: t.map, bumpMap: t.bump, bumpScale: 5, roughness: 0.48, clearcoat: 0.3, clearcoatRoughness: 0.45 });
    const [dx, dz] = i < 3 ? spots[i] : [0, 0], y = T + 0.012 + H / 2 + (i < 3 ? 0 : H);
    place(cakeG, [sideM, topM, botM], PX + dx, y, PZ + dz, rr(0, TAU) * (i < 3 ? 1 : 0) + (i === 3 ? 0.3 : 0));
  });
  discSolid(TX + PX, TZ + PZ, 0.2, T + 0.012 + 2 * H, 'table');

  // teapot
  const tp = new THREE.Group(); tp.position.set(TX + 0.28, T, TZ - 0.18); tp.rotation.y = 0.6; scene.add(tp);
  const tpAdd = (g, m) => { const o = new THREE.Mesh(g, m); o.castShadow = o.receiveShadow = true; tp.add(o); return o; };
  tpAdd(new THREE.LatheGeometry(V2([[0, 0], [0.045, 0], [0.05, 0.004], [0.075, 0.03], [0.086, 0.06], [0.079, 0.09], [0.058, 0.11], [0.04, 0.117], [0.036, 0.12], [0, 0.12]]), 48), porcelain);
  tpAdd(new THREE.LatheGeometry(V2([[0, 0.121], [0.044, 0.119], [0.041, 0.127], [0.028, 0.136], [0.012, 0.14], [0.012, 0.15], [0.021, 0.158], [0.012, 0.168], [0, 0.17]]), 40), porcelain);
  const sp = []; for (let i = 0; i <= 12; i++) { const t = i / 12; sp.push(new V3(0.072 + t * 0.085, 0.045 + t * t * 0.085 + t * 0.02, 0)); }
  tpAdd(taperedTube(sp, (t) => 0.017 - t * 0.008, 12, false), white);
  const hd = tpAdd(new THREE.TorusGeometry(0.045, 0.008, 10, 28, Math.PI * 1.15), white);
  hd.position.set(-0.07, 0.065, 0); hd.rotation.z = Math.PI * 0.43;
  discSolid(TX + 0.28, TZ - 0.18, 0.09, T + 0.17, 'table');

  // cups with tea
  const cupG = new THREE.LatheGeometry(V2([[0, 0], [0.019, 0], [0.021, 0.004], [0.028, 0.02], [0.035, 0.044], [0.036, 0.047], [0.033, 0.047], [0.031, 0.043], [0.025, 0.02], [0.018, 0.007], [0, 0.007]]), 48);
  const teaG = new THREE.CircleGeometry(0.0305, 40); teaG.rotateX(-Math.PI / 2);
  for (const [x, z] of [[0.16, 0.22], [0.4, 0.07], [0.02, -0.32]]) {
    place(cupG, porcelain, x, T, z, rr(0, TAU));
    const tq = place(teaG, tea, x, T + 0.037, z); tq.castShadow = false;
    discSolid(TX + x, TZ + z, 0.036, T + 0.047, 'table');
  }
}
