// Neon Brawl simulation: rules, physics, CPU, rounds. Shared by the full game (game.js)
// and the watch edition (watch.js), so either one can host an online room for the other.
// Plain script (no modules, no libraries); exposes window.NBSim.
(function () {
  'use strict';

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function damp(rate, dt) { return 1 - Math.exp(-rate * dt); }
  function lerpAngle(a, b, t) {
    var d = (b - a) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return a + d * t;
  }
  function r3(n) { return Math.round(n * 1000) / 1000; }

  var ARENA_R = 8.4;
  var ROSTER = [
    { name: 'RYKA', color: 0xff2d6f, trim: 0xffd166, skin: 0xe0a47a },
    { name: 'VOLT', color: 0x2de2ff, trim: 0xb8ff3d, skin: 0x8d5a3b },
    { name: 'JADE', color: 0x6dff7a, trim: 0xff8a3d, skin: 0xc68863 },
    { name: 'SOL', color: 0xffb21a, trim: 0xa77bff, skin: 0xf1c27d }
  ];

  // Attack frame data, in seconds.
  var MOVES = {
    jab:   { start: 0.06, active: 0.08, rec: 0.14, dmg: 5,  range: 1.5,  push: 2.4, stun: 0.28, meter: 7,  lunge: 1.6, sound: 'hit',   h: 1.45 },
    cross: { start: 0.08, active: 0.08, rec: 0.18, dmg: 7,  range: 1.55, push: 3.2, stun: 0.32, meter: 8,  lunge: 2.2, sound: 'hit',   h: 1.45 },
    kick:  { start: 0.15, active: 0.1,  rec: 0.28, dmg: 11, range: 1.9,  push: 4.8, stun: 0.42, meter: 12, lunge: 2.6, sound: 'heavy', h: 1.15 },
    super: { start: 0.3,  active: 0.22, rec: 0.45, dmg: 24, range: 2.0,  push: 11,  stun: 0.85, meter: 0,  lunge: 10,  sound: 'super', h: 1.3, launch: true }
  };

  // CPU tuning. The watch profile is gentler because its controls are slower to use.
  //   react: chance to block an incoming attack   aggr: how often it attacks   think: seconds between decisions
  //   combo: chance to chain after a hit   dmg: damage multiplier   punish: chance to hit you while you recover
  //   antiair: chance to kick you out of a jump   superCombo: chance to cancel a hit into its super
  //   bait: chance to back off and wait out your block
  var DIFF = {
    desktop: {
      easy: { react: 0.12, aggr: 0.35, think: 0.5, combo: 0.15, dmg: 1, punish: 0, antiair: 0, superCombo: 0, bait: 0 },
      normal: { react: 0.45, aggr: 0.65, think: 0.26, combo: 0.55, dmg: 1, punish: 0.25, antiair: 0.2, superCombo: 0.2, bait: 0.1 },
      hard: { react: 0.78, aggr: 0.88, think: 0.12, combo: 0.9, dmg: 1.08, punish: 0.6, antiair: 0.5, superCombo: 0.6, bait: 0.35 },
      extreme: { react: 0.93, aggr: 0.96, think: 0.06, combo: 1, dmg: 1.22, punish: 0.95, antiair: 0.85, superCombo: 1, bait: 0.7 }
    },
    watch: {
      easy: { react: 0.05, aggr: 0.2, think: 0.8, combo: 0, dmg: 0.6, punish: 0, antiair: 0, superCombo: 0, bait: 0 },
      normal: { react: 0.25, aggr: 0.45, think: 0.45, combo: 0.25, dmg: 0.8, punish: 0.1, antiair: 0.05, superCombo: 0.1, bait: 0 },
      hard: { react: 0.55, aggr: 0.7, think: 0.24, combo: 0.6, dmg: 1, punish: 0.35, antiair: 0.25, superCombo: 0.4, bait: 0.2 },
      extreme: { react: 0.8, aggr: 0.88, think: 0.12, combo: 0.9, dmg: 1.12, punish: 0.75, antiair: 0.6, superCombo: 0.85, bait: 0.5 }
    }
  };
  var LADDER = ['easy', 'normal', 'hard', 'extreme'];

  // Pose = joint angles in radians. P() fills unspecified joints from the guard stance.
  var POSE_KEYS = ['hy', 'sx', 'sy', 'nx', 'lsx', 'lsz', 'rsx', 'rsz', 'lex', 'rex', 'lhx', 'lhz', 'rhx', 'rhz', 'lkx', 'rkx'];
  var GUARD = { hy: -0.05, sx: 0.12, sy: -0.22, nx: 0, lsx: -1.0, lsz: 0.2, rsx: -1.0, rsz: -0.2, lex: -1.75, rex: -1.75, lhx: -0.35, lhz: 0.06, rhx: 0.3, rhz: -0.06, lkx: 0.45, rkx: 0.1 };
  function P(o) { var p = {}, k; for (k in GUARD) p[k] = GUARD[k]; for (k in o) p[k] = o[k]; return p; }

  var NONE = { mx: 0, mz: 0, jump: false, punch: false, kick: false, block: false, super: false };

  // ---------------------------------------------------------------------------
  // Match setup
  // ---------------------------------------------------------------------------
  function makeFighter(i, slot) {
    var r = ROSTER[i];
    return {
      idx: i, name: r.name, color: r.color, kind: slot.kind, label: slot.label || '',
      wins: 0, meter: 0, pose: P({}), clock: Math.random() * 9, walkPh: 0,
      ai: { t: 0, act: 'approach', rolled: false, blocking: false, blockT: 0, side: 1 },
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, airX: 0, airZ: 0, yaw: 0, bodyRx: 0, bodyY: 0, dirX: 1, dirZ: 0,
      hp: 100, state: 'idle', atk: null, stun: 0, combo: 0, flash: 0, lastPunch: 'cross', punchT: 0, attacking: false
    };
  }

  function spawn(S) {
    var n = S.fighters.length, r = n === 2 ? 2.4 : 3.0;
    S.fighters.forEach(function (f, i) {
      var a = Math.PI + i * 2 * Math.PI / n;
      f.x = Math.cos(a) * r; f.z = Math.sin(a) * r; f.y = 0;
      f.vx = f.vy = f.vz = 0;
      f.hp = 100; f.state = 'idle'; f.atk = null; f.stun = 0; f.combo = 0; f.flash = 0;
      f.lastPunch = 'cross'; f.punchT = 0; f.bodyRx = 0; f.bodyY = 0; f.attacking = false;
      if (f.kind === 'gone') { f.hp = 0; f.state = 'ko'; }
      var d = Math.sqrt(f.x * f.x + f.z * f.z) || 1;
      f.dirX = -f.x / d; f.dirZ = -f.z / d;
      f.yaw = Math.atan2(f.dirX, f.dirZ);
    });
  }

  // opts: { slots: [{kind: 'local'|'remote'|'cpu', label}], diff, profile: 'desktop'|'watch', roundTime,
  //         adapt: saved adaptive profile { power, rounds, habits } when diff is 'adaptive' }
  function createMatch(opts) {
    var S = {
      opts: opts, fighters: opts.slots.map(function (s, i) { return makeFighter(i, s); }),
      round: 1, phase: 'intro', timer: opts.roundTime || 99, phaseT: 0, timeScale: 1, hitstop: 0,
      winner: -1, flags: {}, events: []
    };
    if (opts.diff === 'adaptive') {
      var saved = opts.adapt || {}, h = saved.habits || {};
      var power = +saved.power >= 0 ? +saved.power : +saved.level >= 0 ? +saved.level : 40;
      power = clamp(power, 0, 100);
      S.adapt = {
        power: power, // how strong you are: saved, and where the CPU starts each match
        startPower: power, rounds: +saved.rounds || 0,
        level: power, // the CPU's live level, which follows how you're fighting right now
        lvlSum: 0, lvlT: 0,
        habits: { jump: +h.jump || 0, atk: +h.atk || 0, block: +h.block || 0 },
        save: false
      };
    }
    startRound(S);
    return S;
  }

  function emit(S, type, a) { S.events.push([type, a]); }

  function startRound(S) {
    spawn(S);
    S.timer = S.opts.roundTime || 99;
    S.phase = 'intro'; S.phaseT = 0; S.timeScale = 1; S.hitstop = 0; S.winner = -1; S.flags = {};
    var onePointAway = S.fighters.filter(function (f) { return f.wins === 1; }).length;
    emit(S, 'announce', [onePointAway >= 2 ? 'FINAL\nROUND' : 'ROUND ' + S.round, 'go']);
  }

  function rematch(S) {
    if (present(S).length < 2) return;
    S.round = 1;
    S.fighters.forEach(function (f) { f.wins = 0; f.meter = 0; });
    if (S.adapt) { S.adapt.level = S.adapt.power; S.adapt.startPower = S.adapt.power; }
    startRound(S);
  }

  function diffOf(S) {
    var table = DIFF[S.opts.profile || 'desktop'];
    if (!S.adapt) return table[S.opts.diff] || table.normal;
    return adaptiveDiff(table, S.adapt);
  }

  // ---------------------------------------------------------------------------
  // Adaptive CPU. Your power (0-100) is saved between matches, and each match the CPU starts at
  // it. During a fight its live level rises when you beat it up and falls when it beats you,
  // and it counters your habits (jumping, attacking, blocking). After each round your power
  // moves toward how you actually played: the CPU's average level that round, plus a bit if you
  // won it or minus a bit if you lost. New players' power moves fast; it settles over time.
  // ---------------------------------------------------------------------------
  function adaptiveDiff(table, ad) {
    var x = clamp(ad.level, 0, 100) / 100 * (LADDER.length - 1), i = Math.min(LADDER.length - 2, Math.floor(x)), t = x - i;
    var a = table[LADDER[i]], b = table[LADDER[i + 1]], out = {}, k;
    for (k in a) out[k] = a[k] + (b[k] - a[k]) * t;
    var h = ad.habits;
    out.antiair = Math.min(1, out.antiair + clamp(h.jump / 6, 0, 1) * 0.5);
    out.react = Math.min(0.97, out.react + clamp(h.atk / 25, 0, 1) * 0.15);
    out.punish = Math.min(1, out.punish + clamp(h.atk / 25, 0, 1) * 0.25);
    out.bait = Math.min(1, out.bait + clamp(h.block / 0.3, 0, 1) * 0.5);
    return out;
  }
  function adaptRound(S, winner) {
    var ad = S.adapt, w = S.fighters[winner];
    var vsCpu = S.fighters.some(function (f) { return f.kind === 'cpu'; }) && S.fighters.some(isHuman);
    if (!vsCpu) return;
    var avg = ad.lvlT > 1 ? ad.lvlSum / ad.lvlT : ad.level;
    var perf = avg + (!w ? 0 : w.kind === 'cpu' ? -8 : 8);
    var rate = Math.max(0.2, 1 / (ad.rounds + 2));
    ad.power = clamp(ad.power + (perf - ad.power) * rate, 0, 100);
    ad.rounds++;
    ad.lvlSum = 0; ad.lvlT = 0;
    if (w) adaptLevel(S, w.kind === 'cpu' ? -6 : 6);
    ad.save = true;
  }
  function isHuman(f) { return f.kind === 'local' || f.kind === 'remote'; }
  function adaptLevel(S, by) {
    if (!S.adapt) return;
    var hasCpu = false, hasHuman = false;
    S.fighters.forEach(function (f) { if (f.kind === 'cpu') hasCpu = true; else if (isHuman(f)) hasHuman = true; });
    if (hasCpu && hasHuman) S.adapt.level = clamp(S.adapt.level + by, 0, 100);
  }
  // Habits fade over ~20 seconds of fighting: jumps and attacks are counts, block is a share of the time.
  function adaptHabits(S, dt) {
    S.adapt.lvlSum += S.adapt.level * dt; S.adapt.lvlT += dt;
    var h = S.adapt.habits, fade = Math.exp(-dt / 20), blocking = 0, humans = 0;
    h.jump *= fade; h.atk *= fade;
    S.fighters.forEach(function (f) {
      if (!isHuman(f) || f.state === 'ko') return;
      humans++;
      if (f.state === 'block') blocking++;
    });
    if (humans) h.block += (blocking / humans - h.block) * (1 - fade);
  }

  // ---------------------------------------------------------------------------
  // Fighter update
  // ---------------------------------------------------------------------------
  function nearest(S, f) {
    var best = null, bd = Infinity;
    S.fighters.forEach(function (o) {
      if (o === f || o.state === 'ko') return;
      var d = (o.x - f.x) * (o.x - f.x) + (o.z - f.z) * (o.z - f.z);
      if (d < bd) { bd = d; best = o; }
    });
    return best;
  }

  function nextPunch(f) {
    var n = f.punchT > 0 && f.lastPunch === 'jab' ? 'cross' : 'jab';
    f.lastPunch = n; f.punchT = 0.5;
    return n;
  }
  function startAttack(S, f, name) {
    // air: started mid-jump, which makes it a jump attack (more damage, see resolveHit).
    f.atk = { name: name, t: 0, hit: false, hits: [], waved: false, air: f.y > 0.05 };
    f.state = 'attack';
    if (name === 'super') { f.meter = 0; emit(S, 'sfx', 'charge'); }
    else emit(S, 'sfx', 'whoosh');
  }

  function updateFighter(S, f, dt, inp) {
    var t = nearest(S, f), dist = 99;
    if (t) {
      var dx = t.x - f.x, dz = t.z - f.z;
      dist = Math.sqrt(dx * dx + dz * dz);
      if (dist > 1e-4 && f.state !== 'ko') { f.dirX = dx / dist; f.dirZ = dz / dist; }
    }
    var grounded = f.y <= 0 && f.vy <= 0;
    var mvx = 0, mvz = 0;
    f.punchT -= dt;
    f.clock += dt;
    if (f.state !== 'ko') f.yaw = lerpAngle(f.yaw, Math.atan2(f.dirX, f.dirZ), damp(18, dt));

    if (f.state === 'ko' || f.state === 'win') {
      // no control
    } else if (f.stun > 0) {
      f.stun -= dt;
      if (f.stun <= 0) f.state = 'idle';
    } else if (f.atk) {
      var a = f.atk, m = MOVES[a.name];
      a.t += dt;
      if (inp.super && f.meter >= 100 && a.name !== 'super' && (a.t < 0.12 || a.hit)) {
        startAttack(S, f, 'super'); a = f.atk; m = MOVES.super;
      }
      if (!grounded) { mvx = f.airX; mvz = f.airZ; }
      else if (a.t > m.start * 0.5 && a.t < m.start + m.active && dist > 0.95) { mvx = f.dirX * m.lunge; mvz = f.dirZ * m.lunge; }
      if (a.name === 'super' && a.t >= m.start && !a.waved) {
        a.waved = true;
        emit(S, 'wave', [r3(f.x + f.dirX * 0.6), 1.3, r3(f.z + f.dirZ * 0.6), f.color]);
      }
      if (a.t >= m.start && a.t < m.start + m.active) {
        // Hits everyone in range in front of you, once each per attack.
        S.fighters.forEach(function (o) {
          if (o === f || o.state === 'ko' || a.hits.indexOf(o.idx) >= 0) return;
          var ox = o.x - f.x, oz = o.z - f.z, od = Math.sqrt(ox * ox + oz * oz);
          var inFront = od < 0.3 || (ox * f.dirX + oz * f.dirZ) / od > 0.35;
          // A jump kick reaches down onto grounded fighters, but a jump punch goes over their head
          // (it only hits someone up in the air with you). A kick from the ground passes under
          // someone in the air (they're above your foot).
          var dy = f.y - o.y;
          var reach = !a.air ? Math.abs(dy) < 1.1 : a.name === 'kick' || a.name === 'super' ? dy > -0.6 && dy < 1.7 : Math.abs(dy) < 0.45;
          if (!a.air && a.name === 'kick' && o.y > 0.4) reach = false;
          if (od < m.range && reach && inFront) {
            a.hits.push(o.idx); a.hit = true;
            resolveHit(S, f, o, m);
          }
        });
      }
      if (f.atk === a) {
        var recovering = a.t >= m.start + m.active;
        // Landing a hit lets you cancel recovery into the next attack: the combo system.
        if (a.hit && recovering && a.name !== 'super' && (inp.punch || inp.kick)) startAttack(S, f, inp.punch ? nextPunch(f) : 'kick');
        else if (a.t >= m.start + m.active + m.rec) { f.atk = null; f.state = 'idle'; }
      }
    } else {
      f.state = 'idle';
      if (inp.super && f.meter >= 100) startAttack(S, f, 'super');
      else if (inp.punch) startAttack(S, f, nextPunch(f));
      else if (inp.kick) startAttack(S, f, 'kick');
      else if (!grounded) { mvx = f.airX; mvz = f.airZ; }
      else if (inp.block) f.state = 'block';
      else {
        var ml = Math.sqrt(inp.mx * inp.mx + inp.mz * inp.mz);
        var ix = ml > 1 ? inp.mx / ml : inp.mx, iz = ml > 1 ? inp.mz / ml : inp.mz;
        var fwd = ix * f.dirX + iz * f.dirZ;
        var speed = fwd < -0.3 ? 2.6 : 3.4;
        mvx = ix * speed; mvz = iz * speed;
        if (mvx * mvx + mvz * mvz > 0.01) { f.state = 'walk'; f.walkPh += dt * 10 * (fwd < -0.3 ? -1 : 1); }
        if (inp.jump) {
          if (S.adapt && isHuman(f)) S.adapt.habits.jump++;
          f.vy = 7.4; f.airX = mvx * 1.15; f.airZ = mvz * 1.15; f.state = 'idle';
          emit(S, 'sfx', 'jump');
        }
      }
    }
    f.attacking = !!f.atk;

    var wasAir = f.y > 0;
    f.vy -= 22 * dt;
    f.y += f.vy * dt;
    if (f.y <= 0) {
      f.y = 0;
      if (wasAir && f.vy < -4) emit(S, 'sfx', 'land');
      f.vy = 0;
    }
    f.x += (mvx + f.vx) * dt;
    f.z += (mvz + f.vz) * dt;
    var fr = Math.exp(-(f.y > 0 ? 0.6 : 7) * dt);
    f.vx *= fr; f.vz *= fr;
    var r = Math.sqrt(f.x * f.x + f.z * f.z);
    if (r > ARENA_R) { f.x *= ARENA_R / r; f.z *= ARENA_R / r; }
    animate(f, dt);
  }

  // Tricks: bonus damage for a jump kick or jump punch, and for a counter (hitting someone while
  // their own attack is still winding up). They stack, up to 2.2 times the damage.
  function trickOf(att, def, m) {
    var name = '', mult = 1, a = att.atk, d = def.atk;
    if (a && a.air && m !== MOVES.super) { name = m === MOVES.kick ? 'JUMP KICK' : 'JUMP PUNCH'; mult = m === MOVES.kick ? 1.7 : 1.35; }
    if (d && d.name !== 'super' && d.t < MOVES[d.name].start) { name = name ? name + ' + COUNTER' : 'COUNTER'; mult *= 1.4; }
    return { name: name, mult: Math.min(mult, 2.2) };
  }

  function resolveHit(S, att, def, m) {
    var blocked = def.state === 'block';
    var trick = trickOf(att, def, m);
    if (S.adapt && isHuman(att)) S.adapt.habits.atk++;
    var dmg = m.dmg * trick.mult * (att.kind === 'cpu' ? diffOf(S).dmg : 1);
    if (blocked) dmg *= m === MOVES.super ? 0.35 : 0.1;
    else {
      att.combo = def.stun > 0 ? att.combo + 1 : 1;
      dmg *= Math.max(0.5, 1 - (att.combo - 1) * 0.08);
    }
    def.hp = Math.max(0, def.hp - dmg);
    // Adaptive CPU: trading damage moves its level, so a close fight stays close.
    if (!blocked && isHuman(att) && def.kind === 'cpu') adaptLevel(S, dmg * 0.12);
    else if (!blocked && att.kind === 'cpu' && isHuman(def)) adaptLevel(S, -dmg * 0.12);
    att.meter = Math.min(100, att.meter + m.meter * (blocked ? 0.4 : 1));
    def.meter = Math.min(100, def.meter + dmg * 0.5);
    var kx = def.x - att.x, kz = def.z - att.z, kl = Math.sqrt(kx * kx + kz * kz);
    if (kl < 1e-4) { kx = att.dirX; kz = att.dirZ; kl = 1; }
    var push = m.push * (blocked ? 0.55 : 1) * (1 + (trick.mult - 1) * 0.6);
    def.vx = kx / kl * push; def.vz = kz / kl * push;

    var hx = r3(att.x + (def.x - att.x) * 0.7), hz = r3(att.z + (def.z - att.z) * 0.7);
    var hy = r3(Math.max(att.y, def.y) + m.h);
    if (blocked) {
      emit(S, 'burst', [hx, hy, hz, 0x9fe8ff, 10, 4]);
      emit(S, 'sfx', 'block');
      S.hitstop = 0.035;
    } else {
      def.flash = 0.12;
      // A super in progress can't be interrupted: the defender takes the damage but keeps attacking.
      if (!(def.atk && def.atk.name === 'super')) { def.stun = m.stun; def.atk = null; def.state = 'hit'; }
      if (m.launch || def.hp <= 0) def.vy = 6.2;
      else if (trick.name.indexOf('JUMP KICK') === 0) def.vy = 4.5;
      if (trick.name) emit(S, 'trick', [trick.name, att.idx, Math.round(trick.mult * 100) / 100]);
      var big = m === MOVES.super || trick.mult >= 1.6;
      emit(S, 'burst', [hx, hy, hz, att.color, big ? 50 : m === MOVES.kick ? 26 : 18, big ? 9 : 6]);
      emit(S, 'sfx', trick.mult >= 1.6 && m !== MOVES.super ? 'heavy' : m.sound);
      emit(S, 'shake', big ? 0.45 : m === MOVES.kick ? 0.18 : 0.1);
      S.hitstop = big ? 0.18 : m === MOVES.kick ? 0.08 : 0.055;
    }
    if (def.hp <= 0) knockOut(S, att, def);
  }

  function knockOut(S, att, def) {
    def.state = 'ko'; def.stun = 0; def.atk = null;
    emit(S, 'sfx', 'ko');
    emit(S, 'shake', 0.5);
    if (S.phase !== 'fight') return;
    var alive = S.fighters.filter(function (f) { return f.state !== 'ko'; });
    if (alive.length <= 1) {
      endRound(S, alive.length ? alive[0].idx : att.idx);
      S.timeScale = 0.3;
      emit(S, 'announce', ['K.O.', 'ko']);
    } else {
      emit(S, 'announce', [def.name + ' OUT', 'go']);
    }
  }

  function present(S) { return S.fighters.filter(function (f) { return f.kind !== 'gone'; }); }

  // A player left an online match: they forfeit and stay out for the rest of it.
  function forfeit(S, fidx) {
    var f = S.fighters[fidx];
    if (!f || f.kind === 'gone') return;
    f.kind = 'gone'; f.label = 'LEFT'; f.hp = 0; f.state = 'ko'; f.atk = null; f.stun = 0; f.meter = 0;
    if (S.phase === 'over') return;
    var left = present(S);
    if (left.length <= 1) {
      // Nobody left to fight: the last player wins the match.
      var w = left[0];
      if (S.phase !== 'ko') endRound(S, w ? w.idx : -1);
      else S.winner = w ? w.idx : -1;
      if (w) w.wins = 2;
      emit(S, 'announce', [f.name + ' LEFT', 'ko']);
      return;
    }
    emit(S, 'announce', [f.name + ' LEFT', 'go']);
    if (S.phase === 'fight') {
      var alive = S.fighters.filter(function (o) { return o.state !== 'ko'; });
      if (alive.length <= 1) endRound(S, alive.length ? alive[0].idx : -1);
    }
  }

  function endRound(S, winner) {
    S.winner = winner;
    if (winner >= 0) S.fighters[winner].wins++;
    if (S.adapt) adaptRound(S, winner);
    S.phase = 'ko'; S.phaseT = 0; S.flags = {};
  }

  function timeUp(S) {
    var alive = S.fighters.filter(function (f) { return f.state !== 'ko'; });
    var top = Math.max.apply(null, alive.map(function (f) { return f.hp; }));
    var leaders = alive.filter(function (f) { return f.hp === top; });
    endRound(S, leaders.length === 1 ? leaders[0].idx : -1);
    emit(S, 'announce', ['TIME', 'ko']);
    emit(S, 'sfx', 'bell');
  }

  function separateAll(S) {
    var F = S.fighters, min = 0.8;
    for (var i = 0; i < F.length; i++) for (var j = i + 1; j < F.length; j++) {
      var a = F[i], b = F[j];
      if (a.state === 'ko' || b.state === 'ko' || Math.abs(a.y - b.y) > 1.3) continue;
      var dx = b.x - a.x, dz = b.z - a.z, d = Math.sqrt(dx * dx + dz * dz);
      if (d >= min) continue;
      var nx = d > 1e-4 ? dx / d : 1, nz = d > 1e-4 ? dz / d : 0, push = (min - d) / 2;
      a.x -= nx * push; a.z -= nz * push;
      b.x += nx * push; b.z += nz * push;
    }
  }

  // ---------------------------------------------------------------------------
  // Main step. inputs[i] is the input for fighter i (ignored for CPU fighters).
  // ---------------------------------------------------------------------------
  function step(S, rdt, inputs) {
    var dt = rdt;
    if (S.hitstop > 0) { S.hitstop -= rdt; dt = 0; }
    dt *= S.timeScale;
    S.phaseT += rdt;
    var fighting = S.phase === 'fight';
    S.fighters.forEach(function (f, i) {
      var inp = NONE;
      if (fighting) inp = f.kind === 'cpu' ? cpuInput(S, f, rdt) : (inputs[i] || NONE);
      updateFighter(S, f, dt, inp);
    });
    separateAll(S);

    if (S.phase === 'intro') {
      if (!S.flags.fight && S.phaseT > 1.3) { S.flags.fight = true; emit(S, 'announce', ['FIGHT!', 'go']); emit(S, 'sfx', 'bell'); }
      if (S.phaseT > 1.8) { S.phase = 'fight'; S.phaseT = 0; }
    } else if (S.phase === 'fight') {
      if (S.adapt) adaptHabits(S, dt);
      S.timer -= dt;
      if (S.timer <= 0) { S.timer = 0; timeUp(S); }
    } else if (S.phase === 'ko') {
      if (S.phaseT > 1.1) S.timeScale = 1;
      if (!S.flags.win && S.phaseT > 1.8) {
        S.flags.win = true;
        var w = S.fighters[S.winner];
        if (w && w.state !== 'ko') { w.atk = null; w.stun = 0; w.state = 'win'; }
        if (matchOver(S)) emit(S, 'announce', [w.name + '\nVICTORY', 'stay', '']);
        else emit(S, 'announce', [w ? w.name + ' WINS' : 'DRAW', 'stay', w && w.hp >= 100 ? 'PERFECT' : '']);
      }
      if (S.phaseT > 4.2) {
        if (matchOver(S)) S.phase = 'over';
        else { S.round++; startRound(S); }
      }
    }
  }
  function matchOver(S) { return S.fighters.some(function (f) { return f.wins >= 2; }); }

  // ---------------------------------------------------------------------------
  // CPU
  // ---------------------------------------------------------------------------
  function cpuInput(S, me, dt) {
    var ai = me.ai, df = diffOf(S);
    var inp = { mx: 0, mz: 0, jump: false, punch: false, kick: false, block: false, super: false };
    var t = nearest(S, me);
    if (!t) return inp;
    var dx = t.x - me.x, dz = t.z - me.z, d = Math.sqrt(dx * dx + dz * dz) || 1;
    var ux = dx / d, uz = dz / d;

    // Reactive blocking: one roll per incoming attack from anyone nearby.
    var threat = S.fighters.some(function (o) {
      return o !== me && o.atk && Math.sqrt((o.x - me.x) * (o.x - me.x) + (o.z - me.z) * (o.z - me.z)) < 2.4;
    });
    if (threat) {
      if (!ai.rolled) { ai.rolled = true; ai.blocking = Math.random() < df.react; ai.blockT = 0.4; }
    } else ai.rolled = false;
    if (ai.blockT > 0) {
      ai.blockT -= dt;
      if (ai.blocking && !me.atk) { inp.block = true; return inp; }
    }
    if (me.atk && me.atk.hit) {
      // Cancel a landed hit into the super, or keep the combo going.
      if (me.meter >= 100 && me.atk.name !== 'super' && Math.random() < df.superCombo * dt * 15) inp.super = true;
      else if (Math.random() < df.combo * dt * 12) { if (Math.random() < 0.65) inp.punch = true; else inp.kick = true; }
    }
    if (!me.atk && me.stun <= 0) {
      // Punish: hit the target while its attack is recovering (one roll per attack).
      var ta = t.atk, tm = ta && MOVES[ta.name];
      if (ta && ta !== ai.seenAtk && ta.t >= tm.start + tm.active) {
        ai.seenAtk = ta;
        if (d < 2.0 && Math.random() < df.punish) { if (d < 1.5) inp.punch = true; else inp.kick = true; return inp; }
      }
      // Anti-air: punch a target that jumps in close (one roll per jump). Kicks would pass under it.
      if (t.y > 0.35 && !ai.airRolled) {
        ai.airRolled = true;
        ai.antiAir = Math.random() < df.antiair;
      } else if (t.y <= 0) ai.airRolled = false;
      if (ai.antiAir && t.y > 0.35 && t.y < 1.3 && d < 1.6) { ai.antiAir = false; inp.punch = true; return inp; }
      // Bait: back off from a blocking target, then rush in when the guard drops.
      if (t.state === 'block' && d < 2.2 && ai.act !== 'retreat' && Math.random() < df.bait * dt * 4) {
        if (me.meter >= 100) { inp.super = true; return inp; }
        ai.act = 'retreat'; ai.t = 0.35; ai.wasBait = true;
      } else if (ai.wasBait && t.state !== 'block') { ai.wasBait = false; ai.act = 'approach'; ai.t = 0.15; }
    }

    ai.t -= dt;
    var fresh = false;
    if (ai.t <= 0) {
      ai.t = df.think * (0.5 + Math.random());
      fresh = true;
      var r = Math.random();
      if (me.meter >= 100 && d < 2.2 && r < 0.5) ai.act = 'super';
      else if (d > 2.3) ai.act = r < 0.12 ? 'side' : r < 0.18 ? 'jumpin' : 'approach';
      else if (d > 1.6) ai.act = r < df.aggr * 0.6 ? 'kick' : r < 0.72 ? 'approach' : r < 0.86 ? 'retreat' : 'side';
      else ai.act = r < df.aggr * 0.55 ? 'punch' : r < df.aggr * 0.85 ? 'kick' : r < 0.82 ? 'retreat' : r < 0.93 ? 'side' : 'jump';
      ai.side = Math.random() < 0.5 ? -1 : 1;
    }
    switch (ai.act) {
      case 'approach': inp.mx = ux; inp.mz = uz; break;
      case 'retreat': inp.mx = -ux * 0.9; inp.mz = -uz * 0.9; break;
      case 'side': inp.mx = -uz * ai.side; inp.mz = ux * ai.side; break;
      case 'jumpin': inp.mx = ux; inp.mz = uz; inp.jump = fresh; if (me.y > 1 && !me.atk) inp.kick = true; break;
      case 'jump': inp.jump = fresh; break;
      case 'punch': inp.punch = fresh; break;
      case 'kick': inp.kick = fresh; break;
      case 'super': inp.super = fresh; break;
    }
    return inp;
  }

  // ---------------------------------------------------------------------------
  // Animation (target poses, blended)
  // ---------------------------------------------------------------------------
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
    for (var i = 0; i < POSE_KEYS.length; i++) f.pose[POSE_KEYS[i]] += (tg[POSE_KEYS[i]] - f.pose[POSE_KEYS[i]]) * a;
    if (f.flash > 0) f.flash -= dt;
  }

  // Idle animation for menus (no rules, no input).
  function idle(S, dt) {
    S.fighters.forEach(function (f) { f.clock += dt; f.state = 'idle'; animate(f, dt); });
  }

  // ---------------------------------------------------------------------------
  // Network snapshots: the host packs state, guests blend toward it.
  // ---------------------------------------------------------------------------
  var BASE = 14; // fields before the pose values
  function pack(S, events) {
    return {
      t: 's', g: [S.phase, r3(S.timer), S.round],
      f: S.fighters.map(function (f) {
        var a = [r3(f.x), r3(f.y), r3(f.z), r3(f.yaw), r3(f.bodyRx), r3(f.bodyY), r3(f.hp), r3(f.meter),
          f.combo, f.stun > 0 ? 1 : 0, r3(Math.max(0, f.flash)), f.atk ? 1 : 0, f.wins, f.kind === 'gone' ? 2 : f.state === 'ko' ? 1 : 0];
        for (var i = 0; i < POSE_KEYS.length; i++) a.push(r3(f.pose[POSE_KEYS[i]]));
        return a;
      }),
      e: events
    };
  }
  function applySnap(S, snap, k, dt) {
    S.phase = snap.g[0]; S.timer = snap.g[1]; S.round = snap.g[2];
    snap.f.forEach(function (d, i) {
      var f = S.fighters[i];
      if (!f) return;
      f.x += (d[0] - f.x) * k; f.y += (d[1] - f.y) * k; f.z += (d[2] - f.z) * k;
      f.yaw = lerpAngle(f.yaw, d[3], k);
      f.bodyRx += (d[4] - f.bodyRx) * k; f.bodyY += (d[5] - f.bodyY) * k;
      f.hp = d[6]; f.meter = d[7]; f.combo = d[8]; f.stun = d[9] ? 1 : 0; f.flash = d[10];
      f.attacking = !!d[11]; f.wins = d[12]; f.state = d[13] ? 'ko' : 'idle';
      if (d[13] === 2 && f.kind !== 'gone') { f.kind = 'gone'; f.label = 'LEFT'; }
      for (var j = 0; j < POSE_KEYS.length; j++) f.pose[POSE_KEYS[j]] += (d[BASE + j] - f.pose[POSE_KEYS[j]]) * k;
      f.clock += dt;
    });
  }

  window.NBSim = {
    ARENA_R: ARENA_R, ROSTER: ROSTER, forfeit: forfeit, MOVES: MOVES, POSE_KEYS: POSE_KEYS, NONE: NONE,
    createMatch: createMatch, rematch: rematch, cpuInput: cpuInput, step: step, idle: idle, nearest: nearest,
    pack: pack, applySnap: applySnap, clamp: clamp, damp: damp, lerpAngle: lerpAngle
  };
})();
