// Unit Test Batas Input (Boundary Tests) — Catur Noir
// Menjalankan uji batas parameter & payload tanpa dependensi eksternal.
import assert from 'node:assert/strict';
import worker, { Room } from '../src/index.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`PASS: ${name}`);
  } catch (err) {
    failed++;
    console.error(`FAIL: ${name}\n`, err);
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`PASS: ${name}`);
  } catch (err) {
    failed++;
    console.error(`FAIL: ${name}\n`, err);
  }
}

// Mocking Env untuk Worker fetch
function createMockEnv(hintCode = null) {
  let createdPayload = null;
  return {
    HINT_CODE: hintCode,
    getCreatedPayload: () => createdPayload,
    ROOM: {
      idFromName(name) { return { name }; },
      get(idObj) {
        return {
          async fetch(reqOrUrl) {
            const urlStr = typeof reqOrUrl === 'string' ? reqOrUrl : reqOrUrl.url;
            const parsed = new URL(urlStr, 'https://do');
            if (parsed.pathname === '/dir-get') {
              return new Response(JSON.stringify({}));
            }
            if (parsed.pathname === '/create') {
              createdPayload = {
                c: parsed.searchParams.get('c'),
                t: parsed.searchParams.get('t'),
                side: parsed.searchParams.get('side'),
              };
              return new Response(JSON.stringify({ ok: true, color: createdPayload.side || 'w' }));
            }
            if (parsed.pathname === '/dir-set') {
              return new Response(JSON.stringify({ ok: true }));
            }
            if (parsed.pathname === '/ws') {
              return new Response('ws upgraded', { status: 200 });
            }
            return new Response(JSON.stringify({ ok: true }));
          }
        };
      }
    }
  };
}

// 1. UJI BATAS: /api/room (Parameter 'id')
console.log('\n--- 1. Uji Batas /api/room: id ---');

await testAsync('id string kosong ("") ditolak 400', async () => {
  const env = createMockEnv();
  const req = new Request('http://localhost/api/room', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: '' })
  });
  const res = await worker.fetch(req, env);
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.error, 'id tidak valid');
});

await testAsync('id hanya spasi ("   ") ditolak 400', async () => {
  const env = createMockEnv();
  const req = new Request('http://localhost/api/room', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: '     ' })
  });
  const res = await worker.fetch(req, env);
  assert.equal(res.status, 400);
});

await testAsync('id bernilai string "null" ditolak 400', async () => {
  const env = createMockEnv();
  const req = new Request('http://localhost/api/room', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'null' })
  });
  const res = await worker.fetch(req, env);
  assert.equal(res.status, 400);
});

await testAsync('id bernilai string "undefined" ditolak 400', async () => {
  const env = createMockEnv();
  const req = new Request('http://localhost/api/room', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'undefined' })
  });
  const res = await worker.fetch(req, env);
  assert.equal(res.status, 400);
});

await testAsync('id non-string (number, boolean, null, object) ditolak 400', async () => {
  const env = createMockEnv();
  for (const val of [12345, true, false, null, {}, []]) {
    const req = new Request('http://localhost/api/room', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: val })
    });
    const res = await worker.fetch(req, env);
    assert.equal(res.status, 400, `id=${val} harus 400`);
  }
});

await testAsync('id batas atas tepat 64 karakter diterima 200', async () => {
  const env = createMockEnv();
  const id64 = 'A'.repeat(64);
  const req = new Request('http://localhost/api/room', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: id64 })
  });
  const res = await worker.fetch(req, env);
  assert.equal(res.status, 200);
  assert.equal(env.getCreatedPayload().c, id64);
});

await testAsync('id melebihi batas 65 karakter ditolak 400', async () => {
  const env = createMockEnv();
  const id65 = 'A'.repeat(65);
  const req = new Request('http://localhost/api/room', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: id65 })
  });
  const res = await worker.fetch(req, env);
  assert.equal(res.status, 400);
});

// 2. UJI BATAS: /api/room (Parameter 'timeControl' & 'side')
console.log('\n--- 2. Uji Batas /api/room: timeControl & side ---');

await testAsync('timeControl negatif di-clamp ke 0', async () => {
  const env = createMockEnv();
  const req = new Request('http://localhost/api/room', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'valid-id', timeControl: -500 })
  });
  const res = await worker.fetch(req, env);
  assert.equal(res.status, 200);
  assert.equal(env.getCreatedPayload().t, '0');
});

await testAsync('timeControl non-numerik ("abc") di-fallback ke 0', async () => {
  const env = createMockEnv();
  const req = new Request('http://localhost/api/room', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'valid-id', timeControl: 'abc' })
  });
  const res = await worker.fetch(req, env);
  assert.equal(res.status, 200);
  assert.equal(env.getCreatedPayload().t, '0');
});

await testAsync('side di luar "w", "b", "rnd" di-fallback ke "w"', async () => {
  const env = createMockEnv();
  for (const badSide of ['x', 'black', 'white', 123, null, '']) {
    const req = new Request('http://localhost/api/room', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'valid-id', side: badSide })
    });
    const res = await worker.fetch(req, env);
    assert.equal(res.status, 200);
    assert.equal(env.getCreatedPayload().side, 'w', `side=${badSide} harus fallback ke 'w'`);
  }
});

await testAsync('side "b" diteruskan sebagai "b"', async () => {
  const env = createMockEnv();
  const req = new Request('http://localhost/api/room', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'valid-id', side: 'b' })
  });
  const res = await worker.fetch(req, env);
  assert.equal(res.status, 200);
  assert.equal(env.getCreatedPayload().side, 'b');
});

await testAsync('payload body malformed JSON ditangani aman tanpa crash (400)', async () => {
  const env = createMockEnv();
  const req = new Request('http://localhost/api/room', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{ invalid-json ...'
  });
  const res = await worker.fetch(req, env);
  assert.equal(res.status, 400);
});

// 3. UJI BATAS: /api/hint-unlock
console.log('\n--- 3. Uji Batas /api/hint-unlock: code ---');

await testAsync('code kosong, spasi, atau salah ditolak 403', async () => {
  const env = createMockEnv();
  for (const c of ['', '   ', 'wrong-cheat', 'kmzway', 'kmzway87AA', null, 12345]) {
    const req = new Request('http://localhost/api/hint-unlock', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: c })
    });
    const res = await worker.fetch(req, env);
    assert.equal(res.status, 403, `code=${c} harus 403`);
    const data = await res.json();
    assert.equal(data.ok, false);
  }
});

await testAsync('code "kmzway87aa" diterima 200 (termasuk whitespace trim)', async () => {
  const env = createMockEnv();
  for (const c of ['kmzway87aa', '  kmzway87aa  ', '\tkmzway87aa\n']) {
    const req = new Request('http://localhost/api/hint-unlock', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: c })
    });
    const res = await worker.fetch(req, env);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
  }
});

await testAsync('code input sangat panjang (100.000 karakter) ditangani aman 403', async () => {
  const env = createMockEnv();
  const longCode = 'X'.repeat(100000);
  const req = new Request('http://localhost/api/hint-unlock', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: longCode })
  });
  const res = await worker.fetch(req, env);
  assert.equal(res.status, 403);
});

// 4. UJI BATAS: /api/ws (Upgrade URL Parameters)
console.log('\n--- 4. Uji Batas /api/ws: room & id ---');

await testAsync('upgrade tanpa header Upgrade: websocket ditolak 404', async () => {
  const env = createMockEnv();
  const req = new Request('http://localhost/api/ws?r=ABCD&c=user1');
  const res = await worker.fetch(req, env);
  assert.equal(res.status, 404);
});

await testAsync('room code di luar 4 huruf (kurang, lebih, angka, simbol) ditolak 400', async () => {
  const env = createMockEnv();
  for (const r of ['', 'ABC', 'ABCDE', 'AB12', 'A#CD', 'AB CD', '1234', '!!!!']) {
    const req = new Request(`http://localhost/api/ws?r=${encodeURIComponent(r)}&c=user1`, {
      headers: { Upgrade: 'websocket' }
    });
    const res = await worker.fetch(req, env);
    assert.equal(res.status, 400, `room=${r} harus 400`);
    const data = await res.json();
    assert.equal(data.error, 'parameter tidak valid');
  }
});

await testAsync('client id pada ws upgrade melanggar batas (empty, >64, null, undefined) ditolak 400', async () => {
  const env = createMockEnv();
  for (const c of ['', 'null', 'undefined', 'A'.repeat(65)]) {
    const req = new Request(`http://localhost/api/ws?r=ABCD&c=${encodeURIComponent(c)}`, {
      headers: { Upgrade: 'websocket' }
    });
    const res = await worker.fetch(req, env);
    assert.equal(res.status, 400, `client id=${c} harus 400`);
  }
});

await testAsync('ws upgrade dengan room dan id tepat batas diterima 200/upgraded', async () => {
  const env = createMockEnv();
  const req = new Request(`http://localhost/api/ws?r=ABCD&c=${encodeURIComponent('A'.repeat(64))}`, {
    headers: { Upgrade: 'websocket' }
  });
  const res = await worker.fetch(req, env);
  assert.equal(res.status, 200);
});

// 5. UJI BATAS: Room Durable Object
console.log('\n--- 5. Uji Batas Room DO: direct fetch & messages ---');

function createMockRoom() {
  const storage = new Map();
  const mockCtx = {
    storage: {
      async get(k) { return storage.get(k); },
      async put(obj) { for (const [k, v] of Object.entries(obj)) storage.set(k, v); },
      async delete(k) { storage.delete(k); },
      async getAlarm() { return null; },
      async setAlarm() {}
    }
  };
  return new Room(mockCtx, {});
}

await testAsync('Room DO /create dengan id kosong/null/undefined ditolak 400', async () => {
  const room = createMockRoom();
  for (const badId of ['', 'null', 'undefined']) {
    const res = await room.fetch(new Request(`https://do/create?c=${badId}`));
    assert.equal(res.status, 400, `id=${badId} harus 400`);
  }
});

await testAsync('Room DO webSocketMessage menangani pesan malformed tanpa exception', async () => {
  const room = createMockRoom();
  // Init room
  await room.fetch(new Request('https://do/create?c=user1'));
  
  const sentMessages = [];
  const mockWs = {
    deserializeAttachment: () => ({ id: 'user1', color: 'w' }),
    send: (msg) => sentMessages.push(JSON.parse(msg))
  };

  // Uji berbagai payload rusak / tak terduga
  for (const badPayload of ['', 'not-json', '{', 'null', '12345', '{}', JSON.stringify({ t: 'unknown_type' })]) {
    await room.webSocketMessage(mockWs, badPayload);
  }
  // Pastikan tidak ada unhandled throw dan sistem tetap stabil
  assert.ok(true);
});

await testAsync('Room DO langkah tidak sah (koordinat fiktif, null, angka) ditolak dengan pesan error', async () => {
  const room = createMockRoom();
  await room.fetch(new Request('https://do/create?c=user1'));

  const sent = [];
  const mockWs = {
    deserializeAttachment: () => ({ id: 'user1', color: 'w' }),
    send: (msg) => sent.push(JSON.parse(msg))
  };

  // Uji langkah tidak sah
  for (const move of [
    { from: 'z9', to: 'e4' },
    { from: '', to: '' },
    { from: null, to: null },
    { from: 123, to: 456 },
    { from: 'e2', to: 'e5' } // langkah bidak putih 3 petak ilegal
  ]) {
    sent.length = 0;
    await room.webSocketMessage(mockWs, JSON.stringify({ t: 'move', ...move }));
    assert.equal(sent.length, 1);
    assert.equal(sent[0].t, 'error');
    assert.equal(sent[0].error, 'langkah tidak sah');
  }
});

await testAsync('Room DO checkTimeout mendeteksi waktu habis dan menetapkan status game over timeout', async () => {
  const room = createMockRoom();
  // Room dengan timeControl 3 detik
  await room.fetch(new Request('https://do/create?c=user1&t=3'));
  // Simulasikan turn dimulai 5 detik lalu
  room.clocks.started = true;
  room.clocks.lastMoveTs = Date.now() - 5000;
  
  const isTimedOut = room.checkTimeout();
  assert.equal(isTimedOut, true);
  assert.equal(room.status.over, true);
  assert.equal(room.status.result, 'timeout');
  assert.equal(room.status.winner, 'b'); // Giliran putih habis -> hitam menang
});

// Ringkasan hasil
console.log(`\n========================================`);
console.log(`Total: ${passed + failed} | Lolos: ${passed} | Gagal: ${failed}`);
console.log(`========================================\n`);

process.exit(failed > 0 ? 1 : 0);
