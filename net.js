// Neon Brawl online rooms, shared by the full game and the watch edition.
// Peer-to-peer over WebRTC via PeerJS. The host runs NBSim for everyone; guests send
// inputs and draw the host's snapshots. Up to 3 guests per room. Exposes window.NBNet.
(function () {
  'use strict';

  var PREFIX = 'neonbrawl-v2-';
  var MAX_GUESTS = 3;
  var N = {
    role: null, // 'host' | 'guest' | null
    code: '', peer: null, conn: null,
    guests: [], // host side: { conn, client, fidx, input, seen }
    started: false,
    counts: [0, 0, 0, 0], // guest side: press counters for jump, punch, kick, super
    timer: 0,
    h: {} // handlers: status(text), lobby(info), joined(), start(msg), snap(msg), rematch(), left(fidx), closed(text)
  };
  function call(name, a) { if (N.h[name]) N.h[name](a); }

  N.supported = function () { return !!(window.RTCPeerConnection || window.webkitRTCPeerConnection); };

  function loadPeer(cb) {
    if (window.Peer) { cb(); return; }
    var s = document.createElement('script');
    s.src = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js';
    s.onload = cb;
    s.onerror = function () { call('status', 'Online play could not load. Check your internet connection.'); };
    document.head.appendChild(s);
  }
  function makeCode() {
    var A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', c = '';
    for (var i = 0; i < 5; i++) c += A[Math.floor(Math.random() * A.length)];
    return c;
  }

  N.close = function () {
    clearTimeout(N.timer);
    var peer = N.peer, conn = N.conn, guests = N.guests;
    N.role = null; N.peer = null; N.conn = null; N.guests = []; N.started = false;
    try { if (conn) conn.close(); } catch (e) {}
    guests.forEach(function (g) { try { g.conn.close(); } catch (e) {} });
    try { if (peer) peer.destroy(); } catch (e) {}
  };

  // ---------------- Host ----------------
  function lobbyInfo() {
    return { players: [N.hostClient].concat(N.guests.map(function (g) { return g.client; })), code: N.code };
  }
  function broadcastLobby() {
    var info = lobbyInfo();
    call('lobby', info);
    N.guests.forEach(function (g, i) {
      if (g.conn.open) g.conn.send({ t: 'lobby', players: info.players, you: i + 1, code: N.code });
    });
  }
  function findGuest(conn) {
    for (var i = 0; i < N.guests.length; i++) if (N.guests[i].conn === conn) return N.guests[i];
    return null;
  }

  N.host = function (client) {
    if (!N.supported()) { call('status', "This browser can't make the peer-to-peer connections online play needs."); return; }
    call('status', 'Opening a room…');
    loadPeer(function () {
      N.close();
      N.role = 'host'; N.hostClient = client; N.code = makeCode();
      var peer = N.peer = new window.Peer(PREFIX + N.code);
      peer.on('open', function () { broadcastLobby(); });
      peer.on('connection', function (conn) {
        conn.on('open', function () {
          if (N.role !== 'host') { conn.close(); return; }
          if (N.started || N.guests.length >= MAX_GUESTS) {
            conn.send({ t: 'full', started: N.started });
            setTimeout(function () { conn.close(); }, 400);
            return;
          }
          N.guests.push({ conn: conn, client: 'desktop', fidx: -1, input: { mx: 0, mz: 0, block: false, c: [0, 0, 0, 0] }, seen: [0, 0, 0, 0] });
          broadcastLobby();
        });
        conn.on('data', function (msg) {
          var g = findGuest(conn);
          if (!g || !msg) return;
          if (msg.t === 'hello') { g.client = msg.client === 'watch' ? 'watch' : 'desktop'; broadcastLobby(); }
          else if (msg.t === 'in') g.input = msg;
          else if (msg.t === 'rematch') call('rematch');
        });
        conn.on('close', function () {
          var g = findGuest(conn);
          if (!g) return;
          N.guests.splice(N.guests.indexOf(g), 1);
          broadcastLobby();
          if (g.fidx >= 0) call('left', g.fidx);
        });
      });
      peer.on('error', function (e) {
        if (e.type === 'peer-unavailable') return; // a guest vanished; harmless
        call('status', e.type === 'unavailable-id' ? 'That room code is taken. Try hosting again.' : 'Online error: ' + e.type + '. Try again.');
      });
    });
  };

  // Guests take fighter slots 1, 2, 3 in join order. Returns how many guests there are.
  N.startMatch = function (slots, extra) {
    N.started = true;
    N.guests.forEach(function (g, i) {
      g.fidx = i + 1;
      g.seen = g.input.c ? g.input.c.slice() : [0, 0, 0, 0];
      if (g.conn.open) g.conn.send({ t: 'start', you: g.fidx, slots: slots, roundTime: extra.roundTime, profile: extra.profile });
    });
  };
  N.guestCount = function () { return N.guests.length; };
  N.sendSnap = function (snap) {
    N.guests.forEach(function (g) { if (g.conn.open) g.conn.send(snap); });
  };
  var BTN = ['jump', 'punch', 'kick', 'super'];
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
    if (!N.supported()) { call('status', "This browser can't make the peer-to-peer connections online play needs."); return; }
    call('status', 'Connecting…');
    loadPeer(function () {
      N.close();
      N.timer = setTimeout(function () {
        if (N.role !== 'guest') { N.close(); call('status', 'Could not reach room ' + code + '. Check the code and try again.'); }
      }, 15000);
      var peer = N.peer = new window.Peer();
      peer.on('open', function () {
        var conn = N.conn = peer.connect(PREFIX + code, { reliable: true });
        conn.on('open', function () {
          clearTimeout(N.timer);
          N.role = 'guest'; N.code = code; N.counts = [0, 0, 0, 0];
          conn.send({ t: 'hello', client: client });
          call('joined');
        });
        conn.on('data', function (msg) {
          if (!msg) return;
          if (msg.t === 's') call('snap', msg);
          else if (msg.t === 'lobby') call('lobby', msg);
          else if (msg.t === 'start') call('start', msg);
          else if (msg.t === 'full') call('status', msg.started ? 'That match has already started.' : 'That room is full (4 fighters max).');
        });
        conn.on('close', function () {
          if (N.role !== 'guest') return;
          N.close();
          call('closed', 'The host closed the room.');
        });
      });
      peer.on('error', function (e) {
        clearTimeout(N.timer);
        call('status', e.type === 'peer-unavailable' ? 'No open room with code ' + code + '.' : 'Online error: ' + e.type + '. Try again.');
      });
    });
  };
  // inp: { mx, mz, block, jump, punch, kick, super } with button presses as one-frame booleans.
  N.sendInput = function (inp) {
    if (!N.conn || !N.conn.open) return;
    for (var b = 0; b < 4; b++) if (inp[BTN[b]]) N.counts[b]++;
    N.conn.send({ t: 'in', mx: Math.round(inp.mx * 1000) / 1000, mz: Math.round(inp.mz * 1000) / 1000, block: !!inp.block, c: N.counts.slice() });
  };
  N.requestRematch = function () { if (N.conn && N.conn.open) N.conn.send({ t: 'rematch' }); };

  window.NBNet = N;
})();
