// Neon Brawl online rooms, shared by the full game and the watch edition.
// Messages travel over a plain WebSocket to a free public MQTT broker, which relays them between
// players. No WebRTC (the Apple Watch browser doesn't have it) and no server of our own.
// The host runs NBSim for everyone; guests send inputs and draw the host's snapshots.
// Up to 3 guests per room. Exposes window.NBNet.
(function () {
  'use strict';

  // The room code picks the broker, so host and guests always meet on the same one.
  var BROKERS = ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt', 'wss://test.mosquitto.org:8081/mqtt'];
  var ROOT = 'neonbrawl/v3/';
  var MAX_GUESTS = 3;
  var CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var BTN = ['jump', 'punch', 'kick', 'super'];

  var N = {
    role: null, // 'host' | 'guest' | null
    code: '', mq: null,
    guests: [], // host side: { id, client, fidx, input, seen, last }
    started: false,
    counts: [0, 0, 0, 0], // guest side: press counters for jump, punch, kick, super
    h: {} // handlers: status(text), lobby(info), joined(), start(msg), snap(msg), rematch(), left(fidx), closed(text)
  };
  var timers = [], session = 0;
  function call(name, a) { if (N.h[name]) N.h[name](a); }
  function later(fn, ms) { var t = setTimeout(fn, ms); timers.push(t); return t; }
  function every(fn, ms) { var t = setInterval(fn, ms); timers.push(t); return t; }
  function now() { return Date.now(); }

  N.supported = function () { return typeof WebSocket !== 'undefined'; };

  function brokerFor(code) {
    var h = 0;
    for (var i = 0; i < code.length; i++) h = (h * 31 + code.charCodeAt(i)) >>> 0;
    return h % BROKERS.length;
  }
  function makeCode(broker) {
    var c;
    do {
      c = '';
      for (var i = 0; i < 5; i++) c += CHARS[Math.floor(Math.random() * CHARS.length)];
    } while (brokerFor(c) !== broker);
    return c;
  }
  function topic(code, part) { return ROOT + code + '/' + part; }

  // ---------------- Minimal MQTT 3.1.1 client over WebSocket (QoS 0 only) ----------------
  function utf8(s) { return unescape(encodeURIComponent(s)); }
  function fromUtf8(s) { try { return decodeURIComponent(escape(s)); } catch (e) { return s; } }
  function strBytes(s) { // s is a byte string
    var a = new Array(s.length + 2);
    a[0] = (s.length >> 8) & 255; a[1] = s.length & 255;
    for (var i = 0; i < s.length; i++) a[i + 2] = s.charCodeAt(i) & 255;
    return a;
  }
  function packet(type, body) {
    var len = body.length, hdr = [type];
    do { var b = len % 128; len = Math.floor(len / 128); if (len > 0) b |= 128; hdr.push(b); } while (len > 0);
    var out = new Uint8Array(hdr.length + body.length);
    out.set(hdr, 0);
    out.set(body, hdr.length);
    return out;
  }
  function bytesToStr(u8) {
    var s = '';
    for (var i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192));
    return s;
  }

  // cb: { open(), message(topic, obj), close(wasOpen) }
  function connect(url, will, cb) {
    var ws, open = false, done = false, buf = new Uint8Array(0), pid = 1, ping = 0, failT = 0;
    var c = {
      sub: function (t) {
        pid = (pid % 65535) + 1;
        send(packet(0x82, [pid >> 8, pid & 255].concat(strBytes(utf8(t)), [0])));
      },
      pub: function (t, obj) { if (open) send(packet(0x30, strBytes(utf8(t)).concat(strBytes(utf8(JSON.stringify(obj))).slice(2)))); },
      end: function () {
        if (done) return;
        done = true;
        clearInterval(ping); clearTimeout(failT);
        try { if (open) ws.send(packet(0xe0, [])); } catch (e) {}
        try { ws.close(); } catch (e) {}
      }
    };
    function send(p) { try { if (ws.readyState === 1) ws.send(p); } catch (e) {} }
    function fail() {
      if (done) return;
      var was = open;
      c.end();
      cb.close(was);
    }
    try { ws = new WebSocket(url, 'mqtt'); } catch (e) { setTimeout(fail, 0); return c; }
    ws.binaryType = 'arraybuffer';
    failT = setTimeout(function () { if (!open) fail(); }, 7000);
    ws.onopen = function () {
      var id = 'nb' + Math.random().toString(36).slice(2, 12);
      var payload = strBytes(id), flags = 0x02; // clean session
      if (will) { flags |= 0x04; payload = payload.concat(strBytes(utf8(will.topic)), strBytes(utf8(JSON.stringify(will.msg)))); }
      send(packet(0x10, [0, 4, 77, 81, 84, 84, 4, flags, 0, 20].concat(payload))); // keepalive 20s
    };
    ws.onmessage = function (e) {
      var d = new Uint8Array(e.data), nb = new Uint8Array(buf.length + d.length);
      nb.set(buf, 0); nb.set(d, buf.length); buf = nb;
      while (buf.length >= 2) {
        var mul = 1, len = 0, i = 1, b;
        do {
          if (i >= buf.length) return;
          b = buf[i++]; len += (b & 127) * mul; mul *= 128;
        } while (b & 128);
        if (buf.length < i + len) return;
        var type = buf[0] >> 4, body = buf.subarray(i, i + len);
        buf = buf.slice(i + len);
        if (type === 2) { // CONNACK
          if (body[1] !== 0) { fail(); return; }
          open = true;
          clearTimeout(failT);
          ping = setInterval(function () { send(packet(0xc0, [])); }, 15000);
          cb.open();
        } else if (type === 3) { // PUBLISH (QoS 0: no packet id)
          var tl = (body[0] << 8) | body[1];
          var t = fromUtf8(bytesToStr(body.subarray(2, 2 + tl)));
          var msg = null;
          try { msg = JSON.parse(fromUtf8(bytesToStr(body.subarray(2 + tl)))); } catch (err) {}
          if (msg && !done) cb.message(t, msg);
        }
      }
    };
    ws.onerror = fail;
    ws.onclose = fail;
    return c;
  }

  N.close = function () {
    session++;
    timers.forEach(function (t) { clearTimeout(t); clearInterval(t); });
    timers = [];
    var mq = N.mq;
    if (mq) {
      if (N.role === 'host') mq.pub(topic(N.code, 'a'), { t: '_closed' });
      else if (N.role === 'guest') mq.pub(topic(N.code, 'h'), { f: N.id, m: { t: '_bye' } });
      setTimeout(function () { mq.end(); }, 150);
    }
    N.role = null; N.mq = null; N.guests = []; N.started = false;
  };

  // ---------------- Host ----------------
  function toGuest(id, msg) { if (N.mq) N.mq.pub(topic(N.code, 'g/' + id), msg); }
  function broadcastLobby() {
    var players = [N.hostClient].concat(N.guests.map(function (g) { return g.client; }));
    call('lobby', { players: players, code: N.code });
    N.guests.forEach(function (g, i) { toGuest(g.id, { t: 'lobby', players: players, you: i + 1, code: N.code }); });
  }
  function findGuest(id) {
    for (var i = 0; i < N.guests.length; i++) if (N.guests[i].id === id) return N.guests[i];
    return null;
  }
  function dropGuest(g) {
    var i = N.guests.indexOf(g);
    if (i < 0) return;
    N.guests.splice(i, 1);
    broadcastLobby();
    if (g.fidx >= 0) call('left', g.fidx);
  }
  function hostMessage(d) {
    if (!d || typeof d.f !== 'string') return;
    var g = findGuest(d.f), m = d.m || {};
    if (m.t === '_join') {
      if (g) { toGuest(g.id, { t: '_ok' }); broadcastLobby(); return; }
      if (N.started || N.guests.length >= MAX_GUESTS) { toGuest(d.f, { t: 'full', started: N.started }); return; }
      N.guests.push({ id: d.f, client: m.client === 'watch' ? 'watch' : 'desktop', fidx: -1, input: { mx: 0, mz: 0, block: false, c: [0, 0, 0, 0] }, seen: [0, 0, 0, 0], last: now() });
      toGuest(d.f, { t: '_ok' });
      broadcastLobby();
      return;
    }
    if (!g) return;
    g.last = now();
    if (m.t === '_bye') dropGuest(g);
    else if (m.t === 'in') g.input = m;
    else if (m.t === 'rematch') call('rematch');
  }

  N.host = function (client) {
    if (!N.supported()) { call('status', "This browser can't open network connections."); return; }
    N.close();
    call('status', 'Opening a room…');
    var my = session;
    (function attempt(b) {
      if (my !== session) return;
      if (b >= BROKERS.length) { call('status', "Couldn't reach the game server. Check your internet connection."); return; }
      var code = makeCode(b);
      var mq = connect(BROKERS[b], { topic: topic(code, 'a'), msg: { t: '_closed' } }, {
        open: function () {
          if (my !== session) { mq.end(); return; }
          N.role = 'host'; N.code = code; N.mq = mq; N.hostClient = client; N.guests = []; N.started = false;
          mq.sub(topic(code, 'h'));
          broadcastLobby();
          // Keep-alive both ways: ping guests, and drop guests we haven't heard from.
          every(function () {
            mq.pub(topic(code, 'a'), { t: '_ping' });
            N.guests.slice().forEach(function (g) { if (now() - g.last > 10000) dropGuest(g); });
          }, 2000);
        },
        message: function (t, msg) { if (my === session) hostMessage(msg); },
        close: function (wasOpen) {
          if (my !== session) return;
          if (!wasOpen) { attempt(b + 1); return; }
          N.mq = null;
          N.close();
          call('closed', 'Lost the connection to the game server.');
        }
      });
    })(0);
  };

  // Guests take fighter slots 1, 2, 3 in join order.
  N.startMatch = function (slots, extra) {
    N.started = true;
    N.guests.forEach(function (g, i) {
      g.fidx = i + 1;
      g.seen = g.input.c ? g.input.c.slice() : [0, 0, 0, 0];
      toGuest(g.id, { t: 'start', you: g.fidx, slots: slots, roundTime: extra.roundTime, profile: extra.profile });
    });
  };
  N.guestCount = function () { return N.guests.length; };
  // One publish reaches every guest.
  N.sendSnap = function (snap) { if (N.role === 'host' && N.mq && N.guests.length) N.mq.pub(topic(N.code, 'a'), snap); };
  N.inputFor = function (fidx) {
    for (var i = 0; i < N.guests.length; i++) {
      var g = N.guests[i];
      if (g.fidx !== fidx) continue;
      var r = g.input, c = r.c || [0, 0, 0, 0];
      var inp = { mx: +r.mx || 0, mz: +r.mz || 0, block: !!r.block };
      for (var b = 0; b < 4; b++) inp[BTN[b]] = c[b] > g.seen[b];
      return inp;
    }
    return null;
  };
  N.consumeInputs = function () {
    N.guests.forEach(function (g) { if (g.input.c) g.seen = g.input.c.slice(); });
  };

  // ---------------- Guest ----------------
  N.join = function (code, client) {
    code = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length !== 5) { call('status', 'Enter the 5-character room code shown on the host screen.'); return; }
    if (!N.supported()) { call('status', "This browser can't open network connections."); return; }
    N.close();
    call('status', 'Connecting…');
    var my = session, id = Math.random().toString(36).slice(2, 10), lastHost = 0;
    N.id = id;
    var mq = connect(BROKERS[brokerFor(code)], { topic: topic(code, 'h'), msg: { f: id, m: { t: '_bye' } } }, {
      open: function () {
        if (my !== session) { mq.end(); return; }
        N.mq = mq; N.code = code;
        mq.sub(topic(code, 'g/' + id));
        mq.sub(topic(code, 'a'));
        var ask = function () { mq.pub(topic(code, 'h'), { f: id, m: { t: '_join', client: client } }); };
        ask();
        var retry = every(function () { if (N.role !== 'guest') ask(); else clearInterval(retry); }, 1500);
        later(function () {
          if (N.role !== 'guest') { N.close(); call('status', 'No open room with code ' + code + '.'); }
        }, 8000);
      },
      message: function (t, m) {
        if (my !== session) return;
        if (N.role !== 'guest') {
          if (m.t === '_ok') {
            N.role = 'guest'; N.counts = [0, 0, 0, 0]; lastHost = now();
            call('joined');
            every(function () {
              mq.pub(topic(code, 'h'), { f: id, m: { t: '_ping' } });
              if (now() - lastHost > 10000) { N.mq = null; N.close(); mq.end(); call('closed', 'Lost the connection to the host.'); }
            }, 2000);
          } else if (m.t === 'full') {
            N.close();
            call('status', m.started ? 'That match has already started.' : 'That room is full (4 fighters max).');
          }
          return;
        }
        lastHost = now();
        if (m.t === 's') call('snap', m);
        else if (m.t === 'lobby') call('lobby', m);
        else if (m.t === 'start') call('start', m);
        else if (m.t === '_closed') { N.close(); call('closed', 'The host closed the room.'); }
      },
      close: function (wasOpen) {
        if (my !== session) return;
        var wasGuest = N.role === 'guest';
        N.mq = null;
        N.close();
        if (wasGuest) call('closed', 'Lost the connection to the game server.');
        else call('status', wasOpen ? 'Lost the connection to the game server.' : "Couldn't reach the game server. Check your internet connection.");
      }
    });
  };

  // inp: { mx, mz, block, jump, punch, kick, super } with button presses as one-frame booleans.
  // Sent right away when a button is pressed, otherwise only when something changes (and a
  // refresh every 250 ms), so a guest doesn't flood the relay at 60 messages a second.
  var lastKey = '', lastC = '', lastT = 0;
  N.sendInput = function (inp) {
    if (N.role !== 'guest' || !N.mq) return;
    for (var b = 0; b < 4; b++) if (inp[BTN[b]]) N.counts[b]++;
    var msg = { t: 'in', mx: Math.round(inp.mx * 100) / 100, mz: Math.round(inp.mz * 100) / 100, block: !!inp.block, c: N.counts.slice() };
    var c = msg.c.join(), key = msg.mx + ',' + msg.mz + ',' + msg.block, t = now();
    if (c !== lastC || (key !== lastKey && t - lastT > 40) || t - lastT > 250) {
      N.mq.pub(topic(N.code, 'h'), { f: N.id, m: msg });
      lastC = c; lastKey = key; lastT = t;
    }
  };
  N.requestRematch = function () { if (N.role === 'guest' && N.mq) N.mq.pub(topic(N.code, 'h'), { f: N.id, m: { t: 'rematch' } }); };

  window.NBNet = N;
})();
