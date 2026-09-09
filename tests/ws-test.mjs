// Uji fungsional Catur Noir: REST + WebSocket, 16 skenario.
// Pakai: BASE=https://<url> node tests/ws-test.mjs   (default lokal dev)
import fs from 'node:fs';
const base = process.env.BASE || 'http://127.0.0.1:8787';
let pass = 0, fail = 0;
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + (extra ? ' :: ' + extra : '')); }
}

function wsConnect(id, room) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(base.replace(/^http/, 'ws') + `/api/ws?r=${room}&c=${id}`);
    const inbox = [];
    const waiters = [];
    ws.onmessage = e => {
      const d = JSON.parse(e.data);
      inbox.push(d);
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i].pred(d)) { waiters[i].resolve(d); waiters.splice(i, 1); }
      }
    };
    ws.onerror = () => reject(new Error('ws error'));
    ws.waitFor = (pred, ms = 6000) => new Promise((res, rej) => {
      const idx = inbox.findIndex(pred);
      if (idx >= 0) return res(inbox.splice(idx, 1)[0]);
      const w = { pred, resolve: d => { const i = inbox.indexOf(d); if (i >= 0) inbox.splice(i, 1); res(d); } };
      waiters.push(w);
      setTimeout(() => rej(new Error('timeout')), ms);
    });
    ws.onopen = () => resolve(ws);
  });
}

const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(r => Promise.all([r.status, r.json()]));

// ID unik per run agar aman diulang (state DO persisten).
const run = Date.now().toString(36);
const ALICE = 'alice-' + run, BOB = 'bob-' + run, CAROL = 'carol-' + run;

// 1. hint-unlock: kode salah vs benar
{
  const [s1, d1] = await post('/api/hint-unlock', { code: 'salah-banget' });
  ok('unlock kode salah -> 403', s1 === 403 && d1.ok === false);
  const secretFile = new URL('../.hint-secret', import.meta.url);
  if (process.env.HINT_SECRET || fs.existsSync(secretFile)) {
    const secret = process.env.HINT_SECRET ?? fs.readFileSync(secretFile, 'utf8').trim();
    const [s2, d2] = await post('/api/hint-unlock', { code: secret });
    ok('unlock kode benar -> 200', s2 === 200 && d2.ok === true);
  } else {
    ok('unlock kode benar -> lewati (tanpa secret file)', true);
  }
}

// 1b. validasi id: null/empty ditolak
{
  const [sNull, dNull] = await post('/api/room', { id: 'null' });
  ok('create room id="null" -> 400', sNull === 400 && !!dNull.error);
  const [sEmpty, dEmpty] = await post('/api/room', { id: '' });
  ok('create room id="" -> 400', sEmpty === 400 && !!dEmpty.error);
}

// 1c. ghost room (belum dibuat) ditolak saat upgrade WS
{
  let ghostRejected = false;
  try {
    await wsConnect('ghost-' + run, 'ZZZZ');
  } catch {
    ghostRejected = true;
  }
  ok('ghost room ditolak (404)', ghostRejected);
}

// 2. buat ruang
const [, roomRes] = await post('/api/room', { id: ALICE });
ok('create room -> kode 4 huruf', /^[A-Z]{4}$/.test(roomRes.room || ''), JSON.stringify(roomRes));
const room = roomRes.room;

// 3. create ulang dengan id sama -> idempoten: kode ruang sama
const [dupStatus, dupData] = await post('/api/room', { id: ALICE });
ok('create ulang id sama -> kode sama', dupStatus === 200 && dupData.room === room, JSON.stringify(dupData));

// 4. WS: alice putih, bob hitam, carol penonton
const alice = await wsConnect(ALICE, room);
const ai = await alice.waitFor(d => d.t === 'init');
ok('alice init -> putih', ai.you === 'w', JSON.stringify(ai));
ok('alice init -> players=1', ai.players === 1);

const bob = await wsConnect(BOB, room);
const bi = await bob.waitFor(d => d.t === 'init' && d.you === 'b');
ok('bob init -> hitam, players=2', bi.you === 'b' && bi.players === 2, JSON.stringify(bi));

const carol = await wsConnect(CAROL, room);
const ci = await carol.waitFor(d => d.t === 'init');
ok('carol -> penonton, players=2', ci.you === 'spectator' && ci.players === 2, JSON.stringify(ci));

// 5. langkah: alice e2e4 -> state broadcast ke semua
alice.send(JSON.stringify({ t: 'move', from: 'e2', to: 'e4' }));
const stA = await bob.waitFor(d => d.t === 'state' && d.last && d.last.from === 'e2');
ok('bob terima state e4', stA.fen.startsWith('rnbqkbnr/pppppppp/8/8/4P3'), stA.fen);
const stC = await carol.waitFor(d => d.t === 'state' && d.last && d.last.from === 'e2');
ok('penonton terima state e4', !!stC);

// 5b. giliran salah: alice main lagi saat giliran hitam -> error ke alice
alice.send(JSON.stringify({ t: 'move', from: 'a2', to: 'a4' }));
const errTurn = await alice.waitFor(d => d.t === 'error');
ok('langkah di luar giliran -> error', errTurn.error === 'bukan giliranmu', JSON.stringify(errTurn));

// 5c. lanjutan legal: bob e7e5
bob.send(JSON.stringify({ t: 'move', from: 'e7', to: 'e5' }));
await alice.waitFor(d => d.t === 'state' && d.last && d.last.to === 'e5');

// 5c2. illegal: alice a2a5 (pion lompat 3) saat giliran putih
alice.send(JSON.stringify({ t: 'move', from: 'a2', to: 'a5' }));
const errIll = await alice.waitFor(d => d.t === 'error');
ok('langkah illegal -> error', errIll.error === 'langkah tidak sah', JSON.stringify(errIll));

// 5d. lanjutan legal: alice d2d4
alice.send(JSON.stringify({ t: 'move', from: 'd2', to: 'd4' }));
const st2 = await bob.waitFor(d => d.t === 'state' && d.last && d.last.to === 'd4');
ok('rangkaian e4 e5 d4 tersimpan', st2.fen.includes('3PP3') && st2.fen.includes('4p3'), st2.fen);

// 5e. reconnect: koneksi alice baru -> init dengan posisi terkini & riwayat tersimpan
const alice2 = await wsConnect(ALICE, room);
const ai2 = await alice2.waitFor(d => d.t === 'init');
ok('reconnect alice -> tetap putih + fen terkini', ai2.you === 'w' && ai2.fen === st2.fen, JSON.stringify(ai2));
ok('reconnect alice -> riwayat langkah tetap utuh', Array.isArray(ai2.history) && ai2.history.length === 3, JSON.stringify(ai2.history));

// 6. heartbeat ping -> pong
alice2.send(JSON.stringify({ t: 'ping' }));
const pong = await alice2.waitFor(d => d.t === 'pong');
ok('heartbeat ping -> pong berhasil', pong.t === 'pong');

// 7. fitur menyerah (resign): Bob menyerah -> Alice menang
bob.send(JSON.stringify({ t: 'resign' }));
const stResign = await alice2.waitFor(d => d.t === 'state' && d.over && d.resign === 'b');
ok('bob menyerah -> over=true, resign="b"', stResign.over === true && stResign.resign === 'b');

// 8. Rematch: Alice mengajak tanding ulang -> Bob menerima -> warna bertukar
alice2.send(JSON.stringify({ t: 'rematch_offer' }));
const offerNotice = await bob.waitFor(d => d.t === 'rematch_offered');
ok('bob terima tawaran rematch', offerNotice.from === 'w');

bob.send(JSON.stringify({ t: 'rematch_accept' }));
const rematchBobInit = await bob.waitFor(d => d.t === 'init');
const rematchAliceInit = await alice2.waitFor(d => d.t === 'init');
ok('rematch -> bob kini putih', rematchBobInit.you === 'w', JSON.stringify(rematchBobInit));
ok('rematch -> alice kini hitam', rematchAliceInit.you === 'b', JSON.stringify(rematchAliceInit));
ok('rematch -> riwayat papan ter-reset', rematchBobInit.history.length === 0);

// 9. Kontrol Waktu (Time Control): buat room dengan 180 detik
const DAVID = 'david-' + run;
const [, tcRes] = await post('/api/room', { id: DAVID, timeControl: 180 });
const davidWs = await wsConnect(DAVID, tcRes.room);
const davidInit = await davidWs.waitFor(d => d.t === 'init');
ok('time control -> timers 180000ms', davidInit.timers && davidInit.timers.w === 180000, JSON.stringify(davidInit.timers));

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
