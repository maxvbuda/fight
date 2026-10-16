import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

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
// A colour pushed past 1.0 so the bloom pass picks it up.
const glow = (hex, k) => new THREE.Color(hex).multiplyScalar(k);
const TAU = Math.PI * 2;

// =====================================================================
// Renderer, post-processing, scene
// =====================================================================
const DPR = Math.min(devicePixelRatio, 1.75);
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(DPR);
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x0b0718, 0.022);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;

const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 160);
camera.position.set(0, 3, 9);
// Layer 1 holds point clouds; the floor mirror's camera only sees layer 0, so they're left out of reflections.
const NO_REFLECT = 1;
camera.layers.enable(NO_REFLECT);

// Bloom makes the neon glow; the grade pass adds vignette, hit aberration, flashes and KO desaturation.
const composer = new EffectComposer(renderer);
composer.setPixelRatio(DPR);
composer.addPass(new RenderPass(scene, camera));
// One bad pixel (NaN) would be smeared over the whole screen by the bloom blur, so scrub them first.
composer.addPass(new ShaderPass({
  uniforms: { tDiffuse: { value: null } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      if (any(isnan(c)) || any(isinf(c))) c = vec4(0.0, 0.0, 0.0, 1.0);
      gl_FragColor = min(c, vec4(64.0));
    }`,
}));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.75, 0.5, 0.9);
composer.addPass(bloom);
const grade = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uAberr: { value: 0 }, uFlash: { value: 0 }, uSat: { value: 1 }, uTime: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uAberr, uFlash, uSat, uTime; varying vec2 vUv;
    void main() {
      vec2 d = vUv - 0.5; float r2 = dot(d, d);
      vec2 off = d * (0.0015 + uAberr) * (0.5 + r2 * 3.0);
      vec4 c = texture2D(tDiffuse, vUv);
      c.r = texture2D(tDiffuse, vUv + off).r;
      c.b = texture2D(tDiffuse, vUv - off).b;
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = mix(vec3(l), c.rgb, uSat) + uFlash;
      c.rgb *= 1.0 - smoothstep(0.12, 0.6, r2) * 0.6;
      float n = fract(sin(dot(vUv * 913.0 + uTime, vec2(12.9898, 78.233))) * 43758.5453);
      c.rgb += (n - 0.5) * 0.012;
      gl_FragColor = c;
    }`,
});
composer.addPass(grade);
composer.addPass(new OutputPass());

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});

// ---------------- Lights ----------------
scene.add(new THREE.HemisphereLight(0x8c7cff, 0x140a1c, 0.45));
const key = new THREE.DirectionalLight(0xfff1e8, 2.2);
key.position.set(4, 14, 7);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -11, right: 11, top: 11, bottom: -11, near: 1, far: 34 });
key.shadow.bias = -0.0004;
key.shadow.normalBias = 0.02;
key.shadow.radius = 4;
scene.add(key);
const rimA = new THREE.PointLight(0xff2d6f, 50, 30, 2);
rimA.position.set(-8, 4, -4);
const rimB = new THREE.PointLight(0x2de2ff, 50, 30, 2);
rimB.position.set(8, 4, -4);
scene.add(rimA, rimB);
const hitLight = new THREE.PointLight(0xffffff, 0, 9, 2);
scene.add(hitLight);

const ARENA_R = 8.4;

// ---------------- Sky: dark gradient, coloured haze on the horizon, stars ----------------
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(120, 48, 24),
  new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { uTime: { value: 0 } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      uniform float uTime; varying vec3 vDir;
      void main() {
        float h = vDir.y, a = atan(vDir.z, vDir.x);
        vec3 c = mix(vec3(0.04, 0.015, 0.08), vec3(0.006, 0.004, 0.018), smoothstep(-0.05, 0.55, h));
        float band = exp(-pow((h - 0.04) * 9.0, 2.0));
        c += band * 0.2 * (vec3(0.55, 0.04, 0.25) * (0.5 + 0.5 * sin(a * 3.0 + uTime * 0.07))
                         + vec3(0.03, 0.3, 0.55) * (0.5 + 0.5 * sin(a * 3.0 + 2.1 - uTime * 0.05)));
        vec3 p = floor(vDir * 220.0);
        float s = fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
        float tw = 0.6 + 0.4 * sin(uTime * 2.0 + s * 100.0);
        c += step(0.9972, s) * smoothstep(0.08, 0.5, h) * tw * 0.9;
        gl_FragColor = vec4(c, 1.0);
      }`,
  })
);
scene.add(sky);

// ---------------- Floor: a mirror under a glossy, semi-transparent printed mat ----------------
function floorCanvases() {
  const S = 1024, mk = () => { const c = document.createElement('canvas'); c.width = c.height = S; return c; };
  const base = mk(), glowC = mk();
  const g = base.getContext('2d'), e = glowC.getContext('2d');
  const grd = g.createRadialGradient(512, 512, 40, 512, 512, 512);
  grd.addColorStop(0, '#2a2150'); grd.addColorStop(0.6, '#171230'); grd.addColorStop(1, '#0c0a1c');
  g.fillStyle = grd; g.fillRect(0, 0, S, S);
  e.fillStyle = '#000'; e.fillRect(0, 0, S, S);
  // Hexagon grid.
  g.strokeStyle = 'rgba(190,170,255,0.07)'; g.lineWidth = 2;
  const hr = 34, hw = hr * Math.sqrt(3);
  for (let row = -1; row < S / (hr * 1.5) + 1; row++) {
    for (let col = -1; col < S / hw + 1; col++) {
      const cx = col * hw + (row % 2 ? hw / 2 : 0), cy = row * hr * 1.5;
      g.beginPath();
      for (let k = 0; k <= 6; k++) { const a = Math.PI / 6 + k * Math.PI / 3; g.lineTo(cx + Math.cos(a) * hr, cy + Math.sin(a) * hr); }
      g.stroke();
    }
  }
  const ring = (ctx, r, color, w, dash) => {
    ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = w; if (dash) ctx.setLineDash(dash);
    ctx.beginPath(); ctx.arc(512, 512, r, 0, TAU); ctx.stroke(); ctx.restore();
  };
  // Neon lines go on both maps: the colour map, and the emissive map so they bloom.
  for (const ctx of [g, e]) {
    ring(ctx, 494, '#ff2d6f', 9);
    ring(ctx, 474, 'rgba(255,45,111,0.5)', 3, [18, 14]);
    ring(ctx, 300, 'rgba(45,226,255,0.55)', 4);
    ring(ctx, 288, 'rgba(45,226,255,0.25)', 2, [4, 10]);
    ring(ctx, 96, 'rgba(255,209,102,0.7)', 4);
    ctx.save(); ctx.translate(512, 512);
    for (let i = 0; i < 72; i++) {
      ctx.rotate(TAU / 72);
      ctx.fillStyle = i % 6 === 0 ? 'rgba(255,209,102,0.8)' : 'rgba(255,255,255,0.25)';
      ctx.fillRect(-1.5, 430, 3, i % 6 === 0 ? 30 : 14);
    }
    ctx.restore();
  }
  // Text around the ring and the centre "VS".
  g.save(); g.translate(512, 512);
  g.font = '700 30px Bungee, Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  const label = '  NEON BRAWL  ·  WORLD CIRCUIT  ·  NEON BRAWL  ·  WORLD CIRCUIT  ·';
  for (let i = 0; i < label.length; i++) {
    g.save(); g.rotate((i / label.length) * TAU); g.translate(0, -384);
    g.fillStyle = 'rgba(255,255,255,0.13)'; g.fillText(label[i], 0, 0); g.restore();
  }
  g.restore();
  g.fillStyle = 'rgba(255,255,255,0.08)';
  g.font = '170px Bungee, Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('VS', 512, 524);
  const tex = (c, srgb) => {
    const t = new THREE.CanvasTexture(c);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return t;
  };
  return [tex(base, true), tex(glowC, true)];
}
const mirror = new Reflector(new THREE.CircleGeometry(9.2, 96), {
  textureWidth: Math.round(innerWidth * DPR * 0.5), textureHeight: Math.round(innerHeight * DPR * 0.5), color: 0x8a8a9a,
});
mirror.rotation.x = -Math.PI / 2;
scene.add(mirror);
const [floorMap, floorGlow] = floorCanvases();
const floorMat = new THREE.MeshStandardMaterial({
  map: floorMap, emissiveMap: floorGlow, emissive: 0xffffff, emissiveIntensity: 2.2,
  roughness: 0.32, metalness: 0.25, transparent: true, opacity: 0.84, envMapIntensity: 0.25,
});
const floor = new THREE.Mesh(new THREE.CircleGeometry(9.2, 96), floorMat);
floor.rotation.x = -Math.PI / 2;
floor.position.y = 0.004;
floor.receiveShadow = true;
scene.add(floor);
// Redraw once the display font loads so the lettering uses it.
document.fonts?.ready.then(() => { const [m, e] = floorCanvases(); floorMat.map = m; floorMat.emissiveMap = e; floorMat.needsUpdate = true; });

const plinth = new THREE.Mesh(
  new THREE.CylinderGeometry(9.2, 9.8, 1.0, 96, 1, true),
  new THREE.MeshStandardMaterial({ color: 0x15112a, roughness: 0.5, metalness: 0.6, envMapIntensity: 0.4 })
);
plinth.position.y = -0.5;
scene.add(plinth);
// LED band around the ring edge with a chasing colour pattern.
const ledMat = new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 }, uBoost: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform float uTime, uBoost; varying vec2 vUv;
    void main() {
      float w = 0.5 + 0.5 * sin(vUv.x * 6.2832 * 8.0 - uTime * 2.5);
      vec3 c = mix(vec3(1.0, 0.18, 0.44), vec3(0.18, 0.89, 1.0), w);
      float dots = 0.75 + 0.25 * step(0.5, fract(vUv.x * 360.0));
      gl_FragColor = vec4(c * (2.2 + uBoost * 3.0) * dots, 1.0);
    }`,
});
const led = new THREE.Mesh(new THREE.CylinderGeometry(9.23, 9.26, 0.16, 128, 1, true), ledMat);
led.position.y = -0.1;
scene.add(led);
const edge = new THREE.Mesh(new THREE.TorusGeometry(9.2, 0.045, 8, 180), new THREE.MeshBasicMaterial({ color: glow(0xff2d6f, 3) }));
edge.rotation.x = Math.PI / 2;
edge.position.y = 0.02;
scene.add(edge);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), new THREE.MeshStandardMaterial({ color: 0x0a0814, roughness: 0.9 }));
ground.rotation.x = -Math.PI / 2;
ground.position.y = -1;
ground.receiveShadow = true;
scene.add(ground);

// ---------------- Stands with a cheering crowd ----------------
const crowd = (() => {
  const tiers = [{ r: 13, y: -0.6 }, { r: 14.6, y: 0.3 }, { r: 16.2, y: 1.2 }, { r: 17.8, y: 2.1 }];
  const standMat = new THREE.MeshStandardMaterial({ color: 0x110d22, roughness: 0.8 });
  const stepMat = new THREE.MeshBasicMaterial({ color: glow(0x2de2ff, 1.4) });
  tiers.forEach((t) => {
    const s = new THREE.Mesh(new THREE.CylinderGeometry(t.r + 0.8, t.r + 0.8, t.y + 1.4, 96, 1, true), standMat);
    s.position.y = (t.y + 1.4) / 2 - 1;
    s.material.side = THREE.DoubleSide;
    scene.add(s);
    const top = new THREE.Mesh(new THREE.RingGeometry(t.r - 0.8, t.r + 0.8, 96), standMat);
    top.rotation.x = -Math.PI / 2;
    top.position.y = t.y + 0.4;
    scene.add(top);
    const strip = new THREE.Mesh(new THREE.TorusGeometry(t.r - 0.8, 0.02, 4, 160), stepMat);
    strip.rotation.x = Math.PI / 2;
    strip.position.y = t.y + 0.41;
    scene.add(strip);
  });
  const per = 84, n = tiers.length * per;
  const body = new THREE.CapsuleGeometry(0.22, 0.5, 2, 6);
  body.translate(0, 0.47, 0);
  const head = new THREE.SphereGeometry(0.15, 8, 6);
  head.translate(0, 1.05, 0);
  const mat = withRim(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, envMapIntensity: 0.1 }), 0x7a4cff, 0.35);
  const bodies = new THREE.InstancedMesh(body, mat, n), heads = new THREE.InstancedMesh(head, mat, n);
  const seats = [], col = new THREE.Color();
  const tints = [0x1c1733, 0x15122a, 0x24152b, 0x121a2c, 0x281f38];
  tiers.forEach((t, ti) => {
    for (let i = 0; i < per; i++) {
      const a = (i + (ti % 2) * 0.5 + Math.random() * 0.3) / per * TAU;
      seats.push({ x: Math.cos(a) * t.r, y: t.y + 0.4, z: Math.sin(a) * t.r, a, ph: Math.random() * TAU, sp: 4 + Math.random() * 5, s: 0.85 + Math.random() * 0.3 });
      col.setHex(tints[(Math.random() * tints.length) | 0]);
      bodies.setColorAt(seats.length - 1, col);
      heads.setColorAt(seats.length - 1, col.multiplyScalar(1.3));
    }
  });
  scene.add(bodies, heads);
  // Camera flashes popping in the stands.
  const fpos = new Float32Array(n * 3), fseed = new Float32Array(n);
  seats.forEach((s, i) => { fpos.set([s.x * 0.98, s.y + 1.1, s.z * 0.98], i * 3); fseed[i] = Math.random(); });
  const fg = new THREE.BufferGeometry();
  fg.setAttribute('position', new THREE.BufferAttribute(fpos, 3));
  fg.setAttribute('seed', new THREE.BufferAttribute(fseed, 1));
  const flashes = new THREE.Points(fg, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uRate: { value: 1 } },
    vertexShader: `
      attribute float seed; uniform float uTime, uRate; varying float vA;
      void main() {
        float slot = floor(uTime * 9.0 + seed * 50.0);
        float r = fract(sin(slot * 91.7 + seed * 437.1) * 43758.5);
        vA = step(1.0 - 0.006 * uRate, r);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = vA * 260.0 / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying float vA;
      void main() { float d = length(gl_PointCoord - 0.5); gl_FragColor = vec4(vec3(3.0) * smoothstep(0.5, 0.0, d) * vA, 1.0); }`,
  }));
  flashes.layers.set(NO_REFLECT);
  scene.add(flashes);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  let hype = 0;
  return {
    flashes,
    cheer(k) { hype = Math.max(hype, k); },
    update(t, dt) {
      hype *= Math.exp(-1.2 * dt);
      flashes.material.uniforms.uTime.value = t;
      flashes.material.uniforms.uRate.value = 1 + hype * 12;
      for (let i = 0; i < seats.length; i++) {
        const s = seats[i];
        const jump = Math.max(0, Math.sin(t * s.sp + s.ph)) * (0.04 + hype * 0.3);
        p.set(s.x, s.y + jump, s.z);
        q.setFromAxisAngle(up, -s.a - Math.PI / 2);
        sc.setScalar(s.s);
        m4.compose(p, q, sc);
        bodies.setMatrixAt(i, m4);
        heads.setMatrixAt(i, m4);
      }
      bodies.instanceMatrix.needsUpdate = heads.instanceMatrix.needsUpdate = true;
    },
  };
})();

// ---------------- Pillars, lighting rig and spotlight beams ----------------
{
  const pillarMat = new THREE.MeshStandardMaterial({ color: 0x17132b, roughness: 0.5, metalness: 0.5 });
  const neon = [new THREE.MeshBasicMaterial({ color: glow(0xff2d6f, 3) }), new THREE.MeshBasicMaterial({ color: glow(0x2de2ff, 3) })];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU, r = 21;
    const p = new THREE.Mesh(new THREE.BoxGeometry(1, 16, 1), pillarMat);
    p.position.set(Math.cos(a) * r, 7, Math.sin(a) * r);
    p.lookAt(0, 7, 0);
    scene.add(p);
    for (const dx of [-0.32, 0.32]) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.08, 14, 0.05), neon[i % 2]);
      s.position.set(dx, 0, 0.52);
      p.add(s);
    }
  }
  // Overhead truss.
  const trussMat = new THREE.MeshStandardMaterial({ color: 0x2a2640, roughness: 0.4, metalness: 0.8 });
  for (const y of [12.4, 13]) {
    const t = new THREE.Mesh(new THREE.TorusGeometry(7.5, 0.07, 6, 96), trussMat);
    t.rotation.x = Math.PI / 2;
    t.position.y = y;
    scene.add(t);
  }
  const halo = new THREE.Mesh(new THREE.TorusGeometry(7.5, 0.05, 6, 160), new THREE.MeshBasicMaterial({ color: glow(0xffd166, 2.5) }));
  halo.rotation.x = Math.PI / 2;
  halo.position.y = 12.1;
  scene.add(halo);
}
const beamMat = (color) => new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  uniforms: { uColor: { value: new THREE.Color(color) }, uStr: { value: 0.22 } },
  vertexShader: `
    varying float vH, vF;
    void main() {
      vH = uv.y;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vF = abs(dot(normalize(normalMatrix * normal), normalize(-mv.xyz)));
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: `
    uniform vec3 uColor; uniform float uStr; varying float vH, vF;
    void main() { gl_FragColor = vec4(uColor * pow(vF, 2.5) * (0.12 + 0.88 * vH * vH) * uStr, 1.0); }`,
});
const beams = [0xff2d6f, 0x2de2ff, 0xffd166, 0xb48cff].map((color, i) => {
  const a = (i / 4) * TAU + Math.PI / 4;
  const rig = new THREE.Group();
  rig.position.set(Math.cos(a) * 7.5, 12.2, Math.sin(a) * 7.5);
  const L = 15;
  const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 2.4, L, 40, 1, true), beamMat(color));
  cone.rotation.x = -Math.PI / 2;
  cone.position.z = L / 2;
  cone.layers.set(NO_REFLECT);
  // CylinderGeometry's uv.y is 1 at the top, so the narrow end (at the lamp) is brightest.
  rig.add(cone);
  const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.38, 0.5, 16), new THREE.MeshStandardMaterial({ color: 0x1b1830, metalness: 0.8, roughness: 0.3 }));
  lamp.rotation.x = Math.PI / 2;
  rig.add(lamp);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.3, 16), new THREE.MeshBasicMaterial({ color: glow(color, 6) }));
  lens.position.z = 0.26;
  rig.add(lens);
  const spot = new THREE.SpotLight(color, 160, 26, 0.24, 0.6, 1.6);
  spot.position.copy(rig.position);
  scene.add(rig, spot, spot.target);
  return { rig, spot, cone, a, ph: i * 1.7 };
});
function updateStage(t, dt, focus) {
  for (const b of beams) {
    const tx = focus.x + Math.sin(t * 0.37 + b.ph) * 2.8, tz = focus.z + Math.cos(t * 0.29 + b.ph * 1.3) * 2.8;
    b.rig.lookAt(tx, 0, tz);
    b.spot.target.position.set(tx, 0, tz);
    const d = b.rig.position.distanceTo(b.spot.target.position);
    b.cone.scale.y = d / 15;
    b.cone.position.z = d / 2;
  }
  ledMat.uniforms.uTime.value = t;
  ledMat.uniforms.uBoost.value *= Math.exp(-3 * dt);
  sky.material.uniforms.uTime.value = t;
  grade.uniforms.uTime.value = t % 10;
  crowd.update(t, dt);
}

// Floating embers.
const dust = (() => {
  const n = 700, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  const pal = [new THREE.Color(0xff2d6f), new THREE.Color(0x2de2ff), new THREE.Color(0xb9a8ff), new THREE.Color(0xffd166)];
  for (let i = 0; i < n; i++) {
    const r = 3 + Math.random() * 20, a = Math.random() * TAU;
    pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 1] = Math.random() * 12; pos[i * 3 + 2] = Math.sin(a) * r;
    const c = pal[i % 4]; col.set([c.r, c.g, c.b], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const pts = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.06, vertexColors: true, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending }));
  pts.layers.set(NO_REFLECT);
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
// Effects: spark streaks, hit flashes, shockwaves, dust, shake. Driven by NBSim events.
// =====================================================================
function radialTexture(stops) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d'), grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  stops.forEach(([o, col]) => grd.addColorStop(o, col));
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
const softTex = radialTexture([[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,0.6)'], [1, 'rgba(255,255,255,0)']]);
const starTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.translate(128, 128);
  const grd = g.createRadialGradient(0, 0, 0, 0, 0, 128);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.15, 'rgba(255,255,255,0.8)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.beginPath();
  for (let i = 0; i < 16; i++) { const a = (i / 16) * TAU, r = i % 2 ? 22 : 128; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
  g.fill();
  return new THREE.CanvasTexture(c);
})();

const sparkGeo = new THREE.BoxGeometry(0.025, 0.025, 1);
sparkGeo.translate(0, 0, -0.5); // streak trails behind its head
const sparks = [];
for (let i = 0; i < 320; i++) {
  const m = new THREE.Mesh(sparkGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }));
  m.visible = false;
  m.userData = { vel: V(), life: 0, max: 1 };
  scene.add(m);
  sparks.push(m);
}
let sparkIdx = 0;
const flashes = [];
for (let i = 0; i < 8; i++) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: starTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  s.visible = false;
  s.userData = { life: 0, max: 0.14, size: 1 };
  scene.add(s);
  flashes.push(s);
}
let flashIdx = 0;
const waves = [];
const ringGeo = new THREE.RingGeometry(0.85, 1, 64), thinRingGeo = new THREE.RingGeometry(0.95, 1, 96);
for (let i = 0; i < 6; i++) {
  const w = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  w.visible = false;
  w.userData = { life: 0, ground: false };
  scene.add(w);
  waves.push(w);
}
const puffs = [];
for (let i = 0; i < 40; i++) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTex, color: 0x9a8cc8, transparent: true, depthWrite: false, opacity: 0 }));
  s.visible = false;
  s.userData = { vel: V(), life: 0, max: 1 };
  scene.add(s);
  puffs.push(s);
}
let puffIdx = 0;
let shake = 0;
const post = { aberr: 0, flash: 0 };
const tmpV = V();

function spawnFlash(x, y, z, color, size) {
  const s = flashes[flashIdx++ % flashes.length];
  s.visible = true;
  s.position.set(x, y, z);
  s.material.color.copy(glow(color, 2.5));
  s.material.rotation = Math.random() * TAU;
  s.userData.life = s.userData.max = 0.08 + size * 0.05;
  s.userData.size = size;
}
function spawnWave(x, y, z, color, ground) {
  const w = waves.find((w) => !w.visible) || waves[0];
  w.visible = true;
  w.position.set(x, y, z);
  if (ground) w.rotation.set(-Math.PI / 2, 0, 0); else w.lookAt(camera.position);
  w.geometry = ground ? thinRingGeo : ringGeo;
  w.material.color.copy(glow(color, 3));
  w.userData.life = 0;
  w.userData.ground = ground;
}
function spawnDust(x, z, n, speed) {
  for (let i = 0; i < n; i++) {
    const s = puffs[puffIdx++ % puffs.length], a = Math.random() * TAU;
    s.visible = true;
    s.position.set(x + Math.cos(a) * 0.2, 0.1, z + Math.sin(a) * 0.2);
    s.userData.vel.set(Math.cos(a) * speed, 0.3 + Math.random() * 0.5, Math.sin(a) * speed);
    s.userData.life = s.userData.max = 0.4 + Math.random() * 0.3;
  }
}

function runFx(type, a) {
  switch (type) {
    case 'sfx': playSfx(a); break;
    case 'burst': {
      const [x, y, z, color, n, speed] = a;
      for (let i = 0; i < n; i++) {
        const s = sparks[sparkIdx++ % sparks.length];
        s.visible = true;
        s.position.set(x, y, z);
        s.material.color.copy(glow(i % 3 === 0 ? 0xffffff : color, 3.5));
        s.userData.vel.set(Math.random() - 0.5, Math.random() - 0.25, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.5 + Math.random()));
        s.userData.life = s.userData.max = 0.18 + Math.random() * 0.32;
      }
      const big = n >= 40;
      spawnFlash(x, y, z, color, big ? 2.4 : n >= 20 ? 1.7 : n >= 12 ? 1.2 : 0.7);
      if (n >= 12) {
        post.aberr = big ? 0.022 : Math.min(0.01, post.aberr + 0.004);
        ledMat.uniforms.uBoost.value = big ? 1 : 0.4;
        crowd.cheer(big ? 1 : 0.3);
      }
      if (big) { post.flash = 0.12; spawnWave(x, 0.03, z, color, true); }
      hitLight.position.set(x, y, z);
      hitLight.color.setHex(color);
      hitLight.intensity = 30 + n * 3;
      break;
    }
    case 'wave': {
      const [x, y, z, color] = a;
      spawnWave(x, y, z, color, false);
      break;
    }
    case 'shake': shake = Math.max(shake, a); break;
    case 'announce':
      announce(a[0], a[1], a[2]);
      if (a[1] === 'ko' || a[1] === 'stay') crowd.cheer(1);
      break;
  }
}
function updateFx(dt) {
  for (const s of sparks) {
    if (!s.visible) continue;
    const u = s.userData;
    u.life -= dt;
    if (u.life <= 0) { s.visible = false; continue; }
    u.vel.y -= 9 * dt;
    u.vel.multiplyScalar(Math.exp(-2 * dt));
    s.position.addScaledVector(u.vel, dt);
    s.lookAt(tmpV.copy(s.position).add(u.vel));
    const k = u.life / u.max;
    s.scale.set(0.6 + k, 0.6 + k, Math.max(0.02, u.vel.length() * 0.035 * k));
  }
  for (const s of flashes) {
    if (!s.visible) continue;
    const u = s.userData;
    u.life -= dt;
    if (u.life <= 0) { s.visible = false; continue; }
    const k = 1 - u.life / u.max;
    s.scale.setScalar(u.size * (0.5 + k * 0.9));
    s.material.opacity = 1 - k * k;
  }
  for (const w of waves) {
    if (!w.visible) continue;
    w.userData.life += dt;
    const g = w.userData.ground, k = w.userData.life / (g ? 0.7 : 0.45);
    if (k >= 1) { w.visible = false; continue; }
    w.scale.setScalar(g ? 0.5 + k * 7 : 0.3 + k * 3.5);
    w.material.opacity = (1 - k) * (1 - k) * (g ? 0.6 : 1);
  }
  for (const s of puffs) {
    if (!s.visible) continue;
    const u = s.userData;
    u.life -= dt;
    if (u.life <= 0) { s.visible = false; continue; }
    const k = 1 - u.life / u.max;
    s.position.addScaledVector(u.vel, dt);
    u.vel.multiplyScalar(Math.exp(-4 * dt));
    s.scale.setScalar(0.3 + k * 0.8);
    s.material.opacity = 0.35 * (1 - k);
  }
  hitLight.intensity *= Math.exp(-14 * dt);
  shake *= Math.exp(-9 * dt);
  post.aberr *= Math.exp(-7 * dt);
  post.flash *= Math.exp(-10 * dt);
}

// Ribbon that follows a fist or foot and shows only while it's moving fast.
const trailMat = (color) => new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  uniforms: { uColor: { value: glow(color, 2.2) } },
  vertexShader: 'attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: 'uniform vec3 uColor; varying float vA; void main(){ gl_FragColor = vec4(uColor * vA, 1.0); }',
});
class Trail {
  constructor(color, width) {
    const n = (this.n = 12);
    this.width = width;
    this.pts = Array.from({ length: n }, () => V());
    this.spd = new Float32Array(n);
    this.ready = false;
    this.pos = new Float32Array(n * 6);
    this.alpha = new Float32Array(n * 2);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    const idx = [];
    for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, trailMat(color));
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.d = V(); this.side = V(); this.view = V();
  }
  reset() { this.ready = false; this.mesh.visible = false; }
  // p: world position of the limb; rel: how far it moved relative to the fighter this frame.
  update(p, rel, dt) {
    const { n, pts, spd } = this;
    if (!this.ready) { pts.forEach((q) => q.copy(p)); spd.fill(0); this.ready = true; }
    for (let i = n - 1; i > 0; i--) { pts[i].copy(pts[i - 1]); spd[i] = spd[i - 1]; }
    pts[0].copy(p);
    spd[0] = rel / dt;
    let any = false;
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[Math.min(i + 1, n - 1)], c = pts[Math.max(i - 1, 0)];
      this.d.subVectors(c, b);
      this.view.subVectors(camera.position, a);
      this.side.crossVectors(this.d, this.view).normalize();
      const fade = 1 - i / (n - 1);
      this.side.multiplyScalar(this.width * (0.3 + 0.7 * fade));
      this.pos.set([a.x + this.side.x, a.y + this.side.y, a.z + this.side.z, a.x - this.side.x, a.y - this.side.y, a.z - this.side.z], i * 6);
      const al = clamp((spd[i] - 4.5) / 7, 0, 1) * fade;
      this.alpha[i * 2] = this.alpha[i * 2 + 1] = al;
      if (al > 0.01) any = true;
    }
    this.mesh.visible = any;
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.alpha.needsUpdate = true;
  }
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

// Adds a Fresnel rim glow to a standard material so fighters pop against the dark arena.
function withRim(mat, color, strength) {
  mat.userData.rim = { value: new THREE.Color(color) };
  mat.userData.rimStr = { value: strength };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.rimColor = mat.userData.rim;
    sh.uniforms.rimStr = mat.userData.rimStr;
    sh.fragmentShader = 'uniform vec3 rimColor; uniform float rimStr;\n' + sh.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\n totalEmissiveRadiance += rimColor * rimStr * pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 3.0);'
    );
  };
  return mat;
}
function capsule(r, len, mat, r2) {
  // Tapered limb: a cylinder from radius r at the joint to r2, capped with spheres.
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r2 ?? r, len, 14), mat);
  body.position.y = -len / 2;
  g.add(body);
  const top = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), mat);
  const bot = new THREE.Mesh(new THREE.SphereGeometry(r2 ?? r, 14, 10), mat);
  bot.position.y = -len;
  g.add(top, bot);
  return g;
}
function joint(parent, x, y, z) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}
function mesh(geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
}

class FighterView {
  constructor(idx) {
    const d = ROSTER[idx];
    this.suit = withRim(new THREE.MeshPhysicalMaterial({ color: d.color, roughness: 0.38, metalness: 0.1, clearcoat: 0.7, clearcoatRoughness: 0.25, envMapIntensity: 0.5 }), d.color, 0.55);
    const dark = withRim(new THREE.MeshStandardMaterial({ color: 0x1d1a2c, roughness: 0.55, metalness: 0.3, envMapIntensity: 0.5 }), d.color, 0.5);
    const skin = withRim(new THREE.MeshPhysicalMaterial({ color: d.skin, roughness: 0.55, sheen: 0.4, sheenColor: new THREE.Color(0xffd8c0), envMapIntensity: 0.3 }), 0xffffff, 0.25);
    const trim = new THREE.MeshStandardMaterial({ color: d.trim, emissive: d.trim, emissiveIntensity: 1.6, roughness: 0.3 });
    const plate = withRim(new THREE.MeshStandardMaterial({ color: 0x2b2740, roughness: 0.25, metalness: 0.85, envMapIntensity: 1 }), d.color, 0.6);
    this.glove = new THREE.MeshPhysicalMaterial({ color: d.color, emissive: d.color, emissiveIntensity: 0.5, roughness: 0.25, clearcoat: 1 });
    this.trimMat = trim;

    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);
    scene.add(this.root);

    const hips = (this.hips = joint(this.body, 0, 1.0, 0));
    const pelvis = mesh(new THREE.SphereGeometry(0.2, 16, 12), dark);
    pelvis.scale.set(1.15, 0.7, 0.8);
    hips.add(pelvis);
    const spine = joint(hips, 0, 0.06, 0);
    // Torso: abdomen plus a broader chest, with armour plates and a glowing emblem.
    const abs = mesh(new THREE.CapsuleGeometry(0.15, 0.14, 4, 14), this.suit, 0, 0.14, 0);
    abs.scale.set(1.25, 1, 0.8);
    const chest = mesh(new THREE.CapsuleGeometry(0.2, 0.1, 4, 16), this.suit, 0, 0.4, 0);
    chest.scale.set(1.35, 1, 0.78);
    const chestPlate = mesh(new THREE.SphereGeometry(0.2, 18, 10, 0, TAU, 0, Math.PI * 0.5), plate, 0, 0.38, 0.03);
    chestPlate.rotation.x = Math.PI / 2;
    chestPlate.scale.set(1.15, 0.55, 0.85);
    const emblem = mesh(new THREE.OctahedronGeometry(0.045), trim, 0, 0.42, 0.155);
    emblem.scale.set(1, 1.4, 0.4);
    spine.add(abs, chest, chestPlate, emblem);
    const belt = mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.06, 20), trim, 0, 0.02, 0);
    belt.scale.z = 0.72;
    const buckle = mesh(new THREE.BoxGeometry(0.09, 0.07, 0.03), plate, 0, 0.02, 0.165);
    spine.add(belt, buckle);
    // Belt tails hang behind.
    for (const s of [-1, 1]) {
      const tail = mesh(new THREE.BoxGeometry(0.05, 0.3, 0.012), trim, 0.06 * s, -0.12, -0.17);
      tail.rotation.x = 0.25; tail.rotation.z = 0.08 * s;
      spine.add(tail);
    }

    const neck = joint(spine, 0, 0.6, 0);
    neck.add(mesh(new THREE.CylinderGeometry(0.06, 0.075, 0.12, 12), skin, 0, 0.01, 0));
    const head = mesh(new THREE.SphereGeometry(0.155, 24, 18), skin, 0, 0.15, 0);
    head.scale.set(0.95, 1.05, 1);
    const jaw = mesh(new THREE.SphereGeometry(0.11, 16, 10), skin, 0, 0.08, 0.035);
    jaw.scale.set(1.05, 0.8, 1);
    neck.add(head, jaw);
    // Wrap-around visor.
    const visor = mesh(new THREE.CylinderGeometry(0.163, 0.163, 0.05, 24, 1, true, -1.1, 2.2), trim, 0, 0.17, 0);
    visor.material = trim.clone();
    visor.material.side = THREE.DoubleSide;
    this.visorMat = visor.material;
    neck.add(visor);
    const hairMat = dark;
    const hair = mesh(new THREE.SphereGeometry(0.165, 22, 10, 0, TAU, 0, Math.PI * 0.55), hairMat, 0, 0.16, -0.005);
    hair.rotation.x = -0.25;
    neck.add(hair);
    // Each fighter gets a different hairstyle.
    if (idx === 0) { // spikes
      for (let i = 0; i < 6; i++) {
        const sp = mesh(new THREE.ConeGeometry(0.05, 0.2, 8), hairMat, Math.sin(i * 1.05 - 2.6) * 0.1, 0.27, -0.03 - Math.cos(i * 1.05 - 2.6) * 0.06);
        sp.rotation.set(-0.7 - i * 0.05, 0, Math.sin(i * 1.05 - 2.6) * -0.6);
        neck.add(sp);
      }
    } else if (idx === 1) { // mohawk
      for (let i = 0; i < 5; i++) {
        const fin = mesh(new THREE.BoxGeometry(0.03, 0.14 - Math.abs(i - 1) * 0.015, 0.07), trim, 0, 0.31 - i * 0.012, 0.09 - i * 0.065);
        fin.rotation.x = -0.35 - i * 0.18;
        neck.add(fin);
      }
    } else if (idx === 2) { // ponytail
      neck.add(mesh(new THREE.SphereGeometry(0.05, 10, 8), hairMat, 0, 0.22, -0.16));
      const tail = mesh(new THREE.CapsuleGeometry(0.045, 0.28, 4, 8), hairMat, 0, 0.06, -0.22);
      tail.rotation.x = 0.35;
      neck.add(tail);
    } else { // headband
      const band = mesh(new THREE.TorusGeometry(0.163, 0.018, 6, 28), trim, 0, 0.24, 0);
      band.rotation.x = Math.PI / 2 - 0.25;
      neck.add(band);
      for (const s of [-1, 1]) {
        const knot = mesh(new THREE.BoxGeometry(0.03, 0.18, 0.01), trim, 0.03 * s, 0.17, -0.19);
        knot.rotation.set(0.5, 0, 0.35 * s);
        neck.add(knot);
      }
    }

    const arm = (side) => {
      const sh = joint(spine, 0.3 * side, 0.5, 0);
      const pad = mesh(new THREE.SphereGeometry(0.12, 16, 10, 0, TAU, 0, Math.PI * 0.6), plate, 0, 0.02, 0);
      pad.rotation.z = -0.35 * side;
      sh.add(pad);
      sh.add(capsule(0.075, 0.3, this.suit, 0.06));
      const el = joint(sh, 0, -0.3, 0);
      el.add(capsule(0.06, 0.24, skin, 0.05));
      el.add(mesh(new THREE.CylinderGeometry(0.058, 0.058, 0.05, 14), trim, 0, -0.21, 0));
      const fist = mesh(new THREE.SphereGeometry(0.09, 16, 12), this.glove, 0, -0.3, 0.01);
      fist.scale.set(0.95, 1.05, 1.15);
      el.add(fist);
      return [sh, el, fist];
    };
    const leg = (side) => {
      const hp = joint(hips, 0.12 * side, -0.06, 0);
      hp.add(capsule(0.1, 0.46, dark, 0.075));
      const kn = joint(hp, 0, -0.46, 0);
      const kneePad = mesh(new THREE.SphereGeometry(0.075, 12, 8, 0, TAU, 0, Math.PI * 0.5), plate, 0, 0, 0.03);
      kneePad.rotation.x = Math.PI / 2;
      kn.add(kneePad);
      kn.add(capsule(0.078, 0.4, this.suit, 0.06));
      const boot = mesh(new THREE.BoxGeometry(0.15, 0.1, 0.3), dark, 0, -0.43, 0.05);
      const toe = mesh(new THREE.SphereGeometry(0.075, 12, 8), dark, 0, -0.44, 0.17);
      toe.scale.set(1, 0.7, 1);
      const sole = mesh(new THREE.BoxGeometry(0.155, 0.025, 0.31), trim, 0, -0.47, 0.05);
      kn.add(boot, toe, sole);
      const foot = joint(kn, 0, -0.44, 0.12);
      return [hp, kn, foot];
    };
    // +x is the fighter's left (they face +z).
    const [lSh, lEl, lFist] = arm(1);
    const [rSh, rEl, rFist] = arm(-1);
    const [lHip, lKn, lFoot] = leg(1);
    const [rHip, rKn, rFoot] = leg(-1);
    this.j = { spine, neck, lSh, rSh, lEl, rEl, lHip, rHip, lKn, rKn };
    this.root.traverse((o) => { if (o.isMesh) o.castShadow = true; });

    // Coloured marker on the floor, and an aura when the super meter is full.
    this.marker = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.7, 48), new THREE.MeshBasicMaterial({ color: glow(d.color, 2), transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.marker.rotation.x = -Math.PI / 2;
    this.glowDisc = new THREE.Mesh(new THREE.CircleGeometry(1.2, 32), new THREE.MeshBasicMaterial({ map: softTex, color: glow(d.color, 1.5), transparent: true, opacity: 0.25, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.glowDisc.rotation.x = -Math.PI / 2;
    scene.add(this.marker, this.glowDisc);
    const an = 40, apos = new Float32Array(an * 3);
    this.auraSeed = Array.from({ length: an }, () => ({ a: Math.random() * TAU, r: 0.35 + Math.random() * 0.3, y: Math.random() * 2, s: 0.8 + Math.random() * 1.2 }));
    const ag = new THREE.BufferGeometry();
    ag.setAttribute('position', new THREE.BufferAttribute(apos, 3));
    this.aura = new THREE.Points(ag, new THREE.PointsMaterial({ map: softTex, color: glow(d.color, 3), size: 0.14, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.aura.frustumCulled = false;
    this.aura.visible = false;
    this.aura.layers.set(NO_REFLECT);
    scene.add(this.aura);

    this.limbs = [lFist, rFist, lFoot, rFoot];
    this.trails = this.limbs.map((_, i) => new Trail(d.color, i < 2 ? 0.07 : 0.09));
    this.prevLimb = this.limbs.map(() => V());
    this.prevRoot = V();
    this.wasAir = false;
    this.lastMeter = 0;

    // Name tag over the head ("YOU", "P2", ...).
    const c = document.createElement('canvas');
    c.width = 128; c.height = 48;
    this.tagCanvas = c;
    this.tagTex = new THREE.CanvasTexture(c);
    this.tagTex.colorSpace = THREE.SRGBColorSpace;
    this.tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tagTex, depthTest: false, transparent: true, fog: false }));
    this.tag.scale.set(0.75, 0.28, 1);
    this.tag.position.y = 2.3;
    this.tag.renderOrder = 10;
    this.tagText = null;
    this.color = d.color;
    this.root.add(this.tag);
    this.hide();
  }

  hide() {
    this.root.visible = this.marker.visible = this.glowDisc.visible = this.aura.visible = false;
    this.trails.forEach((t) => t.reset());
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
      g.shadowColor = hexStr(this.color);
      g.shadowBlur = 8;
      g.fillStyle = '#fff';
      g.fillText(text, 64, 20);
      g.fillStyle = hexStr(this.color);
      g.beginPath(); g.moveTo(56, 38); g.lineTo(72, 38); g.lineTo(64, 46); g.fill();
    }
    this.tagTex.needsUpdate = true;
    this.tag.visible = !!text;
  }

  sync(f, dt) {
    const wasHidden = !this.root.visible;
    this.root.visible = this.marker.visible = this.glowDisc.visible = true;
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
    this.suit.emissive.setRGB(fl * 2, fl * 2, fl * 2);
    const full = f.meter >= 100, pulse = Math.sin(f.clock * 12);
    this.glove.emissiveIntensity = full ? 2 + pulse * 1 : 0.5;
    this.suit.userData.rimStr.value = full ? 1.3 + pulse * 0.5 : 0.55;
    this.visorMat.emissiveIntensity = 1.6 + (full ? 2 : 0);

    const ko = f.state === 'ko';
    this.marker.position.set(f.x, 0.012, f.z);
    this.marker.material.opacity = ko ? 0.1 : 0.55 / (1 + f.y);
    this.glowDisc.position.set(f.x, 0.01, f.z);
    this.glowDisc.material.opacity = ko ? 0.05 : full ? 0.5 + pulse * 0.15 : 0.18;

    // A super just started: the meter emptied while attacking.
    if (this.lastMeter >= 100 && f.meter < 50 && !ko) {
      post.aberr = Math.max(post.aberr, 0.015);
      spawnWave(f.x, 0.03, f.z, f.color, true);
      ledMat.uniforms.uBoost.value = 1;
    }
    this.lastMeter = f.meter;

    if (!dt) return;
    // Landing dust.
    const air = f.y > 0.12;
    if (this.wasAir && !air) spawnDust(f.x, f.z, 8, 1.6);
    this.wasAir = air;

    // Aura sparks rising around a fighter with a full meter.
    this.aura.visible = full && !ko;
    if (this.aura.visible) {
      const p = this.aura.geometry.attributes.position;
      this.auraSeed.forEach((s, i) => {
        s.y += dt * s.s;
        if (s.y > 2.1) { s.y = 0; s.a = Math.random() * TAU; }
        const a = s.a + f.clock * 1.5;
        p.setXYZ(i, f.x + Math.cos(a) * s.r, f.y + s.y, f.z + Math.sin(a) * s.r);
      });
      p.needsUpdate = true;
    }

    // Swing trails: limb speed relative to the fighter, so walking and knockback don't draw them.
    this.root.updateMatrixWorld(true);
    const rootMove = tmpV.set(f.x, f.y, f.z).sub(this.prevRoot);
    this.limbs.forEach((l, i) => {
      const w = l.getWorldPosition(new THREE.Vector3());
      const rel = wasHidden ? 0 : w.clone().sub(this.prevLimb[i]).sub(rootMove).length();
      if (wasHidden) this.trails[i].reset();
      this.trails[i].update(w, rel, dt);
      this.prevLimb[i].copy(w);
    });
    this.prevRoot.set(f.x, f.y, f.z);
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
    if (!f) { if (v.root.visible) v.hide(); return; }
    v.sync(f, A.paused ? 0 : rdt);
    v.setTag(A.mode === 'menu' ? '' : tagFor(f));
  });

  updateFx(A.paused ? 0 : rdt);
  updateCamera(A.mode === 'menu' ? null : S, rdt);
  if (A.mode !== 'menu') updateHud(S, rdt);
  dust.rotation.y += rdt * 0.01;
  const t = now / 1000, focus = V();
  shown.fighters.forEach((f) => focus.add(V(f.x, 0, f.z)));
  focus.multiplyScalar(1 / Math.max(1, shown.fighters.length));
  updateStage(t, rdt, focus);
  grade.uniforms.uAberr.value = post.aberr;
  grade.uniforms.uFlash.value = post.flash;
  const slow = A.mode !== 'menu' && S && S.timeScale < 1;
  grade.uniforms.uSat.value += ((slow ? 0.35 : 1) - grade.uniforms.uSat.value) * damp(6, rdt);
  composer.render(rdt);
}
requestAnimationFrame(frame);

// Handy for debugging in the console.
window.NB = { A, NBSim, NBNet, THREE, scene, renderer, composer, bloom, grade, mirror, camera };
