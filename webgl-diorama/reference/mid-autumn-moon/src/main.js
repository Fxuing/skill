/* =====================================================================
   main — staged build, orbit camera (zoom-to-cursor, spring-arm
          collision, idle cruise), UI & keys, water interaction, loop
   ===================================================================== */
const STATE = { density: 1, lantern: 1, t: 0, imm: false };
const DEF = { target: new V3(1.5, 2.3, -3), theta: 0.16, phi: 1.46, dist: 24 };
const CTL = {
  theta: DEF.theta, phi: DEF.phi, dist: DEF.dist, target: DEF.target.clone(),
  gTheta: DEF.theta, gPhi: DEF.phi, gDist: DEF.dist, gTarget: DEF.target.clone(),
  arm: DEF.dist, last: -99, drag: 0, px: 0, py: 0,
};
const LIM = { phi0: 0.62, phi1: 1.56, th: 1.5, d0: 0.35, d1: 44 };

/* ---------- picking by marching the baked surface (plus rabbit & canopy volumes) ---------- */
const _ray = new THREE.Raycaster(), _ndc = new THREE.Vector2(), _hit = new V3(), _tmp = new V3();
function raySphere(o, d, c, r) {
  _tmp.subVectors(o, c); const b = _tmp.dot(d), q = _tmp.lengthSq() - r * r, h = b * b - q;
  return h < 0 ? -1 : -b - Math.sqrt(h);
}
function pickScreen(cx, cy) {
  _ndc.set(cx / innerWidth * 2 - 1, -(cy / innerHeight) * 2 + 1);
  _ray.setFromCamera(_ndc, camera);
  const o = _ray.ray.origin, d = _ray.ray.direction;
  let bestT = Infinity, kind = 'none';
  let t = 0.02, prev = 0;
  while (t < 120) {
    const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
    if (y <= surfaceCam(x, z)) {
      let a = prev, b = t;
      for (let k = 0; k < 14; k++) { const m = (a + b) / 2; if (o.y + d.y * m <= surfaceCam(o.x + d.x * m, o.z + d.z * m)) b = m; else a = m; }
      bestT = b; kind = SURF_IDX >= 0 && SURF.k2[SURF_IDX] === 1 ? 'water' : 'solid'; break;
    }
    prev = t; t += Math.max(0.02, t * 0.008);
  }
  if (RABBIT.root) {
    const c = RABBIT.root.localToWorld(_hit.set(0.02, 0.16, 0)), tt = raySphere(o, d, c.clone(), 0.28);
    if (tt > 0 && tt < bestT) { bestT = tt; kind = 'rabbit'; }
  }
  // osmanthus canopy as an ellipsoid shell
  const E = new V3(4.9, 2.9, 4.4), C = new V3(-3.3, 6.1, -8.5);
  const oo = new V3((o.x - C.x) / E.x, (o.y - C.y) / E.y, (o.z - C.z) / E.z), dd = new V3(d.x / E.x, d.y / E.y, d.z / E.z);
  const A = dd.lengthSq(), B = oo.dot(dd), Q = oo.lengthSq() - 1, disc = B * B - A * Q;
  if (disc > 0) { const tt = (-B - Math.sqrt(disc)) / A; if (tt > 0 && tt < bestT) { bestT = tt; kind = 'tree'; } }
  if (!isFinite(bestT)) return null;
  return { p: o.clone().addScaledVector(d, bestT), kind };
}

/* ---------- camera collision (spring arm) ---------- */
function camBlocked(x, y, z) {
  if (y < surfaceCam(x, z) + 0.12) return true;
  const rt = roofTopAt(x, z);
  return rt > -1e8 && y < rt + 0.12 && y > rt - 0.42;
}
const _cp = new V3(), _dir = new V3();
function updateControls(dt) {
  const t = STATE.t, idle = t - CTL.last;
  if (idle > 9) { // slow cruise
    const w = smooth(9, 13, idle);
    CTL.gTheta = lerp(CTL.gTheta, Math.sin(t * 0.045) * 0.75, w * dt * 0.25);
    CTL.gPhi = lerp(CTL.gPhi, 1.42 + Math.sin(t * 0.06) * 0.05, w * dt * 0.2);
    CTL.gDist = lerp(CTL.gDist, 23 + Math.sin(t * 0.07) * 2.5, w * dt * 0.15);
    CTL.gTarget.lerp(DEF.target, w * dt * 0.12);
  }
  CTL.theta = damp(CTL.theta, CTL.gTheta, 7, dt); CTL.phi = damp(CTL.phi, CTL.gPhi, 7, dt);
  CTL.dist = damp(CTL.dist, CTL.gDist, 6, dt); CTL.target.x = damp(CTL.target.x, CTL.gTarget.x, 6, dt);
  CTL.target.y = damp(CTL.target.y, CTL.gTarget.y, 6, dt); CTL.target.z = damp(CTL.target.z, CTL.gTarget.z, 6, dt);
  _dir.set(Math.sin(CTL.phi) * Math.sin(CTL.theta), Math.cos(CTL.phi), Math.sin(CTL.phi) * Math.cos(CTL.theta));
  // spring arm: stop in front of anything solid between the target and the camera
  let arm = CTL.dist;
  for (let i = 1; i <= 48; i++) {
    const s = CTL.dist * i / 48;
    if (camBlocked(CTL.target.x + _dir.x * s, CTL.target.y + _dir.y * s, CTL.target.z + _dir.z * s)) { arm = Math.max(LIM.d0 * 0.6, s - CTL.dist / 48 - 0.08); break; }
  }
  CTL.arm = arm < CTL.arm ? arm : damp(CTL.arm, arm, 4, dt);
  _cp.copy(CTL.target).addScaledVector(_dir, CTL.arm);
  const floor = surfaceCam(_cp.x, _cp.z) + 0.12; if (_cp.y < floor) _cp.y = floor;
  camera.position.copy(_cp); camera.lookAt(CTL.target);
  const near = clamp(CTL.arm * 0.02, 0.01, 0.4);
  if (Math.abs(near - camera.near) > 1e-4) { camera.near = near; camera.updateProjectionMatrix(); }
}
function clampTarget(v) { v.set(clamp(v.x, -22, 18), clamp(v.y, 0.1, 8), clamp(v.z, -14, 11)); }

/* ---------- input ---------- */
const cvs = renderer.domElement;
cvs.addEventListener('contextmenu', e => e.preventDefault());
cvs.addEventListener('pointerdown', e => {
  CTL.drag = e.button === 2 ? 2 : e.button === 0 ? 1 : 0; CTL.px = e.clientX; CTL.py = e.clientY; CTL.last = STATE.t;
  cvs.setPointerCapture(e.pointerId); cvs.classList.add('grab');
});
cvs.addEventListener('pointerup', e => { CTL.drag = 0; cvs.classList.remove('grab'); try { cvs.releasePointerCapture(e.pointerId); } catch (_) { } });
cvs.addEventListener('pointermove', e => {
  poke();
  if (!CTL.drag) return;
  const dx = e.clientX - CTL.px, dy = e.clientY - CTL.py; CTL.px = e.clientX; CTL.py = e.clientY; CTL.last = STATE.t;
  if (CTL.drag === 1) {
    CTL.gTheta = clamp(CTL.gTheta - dx * 0.0052, -LIM.th, LIM.th);
    CTL.gPhi = clamp(CTL.gPhi - dy * 0.0042, LIM.phi0, LIM.phi1);
  } else {
    const s = CTL.dist * 0.0014, r = new V3().setFromMatrixColumn(camera.matrix, 0), u = new V3(0, 1, 0);
    CTL.gTarget.addScaledVector(r, -dx * s).addScaledVector(u, dy * s); clampTarget(CTL.gTarget);
  }
});
let pickCache = null, pickTime = -1;
cvs.addEventListener('wheel', e => {
  e.preventDefault(); CTL.last = STATE.t;
  const k = Math.exp(clamp(e.deltaY, -120, 120) * 0.0014), nd = clamp(CTL.gDist * k, LIM.d0, LIM.d1), ratio = nd / CTL.gDist;
  if (ratio < 1) {
    if (!pickCache || STATE.t - pickTime > 0.35) { pickCache = pickScreen(e.clientX, e.clientY); pickTime = STATE.t; }
    if (pickCache && pickCache.p.distanceTo(camera.position) < CTL.gDist * 2.2) {
      CTL.gTarget.sub(pickCache.p).multiplyScalar(ratio).add(pickCache.p); clampTarget(CTL.gTarget);
    }
  } else {
    pickCache = null;
    if (nd > 12) CTL.gTarget.lerp(DEF.target, (ratio - 1) * 0.35);
  }
  CTL.gDist = nd;
}, { passive: false });
cvs.addEventListener('dblclick', e => {
  const h = pickScreen(e.clientX, e.clientY);
  if (!h || h.kind !== 'water') return;
  addRipple(h.p.x, h.p.z, 1.0); splashAt(h.p.x, h.p.z); rabbitLookAt(h.p.x, h.p.z, STATE.t);
});

const hud = document.getElementById('hud'), toastEl = document.getElementById('toast');
let toastTimer = 0;
function toast(s) { if (STATE.imm) return; toastEl.textContent = s; toastEl.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200); }
let idleTimer = 0;
function poke() { document.body.classList.remove('idle'); clearTimeout(idleTimer); idleTimer = setTimeout(() => document.body.classList.add('idle'), 2500); }
function setImmersive(on) {
  STATE.imm = on; hud.classList.toggle('fade', on); document.body.classList.toggle('imm', on);
  if (!on) toast('已返回 · 夜色调律');
}
function gold() { triggerGold(STATE.t); document.getElementById('btnGold').classList.add('on'); setTimeout(() => document.getElementById('btnGold').classList.remove('on'), 9000); toast('嫦娥奔月 · 金波狂想'); }
addEventListener('keydown', e => {
  if (e.repeat) return;
  const k = e.key.toLowerCase();
  if (k === 'h') setImmersive(!STATE.imm);
  else if (k === 'f') { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(() => { }); }
  else if (e.code === 'Space') { e.preventDefault(); if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); gold(); }
});
document.getElementById('btnGold').addEventListener('click', e => { e.currentTarget.blur(); gold(); });
function bindSlider(id, vid, fn) {
  const el = document.getElementById(id), out = document.getElementById(vid);
  const upd = () => { const v = +el.value; out.textContent = v.toFixed(2); el.style.setProperty('--p', ((v - el.min) / (el.max - el.min) * 100) + '%'); fn(v); };
  el.addEventListener('input', upd); el.addEventListener('keydown', e => { if (e.code === 'Space') e.preventDefault(); }); upd();
}
bindSlider('sDen', 'vDen', v => STATE.density = v);
bindSlider('sLan', 'vLan', v => STATE.lantern = v);
bindSlider('sHalo', 'vHalo', v => G.uHalo.value = v);

/* ---------- sizing ---------- */
const _sz = new THREE.Vector2();
function resize() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.getDrawingBufferSize(_sz);
  reflRT.setSize(Math.max(2, _sz.x >> 1), Math.max(2, _sz.y >> 1));
  resizePost(_sz.x, _sz.y);
  const sc = _sz.y / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
  FX.splash.mat.uniforms.uScale.value = FX.gold.mat.uniforms.uScale.value = FX.motes.material.uniforms.uScale.value = sc;
  SKY.starMat.uniforms.uPR.value = renderer.getPixelRatio();
}
addEventListener('resize', resize);

/* ---------- frame ---------- */
const clock = new THREE.Clock();
const noReflect = [];
let fpsN = 0, fpsT = 0;
const fpsEl = document.getElementById('fps'), pcEl = document.getElementById('pcount');
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  STATE.t += dt; const t = STATE.t; G.uTime.value = t;
  G.uLantern.value = STATE.lantern;
  updateControls(dt);
  updateLanterns(t, STATE.lantern);
  updateGold(dt, t);
  const gv = G.uGold.value;
  updatePetals(dt, t, 34 * STATE.density * (1 + 1.4 * gv));
  updateLotus(t); updateFish(dt, t); updateRabbit(dt, t);
  TREE.flowerMat.emissiveIntensity = 0.5 + gv * 0.7;
  WIND.uWindAmp.value = 1 + 0.35 * Math.sin(t * 0.21) * Math.sin(t * 0.13) + gv * 0.25;

  renderer.shadowMap.needsUpdate = true;
  updateReflectionCamera(camera);
  for (const o of noReflect) o.visible = false;
  renderer.setRenderTarget(reflRT); renderer.clear(); renderer.render(scene, reflCam);
  for (const o of noReflect) o.visible = true;
  renderer.setRenderTarget(POST.scene); renderer.clear(); renderer.render(scene, camera);
  runPost();

  fpsN++; fpsT += dt;
  if (fpsT > 0.5) { fpsEl.textContent = Math.round(fpsN / fpsT) + ' FPS'; pcEl.textContent = '落桂 ' + PET.alive; fpsN = 0; fpsT = 0; }
}

/* ---------- staged build ---------- */
function grassBlocked(x, z) {
  if (x > PV.x - PV.half - 0.5 && x < PV.x + PV.half + 1.6 && z > PV.z - PV.half - 0.5 && z < PV.z + PV.half + 0.5) return true;
  if (Math.abs(x - BR.x) < BR.hw + 0.6 && Math.abs(z) < BR.half + 0.8) return true;
  if (Math.hypot(x - RS.x, z - RS.z) < RS.rx + 0.25) return true;
  if (Math.hypot(x - TR.x, z - TR.z) < 1.3) return true;
  if (pondSDF(x, z) < 0.6) return true;
  for (const r of WORLD.rocks) if (Math.hypot(x - r.x, z - r.z) < r.r + 0.25) return true;
  for (const [px, pz] of WORLD.pathPts) if (Math.hypot(x - px, z - pz) < 0.5) return true;
  return false;
}
async function init() {
  const steps = [
    () => { buildSky(); buildEnvironment(); },
    buildTerrain, buildWater, buildGardenTextures, buildPavilion,
    () => { buildLanterns(); buildTableSet(); },
    () => { buildEdgeStones(PAV.piers); buildRocks(); buildSteppingStones(); buildWall(); buildBridge(); },
    buildTree, () => { buildLotus(); buildFish(); }, buildRabbit,
    () => buildGrass(grassBlocked), bakeSurface, buildPetals,
    () => { buildMist(); buildParticles(); buildPost(); },
  ];
  for (let i = 0; i < steps.length; i++) { steps[i](); setProgress((i + 1) / (steps.length + 1)); await nextFrame(); }
  noReflect.push(WORLD.water, FX.mist, FX.motes, FISH.mesh, ...RABBIT.shells);
  resize();
  CTL.last = -99;
  updateControls(0.016);
  renderer.compile(scene, camera);
  frame();
  setProgress(1); await nextFrame();
  document.getElementById('loader').classList.add('done');
  renderer.setAnimationLoop(frame);
  poke();
}
init().catch(err => {
  console.error(err);
  document.getElementById('lerr').textContent = '初始化失败：' + (err && err.message || err);
});
