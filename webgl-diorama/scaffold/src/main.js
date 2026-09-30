/* =====================================================================
   main — orbit camera (zoom-to-cursor, spring-arm collision, idle
          cruise), picking, HUD (immersive H / fullscreen F / burst Space
          / panel), resize, frame loop, staged build
   Scene contract — scene.js must define:
     SCENE        { burstName, cam: {target, theta, phi, dist}, lim: {phi0, phi1, th, d0, d1}, box: [x0,x1,y0,y1,z0,z1], stat?() }
     PANEL        [{ label, min, max, step, value, on(v) } | { label, options: [[value, text]...], value, on(v) }]
     BUILD_STEPS  [fn...]      run in order behind the loader; bakeSurface runs after them
     UPDATERS     [fn(dt, t)]  called every frame
     INTERACT     { water|ground|solid|<volume kind>: fn(point) }  double-click handlers
     PICK_VOLUMES [{ c: () => V3 (world centre), r, kind }]        spheres that can be double-clicked
   ===================================================================== */
const STATE = { t: 0, imm: false };
const DEF = { target: SCENE.cam.target.clone(), theta: SCENE.cam.theta, phi: SCENE.cam.phi, dist: SCENE.cam.dist };
const CTL = {
  theta: DEF.theta, phi: DEF.phi, dist: DEF.dist, target: DEF.target.clone(),
  gTheta: DEF.theta, gPhi: DEF.phi, gDist: DEF.dist, gTarget: DEF.target.clone(),
  arm: DEF.dist, last: -99, drag: 0, px: 0, py: 0,
};
const LIM = SCENE.lim;

/* ---------- picking: march the baked surface, then test pick volumes ---------- */
const _ray = new THREE.Raycaster(), _ndc = new THREE.Vector2(), _tmp = new V3();
function raySphere(o, d, c, r) {
  _tmp.subVectors(o, c); const b = _tmp.dot(d), q = _tmp.lengthSq() - r * r, h = b * b - q;
  return h < 0 ? -1 : -b - Math.sqrt(h);
}
const KIND_NAME = Object.fromEntries(Object.entries(KIND).map(([k, v]) => [v, k]));
function pickScreen(cx, cy) {
  _ndc.set(cx / innerWidth * 2 - 1, -(cy / innerHeight) * 2 + 1);
  _ray.setFromCamera(_ndc, camera);
  const o = _ray.ray.origin, d = _ray.ray.direction;
  let bestT = Infinity, kind = 'none';
  let t = 0.02, prev = 0;
  while (t < 120) {
    const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
    if (y <= surfaceFast(x, z)) {
      let a = prev, b = t;
      for (let k = 0; k < 14; k++) { const m = (a + b) / 2; if (o.y + d.y * m <= surfaceFast(o.x + d.x * m, o.z + d.z * m)) b = m; else a = m; }
      bestT = b; kind = SURF_IDX >= 0 ? KIND_NAME[SURF.k[SURF_IDX]] : 'ground'; break;
    }
    prev = t; t += Math.max(0.02, t * 0.008);
  }
  for (const v of PICK_VOLUMES) {
    const tt = raySphere(o, d, v.c(), v.r);
    if (tt > 0 && tt < bestT) { bestT = tt; kind = v.kind; }
  }
  if (!isFinite(bestT)) return null;
  return { p: o.clone().addScaledVector(d, bestT), kind };
}

/* ---------- camera: damped spherical orbit + spring arm that never enters solids ---------- */
const camBlocked = (x, y, z) => y < surfaceFast(x, z) + 0.12;
const _cp = new V3(), _dir = new V3();
function updateControls(dt) {
  const t = STATE.t, idle = t - CTL.last;
  if (idle > 9) { // slow idle cruise, blended in over 4 s
    const w = smooth(9, 13, idle);
    CTL.gTheta = lerp(CTL.gTheta, DEF.theta + Math.sin(t * 0.045) * Math.min(0.75, LIM.th), w * dt * 0.25);
    CTL.gPhi = lerp(CTL.gPhi, DEF.phi + Math.sin(t * 0.06) * 0.05, w * dt * 0.2);
    CTL.gDist = lerp(CTL.gDist, DEF.dist * (1 + Math.sin(t * 0.07) * 0.1), w * dt * 0.15);
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
  const floor = surfaceFast(_cp.x, _cp.z) + 0.12; if (_cp.y < floor) _cp.y = floor;
  camera.position.copy(_cp); camera.lookAt(CTL.target);
  const near = clamp(CTL.arm * 0.02, 0.01, 0.4);   // close-ups on tiny details need a small near plane
  if (Math.abs(near - camera.near) > 1e-4) { camera.near = near; camera.updateProjectionMatrix(); }
}
const B = SCENE.box;
function clampTarget(v) { v.set(clamp(v.x, B[0], B[1]), clamp(v.y, B[2], B[3]), clamp(v.z, B[4], B[5])); }

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
    CTL.gTheta = clamp(CTL.gTheta - dx * 0.0052, DEF.theta - LIM.th, DEF.theta + LIM.th);
    CTL.gPhi = clamp(CTL.gPhi - dy * 0.0042, LIM.phi0, LIM.phi1);
  } else {
    const s = CTL.dist * 0.0014, r = new V3().setFromMatrixColumn(camera.matrix, 0), u = new V3(0, 1, 0);
    CTL.gTarget.addScaledVector(r, -dx * s).addScaledVector(u, dy * s); clampTarget(CTL.gTarget);
  }
});
let pickCache = null, pickTime = -1;
cvs.addEventListener('wheel', e => {   // zoom toward the point under the cursor
  e.preventDefault(); CTL.last = STATE.t;
  const k = Math.exp(clamp(e.deltaY, -120, 120) * 0.0014), nd = clamp(CTL.gDist * k, LIM.d0, LIM.d1), ratio = nd / CTL.gDist;
  if (ratio < 1) {
    if (!pickCache || STATE.t - pickTime > 0.35) { pickCache = pickScreen(e.clientX, e.clientY); pickTime = STATE.t; }
    if (pickCache && pickCache.p.distanceTo(camera.position) < CTL.gDist * 2.2) {
      CTL.gTarget.sub(pickCache.p).multiplyScalar(ratio).add(pickCache.p); clampTarget(CTL.gTarget);
    }
  } else {
    pickCache = null;
    if (nd > DEF.dist * 0.5) CTL.gTarget.lerp(DEF.target, (ratio - 1) * 0.35);
  }
  CTL.gDist = nd;
}, { passive: false });
cvs.addEventListener('dblclick', e => {
  const h = pickScreen(e.clientX, e.clientY);
  if (h && INTERACT[h.kind]) INTERACT[h.kind](h.p);
});

/* ---------- HUD: immersive mode, fullscreen, burst, panel ---------- */
const hud = document.getElementById('hud'), toastEl = document.getElementById('toast');
let toastTimer = 0;
function toast(s) { if (STATE.imm) return; toastEl.textContent = s; toastEl.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200); }
let idleTimer = 0;
function poke() { document.body.classList.remove('idle'); clearTimeout(idleTimer); idleTimer = setTimeout(() => document.body.classList.add('idle'), 2500); }
function setImmersive(on) { STATE.imm = on; hud.classList.toggle('fade', on); document.body.classList.toggle('imm', on); }
const btnBurst = document.getElementById('btnBurst');
function burst() {
  triggerBurst(STATE.t); toast(SCENE.burstName);
  btnBurst.classList.add('on'); setTimeout(() => btnBurst.classList.remove('on'), BURST_LEN * 1000 - 1500);
}
addEventListener('keydown', e => {
  if (e.repeat) return;
  const k = e.key.toLowerCase();
  if (k === 'h') setImmersive(!STATE.imm);
  else if (k === 'f') { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(() => { }); }
  else if (e.code === 'Space') { e.preventDefault(); if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); burst(); }
});
btnBurst.textContent = SCENE.burstName + ' · 空格';
btnBurst.addEventListener('click', e => { e.currentTarget.blur(); burst(); });

function buildPanel() {
  const rows = document.getElementById('rows');
  for (const c of PANEL) {
    const row = document.createElement('div'); row.className = 'row';
    const label = document.createElement('label'); label.textContent = c.label;
    const out = document.createElement('b'); label.appendChild(out); row.appendChild(label);
    if (c.options) {   // enumerated presets → segmented buttons
      const seg = document.createElement('div'); seg.className = 'seg';
      const btns = c.options.map(([v, text]) => {
        const b = document.createElement('button'); b.textContent = text;
        b.addEventListener('click', () => { b.blur(); select(v); }); seg.appendChild(b); return [v, b];
      });
      const select = v => { for (const [bv, b] of btns) b.classList.toggle('on', bv === v); out.textContent = ''; c.on(v); };
      row.appendChild(seg); select(c.value);
    } else {
      const el = Object.assign(document.createElement('input'), { type: 'range', min: c.min, max: c.max, step: c.step, value: c.value });
      const upd = () => { const v = +el.value; out.textContent = v.toFixed(2); el.style.setProperty('--p', ((v - c.min) / (c.max - c.min) * 100) + '%'); c.on(v); };
      el.addEventListener('input', upd); el.addEventListener('keydown', e => { if (e.code === 'Space') e.preventDefault(); });
      row.appendChild(el); upd();
    }
    rows.appendChild(row);
  }
}

/* ---------- sizing ---------- */
const _sz = new THREE.Vector2();
function resize() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.getDrawingBufferSize(_sz);
  if (reflRT) reflRT.setSize(Math.max(2, _sz.x >> 1), Math.max(2, _sz.y >> 1));   // half-res mirror
  resizePost(_sz.x, _sz.y);
  const sc = _sz.y / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));     // point-size scale for pools
  for (const P of FX.pools || []) P.mat.uniforms.uScale.value = sc;
}
addEventListener('resize', resize);

/* ---------- frame ---------- */
const clock = new THREE.Clock();
let fpsN = 0, fpsT = 0;
const fpsEl = document.getElementById('fps'), statEl = document.getElementById('scount');
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  STATE.t += dt; const t = STATE.t; G.uTime.value = t;
  updateControls(dt);
  updateBurst(dt, t);
  for (const u of UPDATERS) u(dt, t);

  renderer.shadowMap.needsUpdate = true;
  if (WORLD.water) {   // mirror pass (half-res), without the water itself and view-dependent effects
    updateReflectionCamera(camera);
    for (const o of NO_REFLECT) o.visible = false;
    renderer.setRenderTarget(reflRT); renderer.clear(); renderer.render(scene, reflCam);
    for (const o of NO_REFLECT) o.visible = true;
  }
  renderer.setRenderTarget(POST.scene); renderer.clear(); renderer.render(scene, camera);
  runPost();

  fpsN++; fpsT += dt;
  if (fpsT > 0.5) { fpsEl.textContent = Math.round(fpsN / fpsT) + ' FPS'; statEl.textContent = SCENE.stat ? SCENE.stat() : ''; fpsN = 0; fpsT = 0; }
}

/* ---------- staged build (loader bar advances per step, UI stays responsive) ---------- */
async function init() {
  const steps = [...BUILD_STEPS, bakeSurface, () => { FX.splash = makePool(500, 6); buildPost(); buildPanel(); }];
  for (let i = 0; i < steps.length; i++) { steps[i](); setProgress((i + 1) / (steps.length + 1)); await nextFrame(); }
  if (WORLD.water) NO_REFLECT.push(WORLD.water);
  NO_REFLECT.push(...FX.pools.map(P => P.mesh));
  resize();
  updateControls(0.016);
  renderer.compile(scene, camera);   // compile every shader now instead of stuttering on first sight
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
