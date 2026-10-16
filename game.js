import * as THREE from 'three';

const $ = (s) => document.querySelector(s);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const damp = (rate, dt) => 1 - Math.exp(-rate * dt);
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
function lerpAngle(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

// =====================================================================
// Renderer, scene, arena
// =====================================================================
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07060f);
scene.fog = new THREE.Fog(0x07060f, 16, 42);

const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 120);
camera.position.set(0, 3, 9);
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

scene.add(new THREE.HemisphereLight(0x8c7cff, 0x140a1c, 0.6));
const key = new THREE.DirectionalLight(0xffffff, 2.4);
key.position.set(4, 12, 7);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -11, right: 11, top: 11, bottom: -11, near: 1, far: 30 });
key.shadow.bias = -0.0005;
scene.add(key);
const rimA = new THREE.PointLight(0xff2d6f, 60, 30, 2);
rimA.position.set(-8, 4, -4);
const rimB = new THREE.PointLight(0x2de2ff, 60, 30, 2);
rimB.position.set(8, 4, -4);
scene.add(rimA, rimB);
const hitLight = new THREE.PointLight(0xffffff, 0, 9, 2);
scene.add(hitLight);

const ARENA_R = 8.4;

function floorTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 1024;
  const g = c.getContext('2d');
  g.fillStyle = '#15122a';
  g.fillRect(0, 0, 1024, 1024);
  g.strokeStyle = 'rgba(255,255,255,0.05)';
  g.lineWidth = 2;
  for (let i = 0; i <= 1024; i += 64) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 1024); g.stroke();
    g.beginPath(); g.moveTo(0, i); g.lineTo(1024, i); g.stroke();
  }
  const ring = (r, color, w) => { g.strokeStyle = color; g.lineWidth = w; g.beginPath(); g.arc(512, 512, r, 0, Math.PI * 2); g.stroke(); };
  ring(490, '#ff2d6f', 10);
  ring(470, 'rgba(255,45,111,0.35)', 3);
  ring(300, 'rgba(45,226,255,0.35)', 4);
  ring(90, 'rgba(255,209,102,0.5)', 4);
  g.fillStyle = 'rgba(255,255,255,0.06)';
  g.font = '160px Bungee, Impact, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('VS', 512, 520);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
const floorMat = new THREE.MeshStandardMaterial({ map: floorTexture(), roughness: 0.5, metalness: 0.3 });
const floor = new THREE.Mesh(new THREE.CircleGeometry(9.2, 96), floorMat);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);
// Redraw once the display font loads so "VS" uses it.
document.fonts?.ready.then(() => { floorMat.map = floorTexture(); floorMat.needsUpdate = true; });

const plinth = new THREE.Mesh(
  new THREE.CylinderGeometry(9.2, 9.8, 1.0, 96, 1, true),
  new THREE.MeshStandardMaterial({ color: 0x1a1630, roughness: 0.8 })
);
plinth.position.y = -0.5;
scene.add(plinth);
const edge = new THREE.Mesh(new THREE.TorusGeometry(9.2, 0.05, 8, 180), new THREE.MeshBasicMaterial({ color: 0xff2d6f }));
edge.rotation.x = Math.PI / 2;
edge.position.y = 0.02;
scene.add(edge);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: 0x0a0814, roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.position.y = -1;
ground.receiveShadow = true;
scene.add(ground);

// Pillars with neon strips around the ring.
{
  const pillarMat = new THREE.MeshStandardMaterial({ color: 0x17132b, roughness: 0.7 });
  const neon = [new THREE.MeshBasicMaterial({ color: 0xff2d6f }), new THREE.MeshBasicMaterial({ color: 0x2de2ff })];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const r = 17;
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.9, 11, 0.9), pillarMat);
    p.position.set(Math.cos(a) * r, 4.5, Math.sin(a) * r);
    p.lookAt(0, 4.5, 0);
    scene.add(p);
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.12, 9, 0.05), neon[i % 2]);
    s.position.set(0, 0, 0.47);
    p.add(s);
  }
}
// Floating dust.
const dust = (() => {
  const n = 500, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const r = 4 + Math.random() * 18, a = Math.random() * Math.PI * 2;
    pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 1] = Math.random() * 10; pos[i * 3 + 2] = Math.sin(a) * r;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xb9a8ff, size: 0.05, transparent: true, opacity: 0.6, depthWrite: false }));
  scene.add(pts);
  return pts;
})();

// =====================================================================
// Audio (synthesised, no files)
// =====================================================================
let actx = null, master = null, noiseBuf = null;
function initAudio() {
  if (actx) { if (actx.state === 'suspended') actx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  actx = new AC();
  master = actx.createGain();
  master.gain.value = 0.6;
  master.connect(actx.destination);
  noiseBuf = actx.createBuffer(1, actx.sampleRate * 0.6, actx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}
function noise(t, dur, freq, q, vol, type = 'bandpass', freqEnd) {
  const src = actx.createBufferSource();
  src.buffer = noiseBuf;
  const f = actx.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, t);
  if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
  f.Q.value = q;
  const g = actx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t);
  src.stop(t + dur);
}
function tone(t, dur, f0, f1, vol, type = 'sine') {
  const o = actx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = actx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur);
}
function playSfx(kind) {
  if (!actx) return;
  const t = actx.currentTime;
  switch (kind) {
    case 'whoosh': noise(t, 0.14, 500, 1.2, 0.14, 'bandpass', 2600); break;
    case 'hit': tone(t, 0.12, 190, 60, 0.5); noise(t, 0.07, 2200, 0.8, 0.4, 'lowpass'); break;
    case 'heavy': tone(t, 0.22, 150, 40, 0.75); noise(t, 0.13, 1600, 0.7, 0.5, 'lowpass'); break;
    case 'super': tone(t, 0.6, 95, 28, 0.9); noise(t, 0.4, 3200, 0.5, 0.55, 'lowpass', 200); tone(t, 0.35, 900, 200, 0.16, 'sawtooth'); break;
    case 'charge': tone(t, 0.3, 200, 900, 0.12, 'sawtooth'); break;
    case 'block': tone(t, 0.07, 950, 500, 0.14, 'square'); noise(t, 0.05, 4200, 2, 0.18); break;
    case 'jump': noise(t, 0.12, 300, 1, 0.08, 'bandpass', 1000); break;
    case 'land': tone(t, 0.08, 120, 60, 0.18); break;
    case 'ko': tone(t, 1.4, 75, 24, 0.95); noise(t, 0.9, 900, 0.5, 0.45, 'lowpass', 70); break;
    case 'bell': tone(t, 1.1, 1320, 1290, 0.18, 'triangle'); tone(t, 1.1, 660, 650, 0.2); break;
  }
}

// =====================================================================
// Effects: sparks, shockwaves, shake. Driven by NBSim events.
// =====================================================================
const sparkGeo = new THREE.OctahedronGeometry(0.045);
const sparks = [];
for (let i = 0; i < 260; i++) {
  const m = new THREE.Mesh(sparkGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }));
  m.visible = false;
  m.userData = { vel: V(), life: 0, max: 1 };
  scene.add(m);
  sparks.push(m);
}
let sparkIdx = 0;
const waves = [];
for (let i = 0; i < 4; i++) {
  const w = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 48), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
  w.visible = false;
  w.userData = { life: 0 };
  scene.add(w);
  waves.push(w);
}
let shake = 0;

function runFx(type, a) {
  switch (type) {
    case 'sfx': playSfx(a); break;
    case 'burst': {
      const [x, y, z, color, n, speed] = a;
      for (let i = 0; i < n; i++) {
        const s = sparks[sparkIdx++ % sparks.length];
        s.visible = true;
        s.position.set(x, y, z);
        s.material.color.setHex(i % 3 === 0 ? 0xffffff : color);
        s.userData.vel.set(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.4 + Math.random()));
        s.userData.life = s.userData.max = 0.25 + Math.random() * 0.35;
      }
      hitLight.position.set(x, y, z);
      hitLight.color.setHex(color);
      hitLight.intensity = 25 + n * 2;
      break;
    }
    case 'wave': {
      const [x, y, z, color] = a;
      const w = waves.find((w) => !w.visible) || waves[0];
      w.visible = true;
      w.position.set(x, y, z);
      w.lookAt(camera.position);
      w.material.color.setHex(color);
      w.userData.life = 0;
      break;
    }
    case 'shake': shake = Math.max(shake, a); break;
    case 'announce': announce(a[0], a[1], a[2]); break;
  }
}
function updateFx(dt) {
  for (const s of sparks) {
    if (!s.visible) continue;
    const u = s.userData;
    u.life -= dt;
    if (u.life <= 0) { s.visible = false; continue; }
    u.vel.y -= 9 * dt;
    s.position.addScaledVector(u.vel, dt);
    s.scale.setScalar(u.life / u.max);
  }
  for (const w of waves) {
    if (!w.visible) continue;
    w.userData.life += dt;
    const k = w.userData.life / 0.45;
    if (k >= 1) { w.visible = false; continue; }
    w.scale.setScalar(0.3 + k * 3.5);
    w.material.opacity = 1 - k;
  }
  hitLight.intensity *= Math.exp(-14 * dt);
  shake *= Math.exp(-9 * dt);
}

// =====================================================================
// Announcer
// =====================================================================
const annEl = $('#announce'), subEl = $('#subtext');
function announce(text, mode = 'go', sub = '') {
  annEl.className = '';
  void annEl.offsetWidth; // restart animation
  annEl.textContent = text;
  annEl.className = mode === 'ko' ? 'stay ko' : mode;
  subEl.textContent = sub;
}
function clearAnnounce() { annEl.className = ''; annEl.textContent = ''; subEl.textContent = ''; }

// =====================================================================
// Fighter models. The rules live in sim.js (NBSim); these just draw its state.
// =====================================================================
const { ROSTER, POSE_KEYS, NONE } = NBSim;
const hexStr = (n) => '#' + n.toString(16).padStart(6, '0');

function capsule(r, len, mat) {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.01, len - 2 * r), 4, 12), mat);
  m.position.y = -len / 2;
  return m;
}
function joint(parent, x, y, z) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

class FighterView {
  constructor(idx) {
    const d = ROSTER[idx];
    this.suit = new THREE.MeshStandardMaterial({ color: d.color, roughness: 0.4, metalness: 0.15 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1d1a2c, roughness: 0.7 });
    const skin = new THREE.MeshStandardMaterial({ color: d.skin, roughness: 0.65 });
    const trim = new THREE.MeshStandardMaterial({ color: d.trim, emissive: d.trim, emissiveIntensity: 1.3 });
    this.glove = new THREE.MeshStandardMaterial({ color: d.color, emissive: d.color, emissiveIntensity: 0.4, roughness: 0.3 });

    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);
    scene.add(this.root);

    const hips = (this.hips = joint(this.body, 0, 1.0, 0));
    hips.add(new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.2, 0.25), dark));
    const spine = joint(hips, 0, 0.06, 0);
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.22, 4, 14), this.suit);
    torso.scale.set(1.25, 1, 0.72);
    torso.position.y = 0.32;
    spine.add(torso);
    const belt = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.06, 0.29), trim);
    belt.position.y = 0.03;
    spine.add(belt);
    const neck = joint(spine, 0, 0.6, 0);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 20, 14), skin);
    head.position.y = 0.14;
    neck.add(head);
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.168, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), dark);
    hair.position.y = 0.15;
    hair.rotation.x = -0.25;
    neck.add(hair);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.05, 0.06), trim);
    visor.position.set(0, 0.16, 0.135);
    neck.add(visor);

    const arm = (side) => {
      const sh = joint(spine, 0.3 * side, 0.5, 0);
      sh.add(new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 10), this.suit));
      sh.add(capsule(0.07, 0.3, this.suit));
      const el = joint(sh, 0, -0.3, 0);
      el.add(capsule(0.06, 0.28, skin));
      const fist = new THREE.Mesh(new THREE.SphereGeometry(0.088, 12, 10), this.glove);
      fist.position.y = -0.3;
      el.add(fist);
      return [sh, el];
    };
    const leg = (side) => {
      const hp = joint(hips, 0.12 * side, -0.06, 0);
      hp.add(capsule(0.095, 0.46, dark));
      const kn = joint(hp, 0, -0.46, 0);
      kn.add(capsule(0.08, 0.44, this.suit));
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.09, 0.28), dark);
      boot.position.set(0, -0.44, 0.05);
      kn.add(boot);
      return [hp, kn];
    };
    // +x is the fighter's left (they face +z).
    const [lSh, lEl] = arm(1);
    const [rSh, rEl] = arm(-1);
    const [lHip, lKn] = leg(1);
    const [rHip, rKn] = leg(-1);
    this.j = { spine, neck, lSh, rSh, lEl, rEl, lHip, rHip, lKn, rKn };
    this.root.traverse((o) => { if (o.isMesh) o.castShadow = true; });

    // Name tag over the head ("YOU", "P2", ...).
    const c = document.createElement('canvas');
    c.width = 128; c.height = 48;
    this.tagCanvas = c;
    this.tagTex = new THREE.CanvasTexture(c);
    this.tagTex.colorSpace = THREE.SRGBColorSpace;
    this.tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tagTex, depthTest: false, transparent: true }));
    this.tag.scale.set(0.75, 0.28, 1);
    this.tag.position.y = 2.2;
    this.tag.renderOrder = 10;
    this.tagText = null;
    this.color = d.color;
    this.root.add(this.tag);
    this.root.visible = false;
  }

  setTag(text) {
    if (text === this.tagText) return;
    this.tagText = text;
    const g = this.tagCanvas.getContext('2d');
    g.clearRect(0, 0, 128, 48);
    if (text) {
      g.font = '700 28px "Chakra Petch", system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = hexStr(this.color);
      g.fillText(text, 64, 20);
      g.beginPath(); g.moveTo(56, 38); g.lineTo(72, 38); g.lineTo(64, 46); g.fill();
    }
    this.tagTex.needsUpdate = true;
    this.tag.visible = !!text;
  }

  sync(f) {
    this.root.visible = true;
    this.root.position.set(f.x, f.y, f.z);
    this.root.rotation.y = f.yaw;
    this.body.rotation.x = f.bodyRx;
    this.body.position.y = f.bodyY;
    const c = f.pose, j = this.j;
    this.hips.position.y = 1.0 + c.hy;
    j.spine.rotation.set(c.sx, c.sy, 0);
    j.neck.rotation.set(c.nx, -c.sy * 0.6, 0);
    j.lSh.rotation.set(c.lsx, 0, c.lsz);
    j.rSh.rotation.set(c.rsx, 0, c.rsz);
    j.lEl.rotation.x = c.lex;
    j.rEl.rotation.x = c.rex;
    j.lHip.rotation.set(c.lhx, 0, c.lhz);
    j.rHip.rotation.set(c.rhx, 0, c.rhz);
    j.lKn.rotation.x = c.lkx;
    j.rKn.rotation.x = c.rkx;
    const fl = Math.max(0, f.flash) / 0.12;
    this.suit.emissive.setRGB(fl, fl, fl);
    this.glove.emissiveIntensity = f.meter >= 100 ? 1.2 + Math.sin(f.clock * 12) * 0.6 : 0.4;
  }
}
const views = ROSTER.map((_, i) => new FighterView(i));

// =====================================================================
// App state
// =====================================================================
const A = {
  mode: 'menu', // 'menu' | 'local' | 'host' | 'guest'
  S: null, // NBSim match state (simulated here, or mirrored from the host)
  menuS: NBSim.createMatch({ slots: [{ kind: 'cpu' }, { kind: 'cpu' }] }),
  you: [], // fighter indices controlled on this device
  humans: [], // { fidx, bind, pad }
  paused: false,
  snap: null, pending: [], sendAcc: 0, overShown: false,
  lobbyRole: null,
  opts: { fighters: 2, humans: 1, diff: 'normal', onlineFighters: 2 },
};
A.menuS.events = [];

function drain(S) {
  const ev = S.events;
  S.events = [];
  for (const [type, a] of ev) runFx(type, a);
  return ev;
}

// =====================================================================
// Input: keyboard and gamepads
// =====================================================================
const keys = new Set();
const pressed = new Set();
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (!e.repeat) pressed.add(e.code);
  keys.add(e.code);
  if (A.mode !== 'menu' && /^(Arrow|Space|Slash|Quote)/.test(e.code)) e.preventDefault();
  onMetaKey(e.code);
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

const BIND = {
  p1: { left: ['KeyA'], right: ['KeyD'], up: ['KeyW'], down: ['KeyS'], jump: ['Space'], punch: ['KeyJ', 'KeyF'], kick: ['KeyK', 'KeyG'], block: ['KeyL', 'KeyH'], super: ['KeyU', 'KeyR'] },
  p2: { left: ['ArrowLeft'], right: ['ArrowRight'], up: ['ArrowUp'], down: ['ArrowDown'], jump: ['ShiftRight', 'Numpad0'], punch: ['Comma', 'Numpad1'], kick: ['Period', 'Numpad2'], block: ['Slash', 'Numpad3'], super: ['Semicolon', 'Numpad4'] },
};
// A lone player on this device gets both key sets.
BIND.solo = Object.fromEntries(Object.keys(BIND.p1).map((k) => [k, [...BIND.p1[k], ...BIND.p2[k]]]));
BIND.none = Object.fromEntries(Object.keys(BIND.p1).map((k) => [k, []]));

const held = (list) => list.some((c) => keys.has(c));
const hit = (list) => list.some((c) => pressed.has(c));

const padPrev = [[], [], [], []];
function readPad(i) {
  const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
  const pad = pads[i];
  if (!pad) return null;
  const b = (n) => !!pad.buttons[n]?.pressed;
  const edge = (n) => { const now = b(n), was = padPrev[i][n]; padPrev[i][n] = now; return now && !was; };
  let mx = pad.axes[0] || 0, mz = -(pad.axes[1] || 0);
  if (Math.abs(mx) < 0.25) mx = 0;
  if (Math.abs(mz) < 0.25) mz = 0;
  mx += (b(15) ? 1 : 0) - (b(14) ? 1 : 0);
  mz += (b(12) ? 1 : 0) - (b(13) ? 1 : 0);
  return { mx, mz, jump: edge(0), super: edge(1), punch: edge(2), kick: edge(3), block: b(5) || b(4) || b(7) };
}

const camFwd = V(0, 0, -1), camRight = V(1, 0, 0);
// Returns an NBSim input: world-space move plus buttons. Movement is relative to the camera.
function readHuman(h) {
  const b = BIND[h.bind] || BIND.none;
  let sx = (held(b.right) ? 1 : 0) - (held(b.left) ? 1 : 0);
  let sz = (held(b.up) ? 1 : 0) - (held(b.down) ? 1 : 0);
  const it = { jump: hit(b.jump), punch: hit(b.punch), kick: hit(b.kick), block: held(b.block), super: hit(b.super) };
  const pad = readPad(h.pad);
  if (pad) {
    sx = clamp(sx + pad.mx, -1, 1);
    sz = clamp(sz + pad.mz, -1, 1);
    for (const k of ['jump', 'punch', 'kick', 'block', 'super']) it[k] = it[k] || pad[k];
  }
  const move = V().addScaledVector(camRight, sx).addScaledVector(camFwd, sz);
  if (move.lengthSq() > 1) move.normalize();
  it.mx = move.x;
  it.mz = move.z;
  return it;
}

// =====================================================================
// Starting matches
// =====================================================================
function beginMatch(mode, S) {
  initAudio();
  A.mode = mode;
  A.S = S;
  A.paused = false;
  A.snap = null;
  A.pending = [];
  A.overShown = false;
  $('#menu').hidden = true;
  $('#lobby').hidden = true;
  $('#pause').hidden = true;
  $('#hud').hidden = false;
  clearAnnounce();
  buildHud(S);
  setNetTag();
  if (mode !== 'guest') A.pending = drain(S);
}

function startLocal() {
  NBNet.close();
  setStatus('');
  const humans = A.opts.humans;
  const n = Math.max(A.opts.fighters, humans);
  const slots = [];
  for (let i = 0; i < n; i++) slots.push(i < humans ? { kind: 'local', label: 'P' + (i + 1) } : { kind: 'cpu', label: 'CPU' });
  A.humans = [];
  for (let i = 0; i < humans; i++) A.humans.push({ fidx: i, bind: humans === 1 ? 'solo' : i === 0 ? 'p1' : i === 1 ? 'p2' : 'none', pad: i });
  A.you = A.humans.map((h) => h.fidx);
  beginMatch('local', NBSim.createMatch({ slots, diff: A.opts.diff, profile: 'desktop', roundTime: 99 }));
}

function hostStart() {
  const guests = NBNet.guestCount();
  const n = Math.min(4, Math.max(A.opts.onlineFighters, guests + 1));
  const slots = [{ kind: 'local', label: 'P1' }];
  for (let i = 0; i < guests; i++) slots.push({ kind: 'remote', label: 'P' + (i + 2) });
  while (slots.length < n) slots.push({ kind: 'cpu', label: 'CPU' });
  const S = NBSim.createMatch({ slots, diff: A.opts.diff, profile: 'desktop', roundTime: 99 });
  NBNet.startMatch(slots, { roundTime: 99, profile: 'desktop' });
  A.humans = [{ fidx: 0, bind: 'solo', pad: 0 }];
  A.you = [0];
  beginMatch('host', S);
}

function guestStart(msg) {
  const S = NBSim.createMatch({ slots: msg.slots, roundTime: msg.roundTime, profile: msg.profile });
  S.events = []; // the host sends its own announcements
  A.humans = [{ fidx: msg.you, bind: 'solo', pad: 0 }];
  A.you = [msg.you];
  beginMatch('guest', S);
}

function rematch() {
  if (A.mode === 'local') { NBSim.rematch(A.S); A.overShown = false; clearAnnounce(); buildHud(A.S); }
  else if (A.mode === 'host') hostStart();
  else if (A.mode === 'guest') NBNet.requestRematch();
}

// =====================================================================
// Menu, lobby, pause
// =====================================================================
const statusEl = $('#netStatus');
function setStatus(t) { statusEl.textContent = t; $('#lobbyNote').textContent = A.lobbyRole ? t : ''; }

function updateLocalNote() {
  const { fighters, humans } = A.opts;
  const n = Math.max(fighters, humans);
  const parts = [`${humans} player${humans > 1 ? 's' : ''}${n > humans ? ` vs ${n - humans} CPU` : ''}.`];
  if (humans > fighters) parts.push(`Fighters raised to ${n} to fit everyone.`);
  if (humans >= 3) parts.push('Players 3 and 4 need gamepads.');
  $('#localNote').textContent = parts.join(' ');
}
document.querySelectorAll('.seg').forEach((seg) => seg.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
  const v = b.dataset.v;
  A.opts[seg.dataset.key] = isNaN(+v) ? v : +v;
  updateLocalNote();
  if (seg.dataset.key === 'onlineFighters') renderLobby(lastLobby);
}));
updateLocalNote();

function toMenu() {
  A.mode = 'menu';
  A.S = null;
  A.paused = false;
  A.lobbyRole = null;
  $('#menu').hidden = false;
  $('#lobby').hidden = true;
  $('#pause').hidden = true;
  $('#hud').hidden = true;
  $('#netTag').hidden = true;
  clearAnnounce();
}
function quitToMenu() { NBNet.close(); toMenu(); setStatus(''); }
function setPaused(p) {
  A.paused = p;
  $('#pause').hidden = !p;
  if (p) $('#btnResume').focus();
}

function showLobby(role) {
  A.lobbyRole = role;
  $('#menu').hidden = true;
  $('#lobby').hidden = false;
  renderLobby(null);
}
let lastLobby = null;
function renderLobby(info) {
  lastLobby = info;
  if (!A.lobbyRole) return;
  const host = A.lobbyRole === 'host';
  $('#lobbyRole').textContent = host ? 'Hosting' : 'Joined';
  $('#lobbyCode').textContent = info?.code || '·····'; // only once the room is actually open
  $('#lobbyHelp').textContent = host
    ? 'Share the code. Up to 3 friends can join from a computer or an Apple Watch.'
    : 'Waiting for the host to start the match.';
  const players = info?.players || (host ? ['desktop'] : []);
  const you = host ? 0 : info?.you ?? -1;
  const list = $('#lobbyList');
  list.innerHTML = '';
  players.forEach((client, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="c" style="color:${hexStr(ROSTER[i].color)}">${ROSTER[i].name}</span><span class="dev">${client === 'watch' ? 'Apple Watch' : 'computer'}${i === you ? ' · you' : ''}${i === 0 ? ' · host' : ''}</span>`;
    list.appendChild(li);
  });
  const n = Math.min(4, Math.max(A.opts.onlineFighters, players.length));
  for (let i = players.length; i < n; i++) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="c" style="color:${hexStr(ROSTER[i].color)}">${ROSTER[i].name}</span><span class="dev">CPU</span>`;
    list.appendChild(li);
  }
  $('#lobbyFighters').hidden = !host;
  const start = $('#btnStartOnline');
  start.hidden = !host;
  start.disabled = !host || players.length < 2;
  if (host && players.length < 2) $('#lobbyNote').textContent = info ? 'Waiting for someone to join…' : 'Opening a room…';
  else if (host) $('#lobbyNote').textContent = n > players.length ? 'Empty spots are filled by CPU fighters.' : '';
}

NBNet.h = {
  status: (t) => setStatus(t),
  lobby: (info) => renderLobby(info),
  joined: () => { setStatus(''); showLobby('guest'); },
  start: (msg) => guestStart(msg),
  snap: (msg) => {
    if (A.mode !== 'guest') return;
    A.snap = msg;
    for (const [type, a] of msg.e) runFx(type, a);
  },
  rematch: () => { if (A.mode === 'host' && A.S?.phase === 'over') hostStart(); },
  left: (fidx) => {
    const f = A.mode === 'host' && A.S?.fighters[fidx];
    if (f) { f.kind = 'cpu'; f.label = 'CPU'; }
  },
  closed: (t) => { toMenu(); setStatus(t); },
};

function setNetTag() {
  const t = $('#netTag');
  t.hidden = !(A.mode === 'host' || A.mode === 'guest');
  t.textContent = A.mode === 'host' ? `ONLINE · ROOM ${NBNet.code} · YOU HOST` : `ONLINE · ROOM ${NBNet.code}`;
}

function onMetaKey(code) {
  if (!$('#lobby').hidden && code === 'Escape') { quitToMenu(); return; }
  if (A.mode === 'menu') return;
  if (code === 'Enter' && A.S?.phase === 'over') { rematch(); return; }
  if (code === 'Escape' || code === 'KeyP') {
    if (A.mode === 'local' && A.S?.phase !== 'over') setPaused(!A.paused);
    else if (code === 'Escape') quitToMenu();
  }
}

$('#btnPlay').addEventListener('click', startLocal);
$('#btnHost').addEventListener('click', () => { initAudio(); showLobby('host'); NBNet.host('desktop'); });
$('#joinForm').addEventListener('submit', (e) => { e.preventDefault(); initAudio(); NBNet.join($('#joinCode').value, 'desktop'); });
$('#btnStartOnline').addEventListener('click', hostStart);
$('#btnLeaveLobby').addEventListener('click', quitToMenu);
$('#btnResume').addEventListener('click', () => setPaused(false));
$('#btnQuit').addEventListener('click', quitToMenu);

// =====================================================================
// HUD
// =====================================================================
let hud = [];
function buildHud(S) {
  const bars = $('#bars');
  bars.innerHTML = '';
  bars.style.setProperty('--n', S.fighters.length);
  hud = S.fighters.map((f) => {
    const el = document.createElement('div');
    el.className = 'side';
    el.style.setProperty('--c', hexStr(f.color));
    el.innerHTML = `<div class="name-row"><span class="name">${f.name}</span><span class="ptag"></span><span class="pips"><i></i><i></i></span></div>
      <div class="hp"><div class="trail"></div><div class="fill"></div></div>
      <div class="meter"><div></div><span>SUPER</span></div><div class="combo"></div>`;
    bars.appendChild(el);
    return {
      el, fill: el.querySelector('.fill'), trail: el.querySelector('.trail'), meter: el.querySelector('.meter'),
      mfill: el.querySelector('.meter > div'), pips: el.querySelector('.pips').children, combo: el.querySelector('.combo'),
      tag: el.querySelector('.ptag'), trailV: 100, shownCombo: 0,
    };
  });
}
function tagFor(f) {
  if (A.you.includes(f.idx)) return A.you.length === 1 ? 'YOU' : f.label;
  return f.label === 'CPU' ? '' : f.label;
}
const timerEl = $('#timer');
function updateHud(S, dt) {
  S.fighters.forEach((f, i) => {
    const h = hud[i];
    if (!h) return;
    h.fill.style.width = `${f.hp}%`;
    h.fill.classList.toggle('low', f.hp < 30);
    h.trailV = h.trailV > f.hp ? Math.max(f.hp, h.trailV - dt * 35) : f.hp;
    h.trail.style.width = `${h.trailV}%`;
    h.mfill.style.width = `${f.meter}%`;
    h.meter.classList.toggle('full', f.meter >= 100);
    h.el.classList.toggle('out', f.state === 'ko' && S.phase === 'fight');
    for (let p = 0; p < 2; p++) h.pips[p].classList.toggle('won', f.wins > p);
    const tag = tagFor(f) || (f.label === 'CPU' ? 'CPU' : '');
    if (h.tag.textContent !== tag) h.tag.textContent = tag;
    h.tag.classList.toggle('you', tag === 'YOU');
    const live = f.combo >= 2 && S.fighters.some((o) => o !== f && o.stun > 0);
    if (live && f.combo !== h.shownCombo) { h.combo.innerHTML = `${f.combo} HITS<small>COMBO</small>`; h.shownCombo = f.combo; }
    h.combo.classList.toggle('show', live);
    if (!live) h.shownCombo = 0;
  });
  const t = Math.ceil(S.timer);
  timerEl.textContent = t;
  timerEl.classList.toggle('low', t <= 10 && S.phase === 'fight');
  if (S.phase === 'over' && !A.overShown) {
    A.overShown = true;
    subEl.textContent = A.mode === 'guest' ? 'ENTER: ASK FOR REMATCH · ESC: LEAVE' : 'ENTER: REMATCH · ESC: MENU';
  } else if (S.phase !== 'over' && A.overShown) {
    A.overShown = false;
  }
}

// =====================================================================
// Camera: frames every fighter still standing
// =====================================================================
const camSide = V(0, 0, 1);
const camTarget = V(0, 1.2, 0);
const camPos = V(0, 3, 9);
function updateCamera(S, dt) {
  if (!S || A.mode === 'menu') {
    const t = performance.now() / 1000;
    camPos.set(Math.sin(t * 0.15) * 8.5, 2.6 + Math.sin(t * 0.3) * 0.4, Math.cos(t * 0.15) * 8.5);
    camTarget.set(0, 1.1, 0);
    camera.position.lerp(camPos, damp(3, dt));
  } else {
    let F = S.fighters.filter((f) => f.state !== 'ko');
    if (F.length < 2) F = S.fighters;
    const mid = V();
    for (const f of F) mid.add(V(f.x, 0, f.z));
    mid.multiplyScalar(1 / F.length);
    let spread = 0, maxY = 0;
    for (const f of F) { spread = Math.max(spread, Math.hypot(f.x - mid.x, f.z - mid.z)); maxY = Math.max(maxY, f.y); }
    if (F.length === 2) {
      const dx = F[1].x - F[0].x, dz = F[1].z - F[0].z, sep = Math.hypot(dx, dz) || 1;
      const perp = V(-dz / sep, 0, dx / sep);
      // Stay on the same side if the fighters swap places, so the camera never whips around.
      if (perp.dot(camSide) < 0) perp.negate();
      camSide.lerp(perp, damp(4, dt)).normalize();
    }
    const dist = clamp(4.6 + spread * 1.9, 5.6, 14);
    const desired = V().copy(mid).addScaledVector(camSide, dist);
    desired.y = 2.2 + spread * 0.25 + maxY * 0.3;
    camPos.lerp(desired, damp(6, dt));
    camera.position.copy(camPos);
    camTarget.lerp(V(mid.x, 1.15 + maxY * 0.4, mid.z), damp(8, dt));
  }
  if (shake > 0.002) camera.position.add(V((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake));
  camera.lookAt(camTarget);
  camera.getWorldDirection(camFwd);
  camFwd.y = 0;
  camFwd.normalize();
  camRight.set(-camFwd.z, 0, camFwd.x);
}

// =====================================================================
// Main loop
// =====================================================================
let last = performance.now();
let startWas = false;
function frame(now) {
  requestAnimationFrame(frame);
  const rdt = Math.min((now - last) / 1000, 1 / 30);
  last = now;
  const S = A.S;

  if (A.mode === 'local') {
    const pad = navigator.getGamepads ? [...navigator.getGamepads()].find(Boolean) : null;
    const st = !!pad?.buttons[9]?.pressed;
    if (st && !startWas && S.phase !== 'over') setPaused(!A.paused);
    startWas = st;
  }

  if (A.mode === 'menu') {
    NBSim.idle(A.menuS, rdt);
  } else if (A.mode === 'guest') {
    NBNet.sendInput(readHuman(A.humans[0]));
    if (A.snap) NBSim.applySnap(S, A.snap, damp(20, rdt), rdt);
  } else if (!A.paused) {
    const inputs = S.fighters.map((f, i) => {
      const h = A.humans.find((x) => x.fidx === i);
      if (h) return readHuman(h);
      if (A.mode === 'host' && f.kind === 'remote') return NBNet.inputFor(i) || NONE;
      return NONE;
    });
    NBSim.step(S, rdt, inputs);
    if (A.mode === 'host') NBNet.consumeInputs();
    const ev = drain(S);
    if (A.mode === 'host') {
      A.pending.push(...ev);
      A.sendAcc += rdt;
      if (A.sendAcc >= 1 / 30) { A.sendAcc = 0; NBNet.sendSnap(NBSim.pack(S, A.pending)); A.pending = []; }
    }
  }
  pressed.clear();

  const shown = A.mode === 'menu' ? A.menuS : S;
  views.forEach((v, i) => {
    const f = shown.fighters[i];
    if (!f) { v.root.visible = false; return; }
    v.sync(f);
    v.setTag(A.mode === 'menu' ? '' : tagFor(f));
  });

  updateFx(A.paused ? 0 : rdt);
  updateCamera(A.mode === 'menu' ? null : S, rdt);
  if (A.mode !== 'menu') updateHud(S, rdt);
  dust.rotation.y += rdt * 0.01;
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

// Handy for debugging in the console.
window.NB = { A, NBSim, NBNet };
