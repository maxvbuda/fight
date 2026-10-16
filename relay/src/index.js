// Neon Brawl relay. One Durable Object per room code keeps a mailbox for each player and passes
// messages between them. It doesn't understand the game: clients address messages to
// 'h' (the host), 'a' (every guest) or a player id.
//
// Two ways in, mixed freely in one room:
//   GET  /r/CODE/ws?id=ID[&host=1]   WebSocket (computers)
//   POST /r/CODE/poll {id, host, since, wait}   long poll for messages (Apple Watch: no WebSocket)
//   POST /r/CODE/send {id, msgs: [[to, msg], ...]}
// POST bodies are sent as text/plain so browsers skip the CORS preflight.
import { DurableObject } from 'cloudflare:workers';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS } });

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const m = new URL(req.url).pathname.match(/^\/r\/([A-Z0-9]{5})\/(ws|poll|send)$/);
    if (!m) return new Response('Neon Brawl relay', { headers: CORS });
    return env.ROOM.get(env.ROOM.idFromName(m[1])).fetch(req);
  },
};

const POLL_WAIT = 20000; // longest a poll is held open with nothing to deliver
const STALE = 30000; // forget polling players we haven't heard from in this long
const MAX_QUEUE = 300;

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.boxes = new Map(); // id -> { q: [[seq, msg]], seq, waiters: [], ws, last }
    this.host = null;
  }

  async fetch(req) {
    const url = new URL(req.url);
    const kind = url.pathname.split('/').pop();
    this.prune();
    if (kind === 'ws') {
      if (req.headers.get('Upgrade') !== 'websocket') return json({ error: 'expected websocket' }, 426);
      const id = (url.searchParams.get('id') || '').slice(0, 32);
      if (!id) return json({ error: 'missing id' }, 400);
      if (url.searchParams.get('host') && !this.claimHost(id)) return json({ error: 'taken' }, 409);
      const [client, server] = Object.values(new WebSocketPair());
      server.accept();
      const b = this.box(id);
      if (b.ws) try { b.ws.close(); } catch (e) {}
      b.ws = server;
      if (b.q.length) { server.send(JSON.stringify(b.q.map((x) => x[1]))); b.q = []; }
      server.addEventListener('message', (e) => {
        b.last = Date.now();
        let d;
        try { d = JSON.parse(e.data); } catch (err) { return; }
        if (Array.isArray(d)) for (const x of d) if (Array.isArray(x)) this.route(id, x[0], x[1]);
      });
      const gone = () => { if (b.ws === server) { b.ws = null; this.leave(id); } };
      server.addEventListener('close', gone);
      server.addEventListener('error', gone);
      return new Response(null, { status: 101, webSocket: client });
    }

    if (req.method !== 'POST') return json({ error: 'use POST' }, 405);
    let body;
    try { body = JSON.parse(await req.text()); } catch (e) { return json({ error: 'bad json' }, 400); }
    const id = String(body.id || '').slice(0, 32);
    if (!id) return json({ error: 'missing id' }, 400);

    if (kind === 'send') {
      if (this.boxes.has(id)) this.boxes.get(id).last = Date.now();
      if (Array.isArray(body.msgs)) for (const x of body.msgs.slice(0, 100)) if (Array.isArray(x)) this.route(id, x[0], x[1]);
      return json({ ok: 1 });
    }

    // poll
    if (body.host && !this.claimHost(id)) return json({ error: 'taken' });
    const b = this.box(id);
    b.last = Date.now();
    const since = +body.since || 0;
    b.q = b.q.filter((x) => x[0] > since);
    if (!b.q.length && body.wait) {
      await new Promise((res) => {
        const t = setTimeout(res, POLL_WAIT);
        b.waiters.push(() => { clearTimeout(t); res(); });
      });
      b.last = Date.now();
    }
    return json({ msgs: b.q });
  }

  box(id) {
    let b = this.boxes.get(id);
    if (!b) { b = { q: [], seq: 0, waiters: [], ws: null, last: Date.now() }; this.boxes.set(id, b); }
    return b;
  }
  claimHost(id) {
    if (this.host && this.host !== id && this.boxes.has(this.host)) return false;
    this.host = id;
    return true;
  }
  deliver(id, msg) {
    const b = this.boxes.get(id);
    if (!b) return;
    if (b.ws) { try { b.ws.send(JSON.stringify([msg])); } catch (e) {} return; }
    b.q.push([++b.seq, msg]);
    if (b.q.length > MAX_QUEUE) b.q.splice(0, b.q.length - MAX_QUEUE);
    for (const w of b.waiters.splice(0)) w();
  }
  route(from, to, msg) {
    if (to === 'a') { for (const id of this.boxes.keys()) if (id !== from && id !== this.host) this.deliver(id, msg); }
    else if (to === 'h') { if (this.host && this.host !== from) this.deliver(this.host, msg); }
    else if (typeof to === 'string' && to !== from) this.deliver(to, msg);
  }
  // A player disconnected: tell the others, like the game's own "bye" and "closed" messages.
  leave(id) {
    this.boxes.delete(id);
    if (id === this.host) { this.route(id, 'a', { t: '_closed' }); this.host = null; }
    else this.route(id, 'h', { f: id, m: { t: '_bye' } });
  }
  prune() {
    const now = Date.now();
    for (const [id, b] of this.boxes) if (!b.ws && !b.waiters.length && now - b.last > STALE) this.leave(id);
  }
}
