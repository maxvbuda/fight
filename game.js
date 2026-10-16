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
// Effects: sparks, shockwaves, shake. fx() also forwards to the online guest.
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
function fx(type, a) {
  runFx(type, a);
  if (Net.role === 'host') Net.events.push([type, a]);
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
// Fighters
// =====================================================================
const ROSTER = [
  { name: 'RYKA', color: 0xff2d6f, trim: 0xffd166, skin: 0xe0a47a },
  { name: 'VOLT', color: 0x2de2ff, trim: 0xb8ff3d, skin: 0x8d5a3b },
];

// Attack frame data, in seconds.
const MOVES = {
  jab:   { start: 0.06, active: 0.08, rec: 0.14, dmg: 5,  range: 1.5,  push: 2.4, stun: 0.28, meter: 7,  lunge: 1.6, sound: 'hit',   h: 1.45 },
  cross: { start: 0.08, active: 0.08, rec: 0.18, dmg: 7,  range: 1.55, push: 3.2, stun: 0.32, meter: 8,  lunge: 2.2, sound: 'hit',   h: 1.45 },
  kick:  { start: 0.15, active: 0.1,  rec: 0.28, dmg: 11, range: 1.9,  push: 4.8, stun: 0.42, meter: 12, lunge: 2.6, sound: 'heavy', h: 1.15 },
  super: { start: 0.3,  active: 0.22, rec: 0.45, dmg: 24, range: 2.0,  push: 11,  stun: 0.85, meter: 0,  lunge: 10,  sound: 'super', h: 1.3, launch: true },
};

// Pose = joint angles in radians. P() fills unspecified joints from the guard stance.
const POSE_KEYS = ['hy', 'sx', 'sy', 'nx', 'lsx', 'lsz', 'rsx', 'rsz', 'lex', 'rex', 'lhx', 'lhz', 'rhx', 'rhz', 'lkx', 'rkx'];
const GUARD = { hy: -0.05, sx: 0.12, sy: -0.22, nx: 0, lsx: -1.0, lsz: 0.2, rsx: -1.0, rsz: -0.2, lex: -1.75, rex: -1.75, lhx: -0.35, lhz: 0.06, rhx: 0.3, rhz: -0.06, lkx: 0.45, rkx: 0.1 };
const P = (o) => Object.assign({}, GUARD, o);

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

class Fighter {
  constructor(idx) {
    const d = ROSTER[idx];
    this.idx = idx;
    this.name = d.name;
    this.colorHex = d.color;
    this.suit = new THREE.MeshStandardMaterial({ color: d.color, roughness: 0.4, metalness: 0.15 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1d1a2c, roughness: 0.7 });
    const skin = new THREE.MeshStandardMaterial({ color: d.skin, roughness: 0.65 });
    this.trim = new THREE.MeshStandardMaterial({ color: d.trim, emissive: d.trim, emissiveIntensity: 1.3 });
    const glove = new THREE.MeshStandardMaterial({ color: d.color, emissive: d.color, emissiveIntensity: 0.4, roughness: 0.3 });
    this.glove = glove;

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
    const belt = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.06, 0.29), this.trim);
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
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.05, 0.06), this.trim);
    visor.position.set(0, 0.16, 0.135);
    neck.add(visor);

    const arm = (side) => {
      const sh = joint(spine, 0.3 * side, 0.5, 0);
      const pad = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 10), this.suit);
      sh.add(pad);
      sh.add(capsule(0.07, 0.3, this.suit));
      const el = joint(sh, 0, -0.3, 0);
      el.add(capsule(0.06, 0.28, skin));
      const fist = new THREE.Mesh(new THREE.SphereGeometry(0.088, 12, 10), glove);
      fist.position.y = -0.3;
      el.add(fist);
      return [sh, el, fist];
    };
    const leg = (side) => {
      const hp = joint(hips, 0.12 * side, -0.06, 0);
      hp.add(capsule(0.095, 0.46, dark));
      const kn = joint(hp, 0, -0.46, 0);
      kn.add(capsule(0.08, 0.44, this.suit));
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.09, 0.28), dark);
      boot.position.set(0, -0.44, 0.05);
      kn.add(boot);
      return [hp, kn, boot];
    };
    // +x is the fighter's left (they face +z).
    const [lSh, lEl, lFist] = arm(1);
    const [rSh, rEl, rFist] = arm(-1);
    const [lHip, lKn] = leg(1);
    const [rHip, rKn, rBoot] = leg(-1);
    this.j = { spine, neck, lSh, rSh, lEl, rEl, lHip, rHip, lKn, rKn };
    this.hands = [lFist, rFist];
    this.foot = rBoot;
    this.root.traverse((o) => { if (o.isMesh) o.castShadow = true; });

    this.pose = P({});
    this.vel = V();
    this.airMove = V();
    this.dir = V(1, 0, 0);
    this.meter = 0;
    this.clock = Math.random() * 10;
    this.walkPh = 0;
    this.reset(idx === 0 ? -2.4 : 2.4);
  }
  get pos() { return this.root.position; }
  get grounded() { return this.pos.y <= 0 && this.vel.y <= 0; }

  reset(x) {
    this.pos.set(x, 0, 0);
    this.vel.set(0, 0, 0);
    this.hp = 100;
    this.state = 'idle';
    this.atk = null;
    this.stun = 0;
    this.combo = 0;
    this.flash = 0;
    this.lastPunch = 'cross';
    this.punchT = 0;
    this.body.rotation.set(0, 0, 0);
    this.body.position.set(0, 0, 0);
    this.dir.set(x < 0 ? 1 : -1, 0, 0);
    this.root.rotation.y = Math.atan2(this.dir.x, this.dir.z);
  }

  nextPunch() {
    const name = this.punchT > 0 && this.lastPunch === 'jab' ? 'cross' : 'jab';
    this.lastPunch = name;
    this.punchT = 0.5;
    return name;
  }
  startAttack(name) {
    this.atk = { name, t: 0, hit: false, waved: false };
    this.state = 'attack';
    if (name === 'super') {
      this.meter = 0;
      fx('sfx', 'charge');
    } else fx('sfx', 'whoosh');
  }

  update(dt, inp, opp) {
    const p = this.pos, o = opp.pos;
    const dx = o.x - p.x, dz = o.z - p.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 1e-4) this.dir.set(dx / dist, 0, dz / dist);
    const grounded = this.grounded;
    const move = V();
    this.punchT -= dt;
    this.clock += dt;

    if (this.state !== 'ko') this.root.rotation.y = lerpAngle(this.root.rotation.y, Math.atan2(this.dir.x, this.dir.z), damp(18, dt));

    if (this.state === 'ko' || this.state === 'win') {
      // no control
    } else if (this.stun > 0) {
      this.stun -= dt;
      if (this.stun <= 0) this.state = 'idle';
    } else if (this.atk) {
      const a = this.atk, m = MOVES[a.name];
      a.t += dt;
      if (!grounded) move.copy(this.airMove);
      else if (a.t > m.start * 0.5 && a.t < m.start + m.active && dist > 0.95) move.addScaledVector(this.dir, m.lunge);
      if (a.name === 'super' && a.t >= m.start && !a.waved) {
        a.waved = true;
        fx('wave', [p.x + this.dir.x * 0.6, 1.3, p.z + this.dir.z * 0.6, this.colorHex]);
      }
      if (a.t >= m.start && a.t < m.start + m.active && !a.hit) this.tryHit(opp, m, dist);
      const recovering = a.t >= m.start + m.active;
      // Landing a hit lets you cancel recovery into the next attack: that's the combo system.
      if (a.hit && recovering && a.name !== 'super' && (inp.punch || inp.kick)) {
        this.startAttack(inp.punch ? this.nextPunch() : 'kick');
      } else if (a.t >= m.start + m.active + m.rec) {
        this.atk = null;
        this.state = 'idle';
      }
    } else {
      this.state = 'idle';
      if (inp.super && this.meter >= 100) this.startAttack('super');
      else if (inp.punch) this.startAttack(this.nextPunch());
      else if (inp.kick) this.startAttack('kick');
      else if (!grounded) move.copy(this.airMove);
      else if (inp.block) this.state = 'block';
      else {
        const fwd = inp.move.dot(this.dir);
        move.copy(inp.move).multiplyScalar(fwd < -0.3 ? 2.6 : 3.4);
        if (move.lengthSq() > 0.01) {
          this.state = 'walk';
          this.walkPh += dt * 10 * (fwd < -0.3 ? -1 : 1);
        }
        if (inp.jump) {
          this.vel.y = 7.4;
          this.airMove.copy(move).multiplyScalar(1.15);
          this.state = 'idle';
          fx('sfx', 'jump');
        }
      }
    }

    // Physics
    const wasAir = p.y > 0;
    this.vel.y -= 22 * dt;
    p.y += this.vel.y * dt;
    if (p.y <= 0) {
      p.y = 0;
      if (wasAir && this.vel.y < -4) fx('sfx', 'land');
      this.vel.y = 0;
    }
    p.x += (move.x + this.vel.x) * dt;
    p.z += (move.z + this.vel.z) * dt;
    const fr = Math.exp(-(p.y > 0 ? 0.6 : 7) * dt);
    this.vel.x *= fr;
    this.vel.z *= fr;
    const r = Math.hypot(p.x, p.z);
    if (r > ARENA_R) { p.x *= ARENA_R / r; p.z *= ARENA_R / r; }

    this.animate(dt);
  }

  tryHit(opp, m, dist) {
    if (dist < m.range && Math.abs(this.pos.y - opp.pos.y) < 1.1 && opp.state !== 'ko') {
      this.atk.hit = true;
      resolveHit(this, opp, m);
    }
  }

  attackPose(a) {
    const m = MOVES[a.name], t = a.t;
    const out = t >= m.start * 0.6 && t < m.start + m.active + m.rec * 0.35;
    switch (a.name) {
      case 'jab': return out ? P({ sy: -0.6, lsx: -1.57, lsz: 0.04, lex: -0.05, rsx: -1.15, hy: -0.07, sx: 0.2 }) : P({ sy: -0.1 });
      case 'cross': return out ? P({ sy: 0.6, rsx: -1.57, rsz: -0.04, rex: -0.05, lsx: -1.15, hy: -0.08, sx: 0.22, rhx: 0.45, rkx: 0.25 }) : P({ sy: -0.45 });
      case 'kick':
        if (t < m.start) return P({ rhx: -1.5, rkx: 1.9, sx: -0.1, lkx: 0.3, lhx: -0.1 });
        if (out) return P({ rhx: -1.6, rkx: 0.05, sx: -0.35, lhx: 0.05, lkx: 0.25, lsx: -0.7, rsx: -0.6, rsz: -0.5, sy: 0.25 });
        return P({});
      case 'super':
        if (t < m.start) return P({ sy: 0.7, lsx: -0.3, rsx: 0.5, lex: -1.3, rex: -1.3, hy: -0.2, lkx: 0.9, rkx: 0.7, lhx: -0.5, rhx: 0.2 });
        if (out) return P({ sy: 0, sx: 0.3, lsx: -1.55, rsx: -1.55, lsz: -0.12, rsz: 0.12, lex: 0, rex: 0, hy: -0.16, lhx: -0.7, lkx: 0.8, rhx: 0.6, rkx: 0.1 });
        return P({});
    }
  }

  animate(dt) {
    const t = this.clock, c = this.pose;
    let tg, rate = 14;
    if (this.state === 'ko') {
      tg = P({ hy: 0, sx: -0.3, sy: 0, nx: -0.4, lsx: -2.6, lsz: 0.9, rsx: -2.6, rsz: -0.9, lex: 0, rex: 0, lhx: -0.2, rhx: -0.1, lkx: 0.3, rkx: 0.1 });
      const k = damp(this.pos.y > 0 ? 4 : 7, dt);
      this.body.rotation.x += (-1.5 - this.body.rotation.x) * k;
      this.body.position.y += (0.16 - this.body.position.y) * k;
    } else if (this.state === 'win') {
      tg = P({ sy: 0, rsx: -2.95, rsz: -0.25, rex: -0.15, lsx: -0.9, hy: -0.03 + Math.abs(Math.sin(t * 5)) * 0.05, nx: -0.2 });
    } else if (this.stun > 0) {
      tg = P({ sx: -0.5, nx: -0.4, lsx: -0.4, lsz: 0.7, rsx: -0.4, rsz: -0.7, lex: -0.6, rex: -0.6, hy: -0.08, lkx: 0.6, rkx: 0.5 });
      rate = 26;
    } else if (this.atk) {
      tg = this.attackPose(this.atk);
      rate = 38;
    } else if (this.pos.y > 0) {
      tg = P({ lhx: -1.1, lkx: 1.7, rhx: -0.5, rkx: 1.5, sx: 0.25, lsx: -1.3, rsx: -1.3 });
    } else if (this.state === 'block') {
      tg = P({ sx: 0.3, sy: 0, nx: 0.2, lsx: -1.45, lsz: -0.35, lex: -2.0, rsx: -1.45, rsz: 0.35, rex: -2.0, hy: -0.13, lhx: -0.55, lkx: 0.8, rhx: 0.15, rkx: 0.45 });
      rate = 30;
    } else if (this.state === 'walk') {
      const s = Math.sin(this.walkPh);
      tg = P({ lhx: -0.35 + s * 0.45, rhx: 0.3 - s * 0.45, lkx: 0.45 + Math.max(0, -s) * 0.6, rkx: 0.15 + Math.max(0, s) * 0.6, hy: -0.06 + Math.abs(Math.cos(this.walkPh)) * 0.03 });
    } else {
      const b = Math.sin(t * 3.2);
      tg = P({ hy: -0.05 + b * 0.015, sx: 0.12 + b * 0.02, lsx: -1.0 + b * 0.05, rsx: -1.0 - b * 0.05 });
    }
    const k = damp(rate, dt);
    for (const key of POSE_KEYS) c[key] += (tg[key] - c[key]) * k;
    this.applyPose();
    if (this.flash > 0) this.flash -= dt;
    this.applyFlash();
  }

  applyPose() {
    const c = this.pose, j = this.j;
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
  }
  applyFlash() {
    const f = Math.max(0, this.flash) / 0.12;
    this.suit.emissive.setRGB(f, f, f);
    const full = this.meter >= 100;
    this.glove.emissiveIntensity = full ? 1.2 + Math.sin(this.clock * 12) * 0.6 : 0.4;
  }
}

const F = [new Fighter(0), new Fighter(1)];

// =====================================================================
// Game state and rules (runs on local games and on the online host)
// =====================================================================
const G = {
  mode: 'menu', // 'cpu' | 'local' | 'host' | 'guest'
  phase: 'menu', // 'menu' | 'intro' | 'fight' | 'ko' | 'over'
  round: 1, wins: [0, 0], timer: 99, phaseT: 0,
  timeScale: 1, hitstop: 0, paused: false,
  difficulty: 'normal', winner: -1, flags: {},
};

function resolveHit(att, def, m) {
  const blocked = def.state === 'block';
  let dmg = m.dmg;
  if (blocked) dmg *= m === MOVES.super ? 0.35 : 0.1;
  else {
    att.combo = def.stun > 0 ? att.combo + 1 : 1;
    dmg *= Math.max(0.5, 1 - (att.combo - 1) * 0.08);
  }
  def.hp = Math.max(0, def.hp - dmg);
  att.meter = Math.min(100, att.meter + m.meter * (blocked ? 0.4 : 1));
  def.meter = Math.min(100, def.meter + dmg * 0.5);
  const push = m.push * (blocked ? 0.55 : 1);
  def.vel.x = att.dir.x * push;
  def.vel.z = att.dir.z * push;

  const hx = att.pos.x + (def.pos.x - att.pos.x) * 0.7;
  const hz = att.pos.z + (def.pos.z - att.pos.z) * 0.7;
  const hy = Math.max(att.pos.y, def.pos.y) + m.h;
  if (blocked) {
    fx('burst', [hx, hy, hz, 0x9fe8ff, 10, 4]);
    fx('sfx', 'block');
    G.hitstop = 0.035;
  } else {
    def.flash = 0.12;
    // A super in progress can't be interrupted: the defender takes the damage but keeps attacking.
    if (!(def.atk && def.atk.name === 'super')) {
      def.stun = m.stun;
      def.atk = null;
      def.state = 'hit';
    }
    if (m.launch || def.hp <= 0) def.vel.y = 6.2;
    const big = m === MOVES.super;
    fx('burst', [hx, hy, hz, att.colorHex, big ? 50 : m === MOVES.kick ? 26 : 18, big ? 9 : 6]);
    fx('sfx', m.sound);
    fx('shake', big ? 0.45 : m === MOVES.kick ? 0.18 : 0.1);
    G.hitstop = big ? 0.18 : m === MOVES.kick ? 0.08 : 0.055;
  }
  if (def.hp <= 0) knockOut(att, def);
}

function knockOut(att, def) {
  def.state = 'ko';
  def.stun = 0;
  def.atk = null;
  G.wins[att.idx]++;
  G.winner = att.idx;
  G.phase = 'ko';
  G.phaseT = 0;
  G.timeScale = 0.3;
  G.flags = {};
  fx('sfx', 'ko');
  fx('shake', 0.5);
  fx('announce', ['K.O.', 'ko']);
}

function timeUp() {
  G.phase = 'ko';
  G.phaseT = 0;
  G.flags = {};
  const [a, b] = F;
  G.winner = a.hp === b.hp ? -1 : a.hp > b.hp ? 0 : 1;
  if (G.winner >= 0) G.wins[G.winner]++;
  fx('announce', ['TIME', 'ko']);
  fx('sfx', 'bell');
}

function startRound() {
  F[0].reset(-2.4);
  F[1].reset(2.4);
  G.timer = 99;
  G.phase = 'intro';
  G.phaseT = 0;
  G.timeScale = 1;
  G.hitstop = 0;
  G.winner = -1;
  G.flags = {};
  const final = G.wins[0] === 1 && G.wins[1] === 1;
  fx('announce', [final ? 'FINAL\nROUND' : `ROUND ${G.round}`, 'go']);
}

function startMatch(mode) {
  initAudio();
  G.mode = mode;
  G.wins = [0, 0];
  G.round = 1;
  G.paused = false;
  F[0].meter = F[1].meter = 0;
  for (const f of F) f.ai = { t: 0, act: 'approach', blockT: 0, rolled: false, side: 1 };
  $('#menu').hidden = true;
  $('#pause').hidden = true;
  $('#hud').hidden = false;
  $('#n2').textContent = mode === 'cpu' ? 'VOLT · CPU' : 'VOLT';
  setNetTag();
  startRound();
}

function stepGame(rdt) {
  let dt = rdt;
  if (G.hitstop > 0) { G.hitstop -= rdt; dt = 0; }
  dt *= G.timeScale;
  G.phaseT += rdt;

  const fighting = G.phase === 'fight';
  const i1 = fighting ? inputFor(0) : NO_INPUT;
  const i2 = fighting ? inputFor(1) : NO_INPUT;
  F[0].update(dt, i1, F[1]);
  F[1].update(dt, i2, F[0]);
  separate(F[0], F[1]);
  consumeRemoteEdges();

  switch (G.phase) {
    case 'intro':
      if (!G.flags.fight && G.phaseT > 1.3) { G.flags.fight = true; fx('announce', ['FIGHT!', 'go']); fx('sfx', 'bell'); }
      if (G.phaseT > 1.8) { G.phase = 'fight'; G.phaseT = 0; }
      break;
    case 'fight':
      G.timer -= dt;
      if (G.timer <= 0) { G.timer = 0; timeUp(); }
      break;
    case 'ko':
      if (G.phaseT > 1.1) G.timeScale = 1;
      if (!G.flags.win && G.phaseT > 1.8) {
        G.flags.win = true;
        const w = F[G.winner];
        if (w && w.state !== 'ko') { w.atk = null; w.stun = 0; w.state = 'win'; }
        const perfect = w && w.hp >= 100;
        const matchOver = G.wins.some((x) => x >= 2);
        if (!matchOver) fx('announce', [w ? `${w.name} WINS` : 'DRAW', 'stay', perfect ? 'PERFECT' : '']);
        else fx('announce', [`${w.name}\nVICTORY`, 'stay', rematchHint()]);
      }
      if (G.phaseT > 4.2) {
        if (G.wins.some((x) => x >= 2)) G.phase = 'over';
        else { G.round++; startRound(); }
      }
      break;
  }
}
function rematchHint() {
  return 'ENTER: REMATCH · ESC: MENU';
}

function separate(a, b) {
  const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
  const d = Math.hypot(dx, dz);
  const min = 0.8;
  if (d < min && Math.abs(a.pos.y - b.pos.y) < 1.3 && a.state !== 'ko' && b.state !== 'ko') {
    const nx = d > 1e-4 ? dx / d : 1, nz = d > 1e-4 ? dz / d : 0;
    const push = (min - d) / 2;
    a.pos.x -= nx * push; a.pos.z -= nz * push;
    b.pos.x += nx * push; b.pos.z += nz * push;
  }
}

// =====================================================================
// Input: keyboard, gamepad, CPU, remote
// =====================================================================
const keys = new Set();
const pressed = new Set();
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (!e.repeat) pressed.add(e.code);
  keys.add(e.code);
  if (G.phase !== 'menu' && /^(Arrow|Space|Slash|Quote)/.test(e.code)) e.preventDefault();
  onMetaKey(e.code);
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

const BIND = {
  p1: { left: ['KeyA'], right: ['KeyD'], up: ['KeyW'], down: ['KeyS'], jump: ['Space'], punch: ['KeyJ', 'KeyF'], kick: ['KeyK', 'KeyG'], block: ['KeyL', 'KeyH'], super: ['KeyU', 'KeyR'] },
  p2: { left: ['ArrowLeft'], right: ['ArrowRight'], up: ['ArrowUp'], down: ['ArrowDown'], jump: ['ShiftRight', 'Numpad0'], punch: ['Comma', 'Numpad1'], kick: ['Period', 'Numpad2'], block: ['Slash', 'Numpad3'], super: ['Semicolon', 'Numpad4'] },
};
// Solo and online players get both key sets.
BIND.solo = Object.fromEntries(Object.keys(BIND.p1).map((k) => [k, [...BIND.p1[k], ...BIND.p2[k]]]));

const NO_INPUT = { move: V(), jump: false, punch: false, kick: false, block: false, super: false };
const held = (list) => list.some((c) => keys.has(c));
const hit = (list) => list.some((c) => pressed.has(c));

const padPrev = [[], []];
function readPad(i) {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  const pad = [...pads].filter(Boolean)[i];
  if (!pad) return null;
  const b = (n) => !!pad.buttons[n]?.pressed;
  const edge = (n) => { const now = b(n), was = padPrev[i][n]; padPrev[i][n] = now; return now && !was; };
  let mx = pad.axes[0] || 0, mz = -(pad.axes[1] || 0);
  if (Math.abs(mx) < 0.25) mx = 0;
  if (Math.abs(mz) < 0.25) mz = 0;
  mx += (b(15) ? 1 : 0) - (b(14) ? 1 : 0);
  mz += (b(12) ? 1 : 0) - (b(13) ? 1 : 0);
  return { mx, mz, jump: edge(0), super: edge(1), punch: edge(2), kick: edge(3), block: b(5) || b(4) || b(7), start: edge(9) };
}

// Screen-relative intent: mx = right, mz = into the screen.
function readIntent(bind, padIndex) {
  const b = BIND[bind];
  const it = {
    mx: (held(b.right) ? 1 : 0) - (held(b.left) ? 1 : 0),
    mz: (held(b.up) ? 1 : 0) - (held(b.down) ? 1 : 0),
    jump: hit(b.jump), punch: hit(b.punch), kick: hit(b.kick), block: held(b.block), super: hit(b.super),
  };
  const pad = padIndex >= 0 ? readPad(padIndex) : null;
  if (pad) {
    it.mx = clamp(it.mx + pad.mx, -1, 1);
    it.mz = clamp(it.mz + pad.mz, -1, 1);
    for (const k of ['jump', 'punch', 'kick', 'block', 'super']) it[k] = it[k] || pad[k];
  }
  return it;
}
const camFwd = V(), camRight = V();
function intentToWorld(it) {
  const move = V().addScaledVector(camRight, it.mx).addScaledVector(camFwd, it.mz);
  if (move.lengthSq() > 1) move.normalize();
  return { move, jump: it.jump, punch: it.punch, kick: it.kick, block: it.block, super: it.super };
}

function inputFor(i) {
  if (i === 0) return intentToWorld(readIntent(G.mode === 'local' ? 'p1' : 'solo', 0));
  if (G.mode === 'local') return intentToWorld(readIntent('p2', 1));
  if (G.mode === 'cpu') return cpuInput(F[1], F[0]);
  if (G.mode === 'host') return remoteInput();
  return NO_INPUT;
}

const DIFF = {
  easy: { react: 0.12, aggr: 0.35, think: 0.5, combo: 0.15 },
  normal: { react: 0.38, aggr: 0.6, think: 0.3, combo: 0.45 },
  hard: { react: 0.68, aggr: 0.85, think: 0.16, combo: 0.8 },
};
let lastDt = 1 / 60;
function cpuInput(me, opp) {
  const ai = me.ai, df = DIFF[G.difficulty], dt = lastDt;
  const inp = { move: V(), jump: false, punch: false, kick: false, block: false, super: false };
  const dx = opp.pos.x - me.pos.x, dz = opp.pos.z - me.pos.z;
  const d = Math.hypot(dx, dz);
  const dir = me.dir, side = V(-dir.z, 0, dir.x);

  // Reactive blocking: one roll per incoming attack.
  if (opp.atk && d < 2.4) {
    if (!ai.rolled) { ai.rolled = true; ai.blocking = Math.random() < df.react; ai.blockT = 0.4; }
  } else ai.rolled = false;
  if (ai.blockT > 0) {
    ai.blockT -= dt;
    if (ai.blocking && !me.atk) { inp.block = true; return inp; }
  }
  // Chain combos after landing a hit.
  if (me.atk && me.atk.hit && Math.random() < df.combo * dt * 12) {
    if (Math.random() < 0.65) inp.punch = true; else inp.kick = true;
  }

  ai.t -= dt;
  let fresh = false;
  if (ai.t <= 0) {
    ai.t = df.think * (0.5 + Math.random());
    fresh = true;
    const r = Math.random();
    if (me.meter >= 100 && d < 2.2 && r < 0.5) ai.act = 'super';
    else if (d > 2.3) ai.act = r < 0.12 ? 'side' : r < 0.18 ? 'jumpin' : 'approach';
    else if (d > 1.6) ai.act = r < df.aggr * 0.6 ? 'kick' : r < 0.72 ? 'approach' : r < 0.86 ? 'retreat' : 'side';
    else ai.act = r < df.aggr * 0.55 ? 'punch' : r < df.aggr * 0.85 ? 'kick' : r < 0.82 ? 'retreat' : r < 0.93 ? 'side' : 'jump';
    ai.side = Math.random() < 0.5 ? -1 : 1;
  }
  switch (ai.act) {
    case 'approach': inp.move.copy(dir); break;
    case 'retreat': inp.move.copy(dir).multiplyScalar(-0.9); break;
    case 'side': inp.move.copy(side).multiplyScalar(ai.side); break;
    case 'jumpin': inp.move.copy(dir); inp.jump = fresh; if (me.pos.y > 1 && !me.atk) inp.kick = true; break;
    case 'jump': inp.jump = fresh; break;
    case 'punch': inp.punch = fresh; break;
    case 'kick': inp.kick = fresh; break;
    case 'super': inp.super = fresh; break;
  }
  return inp;
}

// =====================================================================
// Online play (PeerJS / WebRTC). Host simulates; guest sends inputs and renders snapshots.
// =====================================================================
const Net = {
  peer: null, conn: null, role: null, code: '',
  events: [],
  remote: { mx: 0, mz: 0, block: false, c: [0, 0, 0, 0] },
  seen: [0, 0, 0, 0],
  counts: [0, 0, 0, 0],
  snap: null,
};
const PREFIX = 'neonbrawl-v1-';
const statusEl = $('#netStatus');
const setStatus = (html) => { statusEl.innerHTML = html; };

function closeNet() {
  try { Net.conn?.close(); } catch {}
  try { Net.peer?.destroy(); } catch {}
  Net.peer = Net.conn = Net.role = null;
  Net.events = [];
  Net.snap = null;
}

function makeCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 5 }, () => A[Math.floor(Math.random() * A.length)]).join('');
}

function hostOnline() {
  if (!window.Peer) { setStatus('Online play could not load. Check your connection and reload.'); return; }
  closeNet();
  initAudio();
  Net.code = makeCode();
  setStatus('Opening a room…');
  const peer = (Net.peer = new Peer(PREFIX + Net.code));
  peer.on('open', () => setStatus(`Room code <strong>${Net.code}</strong> · Send it to your opponent. Waiting for them to join…`));
  peer.on('connection', (conn) => {
    if (Net.conn) { conn.on('open', () => conn.close()); return; }
    Net.conn = conn;
    Net.role = 'host';
    conn.on('open', () => {
      Net.seen = [0, 0, 0, 0];
      Net.remote = { mx: 0, mz: 0, block: false, c: [0, 0, 0, 0] };
      startMatch('host');
    });
    conn.on('data', onNetData);
    conn.on('close', () => disconnected());
    conn.on('error', () => disconnected());
  });
  peer.on('error', (e) => setStatus(e.type === 'unavailable-id' ? 'That room code is taken. Try hosting again.' : `Online error: ${e.type}. Try again.`));
}

function joinOnline(code) {
  code = code.trim().toUpperCase();
  if (code.length < 4) { setStatus('Enter the 5-letter room code from the host.'); return; }
  if (!window.Peer) { setStatus('Online play could not load. Check your connection and reload.'); return; }
  closeNet();
  initAudio();
  setStatus('Connecting…');
  const peer = (Net.peer = new Peer());
  peer.on('open', () => {
    const conn = (Net.conn = peer.connect(PREFIX + code, { reliable: true }));
    conn.on('open', () => {
      Net.role = 'guest';
      Net.counts = [0, 0, 0, 0];
      G.mode = 'guest';
      G.phase = 'intro';
      $('#menu').hidden = true;
      $('#hud').hidden = false;
      $('#n2').textContent = 'VOLT';
      setNetTag();
      setStatus('');
    });
    conn.on('data', onNetData);
    conn.on('close', () => disconnected());
    conn.on('error', () => disconnected());
  });
  peer.on('error', (e) => setStatus(e.type === 'peer-unavailable' ? `No open room with code ${code}. Check the code with the host.` : `Online error: ${e.type}. Try again.`));
}

function disconnected() {
  if (!Net.role) return;
  closeNet();
  toMenu();
  setStatus('Your opponent disconnected.');
}

function setNetTag() {
  const t = $('#netTag');
  t.hidden = !(G.mode === 'host' || G.mode === 'guest');
  t.textContent = G.mode === 'host' ? `ONLINE · ROOM ${Net.code} · YOU ARE RYKA` : 'ONLINE · YOU ARE VOLT';
}

function onNetData(msg) {
  if (!msg || typeof msg !== 'object') return;
  if (msg.t === 'in' && Net.role === 'host') {
    Net.remote = msg;
  } else if (msg.t === 'rematch' && Net.role === 'host' && G.phase === 'over') {
    startMatch('host');
  } else if (msg.t === 's' && Net.role === 'guest') {
    Net.snap = msg;
    for (const [type, a] of msg.e) runFx(type, a);
  }
}

// Turn the guest's press counters into one-frame button presses on the host.
const BTN = ['jump', 'punch', 'kick', 'super'];
function remoteInput() {
  const r = Net.remote;
  const inp = { move: V(clamp(r.mx, -1, 1), 0, clamp(r.mz, -1, 1)), block: !!r.block };
  BTN.forEach((k, i) => { inp[k] = (r.c?.[i] ?? 0) > Net.seen[i]; });
  return inp;
}
function consumeRemoteEdges() {
  if (G.mode === 'host' && Net.remote.c) Net.seen = Net.remote.c.slice();
}

const r3 = (n) => Math.round(n * 1000) / 1000;
function snapFighter(f) {
  return [r3(f.pos.x), r3(f.pos.y), r3(f.pos.z), r3(f.root.rotation.y), r3(f.body.rotation.x), r3(f.body.position.y),
    r3(f.hp), r3(f.meter), f.combo, f.stun > 0 ? 1 : 0, r3(Math.max(0, f.flash)), ...POSE_KEYS.map((k) => r3(f.pose[k])), f.atk ? 1 : 0];
}
function sendSnapshot() {
  if (!Net.conn?.open) return;
  Net.conn.send({ t: 's', g: [G.phase, r3(G.timer), G.round, G.wins[0], G.wins[1]], f: [snapFighter(F[0]), snapFighter(F[1])], e: Net.events });
  Net.events = [];
}

function guestStep(dt) {
  // Send our input (P1 controls, mapped through our camera, which matches the host's).
  if (Net.conn?.open) {
    const it = readIntent('solo', 0);
    BTN.forEach((k, i) => { if (it[k]) Net.counts[i]++; });
    const w = intentToWorld(it);
    Net.conn.send({ t: 'in', mx: r3(w.move.x), mz: r3(w.move.z), block: it.block, c: Net.counts.slice() });
  }
  const s = Net.snap;
  if (!s) return;
  [G.phase, G.timer, G.round, G.wins[0], G.wins[1]] = s.g;
  const k = damp(30, dt);
  s.f.forEach((d, i) => {
    const f = F[i];
    f.pos.x += (d[0] - f.pos.x) * k;
    f.pos.y += (d[1] - f.pos.y) * k;
    f.pos.z += (d[2] - f.pos.z) * k;
    f.root.rotation.y = lerpAngle(f.root.rotation.y, d[3], k);
    f.body.rotation.x += (d[4] - f.body.rotation.x) * k;
    f.body.position.y += (d[5] - f.body.position.y) * k;
    f.hp = d[6]; f.meter = d[7]; f.combo = d[8]; f.stun = d[9] ? 1 : 0; f.flash = d[10];
    POSE_KEYS.forEach((key, j) => { f.pose[key] += (d[11 + j] - f.pose[key]) * k; });
    f.clock += dt;
    f.applyPose();
    f.applyFlash();
  });
}

// =====================================================================
// Menu, pause, meta keys
// =====================================================================
function toMenu() {
  G.mode = 'menu';
  G.phase = 'menu';
  G.paused = false;
  $('#menu').hidden = false;
  $('#pause').hidden = true;
  $('#hud').hidden = true;
  clearAnnounce();
  F[0].reset(-2.4);
  F[1].reset(2.4);
}
function quitToMenu() {
  if (Net.role) { closeNet(); setStatus(''); }
  toMenu();
}
function setPaused(p) {
  G.paused = p;
  $('#pause').hidden = !p;
  if (p) $('#btnResume').focus();
}

function onMetaKey(code) {
  if (G.phase === 'menu') return;
  if (code === 'Escape' || code === 'KeyP') {
    if (G.phase === 'over' || G.mode === 'host' || G.mode === 'guest') {
      if (code === 'Escape') quitToMenu();
    } else setPaused(!G.paused);
  }
  if (code === 'Enter' && G.phase === 'over') rematch();
}
function rematch() {
  if (G.mode === 'guest') Net.conn?.send({ t: 'rematch' });
  else startMatch(G.mode);
}

$('#btnCpu').addEventListener('click', () => { closeNet(); setStatus(''); startMatch('cpu'); });
$('#btnLocal').addEventListener('click', () => { closeNet(); setStatus(''); startMatch('local'); });
$('#btnHost').addEventListener('click', hostOnline);
$('#joinForm').addEventListener('submit', (e) => { e.preventDefault(); joinOnline($('#joinCode').value); });
document.querySelectorAll('.diff button').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.diff button').forEach((x) => x.classList.toggle('on', x === b));
  G.difficulty = b.dataset.diff;
}));
$('#btnResume').addEventListener('click', () => setPaused(false));
$('#btnQuit').addEventListener('click', quitToMenu);

// =====================================================================
// HUD
// =====================================================================
const hud = [0, 1].map((i) => ({
  hp: $(`#hp${i + 1}`), trail: $(`#trail${i + 1}`), meter: $(`#m${i + 1}`), pips: $(`#pips${i + 1}`).children,
  combo: $(`#combo${i + 1}`), trailV: 100, shownCombo: 0,
}));
const timerEl = $('#timer');
function updateHud(dt) {
  F.forEach((f, i) => {
    const h = hud[i];
    h.hp.style.width = `${f.hp}%`;
    h.hp.classList.toggle('low', f.hp < 30);
    h.trailV = h.trailV > f.hp ? Math.max(f.hp, h.trailV - dt * 35) : f.hp;
    h.trail.style.width = `${h.trailV}%`;
    h.meter.style.width = `${f.meter}%`;
    h.meter.parentElement.classList.toggle('full', f.meter >= 100);
    for (let p = 0; p < 2; p++) h.pips[p].classList.toggle('won', G.wins[i] > p);
    const opp = F[1 - i];
    const live = f.combo >= 2 && opp.stun > 0;
    if (live && f.combo !== h.shownCombo) { h.combo.innerHTML = `${f.combo} HITS<small>COMBO</small>`; h.shownCombo = f.combo; }
    h.combo.classList.toggle('show', live);
    if (!live) h.shownCombo = 0;
  });
  const t = Math.ceil(G.timer);
  timerEl.textContent = t;
  timerEl.classList.toggle('low', t <= 10 && G.phase === 'fight');
}

// =====================================================================
// Camera
// =====================================================================
const camSide = V(0, 0, 1);
const camTarget = V(0, 1.2, 0);
const camPos = V(0, 3, 9);
function updateCamera(dt) {
  const a = F[0].pos, b = F[1].pos;
  if (G.phase === 'menu') {
    const t = performance.now() / 1000;
    camPos.set(Math.sin(t * 0.15) * 8.5, 2.6 + Math.sin(t * 0.3) * 0.4, Math.cos(t * 0.15) * 8.5);
    camTarget.set(0, 1.1, 0);
    camera.position.lerp(camPos, damp(3, dt));
  } else {
    const mid = V().addVectors(a, b).multiplyScalar(0.5);
    const dx = b.x - a.x, dz = b.z - a.z;
    const sep = Math.hypot(dx, dz) || 1;
    const perp = V(-dz / sep, 0, dx / sep);
    // Stay on the same side if the fighters swap places, so the camera never whips around.
    if (perp.dot(camSide) < 0) perp.negate();
    camSide.lerp(perp, damp(4, dt)).normalize();
    const dist = clamp(4.6 + sep * 0.95, 5.6, 12);
    const desired = V().copy(mid).addScaledVector(camSide, dist);
    desired.y = 2.2 + sep * 0.12 + Math.max(a.y, b.y) * 0.3;
    camPos.lerp(desired, damp(6, dt));
    camera.position.copy(camPos);
    camTarget.lerp(V(mid.x, 1.15 + Math.max(a.y, b.y) * 0.4, mid.z), damp(8, dt));
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
let sendAcc = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const rdt = Math.min((now - last) / 1000, 1 / 30);
  last = now;
  lastDt = rdt;

  // Start button on a gamepad pauses (local only).
  if (G.phase !== 'menu' && (G.mode === 'cpu' || G.mode === 'local')) {
    const pad = navigator.getGamepads ? [...navigator.getGamepads()].find(Boolean) : null;
    const st = pad?.buttons[9]?.pressed;
    if (st && !frame.startWas) setPaused(!G.paused);
    frame.startWas = st;
  }

  if (G.mode === 'guest') {
    guestStep(rdt);
  } else if (G.phase === 'menu') {
    F[0].update(rdt, NO_INPUT, F[1]);
    F[1].update(rdt, NO_INPUT, F[0]);
  } else if (!G.paused) {
    stepGame(rdt);
    if (G.mode === 'host') {
      sendAcc += rdt;
      if (sendAcc >= 1 / 60 - 1e-4) { sendAcc = 0; sendSnapshot(); }
    }
  }
  pressed.clear();

  updateFx(G.paused ? 0 : rdt);
  updateCamera(rdt);
  if (G.phase !== 'menu') updateHud(rdt);
  dust.rotation.y += rdt * 0.01;
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

// Handy for debugging in the console.
window.NB = { G, F, Net };
