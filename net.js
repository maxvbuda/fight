// Neon Brawl online rooms, shared by the full game and the watch edition.
// Messages go through a small relay (relay/, a Cloudflare Worker): computers connect with a
// WebSocket, the Apple Watch (no WebRTC, no WebSocket) with plain HTTP long polling.
// The host runs NBSim for everyone; guests send inputs and draw the host's snapshots.
// Up to 3 guests per room. Exposes window.NBNet.
(function () {
  'use strict';

  // Our relay (relay/ in this repo, a Cloudflare Worker). Override with ?relay=URL for testing.
  var RELAY = (location.search.match(/[?&]relay=([^&]+)/) || [])[1];
  RELAY = RELAY ? decodeURIComponent(RELAY) : 'https://neonbrawl-relay.quasar-afternoon.workers.dev';
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

  function makeCode() {
    var c = '';
    for (var i = 0; i < 5; i++) c += CHARS[Math.floor(Math.random() * CHARS.length)];
    return c;
  }
  function makeId() { return Math.random().toString(36).slice(2, 12); }

  // ---------------- Transports to the relay ----------------
  // Both give { send(to, msg), end() } and call cb.open(), cb.message(msg), cb.close(wasOpen, why).
  // 'to' is 'h' (the host), 'a' (every guest) or a player id.
  var hasWS = typeof WebSocket !== 'undefined';
  var hasHTTP = typeof XMLHttpRequest !== 'undefined' || typeof fetch !== 'undefined';
  N.supported = function () { return hasWS || hasHTTP; };

  // Computers: one WebSocket.
  function wsTransport(code, id, host, cb) {
    var open = false, done = false, ws;
    function fail() { if (done) return; done = true; cb.close(open); }
    try { ws = new WebSocket(RELAY.replace(/^http/, 'ws') + '/r/' + code + '/ws?id=' + id + (host ? '&host=1' : '')); }
    catch (e) { setTimeout(fail, 0); return { send: function () {}, end: function () {} }; }
    var t = setTimeout(function () { if (!open) { try { ws.close(); } catch (e) {} fail(); } }, 8000);
    ws.onopen = function () { open = true; clearTimeout(t); cb.open(); };
    ws.onmessage = function (e) {
      var list;
      try { list = JSON.parse(e.data); } catch (err) { return; }
      for (var i = 0; i < list.length && !done; i++) cb.message(list[i]);
    };
    ws.onerror = ws.onclose = function () { clearTimeout(t); fail(); };
    return {
      send: function (to, msg) { if (open && !done && ws.readyState === 1) ws.send(JSON.stringify([[to, msg]])); },
      end: function () { done = true; clearTimeout(t); try { ws.close(); } catch (e) {} }
    };
  }

  // Apple Watch: plain HTTP. A long poll waits for incoming messages; outgoing ones are batched
  // into one request every 100 ms to keep the request count down.
  function post(url, body, cb, timeout) {
    var data = JSON.stringify(body), finished = false;
    function end(err, res) { if (!finished) { finished = true; cb(err, res); } }
    if (typeof XMLHttpRequest !== 'undefined') {
      var x = new XMLHttpRequest();
      x.open('POST', url, true);
      x.setRequestHeader('Content-Type', 'text/plain'); // a "simple" request: no CORS preflight
      x.timeout = timeout;
      x.onload = function () {
        if (x.status !== 200) { end(new Error('status ' + x.status)); return; }
        try { end(null, JSON.parse(x.responseText)); } catch (e) { end(e); }
      };
      x.onerror = x.ontimeout = function () { end(new Error('network')); };
      x.send(data);
    } else {
      fetch(url, { method: 'POST', body: data, headers: { 'Content-Type': 'text/plain' } })
        .then(function (r) { if (r.status !== 200) throw new Error('status ' + r.status); return r.json(); })
        .then(function (j) { end(null, j); }, function (e) { end(e); });
      setTimeout(function () { end(new Error('timeout')); }, timeout);
    }
  }
  function httpTransport(code, id, host, cb) {
    var base = RELAY + '/r/' + code + '/', open = false, done = false, since = 0, fails = 0, out = [], flushT = 0;
    function poll() {
      if (done) return;
      var started = Date.now();
      post(base + 'poll', { id: id, host: host ? 1 : 0, since: since, wait: open ? 1 : 0 }, function (err, r) {
        if (done) return;
        if (r && r.error === 'taken') { done = true; cb.close(false, 'taken'); return; }
        if (err || !r || !r.msgs) {
          if (++fails >= 3) { done = true; cb.close(open); return; }
          setTimeout(poll, 800);
          return;
        }
        fails = 0;
        if (!open) { open = true; cb.open(); }
        for (var i = 0; i < r.msgs.length && !done; i++) {
          since = Math.max(since, r.msgs[i][0]);
          cb.message(r.msgs[i][1]);
        }
        setTimeout(poll, Math.max(0, 100 - (Date.now() - started)));
      }, 30000);
    }
    function flush() {
      flushT = 0;
      if (!out.length) return;
      var batch = out;
      out = [];
      post(base + 'send', { id: id, msgs: batch }, function () {}, 10000);
    }
    poll();
    return {
      send: function (to, msg) { if (done) return; out.push([to, msg]); if (!flushT) flushT = setTimeout(flush, 100); },
      end: function () { clearTimeout(flushT); flush(); done = true; }
    };
  }
  function connect(code, id, host, cb) { return (hasWS ? wsTransport : httpTransport)(code, id, host, cb); }

  N.close = function () {
    session++;
    timers.forEach(function (t) { clearTimeout(t); clearInterval(t); });
    timers = [];
    var mq = N.mq;
    if (mq) {
      if (N.role === 'host') mq.send('a', { t: '_closed' });
      else if (N.role === 'guest') mq.send('h', { f: N.id, m: { t: '_bye' } });
      setTimeout(function () { mq.end(); }, 50);
    }
    N.role = null; N.mq = null; N.guests = []; N.started = false;
  };

  // ---------------- Host ----------------
  function toGuest(id, msg) { if (N.mq) N.mq.send(id, msg); }
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
      N.guests.push({ id: d.f, client: m.client === 'watch' || m.client === 'phone' ? m.client : 'desktop', fidx: -1, input: { mx: 0, mz: 0, block: false, c: [0, 0, 0, 0] }, seen: [0, 0, 0, 0], last: now() });
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
    var tries = 0;
    (function attempt() {
      if (my !== session) return;
      var code = makeCode(), id = makeId();
      var mq = connect(code, id, true, {
        open: function () {
          if (my !== session) { mq.end(); return; }
          N.role = 'host'; N.code = code; N.id = id; N.mq = mq; N.hostClient = client; N.guests = []; N.started = false;
          broadcastLobby();
          // Keep-alive both ways: ping guests, and drop guests we haven't heard from.
          every(function () {
            mq.send('a', { t: '_ping' });
            N.guests.slice().forEach(function (g) { if (now() - g.last > 10000) dropGuest(g); });
          }, 2000);
        },
        message: function (msg) { if (my === session) hostMessage(msg); },
        close: function (wasOpen) {
          if (my !== session) return;
          if (!wasOpen) {
            // Usually the code was taken (or a blip): try a fresh code a couple of times.
            if (++tries < 3) { setTimeout(attempt, 300); return; }
            call('status', "Couldn't reach the game server. Check your internet connection.");
            return;
          }
          N.mq = null;
          N.close();
          call('closed', 'Lost the connection to the game server.');
        }
      });
    })();
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
  N.sendSnap = function (snap) { if (N.role === 'host' && N.mq && N.guests.length) N.mq.send('a', snap); };
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
    var my = session, id = makeId(), lastHost = 0;
    N.id = id;
    var mq = connect(code, id, false, {
      open: function () {
        if (my !== session) { mq.end(); return; }
        N.mq = mq; N.code = code;
        var ask = function () { mq.send('h', { f: id, m: { t: '_join', client: client } }); };
        ask();
        var retry = every(function () { if (N.role !== 'guest') ask(); else clearInterval(retry); }, 1500);
        later(function () {
          if (N.role !== 'guest') { N.close(); call('status', 'No open room with code ' + code + '.'); }
        }, 8000);
      },
      message: function (m) {
        if (my !== session) return;
        if (N.role !== 'guest') {
          if (m.t === '_ok') {
            N.role = 'guest'; N.counts = [0, 0, 0, 0]; lastHost = now();
            call('joined');
            every(function () {
              mq.send('h', { f: id, m: { t: '_ping' } });
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
      N.mq.send('h', { f: N.id, m: msg });
      lastC = c; lastKey = key; lastT = t;
    }
  };
  N.requestRematch = function () { if (N.role === 'guest' && N.mq) N.mq.send('h', { f: N.id, m: { t: 'rematch' } }); };

  window.NBNet = N;
})();
