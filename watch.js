// Neon Brawl, watch edition. Same rules (sim.js) and online rooms (net.js) as the full game,
// drawn in software 3D on a 2D canvas (no WebGL, no modules) so it runs on Apple Watch.
(function () {
  'use strict';

  var Sim = window.NBSim, Net = window.NBNet;
  var clamp = Sim.clamp, damp = Sim.damp;
  var $ = function (id) { return document.getElementById(id); };

  var cv = $('c');
  var ctx = cv.getContext('2d');
  var W = 0, H = 0, PAD_H = 46;
  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------- 3x3 rotation math (same Euler order as three.js: XYZ) ----------
  function rx(a) { var c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]; }
  function ry(a) { var c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; }
  function rz(a) { var c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; }
  function mm(A, B) {
    var R = new Array(9);
    for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++)
      R[i * 3 + j] = A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j];
    return R;
  }
  function mv(A, v) {
    return [A[0] * v[0] + A[1] * v[1] + A[2] * v[2], A[3] * v[0] + A[4] * v[1] + A[5] * v[2], A[6] * v[0] + A[7] * v[1] + A[8] * v[2]];
  }
  function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function hexRgb(h) { return [(h >> 16) & 255, (h >> 8) & 255, h & 255]; }
  function rgb(c, k) { return 'rgb(' + Math.round(clamp(c[0] * k, 0, 255)) + ',' + Math.round(clamp(c[1] * k, 0, 255)) + ',' + Math.round(clamp(c[2] * k, 0, 255)) + ')'; }
  function mix(c, w) { return [c[0] + (255 - c[0]) * w, c[1] + (255 - c[1]) * w, c[2] + (255 - c[2]) * w]; }

  var LOOKS = Sim.ROSTER.map(function (r) { return { suit: hexRgb(r.color), trim: hexRgb(r.trim), skin: hexRgb(r.skin) }; });
  var DARK = [36, 32, 54];

  // ---------- App state ----------
  var A = {
    mode: 'menu', // 'menu' | 'local' | 'host' | 'guest'
    S: null, menuS: Sim.createMatch({ slots: [{ kind: 'cpu' }, { kind: 'cpu' }] }),
    me: 0, snap: null, pending: [], sendAcc: 0, lobbyRole: null, lobby: null,
    opts: { fighters: 2, diff: 'normal' }
  };
  A.menuS.events = [];
  var shake = 0;
  var ann = { text: '', sub: '', t: 0, stay: false };
  function announce(text, stay, sub) { ann.text = text; ann.sub = sub || ''; ann.t = 0; ann.stay = !!stay; }

  // ---------- Effects ----------
  var sparks = [], waves = [], flashes = [];
  function burst(x, y, z, col, n, speed) {
    n = Math.min(n, 30);
    for (var i = 0; i < n; i++) {
      var vx = Math.random() - 0.5, vy = Math.random() - 0.3, vz = Math.random() - 0.5;
      var l = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1, s = speed * (0.4 + Math.random()) / l;
      var life = 0.25 + Math.random() * 0.35;
      sparks.push({ p: [x, y, z], v: [vx * s, vy * s, vz * s], life: life, max: life, c: i % 3 === 0 ? [255, 255, 255] : col });
    }
    if (sparks.length > 160) sparks.splice(0, sparks.length - 160);
    flashes.push({ p: [x, y, z], t: 0, max: n >= 40 ? 0.22 : 0.12, size: n >= 40 ? 1.6 : n >= 12 ? 0.8 : 0.45, c: col });
  }
  function runEvent(type, a) {
    if (type === 'burst') burst(a[0], a[1], a[2], hexRgb(a[3]), a[4], a[5]);
    else if (type === 'wave') waves.push({ x: a[0], y: a[1], z: a[2], t: 0, c: hexRgb(a[3]) });
    else if (type === 'shake') shake = Math.max(shake, a * 15);
    else if (type === 'announce') {
      var text = a[0];
      if (/VICTORY/.test(text)) {
        var winner = text.split('\n')[0], mine = A.S && A.S.fighters[A.me] && A.S.fighters[A.me].name;
        text = winner === mine ? 'YOU WIN' : winner + ' WINS';
      } else text = text.replace(/\n/g, ' ');
      announce(text, a[1] === 'stay' || a[1] === 'ko', a[2] || '');
    }
  }
  function drain(S) {
    var ev = S.events;
    S.events = [];
    for (var i = 0; i < ev.length; i++) runEvent(ev[i][0], ev[i][1]);
    return ev;
  }
  function updateFx(dt) {
    for (var i = sparks.length - 1; i >= 0; i--) {
      var s = sparks[i];
      s.life -= dt;
      if (s.life <= 0) { sparks.splice(i, 1); continue; }
      s.v[1] -= 9 * dt;
      s.p[0] += s.v[0] * dt; s.p[1] += s.v[1] * dt; s.p[2] += s.v[2] * dt;
    }
    for (var j = waves.length - 1; j >= 0; j--) { waves[j].t += dt; if (waves[j].t > 0.45) waves.splice(j, 1); }
    for (var k = flashes.length - 1; k >= 0; k--) { flashes[k].t += dt; if (flashes[k].t > flashes[k].max) flashes.splice(k, 1); }
    shake *= Math.exp(-9 * dt);
    ann.t += dt;
  }

  // ---------- Input: on-screen buttons, arena tap, keyboard ----------
  var held = { L: false, R: false };
  var taps = { punch: false, kick: false, jump: false };
  var superBuf = 0; // a SUPER tap is remembered so it fires once your fighter is free
  function bindButton(id, down, up) {
    var el = $(id);
    var on = function (e) { e.preventDefault(); el.classList.add('on'); down(); };
    var off = function (e) { if (e) e.preventDefault(); el.classList.remove('on'); if (up) up(); };
    if (window.PointerEvent) {
      el.addEventListener('pointerdown', on);
      el.addEventListener('pointerup', off);
      el.addEventListener('pointercancel', off);
      el.addEventListener('pointerleave', off);
    } else {
      el.addEventListener('touchstart', on);
      el.addEventListener('touchend', off);
      el.addEventListener('touchcancel', off);
      el.addEventListener('mousedown', on);
      el.addEventListener('mouseup', off);
    }
  }
  bindButton('bL', function () { held.L = true; }, function () { held.L = false; });
  bindButton('bR', function () { held.R = true; }, function () { held.R = false; });
  bindButton('bP', function () { taps.punch = true; });
  bindButton('bK', function () { taps.kick = true; });
  bindButton('bS', function () { superBuf = 0.5; });
  var superBtn = $('bS'), overEl = $('over');

  cv.addEventListener(window.PointerEvent ? 'pointerdown' : 'touchstart', function (e) {
    if (A.mode === 'menu' || !A.S || A.S.phase === 'over') return;
    e.preventDefault();
    taps.jump = true;
  });
  document.addEventListener('touchmove', function (e) { if (A.mode !== 'menu') e.preventDefault(); }, { passive: false });

  var keys = {};
  window.addEventListener('keydown', function (e) {
    if (e.repeat || (e.target && e.target.tagName === 'INPUT')) return;
    var c = e.code || e.key;
    keys[c] = true;
    if (c === 'KeyJ' || c === 'KeyZ') taps.punch = true;
    if (c === 'KeyK' || c === 'KeyX') taps.kick = true;
    if (c === 'Space' || c === 'KeyW' || c === 'ArrowUp') taps.jump = true;
    if (c === 'KeyU') superBuf = 0.5;
  });
  window.addEventListener('keyup', function (e) { keys[e.code || e.key] = false; });

  // ◀ / ▶ walk toward or away from the nearest opponent, whichever side of the screen they're on.
  // Holding "away" while someone nearby is attacking blocks.
  function readInput(S) {
    var me = S.fighters[A.me];
    var l = held.L || keys.ArrowLeft || keys.KeyA, r = held.R || keys.ArrowRight || keys.KeyD;
    var s = (r ? 1 : 0) - (l ? 1 : 0);
    var inp = { mx: 0, mz: 0, block: false, jump: taps.jump, punch: false, kick: false, super: false };
    var t = Sim.nearest(S, me);
    if (s && t && basis) {
      var dx = t.x - me.x, dz = t.z - me.z, d = Math.sqrt(dx * dx + dz * dz) || 1;
      var ux = dx / d, uz = dz / d;
      var onRight = ux * basis.r[0] + uz * basis.r[2] >= 0;
      if ((s > 0) === onRight) { inp.mx = ux; inp.mz = uz; }
      else {
        var threat = S.fighters.some(function (o) {
          return o !== me && o.attacking && o.state !== 'ko' && Math.sqrt((o.x - me.x) * (o.x - me.x) + (o.z - me.z) * (o.z - me.z)) < 2.6;
        });
        if (threat) inp.block = true;
        else { inp.mx = -ux; inp.mz = -uz; }
      }
    } else if (s && basis) { inp.mx = basis.r[0] * s; inp.mz = basis.r[2] * s; }
    if (me.meter < 100) superBuf = 0;
    inp.super = superBuf > 0;
    inp.punch = taps.punch && !inp.super;
    inp.kick = taps.kick && !inp.super;
    return inp;
  }

  // ---------- Screens ----------
  var DIFF_LABEL = { easy: 'Easy', normal: 'Normal', hard: 'Hard' };
  function show(id) {
    ['menu', 'lobby'].forEach(function (x) { $(x).hidden = x !== id; });
    $('pad').hidden = id !== 'game';
    if (id !== 'game') { superBtn.hidden = true; overEl.hidden = true; }
    syncScroll();
  }
  // Let the page scroll (with the Digital Crown or a finger) while a menu screen is up.
  function syncScroll() {
    var on = !$('menu').hidden || !$('lobby').hidden || !overEl.hidden;
    var root = document.documentElement;
    if (root.classList.contains('scroll') !== on) { root.classList.toggle('scroll', on); window.scrollTo(0, 0); }
  }
  function netMsg(t) { $('netMsg').textContent = t; $('lbNote').textContent = t; }

  function beginMatch(mode, S, me) {
    A.mode = mode; A.S = S; A.me = me; A.snap = null; A.pending = []; A.sendAcc = 0;
    ann.text = ''; superBuf = 0;
    show('game');
    if (mode !== 'guest') A.pending = drain(S);
  }
  function startLocal() {
    Net.close();
    netMsg('');
    var slots = [{ kind: 'local', label: 'YOU' }];
    while (slots.length < A.opts.fighters) slots.push({ kind: 'cpu', label: 'CPU' });
    beginMatch('local', Sim.createMatch({ slots: slots, diff: A.opts.diff, profile: 'watch', roundTime: 60 }), 0);
  }
  function hostStart() {
    var guests = Net.guestCount();
    var n = Math.min(4, Math.max(A.opts.fighters, guests + 1));
    var slots = [{ kind: 'local', label: 'P1' }];
    for (var i = 0; i < guests; i++) slots.push({ kind: 'remote', label: 'P' + (i + 2) });
    while (slots.length < n) slots.push({ kind: 'cpu', label: 'CPU' });
    var S = Sim.createMatch({ slots: slots, diff: A.opts.diff, profile: 'watch', roundTime: 60 });
    Net.startMatch(slots, { roundTime: 60, profile: 'watch' });
    beginMatch('host', S, 0);
  }
  function guestStart(msg) {
    var S = Sim.createMatch({ slots: msg.slots, roundTime: msg.roundTime, profile: msg.profile });
    S.events = []; // the host sends its own announcements
    beginMatch('guest', S, msg.you);
  }
  function toMenu() {
    A.mode = 'menu'; A.S = null; A.lobbyRole = null; ann.text = '';
    show('menu');
  }
  function leave() { Net.close(); toMenu(); netMsg(''); }

  function renderLobby() {
    if (!A.lobbyRole) return;
    var host = A.lobbyRole === 'host', info = A.lobby;
    $('lbRole').textContent = host ? 'Hosting' : 'Joined';
    $('lbCode').textContent = (info && info.code) || '·····'; // only once the room is actually open
    $('lbHelp').textContent = host ? 'Share this code. Friends join from a computer or watch.' : 'Waiting for the host to start.';
    var players = (info && info.players) || (host ? ['watch'] : []);
    var you = host ? 0 : (info ? info.you : -1);
    var n = Math.min(4, Math.max(A.opts.fighters, players.length));
    var html = '';
    for (var i = 0; i < (host ? n : players.length); i++) {
      var who = i < players.length ? (players[i] === 'watch' ? 'watch' : 'computer') + (i === you ? ' · you' : '') : 'CPU';
      html += '<li><span style="color:' + rgb(LOOKS[i].suit, 1) + '">' + Sim.ROSTER[i].name + '</span> <small>' + who + '</small></li>';
    }
    $('lbList').innerHTML = html;
    $('lbFighters').hidden = !host;
    $('lbFighters').textContent = 'Fighters: ' + A.opts.fighters;
    $('lbStart').hidden = !host;
    $('lbStart').disabled = players.length < 2;
    if (host) $('lbNote').textContent = players.length < 2 ? (info ? 'Waiting for someone to join…' : 'Opening a room…') : '';
  }
  function showLobby(role) { A.lobbyRole = role; A.lobby = null; show('lobby'); renderLobby(); }

  Net.h = {
    status: function (t) { netMsg(t); },
    lobby: function (info) { A.lobby = info; renderLobby(); },
    joined: function () { netMsg(''); showLobby('guest'); },
    start: guestStart,
    snap: function (msg) {
      if (A.mode !== 'guest') return;
      A.snap = msg;
      for (var i = 0; i < msg.e.length; i++) runEvent(msg.e[i][0], msg.e[i][1]);
    },
    rematch: function () { if (A.mode === 'host' && A.S && A.S.phase === 'over') hostStart(); },
    left: function (fidx) {
      var f = A.mode === 'host' && A.S && A.S.fighters[fidx];
      if (f) { f.kind = 'cpu'; f.label = 'CPU'; }
    },
    closed: function (t) { toMenu(); netMsg(t); }
  };

  $('go').addEventListener('click', startLocal);
  function cycleFighters() {
    A.opts.fighters = A.opts.fighters >= 4 ? 2 : A.opts.fighters + 1;
    $('fighters').textContent = 'Fighters: ' + A.opts.fighters;
    renderLobby();
  }
  $('fighters').addEventListener('click', cycleFighters);
  $('lbFighters').addEventListener('click', cycleFighters);
  $('diff').addEventListener('click', function () {
    A.opts.diff = A.opts.diff === 'easy' ? 'normal' : A.opts.diff === 'normal' ? 'hard' : 'easy';
    this.textContent = 'CPU: ' + DIFF_LABEL[A.opts.diff];
  });
  $('host').addEventListener('click', function () { showLobby('host'); Net.host('watch'); });
  $('joinForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var inp = $('code');
    inp.blur();
    Net.join(inp.value, 'watch');
  });
  $('lbStart').addEventListener('click', hostStart);
  $('lbLeave').addEventListener('click', leave);
  bindButton('bAgain', function () {
    if (A.mode === 'local') { Sim.rematch(A.S); ann.text = ''; }
    else if (A.mode === 'host') hostStart();
    else Net.requestRematch();
  });
  bindButton('bLeave', leave);

  // ---------- Camera and projection ----------
  var cam = { x: 0, y: 2.1, z: 6.5, tx: 0, ty: 1.0, tz: 0 };
  var camSide = [0, 0, 1];
  var basis = null, FOCAL = 1, CX = 0, CY = 0;
  function updateCamera(S, dt) {
    if (!S) {
      var t = Date.now() / 1000;
      cam.x = Math.sin(t * 0.25) * 4; cam.z = 6.5 + Math.cos(t * 0.25) * 0.8; cam.y = 2.1; cam.tx = 0; cam.tz = 0;
      camSide = [0, 0, 1];
    } else {
      var F = S.fighters.filter(function (f) { return f.state !== 'ko'; });
      if (F.length < 2) F = S.fighters;
      var mx = 0, mz = 0, spread = 0, maxY = 0, i;
      for (i = 0; i < F.length; i++) { mx += F[i].x / F.length; mz += F[i].z / F.length; }
      for (i = 0; i < F.length; i++) {
        spread = Math.max(spread, Math.sqrt((F[i].x - mx) * (F[i].x - mx) + (F[i].z - mz) * (F[i].z - mz)));
        maxY = Math.max(maxY, F[i].y);
      }
      if (F.length === 2) {
        // Side-on view of the fight; stays on the same side if the fighters swap places.
        var dx = F[1].x - F[0].x, dz = F[1].z - F[0].z, sep = Math.sqrt(dx * dx + dz * dz) || 1;
        var px = -dz / sep, pz = dx / sep;
        if (px * camSide[0] + pz * camSide[2] < 0) { px = -px; pz = -pz; }
        var ks = damp(4, dt);
        camSide[0] += (px - camSide[0]) * ks; camSide[2] += (pz - camSide[2]) * ks;
        var sl = Math.sqrt(camSide[0] * camSide[0] + camSide[2] * camSide[2]) || 1;
        camSide[0] /= sl; camSide[2] /= sl;
      }
      var dist = clamp(4.4 + spread * 1.8, 5.2, 12), k = damp(6, dt);
      cam.x += (mx + camSide[0] * dist - cam.x) * k;
      cam.z += (mz + camSide[2] * dist - cam.z) * k;
      cam.y += (2.0 + spread * 0.2 + maxY * 0.3 - cam.y) * k;
      cam.tx += (mx - cam.tx) * k;
      cam.tz += (mz - cam.tz) * k;
    }
    var fx = cam.tx - cam.x, fy = cam.ty - cam.y, fz = cam.tz - cam.z;
    var fl = Math.sqrt(fx * fx + fy * fy + fz * fz); fx /= fl; fy /= fl; fz /= fl;
    var rxv = -fz, rzv = fx, rl = Math.sqrt(rxv * rxv + rzv * rzv); rxv /= rl; rzv /= rl;
    var ux = -rzv * fy, uy = rzv * fx - rxv * fz, uz = rxv * fy; // up = right x forward
    basis = { f: [fx, fy, fz], r: [rxv, 0, rzv], u: [ux, uy, uz] };
    var viewH = H - PAD_H;
    FOCAL = Math.min((viewH / 2) / Math.tan(22 * Math.PI / 180), W * 1.1);
    CX = W / 2; CY = viewH * 0.55;
  }
  function project(p) {
    var dx = p[0] - cam.x, dy = p[1] - cam.y, dz = p[2] - cam.z;
    var z = dx * basis.f[0] + dy * basis.f[1] + dz * basis.f[2];
    if (z < 0.1) return null;
    var x = dx * basis.r[0] + dz * basis.r[2];
    var y = dx * basis.u[0] + dy * basis.u[1] + dz * basis.u[2];
    return { x: CX + x * FOCAL / z, y: CY - y * FOCAL / z, z: z };
  }

  // ---------- Skeleton → segments ----------
  function segments(f, out) {
    var p = f.pose, L = LOOKS[f.idx];
    var flash = Math.max(0, f.flash) / 0.12;
    var suit = mix(L.suit, flash), glove = f.meter >= 100 ? mix(L.suit, 0.35 + 0.3 * Math.sin(f.clock * 12)) : L.suit;
    var R0 = mm(ry(f.yaw), rx(f.bodyRx)), O = [f.x, f.y + f.bodyY, f.z];
    function child(R, o, off, rot) { return { R: rot ? mm(R, rot) : R, o: add(o, mv(R, off)) }; }
    function at(j, off) { return add(j.o, mv(j.R, off)); }
    var hips = child(R0, O, [0, 1 + p.hy, 0]);
    var spine = child(hips.R, hips.o, [0, 0.06, 0], mm(rx(p.sx), ry(p.sy)));
    var neck = child(spine.R, spine.o, [0, 0.6, 0], mm(rx(p.nx), ry(-p.sy * 0.6)));
    var center = project([f.x, f.y + 1, f.z]);
    function seg(a, b, r, col) { out.push({ a: a, b: b, r: r, c: col, cz: center ? center.z : 0 }); }
    seg(hips.o, at(spine, [0, 0.42, 0]), 0.21, suit);
    seg(at(spine, [0.2, 0.03, 0]), at(spine, [-0.2, 0.03, 0]), 0.045, L.trim);
    seg(at(neck, [0, 0.14, 0]), at(neck, [0, 0.14, 0]), 0.16, L.skin);
    seg(at(neck, [0.09, 0.16, 0.14]), at(neck, [-0.09, 0.16, 0.14]), 0.035, L.trim);
    function arm(side, sx, sz, ex) {
      var sh = child(spine.R, spine.o, [0.3 * side, 0.5, 0], mm(rx(sx), rz(sz)));
      var el = child(sh.R, sh.o, [0, -0.3, 0], rx(ex));
      var fist = at(el, [0, -0.3, 0]);
      seg(sh.o, el.o, 0.075, suit); seg(el.o, fist, 0.06, L.skin); seg(fist, fist, 0.09, glove);
    }
    function leg(side, hx, hz, kx) {
      var hp = child(hips.R, hips.o, [0.12 * side, -0.06, 0], mm(rx(hx), rz(hz)));
      var kn = child(hp.R, hp.o, [0, -0.46, 0], rx(kx));
      var ft = at(kn, [0, -0.44, 0]);
      seg(hp.o, kn.o, 0.095, DARK); seg(kn.o, ft, 0.08, suit); seg(ft, at(kn, [0, -0.47, 0.16]), 0.06, DARK);
    }
    arm(1, p.lsx, p.lsz, p.lex); arm(-1, p.rsx, p.rsz, p.rex);
    leg(1, p.lhx, p.lhz, p.lkx); leg(-1, p.rhx, p.rhz, p.rkx);
  }

  // ---------- Drawing ----------
  function ringPath(r, cx, cz, n) {
    ctx.beginPath();
    var first = true;
    n = n || 48;
    for (var i = 0; i <= n; i++) {
      var a = i / n * Math.PI * 2, q = project([(cx || 0) + Math.cos(a) * r, 0, (cz || 0) + Math.sin(a) * r]);
      if (!q) { first = true; continue; }
      if (first) { ctx.moveTo(q.x, q.y); first = false; } else ctx.lineTo(q.x, q.y);
    }
  }
  // Neon line: a wide faint stroke under a thin bright one reads as a glow, without costly blur.
  function neon(col, w) {
    ctx.strokeStyle = col; ctx.globalAlpha = 0.25; ctx.lineWidth = w * 4; ctx.stroke();
    ctx.globalAlpha = 1; ctx.lineWidth = w; ctx.stroke();
  }
  function drawArena() {
    var viewH = H - PAD_H;
    // Horizon height on screen, from the camera's tilt.
    var fl = Math.sqrt(basis.f[0] * basis.f[0] + basis.f[2] * basis.f[2]) || 1;
    var hy = clamp(CY - FOCAL * (basis.f[0] * basis.u[0] + basis.f[2] * basis.u[2]) / (fl * fl), -viewH, viewH * 2);
    var g = ctx.createLinearGradient(0, 0, 0, viewH);
    g.addColorStop(0, '#040309'); g.addColorStop(clamp(hy / viewH, 0.05, 0.95), '#2a0f3a'); g.addColorStop(1, '#07060f');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    var hg = ctx.createLinearGradient(0, hy - 26, 0, hy + 6);
    hg.addColorStop(0, 'rgba(255,45,111,0)'); hg.addColorStop(0.7, 'rgba(255,45,111,0.22)'); hg.addColorStop(1, 'rgba(45,226,255,0.12)');
    ctx.fillStyle = hg;
    ctx.fillRect(0, hy - 26, W, 32);
    ctx.lineCap = 'round';
    for (var i = 0; i < 10; i++) {
      var a = i / 10 * Math.PI * 2, px = Math.cos(a) * 14, pz = Math.sin(a) * 14;
      var b = project([px, 0, pz]), t = project([px, 7, pz]);
      if (!b || !t) continue;
      ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(t.x, t.y);
      neon(i % 2 ? '#2de2ff' : '#ff2d6f', Math.max(1, 0.08 * FOCAL / b.z));
    }
    // Floor with a soft spotlight in the middle.
    var c = project([0, 0, 0]);
    ringPath(9.2);
    ctx.fillStyle = '#100d22';
    ctx.fill();
    if (c) {
      var rr = 9.2 * FOCAL / c.z;
      var fg = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, rr);
      fg.addColorStop(0, 'rgba(120,90,220,0.35)'); fg.addColorStop(0.5, 'rgba(70,50,150,0.15)'); fg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = fg;
      ctx.fill();
    }
    ringPath(9.2); neon('#ff2d6f', 1.5);
    ringPath(6); ctx.strokeStyle = 'rgba(45,226,255,0.4)'; ctx.lineWidth = 1; ctx.stroke();
    ringPath(1.8); ctx.strokeStyle = 'rgba(255,209,102,0.5)'; ctx.lineWidth = 1; ctx.stroke();
  }

  function strokeSegs(drawn, shine) {
    for (var j = 0; j < drawn.length; j++) {
      var d = drawn[j], w = Math.max(1, 2 * d.r * FOCAL / d.z);
      var bx = d.B.x + (d.A.x === d.B.x && d.A.y === d.B.y ? 0.01 : 0);
      ctx.strokeStyle = rgb(d.c, clamp(1 - (d.z - d.cz) * 1.1, 0.55, 1.15));
      ctx.lineWidth = w;
      ctx.beginPath(); ctx.moveTo(d.A.x, d.A.y); ctx.lineTo(bx, d.B.y); ctx.stroke();
      // Highlight along the top edge so limbs look round.
      if (shine && w > 3) {
        var o = w * 0.22;
        ctx.strokeStyle = rgb(mix(d.c, 0.5), 1);
        ctx.globalAlpha = 0.55;
        ctx.lineWidth = w * 0.3;
        ctx.beginPath(); ctx.moveTo(d.A.x - o * 0.4, d.A.y - o); ctx.lineTo(bx - o * 0.4, d.B.y - o); ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
  }
  function projectSegs(segs, flip) {
    var drawn = [];
    for (var i = 0; i < segs.length; i++) {
      var q = segs[i];
      var P1 = project(flip ? [q.a[0], -q.a[1], q.a[2]] : q.a), P2 = project(flip ? [q.b[0], -q.b[1], q.b[2]] : q.b);
      if (!P1 || !P2) continue;
      drawn.push({ A: P1, B: P2, z: (P1.z + P2.z) / 2, r: q.r, c: q.c, cz: q.cz });
    }
    drawn.sort(function (a, b) { return b.z - a.z; });
    return drawn;
  }
  function drawFighters(S) {
    var segs = [], i;
    for (i = 0; i < S.fighters.length; i++) segments(S.fighters[i], segs);
    ctx.lineCap = 'round';
    // Faint mirror image in the glossy floor, clipped to the ring.
    ctx.save();
    ringPath(9.2);
    ctx.clip();
    ctx.globalAlpha = 0.16;
    strokeSegs(projectSegs(segs, true), false);
    ctx.restore();
    ctx.globalAlpha = 1;
    for (i = 0; i < S.fighters.length; i++) {
      var f = S.fighters[i], c = project([f.x, 0, f.z]);
      if (!c) continue;
      var sc = FOCAL / c.z, col = LOOKS[f.idx].suit;
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, 0.45 * sc / (1 + f.y * 0.4), 0.1 * sc, 0, 0, Math.PI * 2);
      ctx.fill();
      // Coloured ring under each fighter; brighter when the super is ready.
      ctx.strokeStyle = rgb(col, 1);
      ctx.globalAlpha = f.state === 'ko' ? 0.15 : f.meter >= 100 ? 0.6 + 0.3 * Math.sin(f.clock * 12) : 0.4;
      ctx.lineWidth = Math.max(1, 0.05 * sc);
      ringPath(0.6, f.x, f.z, 20);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    strokeSegs(projectSegs(segs, false), true);
    // Marker over your own fighter.
    if (A.mode !== 'menu') {
      var me = S.fighters[A.me], m = me && me.state !== 'ko' && project([me.x, me.y + 2.05, me.z]);
      if (m) {
        ctx.fillStyle = rgb(LOOKS[me.idx].suit, 1);
        ctx.beginPath(); ctx.moveTo(m.x - 5, m.y - 6); ctx.lineTo(m.x + 5, m.y - 6); ctx.lineTo(m.x, m.y); ctx.fill();
      }
    }
  }

  function drawFx() {
    ctx.globalCompositeOperation = 'lighter';
    for (var k = 0; k < flashes.length; k++) {
      var fl = flashes[k], fc = project(fl.p);
      if (!fc) continue;
      var kk = fl.t / fl.max, rad = fl.size * (0.5 + kk) * FOCAL / fc.z;
      var gr = ctx.createRadialGradient(fc.x, fc.y, 0, fc.x, fc.y, rad);
      gr.addColorStop(0, 'rgba(255,255,255,' + (1 - kk) + ')');
      gr.addColorStop(0.3, 'rgba(' + fl.c.join(',') + ',' + 0.6 * (1 - kk) + ')');
      gr.addColorStop(1, 'rgba(' + fl.c.join(',') + ',0)');
      ctx.fillStyle = gr;
      ctx.fillRect(fc.x - rad, fc.y - rad, rad * 2, rad * 2);
    }
    ctx.lineCap = 'round';
    for (var i = 0; i < sparks.length; i++) {
      var s = sparks[i], q = project(s.p), e = project([s.p[0] - s.v[0] * 0.03, s.p[1] - s.v[1] * 0.03, s.p[2] - s.v[2] * 0.03]);
      if (!q || !e) continue;
      ctx.strokeStyle = rgb(s.c, 1);
      ctx.lineWidth = Math.max(1, 0.05 * FOCAL / q.z * (s.life / s.max));
      ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(q.x + 0.01, q.y); ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    for (var j = 0; j < waves.length; j++) {
      var w = waves[j], c = project([w.x, w.y, w.z]);
      if (!c) continue;
      var k = w.t / 0.45;
      ctx.strokeStyle = rgb(w.c, 1);
      ctx.globalAlpha = 1 - k;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(c.x, c.y, (0.3 + k * 3) * FOCAL / c.z * 0.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  function bar(x, y, w, h, frac, col) {
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = col;
    ctx.fillRect(x, y, w * clamp(frac, 0, 1), h);
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  }
  // Two fighters: bars either side of the timer. Three or four: timer on top, a 2x2 grid below.
  function drawHud(S) {
    var top = Math.max(6, H * 0.03), side = Math.max(10, W * 0.07), n = S.fighters.length;
    var two = n === 2, tw = two ? 26 : 0, gap = two ? 0 : 6;
    var bw = (W - side * 2 - tw - gap) / 2;
    var y0 = two ? top : top + 16;
    ctx.textAlign = 'center';
    ctx.fillStyle = S.timer <= 10 && S.phase === 'fight' ? '#ff2d6f' : '#f1ecff';
    ctx.font = '800 ' + (two ? 16 : 13) + 'px -apple-system, system-ui, sans-serif';
    ctx.fillText(String(Math.ceil(S.timer)), W / 2, two ? top + 20 : top + 11);
    for (var i = 0; i < n; i++) {
      var f = S.fighters[i], col = i % 2, row = Math.floor(i / 2);
      var x = col === 0 ? side : W - side - bw, y = y0 + row * (two ? 0 : 20);
      var name = f.name + (i === A.me && A.mode !== 'menu' ? '·YOU' : '') + (f.wins ? ' ' + new Array(f.wins + 1).join('◆') : '');
      ctx.globalAlpha = f.state === 'ko' && S.phase === 'fight' ? 0.4 : 1;
      ctx.font = '700 ' + (two ? 10 : 8) + 'px -apple-system, system-ui, sans-serif';
      ctx.fillStyle = rgb(LOOKS[i].suit, 1);
      ctx.textAlign = col === 0 ? 'left' : 'right';
      ctx.fillText(name, col === 0 ? x : x + bw, y + (two ? 9 : 7));
      bar(x, y + (two ? 12 : 9), bw, two ? 7 : 5, f.hp / 100, f.hp < 30 ? '#ff3b3b' : '#ffc23d');
      bar(x, y + (two ? 21 : 15), bw * 0.7, 3, f.meter / 100, f.meter >= 100 ? '#ffd166' : rgb(LOOKS[i].suit, 1));
      ctx.globalAlpha = 1;
    }
    var me = S.fighters[A.me];
    if (me && me.combo >= 2 && S.fighters.some(function (o) { return o !== me && o.stun > 0; })) {
      ctx.font = '800 13px -apple-system, system-ui, sans-serif';
      ctx.fillStyle = rgb(LOOKS[me.idx].suit, 1);
      ctx.textAlign = 'center';
      ctx.fillText(me.combo + ' HITS', W / 2, y0 + (two ? 42 : 52));
    }
  }
  function drawAnnounce() {
    if (!ann.text) return;
    var t = ann.t, alpha, scale;
    if (t < 0.15) { scale = 2.2 - (t / 0.15) * 1.2; alpha = t / 0.15; }
    else { scale = 1; alpha = ann.stay ? 1 : clamp(1 - (t - 0.9) / 0.4, 0, 1); }
    if (alpha <= 0) return;
    var viewH = H - PAD_H, size = Math.min(W * 0.17, 40);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(W / 2, viewH * 0.47);
    ctx.scale(scale, scale);
    ctx.textAlign = 'center';
    ctx.font = '900 ' + size + 'px -apple-system, system-ui, sans-serif';
    var tw = ctx.measureText(ann.text).width;
    if (tw > W * 0.9) ctx.font = '900 ' + Math.floor(size * W * 0.9 / tw) + 'px -apple-system, system-ui, sans-serif';
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.strokeText(ann.text, 0, 0);
    ctx.fillStyle = ann.text === 'K.O.' ? '#ffd166' : '#f1ecff';
    ctx.fillText(ann.text, 0, 0);
    if (ann.sub) {
      ctx.font = '700 11px -apple-system, system-ui, sans-serif';
      ctx.fillStyle = '#a69cc8';
      ctx.fillText(ann.sub, 0, 20);
    }
    ctx.restore();
  }

  // ---------- Loop ----------
  var last = 0;
  function frame(ts) {
    window.requestAnimationFrame(frame);
    var rdt = last ? Math.min((ts - last) / 1000, 1 / 20) : 1 / 60;
    last = ts;
    var S = A.S;

    if (A.mode === 'menu') {
      Sim.idle(A.menuS, rdt);
    } else if (A.mode === 'guest') {
      Net.sendInput(readInput(S));
      if (A.snap) Sim.applySnap(S, A.snap, damp(20, rdt), rdt);
    } else {
      var inputs = S.fighters.map(function (f, i) {
        if (i === A.me) return readInput(S);
        if (A.mode === 'host' && f.kind === 'remote') return Net.inputFor(i) || Sim.NONE;
        return Sim.NONE;
      });
      Sim.step(S, rdt, inputs);
      if (A.mode === 'host') Net.consumeInputs();
      var ev = drain(S);
      if (A.mode === 'host') {
        A.pending = A.pending.concat(ev);
        A.sendAcc += rdt;
        if (A.sendAcc >= 1 / 20) { A.sendAcc = 0; Net.sendSnap(Sim.pack(S, A.pending)); A.pending = []; }
      }
    }
    taps.punch = taps.kick = taps.jump = false;
    var me = S && S.fighters[A.me];
    if (superBuf > 0 && me && me.stun <= 0) superBuf -= rdt; // wait out hitstun, then fire

    updateFx(rdt);
    var shown = A.mode === 'menu' ? A.menuS : S;
    updateCamera(A.mode === 'menu' ? null : S, rdt);
    ctx.save();
    if (shake > 0.2) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    drawArena();
    drawFighters(shown);
    drawFx();
    ctx.restore();
    if (A.mode !== 'menu') { drawHud(S); drawAnnounce(); }

    var showSuper = !!me && A.mode !== 'menu' && S.phase === 'fight' && me.meter >= 100 && me.state !== 'ko';
    if (superBtn.hidden === showSuper) superBtn.hidden = !showSuper;
    var showOver = A.mode !== 'menu' && S.phase === 'over';
    if (overEl.hidden === showOver) {
      overEl.hidden = !showOver;
      syncScroll();
      $('bAgain').textContent = A.mode === 'guest' ? 'Ask for rematch' : 'Rematch';
    }
  }
  syncScroll();
  window.requestAnimationFrame(frame);

  window.NBW = { A: A, Sim: Sim, Net: Net };
})();
