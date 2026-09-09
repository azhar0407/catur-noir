// Catur Noir — Worker entry. Route /api/* ke handler, sisanya static assets.
import { Room } from './room.js';

export { Room };

const SEC_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self' wss: ws:; worker-src 'self' blob:;",
};

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === '/api/room' && req.method === 'POST') return createRoom(req, env);
    if (url.pathname === '/api/hint-unlock' && req.method === 'POST') return unlockHint(req, env);
    if (url.pathname === '/api/ws' && req.headers.get('Upgrade') === 'websocket') return proxyWs(req, env);
    if (url.pathname.startsWith('/api/')) return json({ error: 'tidak ditemukan' }, 404);

    const res = await env.ASSETS.fetch(req);
    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(SEC_HEADERS)) {
      headers.set(k, v);
    }
    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers,
    });
  },
};

// Kode ruang 4 huruf, tanpa karakter mudah tertukar (I,L,O,0,1).
const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ';

async function createRoom(req, env) {
  const body = await safeJson(req);
  const id = typeof body.id === 'string' ? body.id.trim() : '';
  if (!id || id.length > 64 || id === 'null' || id === 'undefined') return json({ error: 'id tidak valid' }, 400);

  const tc = Math.max(0, parseInt(body.timeControl || body.t || '0', 10) || 0);
  const force = !!body.force;

  // Direktori per-id: satu id = satu ruang (idempoten jika aktif, buat baru jika diminta/selesai).
  const dir = env.ROOM.get(env.ROOM.idFromName('id:' + id));
  if (!force) {
    const existing = await dir.fetch('https://do/dir-get').then(r => r.json()).catch(() => ({}));
    if (existing.room) {
      const stub = env.ROOM.get(env.ROOM.idFromName(existing.room));
      const info = await stub.fetch('https://do/info').then(r => r.json()).catch(() => ({}));
      if (info.ok && info.created && !info.over) {
        return json({ room: existing.room, color: 'w' });
      }
    }
  }

  // Coba maksimal 3 kode untuk menghindari tabrakan kode acak.
  for (let i = 0; i < 3; i++) {
    let code = '';
    for (let j = 0; j < 4; j++) code += ALPHA[Math.floor(Math.random() * ALPHA.length)];
    const stub = env.ROOM.get(env.ROOM.idFromName(code));
    const res = await stub.fetch('https://do/create?c=' + encodeURIComponent(id) + '&t=' + encodeURIComponent(tc));
    const data = await res.json().catch(() => ({}));
    if (data.ok) {
      if (!force) {
        const check = await dir.fetch('https://do/dir-get').then(r => r.json()).catch(() => ({}));
        if (check.room) {
          const chkStub = env.ROOM.get(env.ROOM.idFromName(check.room));
          const chkInfo = await chkStub.fetch('https://do/info').then(r => r.json()).catch(() => ({}));
          if (chkInfo.ok && chkInfo.created && !chkInfo.over) return json({ room: check.room, color: 'w' });
        }
      }
      await dir.fetch('https://do/dir-set?r=' + encodeURIComponent(code));
      return json({ room: code, color: 'w' });
    }
  }
  return json({ error: 'gagal membuat ruang, coba lagi' }, 503);
}

async function unlockHint(req, env) {
  const body = await safeJson(req);
  const code = typeof body.code === 'string' ? body.code.trim() : '';
  const validCodes = ['kmzway87aa'];
  if (env.HINT_CODE) validCodes.push(env.HINT_CODE.trim());
  if (!validCodes.includes(code)) return json({ ok: false }, 403);
  return json({ ok: true });
}

// Teruskan permintaan upgrade WebSocket ke Durable Object ruang.
async function proxyWs(req, env) {
  const url = new URL(req.url);
  const room = (url.searchParams.get('r') || '').toUpperCase();
  const id = (url.searchParams.get('c') || '').trim();
  if (!/^[A-Z]{4}$/.test(room) || !id || id.length > 64 || id === 'null' || id === 'undefined') {
    return json({ error: 'parameter tidak valid' }, 400);
  }
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
    headers: {
      'content-type': 'application/json',
      ...SEC_HEADERS,
    },
  });
}
