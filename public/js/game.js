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

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

function toast(msg, good = false) {
  if (window.noirToast) return window.noirToast(msg, good);
  const box = document.getElementById('toast-box');
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
let flip = false;
let over = false;
let pcount = mode === 'bot' ? 2 : 1;
let ws = null;

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
  ws.onmessage = e => {
    let d;
    try { d = JSON.parse(e.data); } catch { return; }
    if (d.t === 'init') {
      myColor = d.you;
      pcount = d.players;
      try { game.load(d.fen); } catch {}
      flip = myColor === 'b';
      render();
    } else if (d.t === 'state') {
      pcount = d.players;
      if (d.fen !== game.fen()) {
        try { game.load(d.fen); } catch {}
        last = d.last;
        hint = null;
        sel = null;
        over = game.isGameOver();
        render();
      } else render();
    } else if (d.t === 'error') {
      statusText.textContent = d.error;
    }
  };
  ws.onclose = () => setTimeout(connect, 1500);
}

// --- langkah ---
function tryMove(from, to) {
  const captured = game.get(to);
  const mv = game.move({ from, to, promotion: 'q' });
  if (!mv) return false;
  over = game.isGameOver();
  last = { from: mv.from, to: mv.to };
  hint = null;
  sel = null;
  render();
  if (captured && !over) toast((captured.color === 'w' ? 'Putih' : 'Hitam') + ' kehilangan ' + namaBidak(captured.type) + '.');
  if (mode === 'bot') {
    if (!over && game.turn() === 'b') botMove();
  } else if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ t: 'move', from: mv.from, to: mv.to, promotion: 'q' }));
  }
  return true;
}

const NAMA = { p: 'pion', n: 'kuda', b: 'benteng', r: 'benteng', q: 'ratu', k: 'raja' };
const namaBidak = t => NAMA[t] || t;

function botMove() {
  requestEngine(game.fen(), { skill }, mv => {
    if (!over && game.turn() === 'b') tryMove(mv.from, mv.to);
  });
}

// --- hint ---
let hintsLeft = 3; // jatah hint per halaman di PvP

function askHint() {
  const myTurn = game.turn() === (mode === 'bot' ? 'w' : myColor);
  if (over || !myTurn) return;
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

// --- render ---
function render() {
  // koordinat papan
  const ranks = flip ? [8, 7, 6, 5, 4, 3, 2, 1] : [1, 2, 3, 4, 5, 6, 7, 8];
  const files = flip ? [...FILES].reverse() : FILES;
  $('#ranks').innerHTML = ranks.map(r => '<span>' + r + '</span>').join('');
  $('#files').innerHTML = files.map(f => '<span>' + f + '</span>').join('');

  // tombol hint
  const myTurn = game.turn() === (mode === 'bot' ? 'w' : myColor);
  const spectator = mode === 'pvp' && (!myColor || myColor === 'spectator');
  hintBtn.hidden = !(hintUnlocked && !over && !spectator && myTurn);
  hintBtn.disabled = mode === 'pvp' && hintsLeft <= 0;
  hintBtn.textContent = mode === 'pvp' ? 'Hint (' + hintsLeft + ')' : 'Hint';

  // status
  statusEl.className = '';
  if (spectator) {
    statusText.textContent = 'Ruangan penuh — mode penonton.';
    statusEl.classList.add('wait');
  } else if (!over && mode === 'pvp' && pcount < 2) {
    statusText.textContent = 'Menunggu lawan… bagikan tautan di atas.';
    statusEl.classList.add('wait');
  } else if (over) {
    statusText.textContent = hasilText();
    statusEl.classList.add('over');
  } else if (game.inCheck()) {
    statusText.textContent = 'Skak! ' + (game.turn() === 'w' ? 'Putih' : 'Hitam') + ' harus menghindar.';
    statusEl.classList.add('check');
  } else {
    statusText.textContent = 'Giliran: ' + (game.turn() === 'w' ? 'Putih' : 'Hitam') +
      (mode === 'bot' ? ' (kamu putih)' : myColor === game.turn() ? ' — kamu' : ' — lawan');
    statusEl.classList.add(game.turn() === myColorOrW() ? 'mine' : 'wait');
  }

  // papan
  const board = $('#board');
  board.innerHTML = '';
  const moves = sel ? game.moves({ square: sel, verbose: true }) : [];
  const targets = new Set(moves.map(m => m.to));

  for (const r of ranks) {
    for (const f of files) {
      const sq = f + r;
      const cell = document.createElement('div');
      const fi = FILES.indexOf(f);
      cell.className = 'cell ' + ((fi + r - 1) % 2 === 0 ? 'dark' : 'light');
      if (sq === sel) cell.classList.add('sel');
      if (last && (sq === last.from || sq === last.to)) cell.classList.add('last');
      if (hint && (sq === hint.from || sq === hint.to)) cell.classList.add('hint');
      if (targets.has(sq)) cell.classList.add('tgt');
      const p = game.get(sq);
      if (p && targets.has(sq)) cell.classList.add('occ');
      if (p) {
        const img = document.createElement('img');
        img.draggable = false;
        img.alt = '';
        img.src = '/pieces/' + (p.color === 'w' ? 'w' : 'b') + p.type.toUpperCase() + '.svg';
        img.className = 'pc';
        cell.appendChild(img);
      }
      cell.onclick = () => onCell(sq, p);
      board.appendChild(cell);
    }
  }

  // riwayat
  const h = game.history();
  const rows = [];
  for (let i = 0; i < h.length; i += 2) rows.push((i / 2 + 1) + '. ' + h[i] + (h[i + 1] ? ' ' + h[i + 1] : ''));
  movesEl.textContent = rows.slice(-6).join('   ');
}

function myColorOrW() { return mode === 'bot' ? 'w' : myColor; }

function onCell(sq, p) {
  if (over) return;
  const spectator = mode === 'pvp' && (!myColor || myColor === 'spectator');
  if (spectator) return;
  if (game.turn() !== myColorOrW()) return; // bukan giliran
  if (sel) {
    if (sq === sel) { sel = null; render(); return; }
    if (tryMove(sel, sq)) return;
  }
  if (p && p.color === game.turn()) { sel = sq; hint = null; render(); }
  else { sel = null; render(); }
}

function hasilText() {
  if (game.isCheckmate()) {
    const pemenang = game.turn() === 'w' ? 'Hitam' : 'Putih';
    const aku = mode === 'bot' ? (pemenang === 'Putih') : (pemenang === (myColor === 'w' ? 'Putih' : 'Hitam'));
    return (aku ? 'Skakmat — kamu menang!' : 'Skakmat — ' + pemenang + ' menang.');
  }
  if (game.isStalemate()) return 'Pat (stalemate) — remis.';
  if (game.isInsufficientMaterial()) return 'Remis — material tak cukup.';
  if (game.isThreefoldRepetition()) return 'Remis — pengulangan tiga kali.';
  if (game.isDraw()) return 'Remis.';
  return 'Permainan berakhir.';
}

// --- share link (PvP) ---
if (mode === 'pvp') {
  $('#room-label').textContent = room;
  const link = location.origin + '/game?m=pvp&r=' + room;
  $('#share-link').value = link;
  $('#btn-copy').onclick = () => {
    navigator.clipboard.writeText(link).then(() => {
      $('#btn-copy').textContent = 'Tersalin!';
      toast('Tautan disalin — kirim ke lawan.', true);
      setTimeout(() => { $('#btn-copy').textContent = 'Salin'; }, 2500);
    }).catch(() => toast('Gagal menyalin — salin manual dari kotak.'));
  };
  connect();
} else {
  $('#room-label').textContent = 'vs Komputer · level ' + skill;
  render();
  // pemain putih mulai; bot menunggu langkah pertama
}
