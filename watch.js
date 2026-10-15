// Neon Brawl, watch edition: same fighters and rules as the full game, rendered in
// software 3D on a 2D canvas (no WebGL, no modules) so it runs on Apple Watch.
(function () {
  'use strict';

  var cv = document.getElementById('c');
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

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function damp(rate, dt) { return 1 - Math.exp(-rate * dt); }

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

  // ---------- Fighters ----------
  var ROSTER = [
    { name: 'RYKA', suit: [255, 45, 111], trim: [255, 209, 102], skin: [224, 164, 122] },
    { name: 'VOLT', suit: [45, 226, 255], trim: [184, 255, 61], skin: [141, 90, 59] }
  ];
  var DARK = [36, 32, 54];
  var MOVES = {
    jab:   { start: 0.06, active: 0.08, rec: 0.14, dmg: 5,  range: 1.5,  push: 2.4, stun: 0.28, meter: 7,  lunge: 1.6, h: 1.45 },
    cross: { start: 0.08, active: 0.08, rec: 0.18, dmg: 7,  range: 1.55, push: 3.2, stun: 0.32, meter: 8,  lunge: 2.2, h: 1.45 },
    kick:  { start: 0.15, active: 0.1,  rec: 0.28, dmg: 11, range: 1.9,  push: 4.8, stun: 0.42, meter: 12, lunge: 2.6, h: 1.15 },
    super: { start: 0.3,  active: 0.22, rec: 0.45, dmg: 24, range: 2.0,  push: 11,  stun: 0.85, meter: 0,  lunge: 10,  h: 1.3, launch: true }
  };
  var KEYS = ['hy', 'sx', 'sy', 'nx', 'lsx', 'lsz', 'rsx', 'rsz', 'lex', 'rex', 'lhx', 'lhz', 'rhx', 'rhz', 'lkx', 'rkx'];
  var GUARD = { hy: -0.05, sx: 0.12, sy: -0.22, nx: 0, lsx: -1.0, lsz: 0.2, rsx: -1.0, rsz: -0.2, lex: -1.75, rex: -1.75, lhx: -0.35, lhz: 0.06, rhx: 0.3, rhz: -0.06, lkx: 0.45, rkx: 0.1 };
  function P(o) { var p = {}, k; for (k in GUARD) p[k] = GUARD[k]; for (k in o) p[k] = o[k]; return p; }
  var ARENA = 6.2;

  function makeFighter(i) {
    var f = { idx: i, name: ROSTER[i].name, look: ROSTER[i], meter: 0, pose: P({}), clock: Math.random() * 9, walkPh: 0 };
    reset(f, i === 0 ? -2.2 : 2.2);
    return f;
  }
  function reset(f, x) {
    f.x = x; f.y = 0; f.vx = 0; f.vy = 0; f.airV = 0;
    f.face = x < 0 ? 1 : -1; f.yaw = f.face * Math.PI / 2;
    f.hp = 100; f.state = 'idle'; f.atk = null; f.stun = 0; f.combo = 0; f.flash = 0;
    f.lastPunch = 'cross'; f.punchT = 0; f.holdBack = false;
    f.bodyRx = 0; f.bodyY = 0;
  }
  var F = [makeFighter(0), makeFighter(1)];

  // ---------- Game state ----------
  var G = { phase: 'menu', round: 1, wins: [0, 0], timer: 60, phaseT: 0, timeScale: 1, hitstop: 0, winner: -1, flags: {}, diff: 'normal' };
  var shake = 0;
  var ann = { text: '', sub: '', t: 0, stay: false };
  function announce(text, stay, sub) { ann.text = text; ann.sub = sub || ''; ann.t = 0; ann.stay = !!stay; }

  function nextPunch(f) {
    var n = f.punchT > 0 && f.lastPunch === 'jab' ? 'cross' : 'jab';
    f.lastPunch = n; f.punchT = 0.5; return n;
  }
  function startAttack(f, name) {
    f.atk = { name: name, t: 0, hit: false };
    f.state = 'attack';
    if (name === 'super') { f.meter = 0; if (f.idx === 0) superBuf = 0; wave(f.x + f.face * 0.5, 1.3, f.look.suit); }
  }

  function updateFighter(f, dt, inp, o) {
    f.clock += dt; f.punchT -= dt;
    var d = o.x - f.x, dist = Math.abs(d);
    if (dist > 0.05 && f.state !== 'ko') f.face = d > 0 ? 1 : -1;
    var grounded = f.y <= 0 && f.vy <= 0;
    var move = 0;
    if (f.state !== 'ko') f.yaw += (f.face * Math.PI / 2 - f.yaw) * damp(18, dt);
    f.holdBack = grounded && inp.move * f.face < -0.1;

    if (f.state === 'ko' || f.state === 'win') {
      // no control
    } else if (f.stun > 0) {
      f.stun -= dt;
      if (f.stun <= 0) f.state = 'idle';
    } else if (f.atk) {
      var a = f.atk, m = MOVES[a.name];
      a.t += dt;
      if (inp.super && f.meter >= 100 && a.name !== 'super' && (a.t < 0.12 || a.hit)) { startAttack(f, 'super'); a = f.atk; m = MOVES.super; }
      if (!grounded) move = f.airV;
      else if (a.t > m.start * 0.5 && a.t < m.start + m.active && dist > 0.95) move = f.face * m.lunge;
      if (a.t >= m.start && a.t < m.start + m.active && !a.hit && dist < m.range && Math.abs(f.y - o.y) < 1.1 && o.state !== 'ko') {
        a.hit = true;
        resolveHit(f, o, m);
      }
      var recovering = a.t >= m.start + m.active;
      if (a.hit && recovering && a.name !== 'super' && (inp.punch || inp.kick)) startAttack(f, inp.punch ? nextPunch(f) : 'kick');
      else if (a.t >= m.start + m.active + m.rec) { f.atk = null; f.state = 'idle'; }
    } else {
      f.state = 'idle';
      if (inp.super && f.meter >= 100) startAttack(f, 'super');
      else if (inp.punch) startAttack(f, nextPunch(f));
      else if (inp.kick) startAttack(f, 'kick');
      else if (!grounded) move = f.airV;
      else if (f.holdBack && o.atk && dist < 2.6) f.state = 'block';
      else {
        move = inp.move * (f.holdBack ? 2.4 : 3.2);
        if (move) { f.state = 'walk'; f.walkPh += dt * 10 * (f.holdBack ? -1 : 1); }
        if (inp.jump) { f.vy = 7.4; f.airV = move * 1.15; f.state = 'idle'; }
      }
    }

    f.vy -= 22 * dt;
    f.y += f.vy * dt;
    if (f.y <= 0) { f.y = 0; f.vy = 0; }
    f.x += (move + f.vx) * dt;
    f.vx *= Math.exp(-(f.y > 0 ? 0.6 : 7) * dt);
    f.x = clamp(f.x, -ARENA, ARENA);
    animate(f, dt);
  }

  function resolveHit(att, def, m) {
    var blocked = (def.holdBack || def.state === 'block') && !def.atk && def.stun <= 0 && def.y <= 0;
    var dmg = m.dmg * (att.idx === 1 ? DIFF[G.diff].dmg : 1); // CPU hits softer on lower levels
    if (blocked) dmg *= m === MOVES.super ? 0.35 : 0.1;
    else {
      att.combo = def.stun > 0 ? att.combo + 1 : 1;
      dmg *= Math.max(0.5, 1 - (att.combo - 1) * 0.08);
    }
    def.hp = Math.max(0, def.hp - dmg);
    att.meter = Math.min(100, att.meter + m.meter * (blocked ? 0.4 : 1));
    def.meter = Math.min(100, def.meter + dmg * 0.5);
    def.vx = att.face * m.push * (blocked ? 0.55 : 1);
    var hx = att.x + (def.x - att.x) * 0.7, hy = Math.max(att.y, def.y) + m.h;
    if (blocked) {
      def.state = 'block';
      burst(hx, hy, [159, 232, 255], 8, 4);
      G.hitstop = 0.035;
    } else {
      def.flash = 0.12;
      // A super in progress can't be interrupted: the defender takes the damage but keeps attacking.
      if (!(def.atk && def.atk.name === 'super')) { def.stun = m.stun; def.atk = null; def.state = 'hit'; }
      if (m.launch || def.hp <= 0) def.vy = 6.2;
      var big = m === MOVES.super;
      burst(hx, hy, att.look.suit, big ? 36 : m === MOVES.kick ? 18 : 12, big ? 9 : 6);
      shake = Math.max(shake, big ? 7 : m === MOVES.kick ? 3.5 : 2);
      G.hitstop = big ? 0.18 : m === MOVES.kick ? 0.08 : 0.055;
    }
    if (def.hp <= 0) {
      def.state = 'ko'; def.stun = 0; def.atk = null;
      G.wins[att.idx]++; G.winner = att.idx;
      G.phase = 'ko'; G.phaseT = 0; G.timeScale = 0.3; G.flags = {};
      shake = 8;
      announce('K.O.', true);
    }
  }

  function attackPose(a) {
    var m = MOVES[a.name], t = a.t;
    var out = t >= m.start * 0.6 && t < m.start + m.active + m.rec * 0.35;
    switch (a.name) {
      case 'jab': return out ? P({ sy: -0.6, lsx: -1.57, lsz: 0.04, lex: -0.05, rsx: -1.15, hy: -0.07, sx: 0.2 }) : P({ sy: -0.1 });
      case 'cross': return out ? P({ sy: 0.6, rsx: -1.57, rsz: -0.04, rex: -0.05, lsx: -1.15, hy: -0.08, sx: 0.22, rhx: 0.45, rkx: 0.25 }) : P({ sy: -0.45 });
      case 'kick':
        if (t < m.start) return P({ rhx: -1.5, rkx: 1.9, sx: -0.1, lkx: 0.3, lhx: -0.1 });
        if (out) return P({ rhx: -1.6, rkx: 0.05, sx: -0.35, lhx: 0.05, lkx: 0.25, lsx: -0.7, rsx: -0.6, rsz: -0.5, sy: 0.25 });
        return P({});
      default:
        if (t < m.start) return P({ sy: 0.7, lsx: -0.3, rsx: 0.5, lex: -1.3, rex: -1.3, hy: -0.2, lkx: 0.9, rkx: 0.7, lhx: -0.5, rhx: 0.2 });
        if (out) return P({ sy: 0, sx: 0.3, lsx: -1.55, rsx: -1.55, lsz: -0.12, rsz: 0.12, lex: 0, rex: 0, hy: -0.16, lhx: -0.7, lkx: 0.8, rhx: 0.6, rkx: 0.1 });
        return P({});
    }
  }

  function animate(f, dt) {
    var t = f.clock, tg, rate = 14;
    if (f.state === 'ko') {
      tg = P({ hy: 0, sx: -0.3, sy: 0, nx: -0.4, lsx: -2.6, lsz: 0.9, rsx: -2.6, rsz: -0.9, lex: 0, rex: 0, lhx: -0.2, rhx: -0.1, lkx: 0.3, rkx: 0.1 });
      var k = damp(f.y > 0 ? 4 : 7, dt);
      f.bodyRx += (-1.5 - f.bodyRx) * k;
      f.bodyY += (0.16 - f.bodyY) * k;
    } else if (f.state === 'win') {
      tg = P({ sy: 0, rsx: -2.95, rsz: -0.25, rex: -0.15, lsx: -0.9, hy: -0.03 + Math.abs(Math.sin(t * 5)) * 0.05, nx: -0.2 });
    } else if (f.stun > 0) {
      tg = P({ sx: -0.5, nx: -0.4, lsx: -0.4, lsz: 0.7, rsx: -0.4, rsz: -0.7, lex: -0.6, rex: -0.6, hy: -0.08, lkx: 0.6, rkx: 0.5 }); rate = 26;
    } else if (f.atk) {
      tg = attackPose(f.atk); rate = 38;
    } else if (f.y > 0) {
      tg = P({ lhx: -1.1, lkx: 1.7, rhx: -0.5, rkx: 1.5, sx: 0.25, lsx: -1.3, rsx: -1.3 });
    } else if (f.state === 'block') {
      tg = P({ sx: 0.3, sy: 0, nx: 0.2, lsx: -1.45, lsz: -0.35, lex: -2.0, rsx: -1.45, rsz: 0.35, rex: -2.0, hy: -0.13, lhx: -0.55, lkx: 0.8, rhx: 0.15, rkx: 0.45 }); rate = 30;
    } else if (f.state === 'walk') {
      var s = Math.sin(f.walkPh);
      tg = P({ lhx: -0.35 + s * 0.45, rhx: 0.3 - s * 0.45, lkx: 0.45 + Math.max(0, -s) * 0.6, rkx: 0.15 + Math.max(0, s) * 0.6, hy: -0.06 + Math.abs(Math.cos(f.walkPh)) * 0.03 });
    } else {
      var b = Math.sin(t * 3.2);
      tg = P({ hy: -0.05 + b * 0.015, sx: 0.12 + b * 0.02, lsx: -1.0 + b * 0.05, rsx: -1.0 - b * 0.05 });
    }
    var a = damp(rate, dt);
    for (var i = 0; i < KEYS.length; i++) f.pose[KEYS[i]] += (tg[KEYS[i]] - f.pose[KEYS[i]]) * a;
    if (f.flash > 0) f.flash -= dt;
  }

  function separate(a, b) {
    var d = b.x - a.x;
    if (Math.abs(d) < 0.8 && Math.abs(a.y - b.y) < 1.3 && a.state !== 'ko' && b.state !== 'ko') {
      var s = d >= 0 ? 1 : -1, push = (0.8 - Math.abs(d)) / 2;
      a.x -= s * push; b.x += s * push;
    }
  }

  // ---------- CPU ----------
  var DIFF = {
    // Tuned gentler than the desktop CPU: watch controls are slower to use.
    easy: { react: 0.05, aggr: 0.2, think: 0.8, combo: 0, dmg: 0.6, label: 'Easy' },
    normal: { react: 0.2, aggr: 0.4, think: 0.5, combo: 0.2, dmg: 0.8, label: 'Normal' },
    hard: { react: 0.45, aggr: 0.65, think: 0.28, combo: 0.5, dmg: 1, label: 'Hard' }
  };
  var ai = { t: 0, act: 'approach', rolled: false, blocking: false, blockT: 0 };
  function cpuInput(me, opp, dt) {
    var df = DIFF[G.diff], inp = { move: 0, jump: false, punch: false, kick: false, super: false };
    var d = Math.abs(opp.x - me.x);
    if (opp.atk && d < 2.4) {
      if (!ai.rolled) { ai.rolled = true; ai.blocking = Math.random() < df.react; ai.blockT = 0.4; }
    } else ai.rolled = false;
    if (ai.blockT > 0) {
      ai.blockT -= dt;
      if (ai.blocking && !me.atk) { inp.move = -me.face; return inp; }
    }
    if (me.atk && me.atk.hit && Math.random() < df.combo * dt * 12) { if (Math.random() < 0.65) inp.punch = true; else inp.kick = true; }
    ai.t -= dt;
    var fresh = false;
    if (ai.t <= 0) {
      ai.t = df.think * (0.5 + Math.random()); fresh = true;
      var r = Math.random();
      if (me.meter >= 100 && d < 2.2 && r < 0.5) ai.act = 'super';
      else if (d > 2.3) ai.act = r < 0.1 ? 'jumpin' : 'approach';
      else if (d > 1.6) ai.act = r < df.aggr * 0.6 ? 'kick' : r < 0.78 ? 'approach' : 'retreat';
      else ai.act = r < df.aggr * 0.55 ? 'punch' : r < df.aggr * 0.85 ? 'kick' : r < 0.88 ? 'retreat' : 'jump';
    }
    switch (ai.act) {
      case 'approach': inp.move = me.face; break;
      case 'retreat': inp.move = -me.face; break;
      case 'jumpin': inp.move = me.face; inp.jump = fresh; if (me.y > 1 && !me.atk) inp.kick = true; break;
      case 'jump': inp.jump = fresh; break;
      case 'punch': inp.punch = fresh; break;
      case 'kick': inp.kick = fresh; break;
      case 'super': inp.super = fresh; break;
    }
    return inp;
  }

  // ---------- Player input: on-screen buttons, arena tap, keyboard ----------
  var held = { L: false, R: false };
  var taps = { punch: false, kick: false, jump: false, super: false };
  var lastP = -1, lastK = -1;
  var superBuf = 0; // a SUPER tap is remembered briefly so it fires once the fighter is free
  function now() { return Date.now(); }
  function pressAttack(which) {
    var t = now();
    if (which === 'P') { taps.punch = true; lastP = t; if (t - lastK < 160) taps.super = true; }
    else { taps.kick = true; lastK = t; if (t - lastP < 160) taps.super = true; }
  }
  function bindButton(id, down, up) {
    var el = document.getElementById(id);
    var on = function (e) { e.preventDefault(); el.className = el.className.replace(/ ?on/g, '') + ' on'; down(); };
    var off = function (e) { if (e) e.preventDefault(); el.className = el.className.replace(/ ?on/g, ''); if (up) up(); };
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
  bindButton('bP', function () { pressAttack('P'); });
  bindButton('bK', function () { pressAttack('K'); });
  bindButton('bS', function () { superBuf = 0.5; });
  var superBtn = document.getElementById('bS');

  function onArenaTap(e) {
    if (G.phase === 'menu') return;
    e.preventDefault();
    if (G.phase === 'over') { menuOpen(); return; }
    taps.jump = true;
  }
  cv.addEventListener(window.PointerEvent ? 'pointerdown' : 'touchstart', onArenaTap);
  document.addEventListener('touchmove', function (e) { e.preventDefault(); }, { passive: false });

  var keys = {};
  window.addEventListener('keydown', function (e) {
    if (e.repeat) return;
    var c = e.code || e.key;
    keys[c] = true;
    if (c === 'KeyJ' || c === 'KeyZ') pressAttack('P');
    if (c === 'KeyK' || c === 'KeyX') pressAttack('K');
    if (c === 'Space' || c === 'KeyW' || c === 'ArrowUp') taps.jump = true;
    if (c === 'KeyU') superBuf = 0.5;
    if (c === 'Enter' && G.phase === 'over') menuOpen();
  });
  window.addEventListener('keyup', function (e) { keys[e.code || e.key] = false; });

  function playerInput() {
    var l = held.L || keys.ArrowLeft || keys.KeyA, r = held.R || keys.ArrowRight || keys.KeyD;
    var sup = taps.super || superBuf > 0;
    var inp = { move: (r ? 1 : 0) - (l ? 1 : 0), jump: taps.jump, punch: taps.punch && !sup, kick: taps.kick && !sup, super: sup };
    return inp;
  }
  var NONE = { move: 0, jump: false, punch: false, kick: false, super: false };

  // ---------- Rounds ----------
  function startRound() {
    reset(F[0], -2.2); reset(F[1], 2.2);
    G.timer = 60; G.phase = 'intro'; G.phaseT = 0; G.timeScale = 1; G.hitstop = 0; G.winner = -1; G.flags = {};
    announce(G.wins[0] === 1 && G.wins[1] === 1 ? 'FINAL' : 'ROUND ' + G.round);
  }
  function startMatch() {
    G.wins = [0, 0]; G.round = 1; F[0].meter = F[1].meter = 0;
    document.getElementById('menu').hidden = true;
    document.getElementById('pad').hidden = false;
    startRound();
  }
  function menuOpen() {
    G.phase = 'menu';
    reset(F[0], -2.2); reset(F[1], 2.2);
    ann.text = '';
    document.getElementById('menu').hidden = false;
    document.getElementById('pad').hidden = true;
  }
  document.getElementById('go').addEventListener('click', startMatch);
  document.getElementById('diff').addEventListener('click', function () {
    G.diff = G.diff === 'easy' ? 'normal' : G.diff === 'normal' ? 'hard' : 'easy';
    this.textContent = 'CPU: ' + DIFF[G.diff].label;
  });

  function step(rdt) {
    var dt = rdt;
    if (G.hitstop > 0) { G.hitstop -= rdt; dt = 0; }
    dt *= G.timeScale;
    G.phaseT += rdt;
    var fighting = G.phase === 'fight';
    var i1 = fighting ? playerInput() : NONE;
    var i2 = fighting ? cpuInput(F[1], F[0], rdt) : NONE;
    updateFighter(F[0], dt, i1, F[1]);
    updateFighter(F[1], dt, i2, F[0]);
    separate(F[0], F[1]);

    if (G.phase === 'intro') {
      if (!G.flags.fight && G.phaseT > 1.2) { G.flags.fight = true; announce('FIGHT!'); }
      if (G.phaseT > 1.7) { G.phase = 'fight'; G.phaseT = 0; }
    } else if (G.phase === 'fight') {
      G.timer -= dt;
      if (G.timer <= 0) {
        G.timer = 0; G.phase = 'ko'; G.phaseT = 0; G.flags = {};
        G.winner = F[0].hp === F[1].hp ? -1 : F[0].hp > F[1].hp ? 0 : 1;
        if (G.winner >= 0) G.wins[G.winner]++;
        announce('TIME', true);
      }
    } else if (G.phase === 'ko') {
      if (G.phaseT > 1.1) G.timeScale = 1;
      if (!G.flags.win && G.phaseT > 1.8) {
        G.flags.win = true;
        var w = F[G.winner];
        if (w && w.state !== 'ko') { w.atk = null; w.stun = 0; w.state = 'win'; }
        var over = G.wins[0] >= 2 || G.wins[1] >= 2;
        if (over) announce(G.winner === 0 ? 'YOU WIN' : 'YOU LOSE', true, 'Tap for menu');
        else announce(w ? w.name + ' WINS' : 'DRAW', true, w && w.hp >= 100 ? 'PERFECT' : '');
      }
      if (G.phaseT > 4) {
        if (G.wins[0] >= 2 || G.wins[1] >= 2) G.phase = 'over';
        else { G.round++; startRound(); }
      }
    }
  }

  // ---------- Effects ----------
  var sparks = [], waves = [];
  function burst(x, y, col, n, speed) {
    for (var i = 0; i < n; i++) {
      var vx = Math.random() - 0.5, vy = Math.random() - 0.3, vz = Math.random() - 0.5;
      var l = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1, s = speed * (0.4 + Math.random()) / l;
      var life = 0.25 + Math.random() * 0.35;
      sparks.push({ p: [x, y, 0], v: [vx * s, vy * s, vz * s], life: life, max: life, c: i % 3 === 0 ? [255, 255, 255] : col });
    }
    if (sparks.length > 160) sparks.splice(0, sparks.length - 160);
  }
  function wave(x, y, col) { waves.push({ x: x, y: y, t: 0, c: col }); }
  function updateFx(dt) {
    for (var i = sparks.length - 1; i >= 0; i--) {
      var s = sparks[i];
      s.life -= dt;
      if (s.life <= 0) { sparks.splice(i, 1); continue; }
      s.v[1] -= 9 * dt;
      s.p[0] += s.v[0] * dt; s.p[1] += s.v[1] * dt; s.p[2] += s.v[2] * dt;
    }
    for (var j = waves.length - 1; j >= 0; j--) { waves[j].t += dt; if (waves[j].t > 0.45) waves.splice(j, 1); }
    shake *= Math.exp(-9 * dt);
    ann.t += dt;
  }

  // ---------- Camera and projection ----------
  var cam = { x: 0, y: 2.1, z: 6.5, tx: 0, ty: 1.0, tz: 0 };
  var basis = null, FOCAL = 1, CX = 0, CY = 0;
  function updateCamera(dt) {
    var mid, sep;
    if (G.phase === 'menu') {
      var t = Date.now() / 1000;
      cam.x = Math.sin(t * 0.25) * 4; cam.z = 6.5 + Math.cos(t * 0.25) * 0.8; cam.tx = 0;
    } else {
      mid = (F[0].x + F[1].x) / 2; sep = Math.abs(F[0].x - F[1].x);
      var k = damp(6, dt);
      cam.x += (mid - cam.x) * k;
      cam.tx += (mid - cam.tx) * k;
      cam.z += (clamp(4.4 + sep * 0.9, 5.2, 9) - cam.z) * k;
      cam.y += (2.0 + Math.max(F[0].y, F[1].y) * 0.3 - cam.y) * k;
    }
    var fx = cam.tx - cam.x, fy = cam.ty - cam.y, fz = cam.tz - cam.z;
    var fl = Math.sqrt(fx * fx + fy * fy + fz * fz); fx /= fl; fy /= fl; fz /= fl;
    var rxv = -fz, rzv = fx, rl = Math.sqrt(rxv * rxv + rzv * rzv); rxv /= rl; rzv /= rl;
    // up = right x forward
    var ux = -rzv * fy, uy = rzv * fx - rxv * fz, uz = rxv * fy;
    basis = { f: [fx, fy, fz], r: [rxv, 0, rzv], u: [ux, uy, uz] };
    var viewH = H - PAD_H;
    FOCAL = (viewH / 2) / Math.tan(22 * Math.PI / 180);
    FOCAL = Math.min(FOCAL, W * 1.1); // keep both fighters in frame on narrow screens
    CX = W / 2; CY = viewH * 0.52;
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
  function rgb(c, k) { return 'rgb(' + Math.round(clamp(c[0] * k, 0, 255)) + ',' + Math.round(clamp(c[1] * k, 0, 255)) + ',' + Math.round(clamp(c[2] * k, 0, 255)) + ')'; }
  function mix(c, w) { return [c[0] + (255 - c[0]) * w, c[1] + (255 - c[1]) * w, c[2] + (255 - c[2]) * w]; }
  function segments(f, out) {
    var p = f.pose, L = f.look;
    var flash = Math.max(0, f.flash) / 0.12;
    var suit = mix(L.suit, flash), glove = f.meter >= 100 ? mix(L.suit, 0.35 + 0.3 * Math.sin(f.clock * 12)) : L.suit;
    var R0 = mm(ry(f.yaw), rx(f.bodyRx)), O = [f.x, f.y + f.bodyY, 0];
    function child(R, o, off, rot) { return { R: rot ? mm(R, rot) : R, o: add(o, mv(R, off)) }; }
    function at(j, off) { return add(j.o, mv(j.R, off)); }
    var hips = child(R0, O, [0, 1 + p.hy, 0]);
    var spine = child(hips.R, hips.o, [0, 0.06, 0], mm(rx(p.sx), ry(p.sy)));
    var neck = child(spine.R, spine.o, [0, 0.6, 0], mm(rx(p.nx), ry(-p.sy * 0.6)));
    var center = project([f.x, f.y + 1, 0]);
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
  function drawArena() {
    var viewH = H - PAD_H;
    var g = ctx.createLinearGradient(0, 0, 0, viewH);
    g.addColorStop(0, '#0d0a1e'); g.addColorStop(1, '#07060f');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // pillars
    for (var i = 0; i < 10; i++) {
      var a = i / 10 * Math.PI * 2, px = Math.cos(a) * 12, pz = Math.sin(a) * 12;
      var b = project([px, 0, pz]), t = project([px, 7, pz]);
      if (!b || !t) continue;
      ctx.strokeStyle = i % 2 ? 'rgba(45,226,255,0.55)' : 'rgba(255,45,111,0.55)';
      ctx.lineWidth = Math.max(1, 0.12 * FOCAL / b.z);
      ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(t.x, t.y); ctx.stroke();
    }
    function ring(r, fill, stroke, w) {
      ctx.beginPath();
      var first = true;
      for (var i = 0; i <= 48; i++) {
        var a = i / 48 * Math.PI * 2, q = project([Math.cos(a) * r, 0, Math.sin(a) * r]);
        if (!q) { first = true; continue; }
        if (first) { ctx.moveTo(q.x, q.y); first = false; } else ctx.lineTo(q.x, q.y);
      }
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = w; ctx.stroke(); }
    }
    ring(7.2, '#15122a', '#ff2d6f', 2);
    ring(4.6, null, 'rgba(45,226,255,0.35)', 1);
    ring(1.2, null, 'rgba(255,209,102,0.45)', 1);
  }

  function drawFighters() {
    var segs = [];
    segments(F[0], segs); segments(F[1], segs);
    // shadows
    for (var s = 0; s < 2; s++) {
      var c = project([F[s].x, 0, 0]);
      if (!c) continue;
      var sc = FOCAL / c.z;
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, 0.45 * sc / (1 + F[s].y * 0.4), 0.1 * sc, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    var drawn = [];
    for (var i = 0; i < segs.length; i++) {
      var q = segs[i], A = project(q.a), B = project(q.b);
      if (!A || !B) continue;
      drawn.push({ A: A, B: B, z: (A.z + B.z) / 2, r: q.r, c: q.c, cz: q.cz });
    }
    drawn.sort(function (a, b) { return b.z - a.z; });
    ctx.lineCap = 'round';
    for (var j = 0; j < drawn.length; j++) {
      var d = drawn[j];
      var shade = clamp(1 - (d.z - d.cz) * 1.1, 0.55, 1.15);
      var w = 2 * d.r * FOCAL / d.z;
      ctx.strokeStyle = rgb(d.c, shade);
      ctx.lineWidth = Math.max(1, w);
      ctx.beginPath();
      ctx.moveTo(d.A.x, d.A.y);
      ctx.lineTo(d.B.x + (d.A.x === d.B.x && d.A.y === d.B.y ? 0.01 : 0), d.B.y);
      ctx.stroke();
    }
  }

  function drawFx() {
    for (var i = 0; i < sparks.length; i++) {
      var s = sparks[i], q = project(s.p);
      if (!q) continue;
      var r = Math.max(1, 0.05 * FOCAL / q.z * (s.life / s.max));
      ctx.fillStyle = rgb(s.c, 1);
      ctx.fillRect(q.x - r, q.y - r, r * 2, r * 2);
    }
    for (var j = 0; j < waves.length; j++) {
      var w = waves[j], c = project([w.x, w.y, 0]);
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

  function bar(x, y, w, h, frac, col, rtl) {
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = col;
    var fw = w * clamp(frac, 0, 1);
    ctx.fillRect(rtl ? x + w - fw : x, y, fw, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  }
  function drawHud() {
    // Inset from the watch's rounded corners.
    var top = Math.max(6, H * 0.03), side = Math.max(10, W * 0.07);
    var tw = 26, bw = (W - side * 2 - tw) / 2;
    for (var i = 0; i < 2; i++) {
      var f = F[i], x = i === 0 ? side : W - side - bw;
      bar(x, top + 12, bw, 7, f.hp / 100, f.hp < 30 ? '#ff3b3b' : '#ffc23d', i === 1);
      bar(i === 1 ? x + bw * 0.3 : x, top + 21, bw * 0.7, 3, f.meter / 100, f.meter >= 100 ? '#ffd166' : rgb(f.look.suit, 1), i === 1);
      ctx.font = '700 10px -apple-system, system-ui, sans-serif';
      ctx.fillStyle = rgb(f.look.suit, 1);
      ctx.textAlign = i === 0 ? 'left' : 'right';
      ctx.fillText(f.name + (G.wins[i] ? ' ' + new Array(G.wins[i] + 1).join('◆') : ''), i === 0 ? x : x + bw, top + 9);
    }
    ctx.textAlign = 'center';
    ctx.fillStyle = G.timer <= 10 && G.phase === 'fight' ? '#ff2d6f' : '#f1ecff';
    ctx.font = '800 16px -apple-system, system-ui, sans-serif';
    ctx.fillText(String(Math.ceil(G.timer)), W / 2, top + 20);
    for (var c = 0; c < 2; c++) {
      if (F[c].combo >= 2 && F[1 - c].stun > 0) {
        ctx.font = '800 13px -apple-system, system-ui, sans-serif';
        ctx.fillStyle = rgb(F[c].look.suit, 1);
        ctx.textAlign = c === 0 ? 'left' : 'right';
        ctx.fillText(F[c].combo + ' HITS', c === 0 ? side : W - side, top + 42);
      }
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
    ctx.translate(W / 2, viewH * 0.45);
    ctx.scale(scale, scale);
    ctx.textAlign = 'center';
    ctx.font = '900 ' + size + 'px -apple-system, system-ui, sans-serif';
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
    if (G.phase === 'menu') {
      updateFighter(F[0], rdt, NONE, F[1]);
      updateFighter(F[1], rdt, NONE, F[0]);
    } else step(rdt);
    taps.punch = taps.kick = taps.jump = taps.super = false;
    if (superBuf > 0 && F[0].stun <= 0) superBuf -= rdt; // wait out hitstun, then fire
    updateFx(rdt);
    updateCamera(rdt);
    ctx.save();
    if (shake > 0.2) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    drawArena();
    drawFighters();
    drawFx();
    ctx.restore();
    if (G.phase !== 'menu') { drawHud(); drawAnnounce(); }
    var showSuper = G.phase === 'fight' && F[0].meter >= 100;
    if (superBtn.hidden === showSuper) superBtn.hidden = !showSuper;
  }
  window.requestAnimationFrame(frame);

  window.NBW = { G: G, F: F };
})();
