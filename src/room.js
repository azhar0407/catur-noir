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
      const id = url.searchParams.get('c');
      if (this.created) return json({ ok: false });
      this.created = true;
      this.players[id] = 'w';
      await this.ctx.storage.put({ created: 1, players: this.players });
      return json({ ok: true, color: 'w' });
    }

    // Direktori sederhana: pemetaan id pemain -> kode ruang.
    if (url.pathname === '/dir-get') {
      const room = await this.ctx.storage.get('dir-room');
      return json(room ? { room } : {});
    }
    if (url.pathname === '/dir-set') {
      const room = url.searchParams.get('r');
      if (!room) return json({ ok: false }, 400);
      await this.ctx.storage.put('dir-room', room);
      return json({ ok: true });
    }

    if (url.pathname === '/ws') {
      const id = url.searchParams.get('c');
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
    let mv = null;
    try { mv = this.game.move({ from: d.from, to: d.to, promotion: d.promotion || 'q' }); }
    catch { mv = null; }
    if (!mv) return this.send(ws, { t: 'error', error: 'langkah tidak sah' });
    await this.ctx.storage.put('fen', this.game.fen());
    this.broadcastState({ from: mv.from, to: mv.to });
  }

  broadcastState(last = null) {
    const msg = { t: 'state', fen: this.game.fen(), players: this.activeCount(), last };
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
  return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
}
