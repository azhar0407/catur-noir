// Durable Object Room: satu instance per kode ruang.
// State: papan (chess.js), pemain (id -> warna), status. Persist via storage KV (pgn, fen, players, created).
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
    this.over = false;
    this.resign = null;
  }

  async load() {
    if (this.loaded) return;
    const [pgn, fen, players, created, over, resign] = await Promise.all([
      this.ctx.storage.get('pgn'),
      this.ctx.storage.get('fen'),
      this.ctx.storage.get('players'),
      this.ctx.storage.get('created'),
      this.ctx.storage.get('over'),
      this.ctx.storage.get('resign'),
    ]);
    this.game = new Chess();
    if (pgn) {
      try { this.game.loadPgn(pgn); } catch { if (fen) try { this.game.load(fen); } catch {} }
    } else if (fen) {
      try { this.game.load(fen); } catch {}
    }
    this.players = players || {};
    this.created = !!created;
    this.over = !!over;
    this.resign = resign || null;
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
      this.game = new Chess(START);
      this.over = false;
      this.resign = null;
      this.players = { [id]: 'w' };
      await this.ctx.storage.put({
        created: 1,
        players: this.players,
        fen: this.game.fen(),
        pgn: this.game.pgn(),
        over: 0,
        lastActivity: Date.now(),
      });
      await this.schedulePrune(3600000);
      return json({ ok: true, color: 'w' });
    }

    if (url.pathname === '/info') {
      return json({
        ok: true,
        created: this.created,
        over: this.over || (this.game ? this.game.isGameOver() : false),
        players: this.activeCount(),
      });
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
      if (!this.created) return json({ error: 'ruang belum dibuat' }, 404);
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
        await this.ctx.storage.put({ players: this.players, lastActivity: Date.now() });
      }
    }
    socket.serializeAttachment({ id, color });
    this.send(socket, {
      t: 'init',
      you: color,
      fen: this.game.fen(),
      history: this.game.history(),
      players: this.activeCount(),
      over: this.over || this.game.isGameOver(),
      resign: this.resign,
      online: this.onlineStatus(),
    });
    if (color !== 'spectator') this.broadcastState();
    return color;
  }

  async webSocketMessage(ws, msg) {
    await this.load();
    let d;
    try { d = JSON.parse(msg); } catch { return; }
    if (d.t === 'ping') return this.send(ws, { t: 'pong' });

    if (d.t === 'resign') {
      const att = ws.deserializeAttachment() || {};
      const color = att.color || this.players[att.id];
      if (!color || color === 'spectator' || this.over) return;
      this.over = true;
      this.resign = color;
      await this.ctx.storage.put({ over: 1, resign: color, lastActivity: Date.now() });
      this.broadcastState();
      return;
    }

    if (d.t !== 'move') return;
    if (this.over) return this.send(ws, { t: 'error', error: 'permainan sudah selesai' });
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
    this.over = this.game.isGameOver();
    await this.ctx.storage.put({
      fen: this.game.fen(),
      pgn: this.game.pgn(),
      over: this.over ? 1 : 0,
      lastActivity: Date.now(),
    });
    this.broadcastState({ from: mv.from, to: mv.to });
  }

  async webSocketClose(ws, code, reason, wasClean) {
    this.broadcastState();
    await this.schedulePrune();
  }

  async webSocketError(ws, error) {
    this.broadcastState();
    await this.schedulePrune();
  }

  async schedulePrune(delayMs = 3600000) {
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

    const lastActivity = (await this.ctx.storage.get('lastActivity')) || 0;
    const idleMs = Date.now() - lastActivity;
    const maxIdleMs = 2 * 3600 * 1000; // 2 jam

    // Jika masih ada pemain terhubung, perpanjang alarm
    if (liveIds.size > 0) {
      await this.ctx.storage.setAlarm(Date.now() + 3600000);
      return;
    }

    // Jika idle > 2 jam dan tanpa pemain terhubung, bersihkan ruang
    if (idleMs >= maxIdleMs) {
      this.game = new Chess(START);
      this.created = false;
      this.over = false;
      this.resign = null;
      this.players = {};
      await this.ctx.storage.deleteAll();
    } else {
      await this.ctx.storage.setAlarm(Date.now() + Math.max(60000, maxIdleMs - idleMs));
    }
  }

  broadcastState(last = null) {
    const msg = {
      t: 'state',
      fen: this.game.fen(),
      players: this.activeCount(),
      history: this.game.history(),
      over: this.over || this.game.isGameOver(),
      resign: this.resign,
      online: this.onlineStatus(),
      last,
    };
    for (const s of this.ctx.getWebSockets()) this.send(s, msg);
  }

  // Hitung pemain terdaftar (maks 2).
  activeCount() {
    return new Set(Object.values(this.players).filter(c => c === 'w' || c === 'b')).size;
  }

  onlineStatus() {
    const liveIds = new Set();
    for (const ws of this.ctx.getWebSockets()) {
      try {
        const att = ws.deserializeAttachment();
        if (att && att.id) liveIds.add(att.id);
      } catch {}
    }
    const status = { w: false, b: false };
    for (const [id, color] of Object.entries(this.players)) {
      if (liveIds.has(id)) {
        if (color === 'w') status.w = true;
        if (color === 'b') status.b = true;
      }
    }
    return status;
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
