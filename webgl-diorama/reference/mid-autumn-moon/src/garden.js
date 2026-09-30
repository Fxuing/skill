/* =====================================================================
   garden — shared textures, pond-edge stones, rocks, stepping stones,
            grass, whitewashed wall with tiled coping, stone arch bridge
   ===================================================================== */
const TEX = {};

function buildGardenTextures() {
  TEX.stone = pixelTex(256, 256, (u, v) => {
    const n = fbm2(u * 10, v * 10, 5), s = noise2(u * 80, v * 80), li = fbm2(u * 5 + 9, v * 5, 3);
    let l = 118 + (n - 0.5) * 110 + (s > 0.8 ? 30 : 0) - (s < 0.12 ? 30 : 0);
    const lichen = smooth(0.58, 0.72, li);
    return [l * (1 - lichen * 0.25), l * (1 - lichen * 0.05), l * (0.94 - lichen * 0.35)];
  }, { repeat: true });
  // cylindrical roof tiles (筒瓦) — colour + bump
  const tileDraw = (bumpOnly) => (g, w, h) => {
    g.fillStyle = bumpOnly ? '#303030' : '#23272d'; g.fillRect(0, 0, w, h);
    const cw = w / 8, rh = h / 6;
    for (let r = 0; r < 6; r++) for (let c = 0; c < 8; c++) {
      const x = c * cw, y = r * rh, gr = g.createLinearGradient(x, 0, x + cw, 0);
      const base = bumpOnly ? 0 : (noise2(c * 3.1, r * 2.3) - 0.5) * 18;
      const col = (l) => `rgb(${l + base},${l + base + 3},${l + base + 8})`;
      if (bumpOnly) { gr.addColorStop(0, '#202020'); gr.addColorStop(0.5, '#f0f0f0'); gr.addColorStop(1, '#202020'); }
      else { gr.addColorStop(0, col(22)); gr.addColorStop(0.35, col(62)); gr.addColorStop(0.55, col(70)); gr.addColorStop(1, col(20)); }
      g.fillStyle = gr; g.fillRect(x + cw * 0.18, y, cw * 0.64, rh - 3);
      g.fillStyle = bumpOnly ? '#101010' : 'rgba(0,0,0,.55)'; g.fillRect(x + cw * 0.18, y + rh - 4, cw * 0.64, 4);
    }
  };
  TEX.tile = canvasTex(256, 256, tileDraw(false), { repeat: true });
  TEX.tileBump = canvasTex(256, 256, tileDraw(true), { repeat: true, srgb: false });
  // ashlar blocks for the bridge
  const ashlar = (bump) => (g, w, h) => {
    g.fillStyle = bump ? '#222' : '#5e5b55'; g.fillRect(0, 0, w, h);
    const rows = 8, rh = h / rows;
    for (let r = 0; r < rows; r++) {
      let x = -rng() * 60;
      while (x < w) {
        const bw = 70 + rng() * 80, t = 150 + rng() * 40;
        if (bump) g.fillStyle = `rgb(${200 + rng() * 40 | 0},${200},${200})`;
        else g.fillStyle = `rgb(${t | 0},${t * 0.98 | 0},${t * 0.93 | 0})`;
        g.fillRect(x + 2, r * rh + 2, bw - 4, rh - 4);
        x += bw;
      }
    }
    if (!bump) { // weathering
      const img = g.getImageData(0, 0, w, h), d = img.data;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const k = (y * w + x) * 4, n = 0.72 + 0.4 * fbm2(x / 40, y / 40, 4) + (noise2(x / 3, y / 3) - 0.5) * 0.15;
        d[k] *= n; d[k + 1] *= n; d[k + 2] *= n * 0.98;
      }
      g.putImageData(img, 0, 0);
    }
  };
  TEX.ashlar = canvasTex(512, 512, ashlar(false), { repeat: true });
  TEX.ashlarBump = canvasTex(512, 512, ashlar(true), { repeat: true, srgb: false });
  TEX.ashlar.repeat.set(0.45, 0.45); TEX.ashlarBump.repeat.set(0.45, 0.45);
}

function rockGeometry(seed, rough = 0.28, seg = 28) {
  const g = new THREE.SphereGeometry(1, seg, Math.round(seg * 0.7)), P = g.attributes.position, v = new V3();
  for (let i = 0; i < P.count; i++) {
    v.fromBufferAttribute(P, i);
    const n = fbm3(v.x * 1.3 + seed, v.y * 1.3, v.z * 1.3 - seed, 4);
    v.multiplyScalar(1 + (n - 0.5) * rough * 2);
    P.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

/* ---- rounded, chiselled edge stones following the pond contour ---- */
function buildEdgeStones(piers) {
  const g = new THREE.BoxGeometry(1, 1, 1, 6, 4, 6), P = g.attributes.position, v = new V3(), q = new V3();
  const r = 0.16;
  for (let i = 0; i < P.count; i++) {
    v.fromBufferAttribute(P, i);
    q.set(clamp(v.x, -0.5 + r, 0.5 - r), clamp(v.y, -0.5 + r, 0.5 - r), clamp(v.z, -0.5 + r, 0.5 - r));
    v.sub(q); if (v.lengthSq() > 0) v.setLength(r); v.add(q);
    v.multiplyScalar(1 + (noise3(v.x * 4, v.y * 4, v.z * 4) - 0.5) * 0.12);
    P.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();

  // march along the zero contour of the pond SDF
  const grad = new THREE.Vector2(), p = { x: 14.8, z: 0 }, pts = [];
  const project = () => { for (let k = 0; k < 6; k++) { const d = pondSDF(p.x, p.z); pondGrad(p.x, p.z, grad); p.x -= grad.x * d; p.z -= grad.y * d; } };
  project();
  const start = { x: p.x, z: p.z };
  for (let it = 0; it < 500; it++) {
    const L = rr(0.78, 1.12);
    pondGrad(p.x, p.z, grad);
    pts.push({ x: p.x, z: p.z, tx: -grad.y, tz: grad.x, gx: grad.x, gz: grad.y, L });
    p.x += -grad.y * L * 0.97; p.z += grad.x * L * 0.97; project();
    if (it > 20 && Math.hypot(p.x - start.x, p.z - start.z) < L * 0.9) break;
  }
  const keep = pts.filter(s => {
    if (Math.abs(s.x - BR.x) < BR.hw + 0.55 && Math.abs(s.z) < 5.6) return false;
    for (const pr of piers) if (Math.hypot(s.x - pr.x, s.z - pr.z) < 0.75) return false;
    if (Math.hypot(s.x - RS.x, s.z - RS.z) < RS.rx + 0.7) return false;
    return true;
  });
  const mat = new THREE.MeshStandardMaterial({ map: TEX.stone, roughness: 0.9, color: 0xb9b5aa, envMapIntensity: 0.5 });
  const mesh = new THREE.InstancedMesh(g, mat, keep.length), m = new THREE.Matrix4(), c = new THREE.Color();
  keep.forEach((s, i) => {
    const h = rr(0.6, 0.78), D = rr(0.55, 0.72), yaw = -Math.atan2(s.tz, s.tx);
    const cx = s.x + s.gx * 0.06, cz = s.z + s.gz * 0.06, cy = 0.27 + rr(-0.03, 0.02);
    m.compose(new V3(cx, cy, cz), new THREE.Quaternion().setFromEuler(new THREE.Euler(rr(-0.04, 0.04), yaw, rr(-0.04, 0.04))), new V3(s.L, h, D));
    mesh.setMatrixAt(i, m);
    c.setHSL(0.1 + rr(-0.03, 0.05), rr(0.03, 0.12), rr(0.42, 0.62)); mesh.setColorAt(i, c);
    const cs = Math.cos(yaw), sn = Math.sin(yaw), top = cy + h / 2, hl = s.L / 2, hd = D / 2;
    solids.push({ kind: 'stone', top: (x, z) => { const dx = x - cx, dz = z - cz, lx = dx * cs - dz * sn, lz = dx * sn + dz * cs; return Math.abs(lx) < hl && Math.abs(lz) < hd ? top : -1e9; } });
  });
  mesh.castShadow = mesh.receiveShadow = true;
  scene.add(mesh);
}

function buildRocks() {
  const mat = new THREE.MeshStandardMaterial({ map: TEX.stone, roughness: 0.85, color: 0x9d9a92, envMapIntensity: 0.5 });
  const spots = [[-1.2, 9.9, 0.9], [6.8, 9.4, 0.65], [-13.8, 6.6, 1.0], [-20.4, -4.2, 1.15], [17.2, 0.4, 0.8], [-8.6, -7.9, 0.6], [3.6, -10.4, 0.75], [-22, 4, 0.9], [18, -9, 1.2]];
  for (const [x, z, s] of spots) {
    if (pondSDF(x, z) < s + 0.5) continue;
    const g = rockGeometry(x * 1.7 + z, 0.34), rock = new THREE.Mesh(g, mat);
    const gy = groundH(x, z), sy = s * rr(0.55, 0.85);
    rock.scale.set(s * rr(0.9, 1.3), sy, s * rr(0.8, 1.1)); rock.rotation.y = rr(0, TAU);
    rock.position.set(x, gy + sy * 0.45, z);
    rock.castShadow = rock.receiveShadow = true; scene.add(rock);
    (WORLD.rocks = WORLD.rocks || []).push({ x, z, r: Math.max(rock.scale.x, rock.scale.z) * 1.15 });
    ellSolid(x, gy + sy * 0.45, z, rock.scale.x * 0.85, sy * 1.05, rock.scale.z * 0.85, 'rock');
  }
  // white pebble ("念珠石") the jade rabbit sits on
  const gy = groundH(RS.x, RS.z);
  const pg = new THREE.SphereGeometry(1, 64, 40), P = pg.attributes.position, v = new V3();
  for (let i = 0; i < P.count; i++) { v.fromBufferAttribute(P, i); v.multiplyScalar(1 + (noise3(v.x * 2, v.y * 2, v.z * 2) - 0.5) * 0.05); P.setXYZ(i, v.x, v.y, v.z); }
  pg.computeVertexNormals();
  const speck = pixelTex(256, 128, (u, v2) => { const s = noise2(u * 120, v2 * 60), n = fbm2(u * 8, v2 * 4, 3); const l = 222 + (n - 0.5) * 30 - (s > 0.85 ? 50 : 0); return [l, l * 0.985, l * 0.95]; });
  const pebble = new THREE.Mesh(pg, new THREE.MeshPhysicalMaterial({ map: speck, color: 0xece8df, roughness: 0.32, clearcoat: 0.35, clearcoatRoughness: 0.25, sheen: 0.3, sheenColor: 0xfff4e0 }));
  pebble.scale.set(RS.rx, RS.ry, RS.rz);
  RS.cy = gy + 0.12; RS.top = RS.cy + RS.ry;
  pebble.position.set(RS.x, RS.cy, RS.z); pebble.rotation.y = 0.4;
  pebble.castShadow = pebble.receiveShadow = true; scene.add(pebble);
  ellSolid(RS.x, RS.cy, RS.z, RS.rx, RS.ry, RS.rz, 'rock');
}

const PATH = [[-10.5, -6.1], [-8.6, -7.6], [-6.5, -8.5], [-2.4, -9.0], [0.8, -9.5], [4.2, -9.8], [7.6, -9.7], [11, -9.4], [14.1, -8.4], [15.4, -6.6]];
function buildSteppingStones() {
  const pts = [];
  for (let i = 0; i < PATH.length - 1; i++) {
    const [x0, z0] = PATH[i], [x1, z1] = PATH[i + 1], L = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(L / 0.78));
    for (let k = 0; k < n; k++) { const t = k / n, side = (pts.length % 2 ? 1 : -1) * 0.12; pts.push([lerp(x0, x1, t) + side * (z1 - z0) / L, lerp(z0, z1, t) - side * (x1 - x0) / L]); }
  }
  const g = rockGeometry(3.3, 0.14, 20), mat = new THREE.MeshStandardMaterial({ map: TEX.stone, roughness: 0.88, color: 0xa29d92 });
  const mesh = new THREE.InstancedMesh(g, mat, pts.length), m = new THREE.Matrix4(), c = new THREE.Color();
  pts.forEach(([x, z], i) => {
    const r = rr(0.27, 0.36), y = groundH(x, z) + 0.035;
    m.compose(new V3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rr(0, TAU), 0)), new V3(r, 0.075, r * rr(0.75, 0.95)));
    mesh.setMatrixAt(i, m); c.setHSL(0.09, 0.06, rr(0.45, 0.6)); mesh.setColorAt(i, c);
    discSolid(x, z, r * 0.8, y + 0.07, 'stone');
  });
  mesh.receiveShadow = true; mesh.castShadow = true; scene.add(mesh);
  WORLD.pathPts = pts;
}

function buildGrass(blocked) {
  const blades = [];
  for (let b = 0; b < 7; b++) {
    const a = b / 7 * TAU + rr(-0.3, 0.3), lean = rr(0.15, 0.5), h = rr(0.6, 1), w = 0.035;
    const pg = new THREE.PlaneGeometry(w, h, 1, 4); pg.translate(0, h / 2, 0);
    const P = pg.attributes.position;
    for (let i = 0; i < P.count; i++) {
      const y = P.getY(i), t = y / h;
      P.setX(i, P.getX(i) * (1 - t * 0.9)); P.setZ(i, lean * t * t * h);
    }
    pg.rotateY(a); pg.translate(Math.cos(a) * 0.04, 0, Math.sin(a) * 0.04);
    blades.push({ g: pg, cf: (x, y) => new THREE.Color().setRGB(0.05 + y * 0.12, 0.09 + y * 0.16, 0.035 + y * 0.03) });
  }
  const geo = mergeGeos(blades, true);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.75, envMapIntensity: 0.4 });
  mat.onBeforeCompile = (s) => {
    s.uniforms.uTime = G.uTime;
    s.vertexShader = 'uniform float uTime;\n' + s.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      vec3 ip=instanceMatrix[3].xyz;
      float sw=sin(uTime*1.7+ip.x*.7+ip.z*.5)+.4*sin(uTime*3.1+ip.x*2.1);
      transformed.x+=sw*.06*position.y*position.y; transformed.z+=sw*.03*position.y;`);
  };
  const list = [];
  for (let tries = 0; tries < 26000 && list.length < 2800; tries++) {
    const x = rr(-27, 22), z = rr(-15, 13), d = pondSDF(x, z);
    if (d < 0.4 || rng() > smooth(7, 0.5, d) * 0.9 + 0.1) continue;
    if (z < WALL_Z + 0.6 || blocked(x, z)) continue;
    list.push([x, z]);
  }
  const mesh = new THREE.InstancedMesh(geo, mat, list.length), m = new THREE.Matrix4();
  list.forEach(([x, z], i) => {
    const s = rr(0.18, 0.36);
    m.compose(new V3(x, groundH(x, z) - 0.01, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rr(0, TAU), 0)), new V3(s * 1.4, s, s * 1.4));
    mesh.setMatrixAt(i, m);
  });
  mesh.receiveShadow = true; scene.add(mesh);
}

function buildWall() {
  const len = 46, H = 3.1, x0 = -2;
  const tex = canvasTex(2048, 150, (g, w, h) => {
    g.fillStyle = '#d6d0c2'; g.fillRect(0, 0, w, h);
    const img = g.getImageData(0, 0, w, h), d = img.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const k = (y * w + x) * 4, drip = fbm2(x / 14, y / 90, 4), n = fbm2(x / 50, y / 30, 3);
      const f = 0.84 + 0.2 * n - smooth(0.55, 0.8, drip) * 0.22 * (y / h) - (noise2(x / 2, y / 2) - 0.5) * 0.04;
      d[k] *= f; d[k + 1] *= f; d[k + 2] *= f * 0.98;
    }
    g.putImageData(img, 0, 0);
    // dark stone plinth
    g.fillStyle = '#4d4c4a'; g.fillRect(0, h * 0.84, w, h * 0.16);
    g.fillStyle = 'rgba(0,0,0,.35)';
    for (let x = 0; x < w; x += 30 + rng() * 20) g.fillRect(x, h * 0.84, 2, h * 0.16);
    g.fillRect(0, h * 0.84, w, 2);
    // lattice windows (漏窗)
    for (const cx of [0.14, 0.47, 0.86]) {
      const X = cx * w, Y = h * 0.42, R = h * 0.2;
      g.fillStyle = '#b9b3a5'; g.beginPath(); g.arc(X, Y, R + 6, 0, TAU); g.fill();
      g.fillStyle = '#15171b'; g.beginPath(); g.arc(X, Y, R, 0, TAU); g.fill();
      g.save(); g.beginPath(); g.arc(X, Y, R, 0, TAU); g.clip();
      g.strokeStyle = '#8f8a80'; g.lineWidth = 3;
      for (let k = 0; k < 9; k++) { const a = k / 9 * TAU; g.beginPath(); g.arc(X + Math.cos(a) * R * 0.55, Y + Math.sin(a) * R * 0.55, R * 0.5, 0, TAU); g.stroke(); }
      g.restore();
    }
  });
  const wall = new THREE.Mesh(new THREE.BoxGeometry(len, H, 0.36),
    [null, null, null, null, null, null].map((_, i) => new THREE.MeshStandardMaterial({ map: i === 4 ? tex : null, color: i === 4 ? 0xffffff : 0xc9c3b6, roughness: 0.93, envMapIntensity: 0.4 })));
  wall.position.set(x0, 0.2 + H / 2, WALL_Z); wall.receiveShadow = true; wall.castShadow = true;
  scene.add(wall);
  const s = new THREE.Shape([[-0.44, 0], [0.44, 0], [0.4, 0.07], [0.12, 0.3], [-0.12, 0.3], [-0.4, 0.07]].map(p => new THREE.Vector2(...p)));
  const cg = new THREE.ExtrudeGeometry(s, { depth: len + 0.4, bevelEnabled: false });
  cg.rotateY(Math.PI / 2); cg.translate(x0 - len / 2 - 0.2, 0.2 + H, WALL_Z);
  const tile = TEX.tile.clone(); tile.repeat.set(1.2, 1.2); tile.needsUpdate = true;
  const coping = new THREE.Mesh(cg, new THREE.MeshStandardMaterial({ map: tile, color: 0x9aa0a8, roughness: 0.7 }));
  coping.castShadow = true; scene.add(coping);
  const ridge = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, len + 0.5, 10), new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.6 }));
  ridge.rotation.z = Math.PI / 2; ridge.position.set(x0, 0.2 + H + 0.31, WALL_Z); scene.add(ridge);
  boxSolid(x0 - len / 2, x0 + len / 2, WALL_Z - 0.44, WALL_Z + 0.44, 0.2 + H + 0.36, 'wall');
}

/* ---- single-span stone arch bridge (spans the channel along z) ---- */
const bridgeDeck = z => 0.5 + 1.28 * Math.pow(Math.max(Math.cos(clamp(z / BR.half, -1, 1) * Math.PI / 2), 0), 1.15);
function buildBridge() {
  const archW = 2.55, archTop = 1.2, archBase = -0.7, L = 5.3;
  const pts = [new THREE.Vector2(-L, -1.4), new THREE.Vector2(-archW, -1.4)];
  for (let i = 0; i <= 40; i++) {
    const a = Math.PI - i / 40 * Math.PI, z = Math.cos(a) * archW;
    pts.push(new THREE.Vector2(z, archBase + (archTop - archBase) * Math.sin(a)));
  }
  pts.push(new THREE.Vector2(archW, -1.4), new THREE.Vector2(L, -1.4));
  for (let i = 0; i <= 40; i++) { const z = L - i / 40 * 2 * L; pts.push(new THREE.Vector2(z, bridgeDeck(z))); }
  const eg = new THREE.ExtrudeGeometry(new THREE.Shape(pts), { depth: BR.hw * 2, bevelEnabled: false, curveSegments: 1 });
  eg.rotateY(Math.PI / 2); eg.translate(BR.x - BR.hw, 0, 0);
  const mat = new THREE.MeshStandardMaterial({ map: TEX.ashlar, bumpMap: TEX.ashlarBump, bumpScale: 1.5, color: 0xd4cfc3, roughness: 0.88, envMapIntensity: 0.6 });
  const body = new THREE.Mesh(eg, mat); body.castShadow = body.receiveShadow = true; scene.add(body);
  // stair treads
  const n = 26, tg = new THREE.BoxGeometry(BR.hw * 2 - 0.12, 0.07, 1), tmat = new THREE.MeshStandardMaterial({ map: TEX.stone, color: 0xc6c1b5, roughness: 0.85 });
  const treads = new THREE.InstancedMesh(tg, tmat, n), m = new THREE.Matrix4();
  for (let i = 0; i < n; i++) {
    const z0 = -BR.half + i * (2 * BR.half / n), z1 = z0 + 2 * BR.half / n, zc = (z0 + z1) / 2;
    m.compose(new V3(BR.x, Math.max(bridgeDeck(z0), bridgeDeck(z1)) + 0.01, zc), new THREE.Quaternion(), new V3(1, 1, (z1 - z0) + 0.02));
    treads.setMatrixAt(i, m);
  }
  treads.castShadow = treads.receiveShadow = true; scene.add(treads);
  // balustrade: posts with lotus-bud caps + panels following the slope
  const postG = mergeGeos([
    { g: new THREE.BoxGeometry(0.12, 0.62, 0.12), m: M4(0, 0.31, 0) },
    { g: new THREE.SphereGeometry(0.075, 12, 10), m: M4(0, 0.67, 0, 0, 0, 0, 1, 1.3, 1) },
    { g: new THREE.CylinderGeometry(0.085, 0.07, 0.05, 12), m: M4(0, 0.6, 0) },
  ]);
  const zs = []; for (let i = 0; i <= 10; i++) zs.push(-4.85 + i * 0.97);
  const posts = new THREE.InstancedMesh(postG, tmat, zs.length * 2), panels = new THREE.InstancedMesh(new THREE.BoxGeometry(0.06, 0.36, 1), tmat, (zs.length - 1) * 2);
  let pi = 0, qi = 0;
  for (const sx of [-1, 1]) {
    const x = BR.x + sx * (BR.hw - 0.08);
    zs.forEach((z, i) => {
      m.compose(new V3(x, bridgeDeck(z), z), new THREE.Quaternion(), new V3(1, 1, 1)); posts.setMatrixAt(pi++, m);
      if (i < zs.length - 1) {
        const z1 = zs[i + 1], y0 = bridgeDeck(z) + 0.28, y1 = bridgeDeck(z1) + 0.28, len = Math.hypot(z1 - z, y1 - y0);
        m.compose(new V3(x, (y0 + y1) / 2, (z + z1) / 2), new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.atan2(y1 - y0, z1 - z), 0, 0)), new V3(1, 1, len - 0.1));
        panels.setMatrixAt(qi++, m);
      }
    });
  }
  posts.castShadow = panels.castShadow = true; posts.receiveShadow = panels.receiveShadow = true;
  scene.add(posts, panels);
  solids.push({ kind: 'bridge', top: (x, z) => Math.abs(x - BR.x) < BR.hw && Math.abs(z) < BR.half ? bridgeDeck(z) + 0.08 : -1e9 });
}
