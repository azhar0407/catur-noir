// Arena: papan, WebSocket (PvP) atau engine lokal (vs bot), hint untuk yang berhak.
import { Chess } from '/js/vendor/chess.esm.js';

const qs = new URLSearchParams(location.search);
const mode = qs.get('m') === 'bot' ? 'bot' : 'pvp';
const room = (qs.get('r') || '').toUpperCase();
const skill = Math.min(20, Math.max(1, parseInt(qs.get('s') || '3', 10) || 3));

let myId = localStorage.getItem('noir-id');
if (!myId) {
  myId = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  localStorage.setItem('noir-id', myId);
}
const hintUnlocked = localStorage.getItem('noir-hint-ok') === '1';

const $ = s => document.querySelector(s);
const statusEl = $('#status');
const statusText = $('#status-text');
const movesEl = $('#moves');
const hintBtn = $('#btn-hint');
const flipBtn = $('#btn-flip');
const resignBtn = $('#btn-resign');
const shareBox = $('#share');
const shareToggleBtn = $('#btn-share-toggle');

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const GLYPHS = {
  w: { p: '♙', n: '♘', b: '♗', r: '♖', q: '♕' },
  b: { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛' },
};
const NAMA = { p: 'pion', n: 'kuda', b: 'gajah', r: 'benteng', q: 'ratu', k: 'raja' };
const namaBidak = t => NAMA[t] || t;

function toast(msg, good = false) {
  if (window.noirToast) return window.noirToast(msg, good);
  const box = document.getElementById('toast-box');
  if (!box) return;
  const el = document.createElement('div');
  el.className = 'toast' + (good ? ' good' : '');
  el.textContent = msg;
  box.appendChild(el);
  while (box.children.length > 3) box.firstChild.remove();
  setTimeout(() => el.remove(), 4000);
}

let game = new Chess();
let sel = null;          // kotak terpilih
let last = null;         // langkah terakhir {from,to}
let hint = null;         // saran engine {from,to}
let myColor = mode === 'bot' ? 'w' : null;
let flip = false;        // true jika hitam di bawah
let over = false;
let resignColor = null;
let onlineStatus = null;
let pcount = mode === 'bot' ? 2 : 1;
let ws = null;
let moveHistory = [];
let reconnectAttempts = 0;
const MAX_RECONNECT = 10;
let reconnectTimer = null;
let pingTimer = null;

// --- engine (Stockfish) ---
let engine = null;
let engineReady = false;
let engineBusy = false;
const engineQueue = [];

function ensureEngine() {
  if (engine) return;
  engine = new Worker('/js/vendor/stockfish-18-lite-single.js');
  engine.onmessage = e => handleEngine(String(e.data));
  engine.onerror = () => { engineReady = false; };
  engine.postMessage('uci');
}

function handleEngine(line) {
  if (line === 'uciok') engine.postMessage('isready');
  else if (line === 'readyok') { engineReady = true; pumpEngine(); }
  else if (line.startsWith('bestmove')) {
    engineBusy = false;
    const job = engineQueue.shift();
    const uci = line.split(/\s+/)[1] || '';
    const mv = { from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || 'q' };
    if (job && job.cb) job.cb(mv);
    pumpEngine();
  }
}

function requestEngine(fen, opts, cb) {
  ensureEngine();
  engineQueue.push({ fen, skill: opts.skill ?? null, cb });
  pumpEngine();
}

function pumpEngine() {
  if (!engineReady || engineBusy || engineQueue.length === 0) return;
  const job = engineQueue[0];
  engineBusy = true;
  if (job.skill != null) engine.postMessage('setoption name Skill Level value ' + job.skill);
  engine.postMessage('position fen ' + job.fen);
  engine.postMessage('go movetime 400');
}

// --- PvP: WebSocket ---
function connect() {
  if (mode !== 'pvp') return;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(proto + '://' + location.host + '/api/ws?r=' + room + '&c=' + myId);
  ws.onopen = () => {
    reconnectAttempts = 0;
    clearInterval(pingTimer);
    pingTimer = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        try { ws.send(JSON.stringify({ t: 'ping' })); } catch {}
      }
    }, 25000);
  };
  ws.onmessage = e => {
    let d;
    try { d = JSON.parse(e.data); } catch { return; }
    if (d.t === 'init') {
      reconnectAttempts = 0;
      myColor = d.you;
      pcount = d.players;
      if (Array.isArray(d.history)) moveHistory = d.history;
      if (d.over != null) over = d.over;
      if (d.resign != null) resignColor = d.resign;
      if (d.online) onlineStatus = d.online;
      try { game.load(d.fen); } catch {}
      // Jika pemain hitam, papan otomatis terbalik (hitam di bawah)
      flip = myColor === 'b';
      if (pcount >= 2) shareBox.hidden = true;
      render();
    } else if (d.t === 'state') {
      pcount = d.players;
      if (pcount >= 2) shareBox.hidden = true;
      if (Array.isArray(d.history)) moveHistory = d.history;
      if (d.over != null) over = d.over;
      if (d.resign != null) resignColor = d.resign;
      if (d.online) onlineStatus = d.online;
      if (d.fen !== game.fen()) {
        try { game.load(d.fen); } catch {}
        last = d.last;
        hint = null;
        sel = null;
        over = over || game.isGameOver();
        render();
      } else render();
    } else if (d.t === 'error') {
      statusText.textContent = d.error;
    }
  };
  ws.onclose = () => {
    clearInterval(pingTimer);
    scheduleReconnect();
  };
}

function scheduleReconnect() {
  if (mode !== 'pvp' || reconnectAttempts >= MAX_RECONNECT) return;
  reconnectAttempts++;
  clearTimeout(reconnectTimer);
  const delay = Math.min(10000, 1000 * Math.pow(1.5, reconnectAttempts));
  reconnectTimer = setTimeout(connect, delay);
}

// --- langkah ---
function tryMove(from, to, promo = null) {
  const piece = game.get(from);
  let selectedPromo = promo || 'q';
  if (piece && piece.type === 'p') {
    const isPromo = (piece.color === 'w' && to.endsWith('8')) || (piece.color === 'b' && to.endsWith('1'));
    if (isPromo && !promo) {
      const pick = window.prompt('Promosi pion ke: (Q) Ratu, (N) Kuda, (R) Benteng, (B) Gajah', 'Q');
      if (!pick) return false;
      const pLower = pick.trim().toLowerCase();
      selectedPromo = ['q', 'r', 'b', 'n'].includes(pLower) ? pLower : 'q';
    }
  }
  const captured = game.get(to);
  const mv = game.move({ from, to, promotion: selectedPromo });
  if (!mv) return false;
  over = game.isGameOver();
  last = { from: mv.from, to: mv.to };
  hint = null;
  sel = null;
  render();
  if (captured && !over) {
    toast((captured.color === 'w' ? 'Putih' : 'Hitam') + ' kehilangan ' + namaBidak(captured.type) + '.');
  }
  if (mode === 'bot') {
    if (!over && game.turn() === 'b') botMove();
  } else if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ t: 'move', from: mv.from, to: mv.to, promotion: selectedPromo }));
  }
  return true;
}

function botMove() {
  requestEngine(game.fen(), { skill }, mv => {
    if (!over && game.turn() === 'b') tryMove(mv.from, mv.to);
  });
}

// --- hint ---
let hintsLeft = 3;

function askHint() {
  const myTurn = game.turn() === myColorOrW();
  if (over || !myTurn || engineBusy) return;
  if (mode === 'pvp') {
    if (!hintUnlocked || hintsLeft <= 0) return;
    hintsLeft--;
  }
  statusText.textContent = 'Menghitung langkah terbaik…';
  requestEngine(game.fen(), {}, mv => {
    hint = mv;
    render();
  });
}

hintBtn.onclick = askHint;

flipBtn.onclick = () => {
  flip = !flip;
  render();
  toast('Sudut pandang papan dibalik.', true);
};

// Hitung bidak yang ditangkap & keunggulan poin
function getCaptures() {
  const initial = { p: 8, n: 2, b: 2, r: 2, q: 1 };
  const currentW = { p: 0, n: 0, b: 0, r: 0, q: 0 };
  const currentB = { p: 0, n: 0, b: 0, r: 0, q: 0 };

  for (let r = 1; r <= 8; r++) {
    for (const f of FILES) {
      const p = game.get(f + r);
      if (p && p.type !== 'k') {
        if (p.color === 'w') currentW[p.type] = (currentW[p.type] || 0) + 1;
        else currentB[p.type] = (currentB[p.type] || 0) + 1;
      }
    }
  }

  const capturedByW = []; // bidak hitam yang dimakan putih
  const capturedByB = []; // bidak putih yang dimakan hitam
  const vals = { p: 1, n: 3, b: 3, r: 5, q: 9 };
  let scoreW = 0, scoreB = 0;

  const order = ['q', 'r', 'b', 'n', 'p'];
  for (const t of order) {
    const diffB = Math.max(0, initial[t] - (currentB[t] || 0));
    for (let i = 0; i < diffB; i++) {
      capturedByW.push(GLYPHS.b[t]);
      scoreW += vals[t];
    }
    const diffW = Math.max(0, initial[t] - (currentW[t] || 0));
    for (let i = 0; i < diffW; i++) {
      capturedByB.push(GLYPHS.w[t]);
      scoreB += vals[t];
    }
  }

  return {
    w: { list: capturedByW, lead: scoreW - scoreB },
    b: { list: capturedByB, lead: scoreB - scoreW },
  };
}

function myColorOrW() { return mode === 'bot' ? 'w' : myColor; }

// --- RENDER UTAMA ---
function render() {
  const myActualColor = myColorOrW();
  const spectator = mode === 'pvp' && (!myColor || myColor === 'spectator');
  const myTurn = game.turn() === myActualColor;

  // Warna posisi pemain: bawah selalu posisi user/flip, atas lawan
  const bottomColor = flip ? 'b' : 'w';
  const topColor = flip ? 'w' : 'b';

  // 1. Ranks & Files (User di bawah: bila flip=false, rank 8..1; bila flip=true, rank 1..8)
  const ranks = flip ? [1, 2, 3, 4, 5, 6, 7, 8] : [8, 7, 6, 5, 4, 3, 2, 1];
  const files = flip ? [...FILES].reverse() : FILES;
  $('#ranks').innerHTML = ranks.map(r => '<span>' + r + '</span>').join('');
  $('#files').innerHTML = files.map(f => '<span>' + f + '</span>').join('');

  // 2. Tombol Hint & Menyerah
  hintBtn.hidden = !(hintUnlocked && !over && !spectator && myTurn);
  hintBtn.disabled = mode === 'pvp' && hintsLeft <= 0;
  hintBtn.textContent = mode === 'pvp' ? '💡 Hint (' + hintsLeft + ')' : '💡 Hint';
  if (resignBtn) resignBtn.hidden = over || spectator;

  // 3. Status Bar
  statusEl.className = 'status-bar';
  if (spectator) {
    statusText.textContent = 'Ruangan penuh — mode penonton.';
    statusEl.classList.add('wait');
  } else if (!over && mode === 'pvp' && pcount < 2) {
    statusText.textContent = 'Menunggu lawan bergabung…';
    statusEl.classList.add('wait');
  } else if (over) {
    statusText.textContent = hasilText();
    statusEl.classList.add('over');
  } else if (game.inCheck()) {
    const terancam = game.turn() === myActualColor ? 'Kamu' : 'Lawan';
    statusText.textContent = 'Skak! ' + terancam + ' dalam posisi terancam!';
    statusEl.classList.add('check');
  } else {
    statusText.textContent = 'Giliran: ' + (game.turn() === 'w' ? 'Putih' : 'Hitam') +
      (mode === 'bot' ? ' (kamu putih)' : myActualColor === game.turn() ? ' — Giliranmu' : ' — Giliran lawan');
    statusEl.classList.add(game.turn() === myActualColor ? 'mine' : 'wait');
  }

  // 4. Update Kartu Pemain (Atas = Lawan, Bawah = User)
  updatePlayerCards(topColor, bottomColor, myActualColor, spectator);

  // 5. Render Papan Catur
  const board = $('#board');
  board.innerHTML = '';
  const moves = sel ? game.moves({ square: sel, verbose: true }) : [];
  const targets = new Set(moves.map(m => m.to));

  // Cek apakah ada raja yang sedang kena skak
  let checkSquare = null;
  if (game.inCheck()) {
    const currentTurn = game.turn();
    for (let r = 1; r <= 8; r++) {
      for (const f of FILES) {
        const sq = f + r;
        const p = game.get(sq);
        if (p && p.type === 'k' && p.color === currentTurn) {
          checkSquare = sq;
          break;
        }
      }
      if (checkSquare) break;
    }
  }

  for (const r of ranks) {
    for (const f of files) {
      const sq = f + r;
      const cell = document.createElement('div');
      const fi = FILES.indexOf(f);
      cell.className = 'cell ' + ((fi + r - 1) % 2 === 0 ? 'dark' : 'light');
      cell.setAttribute('data-sq', sq);

      if (sq === sel) cell.classList.add('sel');
      if (last && (sq === last.from || sq === last.to)) cell.classList.add('last');
      if (hint && (sq === hint.from || sq === hint.to)) cell.classList.add('hint');
      if (sq === checkSquare) cell.classList.add('check-sq');

      const p = game.get(sq);
      if (targets.has(sq)) {
        cell.classList.add('tgt');
        if (p) cell.classList.add('occ');
      }

      if (p) {
        const img = document.createElement('img');
        img.draggable = false;
        img.alt = p.color + ' ' + p.type;
        img.src = '/pieces/' + (p.color === 'w' ? 'w' : 'b') + p.type.toUpperCase() + '.svg';
        img.className = 'pc ' + p.color;
        cell.appendChild(img);
      }
      cell.onclick = () => onCell(sq, p);
      board.appendChild(cell);
    }
  }

  // 6. Riwayat Langkah
  renderMovesHistory();
}

function updatePlayerCards(topColor, bottomColor, myActualColor, spectator) {
  const caps = getCaptures();

  // --- KARTU ATAS (LAWAN) ---
  const nameTop = $('#name-top');
  const tagTop = $('#tag-top');
  const capTop = $('#captured-top');
  const turnTop = $('#turn-top');
  const cardTop = $('#card-top');
  const avatarTop = $('#avatar-top');

  if (mode === 'bot') {
    nameTop.textContent = 'Stockfish';
    avatarTop.textContent = '🤖';
  } else if (spectator) {
    nameTop.textContent = topColor === 'w' ? 'Putih' : 'Hitam';
    avatarTop.textContent = '♟';
  } else {
    if (pcount < 2) {
      nameTop.textContent = 'Menunggu Lawan…';
    } else {
      const isOppOnline = onlineStatus ? onlineStatus[topColor] : true;
      nameTop.textContent = isOppOnline ? 'Lawan' : 'Lawan (terputus…)';
    }
    avatarTop.textContent = '👤';
  }

  tagTop.textContent = topColor === 'w' ? 'Putih' : 'Hitam';
  tagTop.className = 'player-color-tag ' + topColor;

  // Tangkapan pihak atas
  const topCaps = caps[topColor];
  let topCapHtml = topCaps.list.map(g => '<span class="cap-item">' + g + '</span>').join('');
  if (topCaps.lead > 0) topCapHtml += '<span class="cap-lead">+' + topCaps.lead + '</span>';
  capTop.innerHTML = topCapHtml;

  const isTopTurn = !over && game.turn() === topColor;
  turnTop.hidden = !isTopTurn;
  turnTop.textContent = 'Giliran Lawan';
  cardTop.className = 'player-card top' + (isTopTurn ? ' active-turn' : '');

  // --- KARTU BAWAH (USER) ---
  const nameBottom = $('#name-bottom');
  const tagBottom = $('#tag-bottom');
  const capBottom = $('#captured-bottom');
  const turnBottom = $('#turn-bottom');
  const cardBottom = $('#card-bottom');
  const avatarBottom = $('#avatar-bottom');

  if (spectator) {
    nameBottom.textContent = bottomColor === 'w' ? 'Putih' : 'Hitam';
    avatarBottom.textContent = '♟';
  } else {
    nameBottom.textContent = 'Kamu';
    avatarBottom.textContent = '👑';
  }

  tagBottom.textContent = bottomColor === 'w' ? 'Putih' : 'Hitam';
  tagBottom.className = 'player-color-tag ' + bottomColor;

  // Tangkapan pihak bawah
  const btmCaps = caps[bottomColor];
  let btmCapHtml = btmCaps.list.map(g => '<span class="cap-item">' + g + '</span>').join('');
  if (btmCaps.lead > 0) btmCapHtml += '<span class="cap-lead">+' + btmCaps.lead + '</span>';
  capBottom.innerHTML = btmCapHtml;

  const isBtmTurn = !over && game.turn() === bottomColor;
  turnBottom.hidden = !isBtmTurn;
  turnBottom.textContent = (!spectator && bottomColor === myActualColor) ? 'Giliranmu' : 'Giliran ' + (bottomColor === 'w' ? 'Putih' : 'Hitam');
  cardBottom.className = 'player-card bottom' + (isBtmTurn ? ' active-turn my-turn' : '');
}

function renderMovesHistory() {
  const h = mode === 'bot' ? game.history() : moveHistory;
  if (h.length === 0) {
    movesEl.textContent = 'Belum ada langkah';
    return;
  }
  const pairs = [];
  for (let i = 0; i < h.length; i += 2) {
    const num = (i / 2 + 1) + '.';
    const w = h[i];
    const b = h[i + 1] ? ' ' + h[i + 1] : '';
    pairs.push(num + ' ' + w + b);
  }
  movesEl.textContent = pairs.join('   ');
  movesEl.scrollLeft = movesEl.scrollWidth;
}

function onCell(sq, p) {
  if (over) return;
  const spectator = mode === 'pvp' && (!myColor || myColor === 'spectator');
  if (spectator) return;
  if (game.turn() !== myColorOrW()) return; // bukan giliranmu

  if (sel) {
    if (sq === sel) {
      sel = null;
      render();
      return;
    }
    // Jika klik bidak sendiri yang lain, pindah seleksi langsung
    if (p && p.color === game.turn()) {
      sel = sq;
      hint = null;
      render();
      return;
    }
    if (tryMove(sel, sq)) return;
  }

  if (p && p.color === game.turn()) {
    sel = sq;
    hint = null;
    render();
  } else {
    sel = null;
    render();
  }
}

function hasilText() {
  if (resignColor) {
    const pemenang = resignColor === 'w' ? 'Hitam' : 'Putih';
    const aku = (mode === 'bot') ? false : (myColor !== resignColor);
    return aku ? '🏆 Lawan menyerah — Kamu menang!' : 'Kamu menyerah — ' + pemenang + ' menang.';
  }
  if (game.isCheckmate()) {
    const pemenang = game.turn() === 'w' ? 'Hitam' : 'Putih';
    const aku = mode === 'bot' ? (pemenang === 'Putih') : (pemenang === (myColor === 'w' ? 'Putih' : 'Hitam'));
    return aku ? '🏆 Skakmat — Kamu menang!' : 'Skakmat — ' + pemenang + ' menang.';
  }
  if (game.isStalemate()) return 'Pat (stalemate) — Permainan remis.';
  if (game.isInsufficientMaterial()) return 'Remis — Material tidak cukup.';
  if (game.isThreefoldRepetition()) return 'Remis — Pengulangan posisi 3 kali.';
  if (game.isDraw()) return 'Permainan remis.';
  return 'Permainan berakhir.';
}

// --- Inisialisasi Mode ---
if (mode === 'pvp') {
  $('#room-label').textContent = room;
  shareToggleBtn.hidden = false;
  const link = location.origin + '/game?m=pvp&r=' + room;
  $('#share-link').value = link;

  shareToggleBtn.onclick = () => {
    shareBox.hidden = !shareBox.hidden;
  };

  $('#btn-copy').onclick = () => {
    navigator.clipboard.writeText(link).then(() => {
      $('#btn-copy').textContent = '✓ Tersalin!';
      toast('Tautan disalin — kirimkan ke lawan.', true);
      setTimeout(() => { $('#btn-copy').textContent = 'Salin'; }, 2500);
    }).catch(() => toast('Gagal menyalin — silakan salin teks secara manual.'));
  };

  // Tampilkan kotak share di awal jika belum ada lawan
  shareBox.hidden = false;
  connect();
} else {
  $('#room-label').textContent = 'vs Bot · Lv ' + skill;
  shareToggleBtn.hidden = true;
  shareBox.hidden = true;
  flip = false; // Putih di bawah
  render();
}

if (resignBtn) {
  resignBtn.onclick = () => {
    if (over) return;
    if (window.confirm('Yakin ingin menyerah?')) {
      if (mode === 'pvp' && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ t: 'resign' }));
      } else if (mode === 'bot') {
        over = true;
        resignColor = 'w';
        render();
      }
    }
  };
}
