// Durable Object Room: satu instance per kode ruang.
// State: papan (chess.js), pemain (id -> warna), status, timer, riwayat PGN.
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
    this.creatorId = null;
    this.status = null;
    this.timeControl = 0;
    this.clocks = null;
    this.drawOfferedBy = null;
    this.rematchOfferedBy = null;
  }

  async load() {
    if (this.loaded) return;
    const [pgn, fen, players, created, creatorId, status, timeControl, clocks, over, resign] = await Promise.all([
      this.ctx.storage.get('pgn'),
      this.ctx.storage.get('fen'),
      this.ctx.storage.get('players'),
      this.ctx.storage.get('created'),
      this.ctx.storage.get('creatorId'),
      this.ctx.storage.get('status'),
      this.ctx.storage.get('timeControl'),
      this.ctx.storage.get('clocks'),
      this.ctx.storage.get('over'),
      this.ctx.storage.get('resign'),
    ]);

    this.game = new Chess();
    if (pgn) {
      try { this.game.loadPgn(pgn); }
      catch { if (fen) try { this.game.load(fen); } catch {} }
    } else if (fen) {
      try { this.game.load(fen); } catch {}
    }

    this.players = players || {};
    this.created = !!created;
    this.creatorId = creatorId || null;
    this.status = status || (over ? { over: true, result: resign ? 'resign' : 'finished', winner: resign === 'w' ? 'b' : (resign === 'b' ? 'w' : null) } : null);
    this.timeControl = typeof timeControl === 'number' ? timeControl : 0;
    this.clocks = clocks || (this.timeControl > 0 ? {
      w: this.timeControl * 1000,
      b: this.timeControl * 1000,
      lastMoveTs: null,
      started: false,
    } : null);

    this.drawOfferedBy = null;
    this.rematchOfferedBy = null;
    this.loaded = true;
  }

  checkTimeout() {
    if (this.timeControl > 0 && this.clocks && this.clocks.started && !this.isGameOver() && this.clocks.lastMoveTs) {
      const turn = this.game.turn();
      const elapsed = Date.now() - this.clocks.lastMoveTs;
      if (elapsed >= this.clocks[turn]) {
        this.clocks[turn] = 0;
        this.status = { over: true, result: 'timeout', winner: turn === 'w' ? 'b' : 'w' };
        return true;
      }
    }
    return false;
  }

  isGameOver() {
    if (this.status && this.status.over) return true;
    return this.game ? this.game.isGameOver() : false;
  }

  getClocks() {
    if (!this.timeControl || this.timeControl <= 0 || !this.clocks) return null;
    const turn = this.game ? this.game.turn() : 'w';
    let remW = this.clocks.w;
    let remB = this.clocks.b;
    if (this.clocks.started && !this.isGameOver() && this.clocks.lastMoveTs) {
      const elapsed = Date.now() - this.clocks.lastMoveTs;
      if (turn === 'w') remW = Math.max(0, remW - elapsed);
      else remB = Math.max(0, remB - elapsed);
    }
    return {
      w: remW,
      b: remB,
      activeTurn: this.isGameOver() || !this.clocks.started ? null : turn,
    };
  }

  async fetch(req) {
    await this.load();
    const url = new URL(req.url);

    if (url.pathname === '/create') {
      const id = (url.searchParams.get('c') || '').trim();
      const tc = Math.max(0, parseInt(url.searchParams.get('t') || '0', 10) || 0);
      let side = (url.searchParams.get('side') || 'w').toLowerCase();
      if (side === 'rnd') side = Math.random() < 0.5 ? 'w' : 'b';
      if (side !== 'w' && side !== 'b') side = 'w';
      if (!id || id === 'null' || id === 'undefined') return json({ ok: false }, 400);
      if (this.created) return json({ ok: false });

      this.created = true;
      this.creatorId = id;
      this.game = new Chess(START);
      this.status = null;
      this.players = { [id]: side };
      this.timeControl = tc;
      this.clocks = tc > 0 ? { w: tc * 1000, b: tc * 1000, lastMoveTs: null, started: false } : null;

      await this.ctx.storage.put({
        created: 1,
        players: this.players,
        creatorId: id,
        timeControl: tc,
        clocks: this.clocks,
        fen: this.game.fen(),
        pgn: this.game.pgn(),
        status: null,
        over: 0,
        lastActivity: Date.now(),
      });
      await this.schedulePrune(3600000);
      return json({ ok: true, color: side });
    }

    if (url.pathname === '/info' || url.pathname === '/status') {
      return json({
        ok: true,
        created: this.created,
        active: this.created && !this.isGameOver() && Object.keys(this.players).length > 0,
        over: this.isGameOver(),
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
    if (url.pathname === '/dir-clear') {
      await this.ctx.storage.delete('dir-room');
      return json({ ok: true });
    }

    if (url.pathname === '/ws') {
      const id = (url.searchParams.get('c') || '').trim();
      if (!id || id === 'null' || id === 'undefined') return json({ error: 'id tidak valid' }, 400);
      if (!this.created) return json({ error: 'ruang belum dibuat' }, 404);
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      await this.join(id, pair[1]);
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
    const isOver = this.isGameOver();
    const resignColor = (this.status && this.status.result === 'resign') ? (this.status.winner === 'w' ? 'b' : 'w') : null;
    this.send(socket, {
      t: 'init',
      you: color,
      fen: this.game.fen(),
      history: this.game.history(),
      players: this.activeCount(),
      timers: this.getClocks(),
      status: this.status,
      over: isOver,
      resign: resignColor,
      online: this.onlineStatus(),
    });
    if (color !== 'spectator') this.broadcastState();
    return color;
  }

  async webSocketMessage(ws, msg) {
    await this.load();
    let d;
    try { d = JSON.parse(msg); } catch { return; }
    if (!d || typeof d !== 'object') return;
    if (d.t === 'ping') return this.send(ws, { t: 'pong' });

    const att = ws.deserializeAttachment() || {};
    const color = att.color || this.players[att.id];

    if (this.checkTimeout()) {
      await this.ctx.storage.put({ status: this.status, clocks: this.clocks, over: 1, lastActivity: Date.now() });
      this.broadcastState();
      return;
    }
    if (d.t === 'claim_timeout') return;

    // 1. Move
    if (d.t === 'move') {
      if (this.isGameOver()) return this.send(ws, { t: 'error', error: 'permainan sudah selesai' });
      const turn = this.game.turn();
      if (!color || color === 'spectator' || color !== turn) {
        return this.send(ws, { t: 'error', error: 'bukan giliranmu' });
      }

      // Potong waktu jika timer aktif
      if (this.timeControl > 0 && this.clocks) {
        const now = Date.now();
        if (this.clocks.started && this.clocks.lastMoveTs) {
          const elapsed = now - this.clocks.lastMoveTs;
          this.clocks[turn] = Math.max(0, this.clocks[turn] - elapsed);
          if (this.clocks[turn] <= 0) {
            this.status = { over: true, result: 'timeout', winner: turn === 'w' ? 'b' : 'w' };
            await this.ctx.storage.put({ status: this.status, clocks: this.clocks, over: 1, lastActivity: Date.now() });
            this.broadcastState();
            return;
          }
        }
        this.clocks.started = true;
        this.clocks.lastMoveTs = now;
      }

      const promo = (typeof d.promotion === 'string' && ['q', 'r', 'b', 'n'].includes(d.promotion.toLowerCase()))
        ? d.promotion.toLowerCase()
        : 'q';
      let mv = null;
      try { mv = this.game.move({ from: d.from, to: d.to, promotion: promo }); }
      catch { mv = null; }
      if (!mv) return this.send(ws, { t: 'error', error: 'langkah tidak sah' });

      // Cek apakah move menyebabkan game over (skakmat / pat / remis)
      if (this.game.isGameOver()) {
        this.status = {
          over: true,
          result: this.game.isCheckmate() ? 'checkmate' : 'draw',
          winner: this.game.isCheckmate() ? color : null,
        };
      }

      await this.ctx.storage.put({
        fen: this.game.fen(),
        pgn: this.game.pgn(),
        status: this.status,
        over: this.isGameOver() ? 1 : 0,
        clocks: this.clocks,
        lastActivity: Date.now(),
      });

      if (this.timeControl > 0 && this.clocks && !this.isGameOver()) {
        const nextRem = this.clocks[this.game.turn()];
        if (nextRem > 0) {
          await this.ctx.storage.setAlarm(Date.now() + nextRem + 500);
        }
      }

      this.broadcastState({ from: mv.from, to: mv.to });
      return;
    }

    // 2. Resign (Menyerah)
    if (d.t === 'resign') {
      if (this.isGameOver() || !color || color === 'spectator') return;
      this.status = { over: true, result: 'resign', winner: color === 'w' ? 'b' : 'w' };
      await this.ctx.storage.put({ status: this.status, over: 1, resign: color, lastActivity: Date.now() });
      this.broadcastState();
      return;
    }

    // 3. Draw Offer & Response
    if (d.t === 'draw_offer') {
      if (this.isGameOver() || !color || color === 'spectator') return;
      this.drawOfferedBy = color;
      for (const s of this.ctx.getWebSockets()) {
        const a = s.deserializeAttachment() || {};
        if (a.color && a.color !== color && a.color !== 'spectator') {
          this.send(s, { t: 'draw_offered', from: color });
        }
      }
      return;
    }

    if (d.t === 'draw_response') {
      if (!this.drawOfferedBy || this.drawOfferedBy === color) return;
      if (d.accept) {
        this.status = { over: true, result: 'draw_agreed' };
        this.drawOfferedBy = null;
        await this.ctx.storage.put({ status: this.status, over: 1, lastActivity: Date.now() });
        this.broadcastState();
      } else {
        const orig = this.drawOfferedBy;
        this.drawOfferedBy = null;
        for (const s of this.ctx.getWebSockets()) {
          const a = s.deserializeAttachment() || {};
          if (a.color === orig) this.send(s, { t: 'draw_declined' });
        }
      }
      return;
    }

    // 4. Rematch Offer & Response
    if (d.t === 'rematch_offer') {
      if (!this.isGameOver() || !color || color === 'spectator') return;
      this.rematchOfferedBy = color;
      for (const s of this.ctx.getWebSockets()) {
        const a = s.deserializeAttachment() || {};
        if (a.color && a.color !== color && a.color !== 'spectator') {
          this.send(s, { t: 'rematch_offered', from: color });
        }
      }
      return;
    }

    if (d.t === 'rematch_accept') {
      if (!this.isGameOver() || !this.rematchOfferedBy || this.rematchOfferedBy === color) return;
      // Tukar posisi warna pemain (w <-> b)
      for (const [pid, c] of Object.entries(this.players)) {
        if (c === 'w') this.players[pid] = 'b';
        else if (c === 'b') this.players[pid] = 'w';
      }

      this.game = new Chess(START);
      this.status = null;
      this.drawOfferedBy = null;
      this.rematchOfferedBy = null;
      if (this.timeControl > 0) {
        this.clocks = { w: this.timeControl * 1000, b: this.timeControl * 1000, lastMoveTs: null, started: false };
      }

      await this.ctx.storage.put({
        pgn: '',
        fen: START,
        players: this.players,
        status: null,
        over: 0,
        resign: null,
        clocks: this.clocks,
        lastActivity: Date.now(),
      });

      for (const s of this.ctx.getWebSockets()) {
        const a = s.deserializeAttachment() || {};
        if (a.id && this.players[a.id]) {
          const newCol = this.players[a.id];
          s.serializeAttachment({ id: a.id, color: newCol });
          this.send(s, {
            t: 'init',
            you: newCol,
            fen: this.game.fen(),
            history: [],
            players: this.activeCount(),
            timers: this.getClocks(),
            status: null,
            over: false,
            resign: null,
            online: this.onlineStatus(),
          });
        }
      }
      this.broadcastState();
    }
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

    // 1. Cek timeout jam pertandingan
    if (this.checkTimeout()) {
      await this.ctx.storage.put({ status: this.status, clocks: this.clocks, over: 1, lastActivity: Date.now() });
      this.broadcastState();
    }

    // 2. Cek koneksi aktif dan idle cleanup
    const liveIds = new Set();
    for (const ws of this.ctx.getWebSockets()) {
      try {
        const att = ws.deserializeAttachment();
        if (att && att.id) liveIds.add(att.id);
      } catch {}
    }

    const lastActivity = (await this.ctx.storage.get('lastActivity')) || 0;
    const idleMs = Date.now() - lastActivity;
    const maxIdleMs = 2 * 3600 * 1000;

    if (liveIds.size > 0) {
      await this.ctx.storage.setAlarm(Date.now() + 3600000);
      return;
    }

    if (idleMs >= maxIdleMs) {
      if (this.creatorId) {
        const dir = this.env.ROOM.get(this.env.ROOM.idFromName('id:' + this.creatorId));
        await dir.fetch('https://do/dir-clear').catch(() => {});
      }
      this.game = new Chess(START);
      this.created = false;
      this.status = null;
      this.players = {};
      await this.ctx.storage.deleteAll();
    } else {
      await this.ctx.storage.setAlarm(Date.now() + Math.max(60000, maxIdleMs - idleMs));
    }
  }

  broadcastState(last = null) {
    const isOver = this.isGameOver();
    const resignColor = (this.status && this.status.result === 'resign') ? (this.status.winner === 'w' ? 'b' : 'w') : null;
    const msg = {
      t: 'state',
      fen: this.game.fen(),
      pgn: this.game.pgn(),
      players: this.activeCount(),
      history: this.game.history(),
      last,
      status: this.status,
      over: isOver,
      resign: resignColor,
      online: this.onlineStatus(),
      timers: this.getClocks(),
    };
    for (const s of this.ctx.getWebSockets()) this.send(s, msg);
  }

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
