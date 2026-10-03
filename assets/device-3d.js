/* Attend-X device, 3D. Ported from 3d/attend-x-device-3d.html (Three.js r128) as a module the site loads on demand.
   Needs window.THREE and window.AX_MESH (assets/device-mesh.js).

   AXDevice.create(stage, opts) -> { setMode, setView, setLabels, setAutoRotate, refreshText, destroy }
     stage              element the canvas fills (position: relative, with a size)
     opts.interactive   true: drag to rotate, view presets, Product / Inside. false: fixed 3/4 view with a gentle idle sway (hero)
     opts.labelsEl      element that receives the part labels (interactive only)
     opts.t             key => string in the current language (label text and the canvas aria-label)
     opts.ariaKey       T key for the canvas aria-label
     opts.onReady       called after the first frame is on screen
     opts.onView        called with the view name when it changes (to sync the preset buttons)

   Geometry reference (mm, from the team's STL): case 145 x 65.25 x 25 on a 2 mm cover, total height 27.
   Scene axes: X = length, Y = up, Z = toward the front (display side).
   Top (Y=27): fingerprint window 19 x 34 at X 31.1; LED holes d5 at X -55.5..-27.5, Z 25.6.
   Front (Z=32.6): display window 26 x 20 at X 3.0, Y 14.65. Back: switch slot 15.5 x 8 at X 33.5, Y 13.8.
   Left end (X=-72.5): USB-C 9 x 4 at Z 0.5, Y 22. Right end: three 28 x 2 vents. */
(function () {
"use strict";

const TOP = 27, FRONT = 32.625, BACK = -32.4;
const SENSOR = { x: 31.1, z: -0.07, w: 19, d: 34 };
const LEDX = [-55.48, -48.49, -41.5, -34.52, -27.53], LEDZ = 25.6;
const DISP = { x: 3.04, y: 14.65, w: 26, h: 20 };
const LIFT = 46;                       // how far the case lifts in the Inside view
const VIEWS = {
  hero: { pos: [-175, 140, 250], target: [0, 11, 0] },
  front: { pos: [0, 60, 330], target: [0, 12, 0] },
  top: { pos: [0, 360, 40], target: [0, 9, 0] },
  back: { pos: [185, 130, -250], target: [0, 11, 0] }
};
// demo loop (student flow only): ready -> present -> ready -> present -> ready -> not recognized
const SEQ = [["ready", 2.6], ["ok", 2.0], ["ready", 2.6], ["ok", 2.0], ["ready", 2.6], ["fail", 1.6]];

let meshData = null;
function positions(b64) {
  const bin = atob(b64), buf = new ArrayBuffer(bin.length), u8 = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Float32Array(buf);
}
function geo(arr) {
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(arr, 3));
  g.computeVertexNormals(); return g;
}
function canvasTex(w, h, draw) {
  const c = document.createElement("canvas"); c.width = w; c.height = h; const x = c.getContext("2d"); draw(x, w, h);
  const tx = new THREE.CanvasTexture(c); tx.anisotropy = 8; tx.encoding = THREE.sRGBEncoding; return { tx, ctx: x };
}
function rr(x, X, Y, W, H, R) { x.beginPath(); x.moveTo(X + R, Y); x.arcTo(X + W, Y, X + W, Y + H, R); x.arcTo(X + W, Y + H, X, Y + H, R); x.arcTo(X, Y + H, X, Y, R); x.arcTo(X, Y, X + W, Y, R); x.closePath(); }
function noiseTex(size, base, amp) {
  return canvasTex(size, size, (x, w, h) => { const d = x.createImageData(w, h); for (let i = 0; i < d.data.length; i += 4) { const v = base + (Math.random() - .5) * amp; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; } x.putImageData(d, 0, 0); }).tx;
}

function create(stage, opts) {
  opts = opts || {};
  const interactive = !!opts.interactive;
  const tr = opts.t || (k => k);
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!meshData) meshData = { case: positions(AX_MESH.case), cover: positions(AX_MESH.cover) };

  const LABELS = [], leds = [];
  let mode = "product", shellLift = 0, screenState = "ready", showLabels = true, autoRotate = false;
  let displayTex, displayCtx, shell, inside;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputEncoding = THREE.sRGBEncoding; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const canvas = renderer.domElement;
  canvas.setAttribute("role", "img");
  stage.prepend(canvas);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(28, 1, 1, 3000);

  scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x0a1430, 0.22));
  const key = new THREE.DirectionalLight(0xffffff, 1.0); key.position.set(-120, 220, 170); key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048); Object.assign(key.shadow.camera, { left: -150, right: 150, top: 150, bottom: -150, near: 10, far: 600 }); key.shadow.bias = -0.0005; key.shadow.radius = 6;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x6eb4f9, 1.1); rim.position.set(200, 120, -180); scene.add(rim);
  const fill = new THREE.DirectionalLight(0xffffff, 0.35); fill.position.set(150, 60, 200); scene.add(fill);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), new THREE.ShadowMaterial({ opacity: 0.3 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

  const device = new THREE.Group(); device.position.y = 1.2; scene.add(device);
  const grain = noiseTex(256, 128, 70); grain.wrapS = grain.wrapT = THREE.RepeatWrapping; grain.repeat.set(6, 6);
  const blackMat = new THREE.MeshStandardMaterial({ color: 0x050608, roughness: 0.84, metalness: 0.05, bumpMap: grain, bumpScale: 0.05 });
  const baseMat = new THREE.MeshStandardMaterial({ color: 0x070809, roughness: 0.92, bumpMap: grain, bumpScale: 0.12 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x020203, roughness: 0.7 });
  const metal = new THREE.MeshStandardMaterial({ color: 0xb8bec8, roughness: 0.32, metalness: 0.9 });

  // the team's cover (base plate with its two tabs) and rubber feet
  const cover = new THREE.Mesh(geo(meshData.cover), baseMat); cover.castShadow = true; cover.receiveShadow = true; device.add(cover);
  [[-64, -25], [64, -25], [-64, 25], [64, 25]].forEach(([x, z]) => { const f = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.2, 1.2, 20), darkMat); f.position.set(x, -0.6, z); device.add(f); });

  // the team's case + everything mounted in its openings
  shell = new THREE.Group(); device.add(shell);
  const caseMesh = new THREE.Mesh(geo(meshData.case), blackMat); caseMesh.castShadow = true; caseMesh.receiveShadow = true; shell.add(caseMesh);
  const liner = new THREE.Mesh(new THREE.BoxGeometry(139, 20, 59), new THREE.MeshBasicMaterial({ color: 0x010102, side: THREE.BackSide }));
  liner.position.set(0, 14, 0); shell.add(liner);

  // fingerprint sensor glass sitting in the top window
  const glass = canvasTex(256, 448, (x, w, h) => {
    x.fillStyle = "#06090f"; x.fillRect(0, 0, w, h);
    const gl = x.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, h * .55); gl.addColorStop(0, "#0d2246"); gl.addColorStop(1, "#050a14");
    x.fillStyle = gl; rr(x, 22, 30, w - 44, h - 60, 26); x.fill();
    x.strokeStyle = "rgba(110,180,249,0.16)"; x.lineWidth = 4; x.lineCap = "round";
    for (let r = 18; r < 150; r += 16) { x.beginPath(); x.arc(w / 2, h * .6, r, Math.PI * 1.05, Math.PI * 1.95); x.stroke(); }
    x.shadowColor = "#6EB4F9"; x.shadowBlur = 26; x.strokeStyle = "rgba(110,180,249,0.95)"; x.lineWidth = 7; rr(x, 22, 30, w - 44, h - 60, 26); x.stroke();
  });
  const glassMesh = new THREE.Mesh(new THREE.PlaneGeometry(SENSOR.w - 0.6, SENSOR.d - 0.6), new THREE.MeshStandardMaterial({ map: glass.tx, emissive: 0xffffff, emissiveMap: glass.tx, emissiveIntensity: 0.9, roughness: 0.1, metalness: 0.1 }));
  glassMesh.rotation.x = -Math.PI / 2; glassMesh.position.set(SENSOR.x, TOP - 0.8, SENSOR.z); shell.add(glassMesh);

  // suggested logo on the free area of the top
  const wmTex = new THREE.TextureLoader().load(AX_MESH.wordmark, tx => { tx.encoding = THREE.sRGBEncoding; tx.anisotropy = 8; tx.needsUpdate = true; invalidate(); });
  const wm = new THREE.Mesh(new THREE.PlaneGeometry(50, 50 * 187 / 640), new THREE.MeshBasicMaterial({ map: wmTex, transparent: true, opacity: 0.94, depthWrite: false, toneMapped: false }));
  wm.rotation.x = -Math.PI / 2; wm.position.set(-22, TOP + 0.03, -9); shell.add(wm);

  // LEDs in the five top holes, in the order on the case: white (power), blue (ready), orange (pairing), green (present), red (not recognized)
  [0xe8eefb, 0x3b82f6, 0xf59e0b, 0x22c55e, 0xef4444].forEach((c, i) => {
    const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(c).multiplyScalar(0.18), emissive: c, emissiveIntensity: 0.04, roughness: 0.25 });
    const led = new THREE.Mesh(new THREE.SphereGeometry(2.35, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), m); led.scale.y = .55; led.position.set(LEDX[i], TOP - 0.3, LEDZ); shell.add(led); leds.push(m);
  });

  // screen behind the front window
  const d = canvasTex(520, 400, () => {}); displayTex = d.tx; displayCtx = d.ctx;
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(DISP.w - 0.4, DISP.h - 0.4), new THREE.MeshBasicMaterial({ map: displayTex, toneMapped: false }));
  scr.position.set(DISP.x, DISP.y, FRONT - 1.2); shell.add(scr);

  // USB-C receptacle behind the end hole
  const usb = new THREE.Mesh(new THREE.BoxGeometry(1.5, 3.2, 8.4), new THREE.MeshStandardMaterial({ color: 0x9aa1ab, metalness: .9, roughness: .3 })); usb.position.set(-71.3, 22, 0.47); shell.add(usb);
  const usbIn = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.4, 7.4), darkMat); usbIn.position.set(-71.2, 22, 0.47); shell.add(usbIn);
  const tongue = new THREE.Mesh(new THREE.BoxGeometry(1.7, .7, 5.6), metal); tongue.position.set(-71.1, 22, 0.47); shell.add(tongue);
  // slide switch in the back slot
  const knob = new THREE.Mesh(new THREE.BoxGeometry(5, 4.4, 2.2), new THREE.MeshStandardMaterial({ color: 0x2a2e36, roughness: .5 })); knob.position.set(30.5, 13.8, BACK + 0.4); shell.add(knob);

  /* ---------- inside (illustrative placement, matched to the case's inner walls) ---------- */
  inside = new THREE.Group(); inside.visible = false; device.add(inside);
  if (interactive) {
    const pcbG = new THREE.MeshStandardMaterial({ color: 0x1e5b3a, roughness: 0.55, metalness: 0.1 });
    const pcbB = new THREE.MeshStandardMaterial({ color: 0x1f4fa8, roughness: 0.5 });
    const chip = new THREE.MeshStandardMaterial({ color: 0x111317, roughness: 0.4 });
    const box = (w, h, dd, m, x, y, z) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, dd), m); o.position.set(x, y, z); o.castShadow = true; inside.add(o); return o; };
    box(64, 1.6, 54, pcbG, 36, 10.8, -2);                        // main PCB (raised on the cover tabs side)
    box(50, 1.6, 26, chip, 40, 12.6, -16);                       // ESP32 devkit
    box(18, 2.6, 22, metal, 58, 14.4, -16);                      // ESP32 module shield
    for (let i = 0; i < 12; i++) { box(1, 4, 1, metal, 18 + i * 4, 11.4, -28.5); box(1, 4, 1, metal, 18 + i * 4, 11.4, -3.5); }
    box(20, 9, 34, chip, SENSOR.x, 21.5, SENSOR.z);              // fingerprint module under the window
    box(18, .4, 32, new THREE.MeshStandardMaterial({ color: 0x1b3d73, emissive: 0x2a6fd6, emissiveIntensity: .6 }), SENSOR.x, 26.1, SENSOR.z);
    box(32, 24, 1.6, new THREE.MeshStandardMaterial({ color: 0x14306b, roughness: .5 }), DISP.x, 14.6, 29.6); // display module
    const batt = new THREE.Mesh(new THREE.CylinderGeometry(8.8, 8.8, 58, 40), new THREE.MeshStandardMaterial({ color: 0x1d4f9a, roughness: 0.35, metalness: 0.2 }));
    batt.rotation.z = Math.PI / 2; batt.position.set(-36, 11.2, -21.8); batt.castShadow = true; inside.add(batt);
    [-1, 1].forEach(s => { const cap = new THREE.Mesh(new THREE.CylinderGeometry(8.4, 8.4, 1.4, 40), metal); cap.rotation.z = Math.PI / 2; cap.position.set(-36 + s * 29.4, 11.2, -21.8); inside.add(cap); });
    box(28, 1.2, 3, new THREE.MeshStandardMaterial({ color: 0xe8eefb, roughness: .6 }), -36, 20, -21.8);
    box(26, 1.6, 17, pcbB, -58, 23, 2);                          // charger near the USB-C end
    box(8, 3.2, 9, metal, -68, 21, 0.5);
    box(34, 1.6, 8, chip, -41.5, 23.4, LEDZ);                    // LED board under the holes
    LEDX.forEach(x => box(3, 3, 3, new THREE.MeshStandardMaterial({ color: 0xdfe6f2, roughness: .3 }), x, 25.2, LEDZ));
    const buzz = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 7, 32), chip); buzz.position.set(-12, 6, 14); inside.add(buzz);
    const wire = (pts, col) => { const c = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p))); inside.add(new THREE.Mesh(new THREE.TubeGeometry(c, 40, 0.7, 8), new THREE.MeshStandardMaterial({ color: col, roughness: .5 }))); };
    wire([[-6, 11, -21], [2, 14, -18], [16, 13, -14]], 0xd93a3a);
    wire([[-6, 9, -23], [4, 11, -20], [16, 12, -16]], 0x16181d);
    wire([[-48, 22, 4], [-26, 18, 6], [8, 13, 6]], 0xf2c230);
    wire([[-26, 22.5, 22], [-6, 18, 14], [10, 13, 6]], 0x6eb4f9);
    wire([[22, 13, 6], [12, 15, 18], [6, 15, 28]], 0xa78bfa);
    wire([[40, 13, 2], [36, 15, 1], [32, 17, 0]], 0x22c55e);

    addLabel("l_sensor", [SENSOR.x, TOP, SENSOR.z], [0, 1, 0], "product", shell);
    addLabel("l_leds", [-41.5, TOP, LEDZ], [0, 1, 0], "product", shell);
    addLabel("l_display", [DISP.x, DISP.y + 6, FRONT], [0, 0, 1], "product", shell);
    addLabel("l_usb", [-72.5, 22, 0.5], [-1, 0, 0], "product", shell);
    addLabel("l_switch", [30.5, 13.8, -32.6], [0, 0, -1], "product", shell);
    addLabel("l_vents", [72.5, 14.5, -1.5], [1, 0, 0], "product", shell);
    addLabel("l_esp", [64, 16, -26], null, "inside", inside);
    addLabel("l_fpm", [SENSOR.x - 2, 26, 14], null, "inside", inside);
    addLabel("l_dispm", [DISP.x - 10, 26, 29.6], null, "inside", inside);
    addLabel("l_batt", [-50, 20, -21.8], null, "inside", inside);
    addLabel("l_chg", [-60, 24, 9], null, "inside", inside);
    addLabel("l_ledbar", [-30, 26, LEDZ], null, "inside", inside);
    addLabel("l_buzz", [-12, 10, 14], null, "inside", inside);
  }

  /* Device screen (26 x 20 mm window, 520 x 400 canvas). Student flow; the pairing code is for the teacher at session start and is not shown here. */
  function drawScreen(state) {
    screenState = state;
    const x = displayCtx, w = 520, h = 400, cx = w / 2;
    const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, "#10204A"); g.addColorStop(1, "#0A1430");
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    x.textAlign = "center"; x.textBaseline = "alphabetic";
    x.fillStyle = "#A9BADB"; x.font = "600 26px Inter, Arial, sans-serif"; x.fillText("ELC 312 · 08:59", cx, 46);
    if (state === "ok") {
      x.fillStyle = "#4ADE80"; x.beginPath(); x.arc(cx, 170, 74, 0, Math.PI * 2); x.fill();
      x.strokeStyle = "#0A1430"; x.lineWidth = 16; x.lineCap = "round"; x.lineJoin = "round";
      x.beginPath(); x.moveTo(cx - 32, 172); x.lineTo(cx - 8, 196); x.lineTo(cx + 36, 146); x.stroke();
      x.fillStyle = "#4ADE80"; x.font = "800 46px Inter, Arial, sans-serif"; x.fillText("Present", cx, 314);
      x.fillStyle = "#F4F7FC"; x.font = "600 30px Inter, Arial, sans-serif"; x.fillText("Mariam Hassan", cx, 358);
    } else if (state === "fail") {
      x.fillStyle = "#F87171"; x.beginPath(); x.arc(cx, 170, 74, 0, Math.PI * 2); x.fill();
      x.strokeStyle = "#0A1430"; x.lineWidth = 16; x.lineCap = "round";
      x.beginPath(); x.moveTo(cx - 28, 142); x.lineTo(cx + 28, 198); x.moveTo(cx + 28, 142); x.lineTo(cx - 28, 198); x.stroke();
      x.fillStyle = "#F87171"; x.font = "800 42px Inter, Arial, sans-serif"; x.fillText("Not recognized", cx, 314);
      x.fillStyle = "#F4F7FC"; x.font = "500 28px Inter, Arial, sans-serif"; x.fillText("Please try again", cx, 356);
    } else {
      x.lineWidth = 10; x.strokeStyle = "rgba(110,180,249,0.35)"; x.beginPath(); x.arc(cx, 170, 74, 0, Math.PI * 2); x.stroke();
      x.strokeStyle = "#6EB4F9"; x.lineWidth = 8; x.lineCap = "round";
      for (let r = 14; r <= 54; r += 13) { x.beginPath(); x.arc(cx, 186, r, Math.PI * 1.08, Math.PI * 1.92); x.stroke(); }
      x.beginPath(); x.moveTo(cx, 186); x.lineTo(cx, 214); x.stroke();
      x.beginPath(); x.arc(cx, 186, 40, Math.PI * 0.1, Math.PI * 0.42); x.stroke();
      x.fillStyle = "#F4F7FC"; x.font = "700 40px Inter, Arial, sans-serif"; x.fillText("Place your finger", cx, 314);
      x.fillStyle = "#A9BADB"; x.font = "500 26px Inter, Arial, sans-serif"; x.fillText("Analog Integrated Circuits", cx, 356);
    }
    displayTex.needsUpdate = true;
    setLeds(state);
  }
  function setLeds(state, pulse) {
    leds.forEach(l => l.emissiveIntensity = 0.04);
    leds[0].emissiveIntensity = 1.1;
    if (state === "ready") leds[1].emissiveIntensity = 2.2 + (pulse || 0);
    if (state === "ok") leds[3].emissiveIntensity = 3;
    if (state === "fail") leds[4].emissiveIntensity = 3;
  }

  function addLabel(key, pos, normal, m, parent) {
    const el = document.createElement("div"); el.className = "v3-lbl"; el.dataset.off = "1"; el.innerHTML = "<i></i><span></span>";
    opts.labelsEl.appendChild(el);
    LABELS.push({ key, el, pos: new THREE.Vector3(...pos), normal: normal && new THREE.Vector3(...normal), mode: m, parent });
  }
  const _v = new THREE.Vector3(), _c = new THREE.Vector3(), _p = new THREE.Vector3();
  function updateLabels() {
    const w = stage.clientWidth, h = stage.clientHeight;
    LABELS.forEach(l => {
      let on = showLabels && l.mode === mode && (mode === "product" ? shellLift < 1 : shellLift > 25);
      _v.copy(l.pos); l.parent.localToWorld(_v);
      if (on && l.normal) { _c.copy(camera.position).sub(_v); on = l.normal.dot(_c.normalize()) > 0.18; }
      _p.copy(_v).project(camera); if (_p.z > 1) on = false;
      l.el.style.transform = `translate(${Math.round((_p.x * .5 + .5) * w - 5)}px, ${Math.round((-_p.y * .5 + .5) * h - 5)}px)`;
      l.el.dataset.off = on ? "0" : "1";
    });
  }
  function refreshText() {
    LABELS.forEach(l => { l.el.querySelector("span").textContent = tr(l.key); });
    if (opts.ariaKey) canvas.setAttribute("aria-label", tr(opts.ariaKey));
  }

  /* Camera: an orbit around `target` in spherical coordinates. Drag rotates; the page keeps the wheel and vertical swipes for scrolling. */
  const target = new THREE.Vector3(), sph = new THREE.Spherical();
  let goal = null, baseY = 11, vTheta = 0, vPhi = 0, dragging = false;
  const PHI_MIN = 0.1, PHI_MAX = Math.PI * 0.49;
  function viewSph(name) { const v = VIEWS[name]; return { s: new THREE.Spherical().setFromVector3(new THREE.Vector3(...v.pos).sub(new THREE.Vector3(...v.target))), y: v.target[1] }; }
  function setView(name, instant) {
    if (!VIEWS[name]) return;
    const g = viewSph(name); baseY = g.y; vTheta = vPhi = 0;
    if (instant || reduce) { sph.copy(g.s); target.set(0, baseY + (mode === "inside" ? 16 : 0), 0); goal = null; }
    else { g.s.theta = sph.theta + Math.atan2(Math.sin(g.s.theta - sph.theta), Math.cos(g.s.theta - sph.theta)); goal = g.s; }
    if (opts.onView) opts.onView(name);
    invalidate();
  }
  function placeCamera(sway) {
    _c.setFromSphericalCoords(sph.radius, sph.phi, sph.theta + (sway || 0));
    camera.position.copy(target).add(_c); camera.lookAt(target);
  }
  function setMode(m) {
    mode = m === "inside" ? "inside" : "product";
    if (reduce) { shellLift = mode === "inside" ? LIFT : 0; target.y = baseY + (mode === "inside" ? 16 : 0); }
    invalidate();
  }
  function applyShell() { shell.position.y = shellLift; inside.visible = shellLift > 0.5; liner.visible = shellLift < 0.5; }

  if (interactive) {
    let px = 0, py = 0;
    canvas.addEventListener("pointerdown", e => { dragging = true; goal = null; px = e.clientX; py = e.clientY; vTheta = vPhi = 0; try { canvas.setPointerCapture(e.pointerId); } catch (err) {} });
    canvas.addEventListener("pointermove", e => {
      if (!dragging) return;
      const k = 2 * Math.PI / Math.max(stage.clientHeight, 1) * 0.3;
      vTheta = -(e.clientX - px) * k; vPhi = -(e.clientY - py) * k; px = e.clientX; py = e.clientY;
      sph.theta += vTheta; sph.phi = Math.min(PHI_MAX, Math.max(PHI_MIN, sph.phi + vPhi));
      if (opts.onView) opts.onView(null);
    });
    const end = () => { dragging = false; };
    canvas.addEventListener("pointerup", end); canvas.addEventListener("pointercancel", end);
  }

  function resize() {
    const w = stage.clientWidth, h = stage.clientHeight; if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w / h;
    // keep ~120 mm (viewer, room for labels) or ~105 mm (hero) either side of the centre in frame at the 3/4 distance
    const fit = 2 * Math.atan(((interactive ? 120 : 105) / 335) / camera.aspect) * 180 / Math.PI;
    camera.fov = Math.min(46, Math.max(interactive ? 23 : 24, fit));
    // --shift3d on the stage (a fraction of its height) moves the device up, to leave room for a card overlapping the bottom
    const shift = parseFloat(getComputedStyle(stage).getPropertyValue("--shift3d")) || 0;
    if (shift) camera.setViewOffset(w, h, 0, Math.round(shift * h), w, h); else camera.clearViewOffset();
    camera.updateProjectionMatrix();
    invalidate();
  }

  /* Loop: runs only while the stage is on screen and the tab is visible. With reduced motion the hero draws single frames on demand. */
  const animated = interactive || !reduce;
  let raf = 0, last = 0, seqI = 0, seqT = 0, onScreen = true, dead = false, clock = 0, ready = false;
  function frame(now) {
    raf = 0; if (dead) return;
    const dt = Math.min((now - last) / 1000 || 0, .05); last = now; clock += dt;
    const liftGoal = mode === "inside" ? LIFT : 0;
    shellLift += (liftGoal - shellLift) * Math.min(dt * 5, 1); applyShell();
    target.y += (baseY + (mode === "inside" ? 16 : 0) - target.y) * Math.min(dt * 4, 1);
    if (goal) {
      const k = Math.min(dt * 4, 1);
      sph.theta += (goal.theta - sph.theta) * k; sph.phi += (goal.phi - sph.phi) * k; sph.radius += (goal.radius - sph.radius) * k;
      if (Math.abs(goal.theta - sph.theta) + Math.abs(goal.phi - sph.phi) < .002) goal = null;
    } else if (!dragging) {
      if (autoRotate && !reduce) sph.theta += dt * 0.25;
      sph.theta += vTheta; sph.phi = Math.min(PHI_MAX, Math.max(PHI_MIN, sph.phi + vPhi));
      vTheta *= 0.9; vPhi *= 0.9;
    }
    let sway = 0;
    if (!reduce) {
      seqT += dt; if (seqT > SEQ[seqI][1]) { seqT = 0; seqI = (seqI + 1) % SEQ.length; drawScreen(SEQ[seqI][0]); }
      setLeds(screenState, Math.sin(now / 300) * .6);
      if (!interactive) sway = Math.sin(clock * 0.45) * 0.09;   // gentle idle motion in the hero
    }
    placeCamera(sway);
    renderer.render(scene, camera); if (interactive) updateLabels();
    if (!ready) { ready = true; if (opts.onReady) opts.onReady(); }
    if (animated && onScreen && !document.hidden) raf = requestAnimationFrame(frame);
  }
  function invalidate() { if (!raf && !dead && onScreen) { last = performance.now(); raf = requestAnimationFrame(frame); } }

  const io = new IntersectionObserver(es => { onScreen = es[es.length - 1].isIntersecting; if (onScreen) invalidate(); }, { rootMargin: "80px" });
  io.observe(stage);
  const ro = new ResizeObserver(resize); ro.observe(stage);
  const onVis = () => { if (!document.hidden) invalidate(); };
  document.addEventListener("visibilitychange", onVis);
  canvas.addEventListener("webglcontextlost", e => { e.preventDefault(); if (opts.onLost) opts.onLost(); });

  drawScreen("ready");
  setView("hero", true); resize(); refreshText();
  // the screen text is drawn on a canvas, so redraw it once the web fonts are in
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (!dead) { drawScreen(screenState); invalidate(); } });

  return {
    setMode, setView, refreshText,
    setLabels(on) { showLabels = !!on; invalidate(); },
    setAutoRotate(on) { autoRotate = !!on; if (on) goal = null; },
    destroy() { dead = true; cancelAnimationFrame(raf); io.disconnect(); ro.disconnect(); document.removeEventListener("visibilitychange", onVis); renderer.dispose(); canvas.remove(); }
  };
}

window.AXDevice = { create };
})();
