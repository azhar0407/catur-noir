// Durable Object Room: satu instance per kode ruang.
// State: papan (chess.js), pemain (id -> warna), status. Persist via storage KV.
import { Chess } from 'chess.js';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export class Room {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.loaded = false;
    this.game = null;
    this.players = {};
    this.created = false;
  }

  async load() {
    if (this.loaded) return;
    const [fen, players, created] = await Promise.all([
      this.ctx.storage.get('fen'),
      this.ctx.storage.get('players'),
      this.ctx.storage.get('created'),
    ]);
    this.game = new Chess(fen || START);
    this.players = players || {};
    this.created = !!created;
    this.loaded = true;
  }

  async fetch(req) {
    await this.load();
    const url = new URL(req.url);

    if (url.pathname === '/create') {
      const id = (url.searchParams.get('c') || '').trim();
      if (!id || id === 'null' || id === 'undefined') return json({ ok: false }, 400);
      if (this.created) return json({ ok: false });
      this.created = true;
      this.players[id] = 'w';
      await this.ctx.storage.put({ created: 1, players: this.players });
      await this.schedulePrune();
      return json({ ok: true, color: 'w' });
    }

    // Direktori sederhana: pemetaan id pemain -> kode ruang.
    if (url.pathname === '/dir-get') {
      const room = await this.ctx.storage.get('dir-room');
      return json(room ? { room } : {});
    }
    if (url.pathname === '/dir-set') {
      const room = (url.searchParams.get('r') || '').trim().toUpperCase();
      if (!room) return json({ ok: false }, 400);
      await this.ctx.storage.put('dir-room', room);
      return json({ ok: true });
    }

    if (url.pathname === '/ws') {
      const id = (url.searchParams.get('c') || '').trim();
      if (!id || id === 'null' || id === 'undefined') return json({ error: 'id tidak valid' }, 400);
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      const color = await this.join(id, pair[1]);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }

    return json({ error: 'tidak ditemukan' }, 404);
  }

  // Terima pemain: pertahankan warna lama untuk reconnect, atau beri slot bebas.
  async join(id, socket) {
    let color = this.players[id];
    if (!color) {
      const taken = Object.values(this.players);
      if (!taken.includes('w')) color = 'w';
      else if (!taken.includes('b')) color = 'b';
      else color = 'spectator';
      if (color !== 'spectator') {
        this.players[id] = color;
        await this.ctx.storage.put('players', this.players);
      }
    }
    socket.serializeAttachment({ id, color });
    this.send(socket, {
      t: 'init',
      you: color,
      fen: this.game.fen(),
      history: this.game.history(),
      players: this.activeCount(),
    });
    if (color !== 'spectator') this.broadcastState();
    return color;
  }

  async webSocketMessage(ws, msg) {
    await this.load();
    let d;
    try { d = JSON.parse(msg); } catch { return; }
    if (d.t !== 'move') return;
    const att = ws.deserializeAttachment() || {};
    const color = att.color || this.players[att.id];
    const turn = this.game.turn();
    if (!color || color === 'spectator' || color !== turn) {
      return this.send(ws, { t: 'error', error: 'bukan giliranmu' });
    }
    const promo = (typeof d.promotion === 'string' && ['q', 'r', 'b', 'n'].includes(d.promotion.toLowerCase()))
      ? d.promotion.toLowerCase()
      : 'q';
    let mv = null;
    try { mv = this.game.move({ from: d.from, to: d.to, promotion: promo }); }
    catch { mv = null; }
    if (!mv) return this.send(ws, { t: 'error', error: 'langkah tidak sah' });
    await this.ctx.storage.put('fen', this.game.fen());
    this.broadcastState({ from: mv.from, to: mv.to });
  }

  async webSocketClose(ws, code, reason, wasClean) {
    await this.schedulePrune();
  }

  async webSocketError(ws, error) {
    await this.schedulePrune();
  }

  async schedulePrune(delayMs = 60000) {
    const existing = await this.ctx.storage.getAlarm();
    if (!existing) {
      await this.ctx.storage.setAlarm(Date.now() + delayMs);
    }
  }

  async alarm() {
    await this.load();
    const liveIds = new Set();
    for (const ws of this.ctx.getWebSockets()) {
      try {
        const att = ws.deserializeAttachment();
        if (att && att.id) liveIds.add(att.id);
      } catch {}
    }

    let changed = false;
    for (const [id, color] of Object.entries(this.players)) {
      if (!liveIds.has(id)) {
        delete this.players[id];
        changed = true;
      }
    }

    if (changed) {
      if (Object.keys(this.players).length === 0) {
        this.game = new Chess(START);
        this.created = false;
        await this.ctx.storage.deleteAll();
      } else {
        if (!Object.values(this.players).includes('w')) {
          this.created = false;
          await this.ctx.storage.delete('created');
        }
        await this.ctx.storage.put('players', this.players);
      }
      this.broadcastState();
    }
  }

  broadcastState(last = null) {
    const msg = { t: 'state', fen: this.game.fen(), players: this.activeCount(), history: this.game.history(), last };
    for (const s of this.ctx.getWebSockets()) this.send(s, msg);
  }

  // Hitung slot warna yang sudah terisi (maks 2).
  activeCount() {
    return new Set(Object.values(this.players).filter(c => c === 'w' || c === 'b')).size;
  }

  send(socket, msg) {
    try { socket.send(JSON.stringify(msg)); } catch {}
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'content-type': 'application/json',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'referrer-policy': 'strict-origin-when-cross-origin',
    },
  });
}
