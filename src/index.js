// Catur Noir — Worker entry. Route /api/* ke handler, sisanya static assets.
import { Room } from './room.js';

export { Room };

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === '/api/room' && req.method === 'POST') return createRoom(req, env);
    if (url.pathname === '/api/hint-unlock' && req.method === 'POST') return unlockHint(req, env);
    if (url.pathname === '/api/ws' && req.headers.get('Upgrade') === 'websocket') return proxyWs(req, env);
    if (url.pathname.startsWith('/api/')) return json({ error: 'tidak ditemukan' }, 404);
    return env.ASSETS.fetch(req);
  },
};

// Kode ruang 4 huruf, tanpa karakter mudah tertukar (I,L,O,0,1).
const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ';

async function createRoom(req, env) {
  const body = await safeJson(req);
  const id = body.id;
  if (!id || typeof id !== 'string' || id.length > 64) return json({ error: 'id tidak valid' }, 400);
  // Direktori per-id: satu id = satu ruang (create ulang -> ruang sama, idempoten).
  const dir = env.ROOM.get(env.ROOM.idFromName('id:' + id));
  const existing = await dir.fetch('https://do/dir-get').then(r => r.json()).catch(() => ({}));
  if (existing.room) return json({ room: existing.room, color: 'w' });
  // Coba maksimal 3 kode untuk menghindari tabrakan kode acak.
  for (let i = 0; i < 3; i++) {
    let code = '';
    for (let j = 0; j < 4; j++) code += ALPHA[Math.floor(Math.random() * ALPHA.length)];
    const stub = env.ROOM.get(env.ROOM.idFromName(code));
    const res = await stub.fetch('https://do/create?c=' + encodeURIComponent(id));
    const data = await res.json().catch(() => ({}));
    if (data.ok) {
      await dir.fetch('https://do/dir-set?r=' + encodeURIComponent(code));
      return json({ room: code, color: 'w' });
    }
  }
  return json({ error: 'gagal membuat ruang, coba lagi' }, 503);
}

async function unlockHint(req, env) {
  const body = await safeJson(req);
  if (!env.HINT_CODE || body.code !== env.HINT_CODE) return json({ ok: false }, 403);
  return json({ ok: true });
}

// Teruskan permintaan upgrade WebSocket ke Durable Object ruang.
async function proxyWs(req, env) {
  const url = new URL(req.url);
  const room = (url.searchParams.get('r') || '').toUpperCase();
  const id = url.searchParams.get('c') || '';
  if (!/^[A-Z]{4}$/.test(room) || !id || id.length > 64) return json({ error: 'parameter tidak valid' }, 400);
  const stub = env.ROOM.get(env.ROOM.idFromName(room));
  const doUrl = new URL(req.url);
  doUrl.hostname = 'do';
  doUrl.pathname = '/ws';
  return stub.fetch(new Request(doUrl, req));
}

async function safeJson(req) {
  try { return await req.json(); } catch { return {}; }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
