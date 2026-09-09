// Arena: papan catur, Web Audio SFX, Drag & Drop, Jam, Promosi Bidak, Heartbeat, PvP & Bot.
import { Chess } from '/js/vendor/chess.esm.js';

const qs = new URLSearchParams(location.search);
const mode = qs.get('m') === 'bot' ? 'bot' : 'pvp';
const room = (qs.get('r') || '').toUpperCase();

// Parameter Elo (0 s/d 3200) atau fallback ke 's' lama
const rawElo = qs.get('elo');
const rawSkill = qs.get('s');
let botElo = 1500;
if (rawElo != null) {
  botElo = Math.min(3200, Math.max(0, parseInt(rawElo, 10) || 0));
} else if (rawSkill != null) {
  const sk = parseInt(rawSkill, 10) || 3;
  botElo = Math.min(3200, Math.max(0, Math.round(sk * 300)));
}

const botSideChoice = qs.get('c') === 'b' ? 'b' : 'w';

let myId = localStorage.getItem('noir-id');
if (!myId) {
  myId = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  localStorage.setItem('noir-id', myId);
}
let hintUnlocked = localStorage.getItem('noir-hint-ok') === '1';

const $ = s => document.querySelector(s);
const statusEl = $('#status');
const statusText = $('#status-text');
const movesEl = $('#moves');
const hintBtn = $('#btn-hint');
const flipBtn = $('#btn-flip');
const drawBtn = $('#btn-draw');
const resignBtn = $('#btn-resign');
const rematchBtn = $('#btn-rematch');
const pgnBtn = $('#btn-pgn');
const analysisBtn = $('#btn-analysis');
const postGameActions = $('#post-game-actions');
const shareBox = $('#share');
const shareToggleBtn = $('#btn-share-toggle');
const soundBtn = $('#btn-sound');
const promoModal = $('#promo-modal');
const promoChoices = $('#promo-choices');
const offerBanner = $('#offer-banner');
const offerText = $('#offer-text');
const btnOfferAccept = $('#btn-offer-accept');
const btnOfferDecline = $('#btn-offer-decline');
const clockTop = $('#clock-top');
const clockBottom = $('#clock-bottom');
const dragGhost = $('#drag-ghost');

if (promoModal) {
  promoModal.hidden = true;
  promoModal.style.display = 'none';
  promoModal.onclick = (e) => {
    if (e.target === promoModal) {
      promoModal.hidden = true;
      promoModal.style.display = 'none';
      pendingPromo = null;
      sel = null;
      render();
    }
  };
}
if (offerBanner) {
  offerBanner.hidden = true;
  offerBanner.style.display = 'none';
}
if (postGameActions) {
  postGameActions.hidden = true;
  postGameActions.style.display = 'none';
}

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

// --- SUARA (SFX via Web Audio API) ---
let soundEnabled = localStorage.getItem('noir-sound') !== '0';
let audioCtx = null;

function initAudio() {
  if (!audioCtx && typeof window.AudioContext !== 'undefined') {
    audioCtx = new window.AudioContext();
  }
}

function updateSoundButton() {
  if (soundBtn) {
    soundBtn.textContent = soundEnabled ? '🔊' : '🔇';
    soundBtn.title = soundEnabled ? 'Suara: Aktif' : 'Suara: Senyap';
  }
}
updateSoundButton();

if (soundBtn) {
  soundBtn.onclick = () => {
    soundEnabled = !soundEnabled;
    localStorage.setItem('noir-sound', soundEnabled ? '1' : '0');
    updateSoundButton();
    toast(soundEnabled ? 'Suara diaktifkan.' : 'Suara dinonaktifkan.', true);
    if (soundEnabled) initAudio();
  };
}

function playSfx(type) {
  if (!soundEnabled) return;
  try {
    initAudio();
    if (!audioCtx) return;
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const now = audioCtx.currentTime;

    if (type === 'move') {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(240, now);
      osc.frequency.exponentialRampToValueAtTime(80, now + 0.08);
      gain.gain.setValueAtTime(0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.08);
    } else if (type === 'capture') {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(450, now);
      osc.frequency.exponentialRampToValueAtTime(150, now + 0.12);
      gain.gain.setValueAtTime(0.4, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.12);
    } else if (type === 'check') {
      [587.33, 880].forEach((freq, i) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + i * 0.04);
        gain.gain.setValueAtTime(0.25, now + i * 0.04);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now + i * 0.04);
        osc.stop(now + 0.25);
      });
    } else if (type === 'gameover') {
      [220, 277.18, 329.63].forEach(freq => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now);
        osc.stop(now + 0.5);
      });
    }
  } catch {}
}

let game = new Chess();
let sel = null;
let last = null;
let hint = null;
let myColor = mode === 'bot' ? botSideChoice : null;
let flip = mode === 'bot' ? (myColor === 'b') : false;
let over = false;
let serverStatus = null;
let onlineStatus = null;
let pcount = mode === 'bot' ? 2 : 1;
let ws = null;
let moveHistory = [];
let pendingPromo = null;

let reconnectAttempts = 0;
const MAX_RECONNECT = 10;
let reconnectTimer = null;
let pingTimer = null;

// Clocks state
let serverTimers = null;
let timerLocalTs = Date.now();
let timerInterval = null;

function startTimerLoop() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(updateClocksDisplay, 100);
}

function updateClocksDisplay() {
  if (!clockTop || !clockBottom) return;
  if (!serverTimers) {
    clockTop.hidden = true;
    clockTop.style.display = 'none';
    clockBottom.hidden = true;
    clockBottom.style.display = 'none';
    return;
  }
  clockTop.hidden = false;
  clockTop.style.display = 'inline-block';
  clockBottom.hidden = false;
  clockBottom.style.display = 'inline-block';

  const now = Date.now();
  const elapsed = (serverTimers.activeTurn && !over) ? Math.max(0, now - timerLocalTs) : 0;

  const wRemaining = Math.max(0, serverTimers.w - (serverTimers.activeTurn === 'w' ? elapsed : 0));
  const bRemaining = Math.max(0, serverTimers.b - (serverTimers.activeTurn === 'b' ? elapsed : 0));

  const bottomColor = flip ? 'b' : 'w';
  const topColor = flip ? 'w' : 'b';

  const bottomMs = bottomColor === 'w' ? wRemaining : bRemaining;
  const topMs = topColor === 'w' ? wRemaining : bRemaining;

  renderClockEl(clockBottom, bottomMs, serverTimers.activeTurn === bottomColor && !over);
  renderClockEl(clockTop, topMs, serverTimers.activeTurn === topColor && !over);

  if (!over && ((wRemaining <= 0 && serverTimers.activeTurn === 'w') || (bRemaining <= 0 && serverTimers.activeTurn === 'b'))) {
    if (mode === 'bot') {
      over = true;
      serverStatus = {
        over: true,
        result: 'timeout',
        winner: serverTimers.activeTurn === 'w' ? 'b' : 'w',
      };
      playSfx('gameover');
      render();
    }
  }
}

function renderClockEl(el, ms, isActive) {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  el.textContent = String(min).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
  if (totalSec <= 30 && ms > 0 && isActive) el.classList.add('low');
  else el.classList.remove('low');
}

// --- ENGINE (Stockfish) ---
let engine = null;
let engineReady = false;
let engineBusy = false;
const engineQueue = [];
let currentEval = null;

function ensureEngine() {
  if (engine) return;
  engine = new Worker('/js/vendor/stockfish-18-lite-single.js');
  engine.onmessage = e => handleEngine(String(e.data));
  engine.onerror = () => { engineReady = false; };
  engine.postMessage('uci');
}

function handleEngine(line) {
  if (line === 'uciok') {
    engine.postMessage('setoption name Hash value 16');
    engine.postMessage('isready');
  } else if (line === 'readyok') {
    engineReady = true;
    pumpEngine();
  } else if (line.startsWith('info depth')) {
    const scoreMatch = line.match(/score (cp|mate) (-?\d+)/);
    const depthMatch = line.match(/depth (\d+)/);
    if (scoreMatch) {
      currentEval = {
        type: scoreMatch[1],
        val: parseInt(scoreMatch[2], 10),
        depth: depthMatch ? parseInt(depthMatch[1], 10) : 0,
      };
    }
  } else if (line.startsWith('bestmove')) {
    engineBusy = false;
    const job = engineQueue.shift();
    const uci = line.split(/\s+/)[1] || '';
    const mv = {
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci[4] || 'q',
      eval: currentEval,
    };
    currentEval = null;
    if (job && job.cb) job.cb(mv);
    pumpEngine();
  }
}

function requestEngine(fen, opts, cb) {
  ensureEngine();
  engineQueue.push({
    fen,
    skill: opts.skill !== undefined ? opts.skill : 20,
    uciElo: opts.uciElo || null,
    movetime: opts.movetime || 400,
    depth: opts.depth || null,
    limitStrength: opts.limitStrength ?? false,
    cb,
  });
  pumpEngine();
}

function pumpEngine() {
  if (!engineReady || engineBusy || engineQueue.length === 0) return;
  const job = engineQueue[0];
  engineBusy = true;
  currentEval = null;

  if (job.limitStrength) {
    engine.postMessage('setoption name UCI_LimitStrength value true');
    if (job.uciElo) {
      engine.postMessage('setoption name UCI_Elo value ' + job.uciElo);
    }
  } else {
    engine.postMessage('setoption name UCI_LimitStrength value false');
  }

  if (job.skill != null) {
    engine.postMessage('setoption name Skill Level value ' + job.skill);
  }

  engine.postMessage('position fen ' + job.fen);
  if (job.depth) {
    engine.postMessage('go depth ' + job.depth + ' movetime ' + job.movetime);
  } else {
    engine.postMessage('go movetime ' + job.movetime);
  }
}

// --- PROMOSI BIDAK ---
function askPromotion(color, from, to) {
  pendingPromo = { from, to };
  promoChoices.innerHTML = '';
  const pieces = ['q', 'n', 'r', 'b'];
  for (const p of pieces) {
    const btn = document.createElement('button');
    btn.className = 'promo-btn';
    btn.type = 'button';
    const img = document.createElement('img');
    img.src = '/pieces/' + color + p.toUpperCase() + '.svg';
    img.alt = p;
    btn.appendChild(img);
    btn.onclick = () => {
      promoModal.hidden = true;
      promoModal.style.display = 'none';
      executeMove(pendingPromo.from, pendingPromo.to, p);
      pendingPromo = null;
    };
    promoChoices.appendChild(btn);
  }
  promoModal.hidden = false;
  promoModal.style.display = 'flex';
}

// --- PVP: WebSocket & Reconnect ---
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

    if (d.t === 'pong') return;

    if (d.t === 'init') {
      reconnectAttempts = 0;
      myColor = d.you;
      pcount = d.players;
      serverStatus = d.status || (d.over ? { over: true, result: d.resign ? 'resign' : 'finished', winner: d.resign === 'w' ? 'b' : 'w' } : null);
      if (d.online) onlineStatus = d.online;
      if (Array.isArray(d.history)) moveHistory = d.history;
      try { game.load(d.fen); } catch {}
      flip = myColor === 'b';
      if (pcount >= 2 && shareBox) shareBox.hidden = true;
      if (d.timers) {
        serverTimers = d.timers;
        timerLocalTs = Date.now();
        startTimerLoop();
      }
      over = isFinished();
      render();
    } else if (d.t === 'state') {
      pcount = d.players;
      if (pcount >= 2 && shareBox) shareBox.hidden = true;
      if (Array.isArray(d.history)) moveHistory = d.history;
      serverStatus = d.status || (d.over ? { over: true, result: d.resign ? 'resign' : 'finished', winner: d.resign === 'w' ? 'b' : 'w' } : null);
      if (d.online) onlineStatus = d.online;

      if (d.timers) {
        serverTimers = d.timers;
        timerLocalTs = Date.now();
        startTimerLoop();
      }

      if (d.fen !== game.fen()) {
        const prevFen = game.fen();
        try { game.load(d.fen); } catch {}
        last = d.last;
        hint = null;
        sel = null;
        over = isFinished();

        if (d.last) {
          const isCheck = game.inCheck();
          const isOverNow = isFinished();
          if (isOverNow) playSfx('gameover');
          else if (isCheck) playSfx('check');
          else if (prevFen.split(' ')[0] !== d.fen.split(' ')[0]) {
            playSfx(d.last.captured ? 'capture' : 'move');
          }
        }
        render();
      } else {
        over = isFinished();
        render();
      }
    } else if (d.t === 'draw_offered') {
      showOffer('Lawan menawarkan hasil remis.', () => {
        ws.send(JSON.stringify({ t: 'draw_response', accept: true }));
      }, () => {
        ws.send(JSON.stringify({ t: 'draw_response', accept: false }));
      });
    } else if (d.t === 'draw_declined') {
      toast('Lawan menolak tawaran remis.');
    } else if (d.t === 'rematch_offered') {
      showOffer('Lawan mengajak tanding ulang.', () => {
        ws.send(JSON.stringify({ t: 'rematch_accept' }));
      }, () => {
        offerBanner.hidden = true;
      });
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

function showOffer(msg, onAccept, onDecline) {
  if (!offerBanner) return;
  offerText.textContent = msg;
  offerBanner.hidden = false;
  offerBanner.style.display = 'flex';
  btnOfferAccept.onclick = () => {
    offerBanner.hidden = true;
    offerBanner.style.display = 'none';
    onAccept();
  };
  btnOfferDecline.onclick = () => {
    offerBanner.hidden = true;
    offerBanner.style.display = 'none';
    onDecline();
  };
}

function isFinished() {
  if (serverStatus && serverStatus.over) return true;
  return game.isGameOver();
}

function myColorOrW() {
  return mode === 'bot' ? myColor : myColor;
}

// --- LANGKAH ---
function tryMove(from, to) {
  const p = game.get(from);
  if (!p) return false;

  const isPawn = p.type === 'p';
  const isRank8 = (p.color === 'w' && to[1] === '8') || (p.color === 'b' && to[1] === '1');
  if (isPawn && isRank8) {
    const legalMoves = game.moves({ square: from, verbose: true });
    if (legalMoves.some(m => m.to === to)) {
      askPromotion(p.color, from, to);
      return true;
    }
    return false;
  }

  return executeMove(from, to, 'q');
}

function executeMove(from, to, promo = 'q') {
  const captured = game.get(to);
  let mv = null;
  try {
    mv = game.move({ from, to, promotion: promo });
  } catch {
    mv = null;
  }
  if (!mv) return false;

  over = isFinished();
  last = { from: mv.from, to: mv.to, captured: !!captured };
  hint = null;
  sel = null;

  if (over) playSfx('gameover');
  else if (game.inCheck()) playSfx('check');
  else if (captured) playSfx('capture');
  else playSfx('move');

  render();

  if (captured && !over) {
    toast((captured.color === 'w' ? 'Putih' : 'Hitam') + ' kehilangan ' + namaBidak(captured.type) + '.');
  }

  if (mode === 'bot') {
    if (!over && game.turn() !== myColor) botMove();
  } else if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ t: 'move', from: mv.from, to: mv.to, promotion: promo }));
  }
  return true;
}

function botMove() {
  let opts = {};
  if (botElo === 0) {
    opts = { skill: 0, depth: 1, movetime: 60, limitStrength: true };
  } else if (botElo < 1320) {
    const sk = Math.floor((botElo / 1320) * 6);
    const dp = Math.max(1, Math.floor((botElo / 1320) * 4));
    const mt = Math.max(80, Math.floor(botElo * 0.25));
    opts = { skill: sk, depth: dp, movetime: mt, limitStrength: true };
  } else if (botElo < 3190) {
    const mt = Math.min(800, 250 + Math.floor((botElo - 1320) * 0.25));
    opts = { uciElo: botElo, movetime: mt, limitStrength: true };
  } else {
    // 3200 (Max Super-Engine)
    opts = { skill: 20, movetime: 1000, limitStrength: false };
  }
  requestEngine(game.fen(), opts, mv => {
    if (!over && game.turn() !== myColor) {
      executeMove(mv.from, mv.to, mv.promotion || 'q');
    }
  });
}

// --- HINT ---
let hintsLeft = 3;
function askHint() {
  const myTurn = game.turn() === myColorOrW();
  if (over || !myTurn || engineBusy) return;
  if (mode === 'pvp') {
    if (!hintUnlocked || hintsLeft <= 0) return;
    hintsLeft--;
  }
  statusText.textContent = 'Menganalisis langkah terbaik (Grandmaster Stockfish)…';
  requestEngine(game.fen(), { skill: 20, depth: 14, movetime: 1200, limitStrength: false }, mv => {
    hint = mv;
    let evalStr = '';
    if (mv.eval) {
      if (mv.eval.type === 'mate') {
        evalStr = ` (Skakmat dalam ${Math.abs(mv.eval.val)} langkah!)`;
      } else {
        const sign = mv.eval.val > 0 ? '+' : '';
        evalStr = ` (eval: ${sign}${(mv.eval.val / 100).toFixed(1)})`;
      }
    }
    statusText.textContent = `💡 Rekomendasi: ${mv.from} → ${mv.to}${evalStr}`;
    toast(`💡 Rekomendasi: ${mv.from.toUpperCase()} ke ${mv.to.toUpperCase()}${evalStr}`, true);
    render();
  });
}
if (hintBtn) hintBtn.onclick = askHint;

if (flipBtn) {
  flipBtn.onclick = () => {
    flip = !flip;
    render();
    toast('Sudut pandang papan dibalik.', true);
  };
}

if (resignBtn) {
  resignBtn.onclick = () => {
    if (over) return;
    if (!confirm('Yakin ingin menyerah?')) return;
    if (mode === 'bot') {
      over = true;
      serverStatus = { over: true, result: 'resign', winner: myColor === 'w' ? 'b' : 'w' };
      playSfx('gameover');
      render();
    } else if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ t: 'resign' }));
    }
  };
}

if (drawBtn) {
  drawBtn.onclick = () => {
    if (over) return;
    if (mode === 'bot') {
      const caps = getCaptures();
      const lead = caps.w.lead;
      if (Math.abs(lead) <= 1 && !game.inCheck()) {
        over = true;
        serverStatus = { over: true, result: 'draw_agreed' };
        toast('Komputer menyetujui tawaran remis.', true);
        playSfx('gameover');
        render();
      } else {
        toast('Komputer menolak tawaran remis.');
      }
    } else if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ t: 'draw_offer' }));
      toast('Tawaran remis dikirimkan ke lawan.', true);
    }
  };
}

if (rematchBtn) {
  rematchBtn.onclick = () => {
    if (mode === 'bot') {
      game = new Chess();
      over = false;
      serverStatus = null;
      last = null;
      hint = null;
      sel = null;
      moveHistory = [];
      myColor = myColor === 'w' ? 'b' : 'w';
      flip = myColor === 'b';
      render();
      toast('Tanding ulang dimulai! Kamu ' + (myColor === 'w' ? 'Putih' : 'Hitam') + '.', true);
      if (myColor === 'b') botMove();
    } else if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ t: 'rematch_offer' }));
      toast('Ajakan tanding ulang dikirimkan...', true);
    }
  };
}

if (pgnBtn) {
  pgnBtn.onclick = () => {
    const pgn = game.pgn();
    navigator.clipboard.writeText(pgn || game.fen()).then(() => {
      toast('PGN berhasil disalin ke clipboard!', true);
    }).catch(() => toast('Gagal menyalin PGN.'));
  };
}

if (analysisBtn) {
  analysisBtn.onclick = () => {
    const fen = game.fen();
    window.open('https://lichess.org/analysis?fen=' + encodeURIComponent(fen), '_blank');
  };
}

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

  const capturedByW = [];
  const capturedByB = [];
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

// --- RENDER UTAMA ---
function render() {
  const myActualColor = myColorOrW();
  const spectator = mode === 'pvp' && (!myColor || myColor === 'spectator');
  const myTurn = game.turn() === myActualColor;

  const bottomColor = flip ? 'b' : 'w';
  const topColor = flip ? 'w' : 'b';

  // 1. Ranks & Files
  const ranks = flip ? [1, 2, 3, 4, 5, 6, 7, 8] : [8, 7, 6, 5, 4, 3, 2, 1];
  const files = flip ? [...FILES].reverse() : FILES;
  $('#ranks').innerHTML = ranks.map(r => '<span>' + r + '</span>').join('');
  $('#files').innerHTML = files.map(f => '<span>' + f + '</span>').join('');

  // 2. Tombol Hint & Aksi
  if (hintBtn) {
    hintBtn.hidden = !(hintUnlocked && !over && !spectator && myTurn);
    hintBtn.disabled = (mode === 'pvp' && hintsLeft <= 0) || engineBusy;
    hintBtn.textContent = mode === 'pvp' ? '💡 Hint (' + hintsLeft + ')' : '💡 Hint';
  }

  if (drawBtn) drawBtn.hidden = over || spectator;
  if (resignBtn) resignBtn.hidden = over || spectator;
  if (postGameActions) {
    postGameActions.hidden = !over;
    postGameActions.style.display = over ? 'flex' : 'none';
  }

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
  } else if (hint && !over) {
    let evalStr = '';
    if (hint.eval) {
      if (hint.eval.type === 'mate') {
        evalStr = ` (Skakmat dalam ${Math.abs(hint.eval.val)} langkah!)`;
      } else {
        const sign = hint.eval.val > 0 ? '+' : '';
        evalStr = ` (eval: ${sign}${(hint.eval.val / 100).toFixed(1)})`;
      }
    }
    statusText.textContent = `💡 Rekomendasi: ${hint.from.toUpperCase()} ke ${hint.to.toUpperCase()}${evalStr}`;
    statusEl.classList.add('mine');
  } else if (game.inCheck()) {
    const terancam = game.turn() === myActualColor ? 'Kamu' : 'Lawan';
    statusText.textContent = 'Skak! ' + terancam + ' dalam posisi terancam!';
    statusEl.classList.add('check');
  } else {
    statusText.textContent = 'Giliran: ' + (game.turn() === 'w' ? 'Putih' : 'Hitam') +
      (mode === 'bot' ? (myActualColor === game.turn() ? ' — Giliranmu' : ' — Komputer berpikir') : myActualColor === game.turn() ? ' — Giliranmu' : ' — Giliran lawan');
    statusEl.classList.add(game.turn() === myActualColor ? 'mine' : 'wait');
  }

  // 4. Update Kartu Pemain
  updatePlayerCards(topColor, bottomColor, myActualColor, spectator);

  // 5. Render Papan Catur
  const board = $('#board');
  board.innerHTML = '';
  const moves = sel ? game.moves({ square: sel, verbose: true }) : [];
  const targets = new Set(moves.map(m => m.to));

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
        setupDrag(cell, sq, p);
      }

      cell.onclick = () => onCell(sq, p);
      board.appendChild(cell);
    }
  }

  // 6. Riwayat Langkah
  renderMovesHistory();
  updateClocksDisplay();
}

// --- DRAG & DROP SUPPORT ---
let dragStartSq = null;
let isDragging = false;

function setupDrag(cell, sq, p) {
  if (!dragGhost) return;
  cell.onpointerdown = e => {
    if (over) return;
    const spectator = mode === 'pvp' && (!myColor || myColor === 'spectator');
    if (spectator || game.turn() !== myColorOrW()) return;
    if (p.color !== game.turn()) return;

    dragStartSq = sq;
    isDragging = true;
    cell.classList.add('dragging');
    dragGhost.src = '/pieces/' + (p.color === 'w' ? 'w' : 'b') + p.type.toUpperCase() + '.svg';
    dragGhost.style.display = 'block';
    dragGhost.style.left = e.clientX + 'px';
    dragGhost.style.top = e.clientY + 'px';

    const onPointerMove = evt => {
      if (!isDragging) return;
      dragGhost.style.left = evt.clientX + 'px';
      dragGhost.style.top = evt.clientY + 'px';
    };

    const onPointerUp = evt => {
      if (!isDragging) return;
      isDragging = false;
      cell.classList.remove('dragging');
      dragGhost.style.display = 'none';
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);

      const targetEl = document.elementFromPoint(evt.clientX, evt.clientY);
      const targetCell = targetEl ? targetEl.closest('.cell') : null;
      if (targetCell) {
        const targetSq = targetCell.getAttribute('data-sq');
        if (targetSq && targetSq !== dragStartSq) {
          tryMove(dragStartSq, targetSq);
        }
      }
      dragStartSq = null;
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  };
}

function updatePlayerCards(topColor, bottomColor, myActualColor, spectator) {
  const caps = getCaptures();

  // TOP
  const nameTop = $('#name-top');
  const tagTop = $('#tag-top');
  const capTop = $('#captured-top');
  const turnTop = $('#turn-top');
  const cardTop = $('#card-top');
  const avatarTop = $('#avatar-top');

  if (mode === 'bot') {
    nameTop.textContent = 'Bot (' + botElo + ' Elo)';
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

  const topCaps = caps[topColor];
  let topCapHtml = topCaps.list.map(g => '<span class="cap-item">' + g + '</span>').join('');
  if (topCaps.lead > 0) topCapHtml += '<span class="cap-lead">+' + topCaps.lead + '</span>';
  capTop.innerHTML = topCapHtml;

  const isTopTurn = !over && game.turn() === topColor;
  turnTop.hidden = !isTopTurn;
  turnTop.textContent = 'Giliran Lawan';
  cardTop.className = 'player-card top' + (isTopTurn ? ' active-turn' : '');

  // BOTTOM
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
  if (!h || h.length === 0) {
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
  if (game.turn() !== myColorOrW()) return;

  if (sel) {
    if (sq === sel) {
      sel = null;
      render();
      return;
    }
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
  if (serverStatus && serverStatus.result) {
    const res = serverStatus.result;
    const win = serverStatus.winner;
    const aku = (win === myColor);
    if (res === 'resign') {
      return aku ? '🏆 Lawan menyerah — Kamu menang!' : '🏳️ Kamu menyerah — Lawan menang.';
    }
    if (res === 'timeout') {
      return aku ? '⏱️ Waktu lawan habis — Kamu menang!' : '⏱️ Waktumu habis — Lawan menang.';
    }
    if (res === 'draw_agreed') return '🤝 Kesepakatan bersama — Permainan remis.';
  }
  if (game.isCheckmate()) {
    const pemenang = game.turn() === 'w' ? 'Hitam' : 'Putih';
    const aku = (pemenang === (myColor === 'w' ? 'Putih' : 'Hitam'));
    return aku ? '🏆 Skakmat — Kamu menang!' : 'Skakmat — ' + pemenang + ' menang.';
  }
  if (game.isStalemate()) return 'Pat (stalemate) — Permainan remis.';
  if (game.isInsufficientMaterial()) return 'Remis — Material tidak cukup.';
  if (game.isThreefoldRepetition()) return 'Remis — Pengulangan posisi 3 kali.';
  if (game.isDraw()) return 'Permainan remis.';
  return 'Permainan berakhir.';
}

// --- INISIALISASI ---
if (mode === 'pvp') {
  $('#room-label').textContent = room;
  if (shareToggleBtn) shareToggleBtn.hidden = false;
  const link = location.origin + '/game?m=pvp&r=' + room;
  if ($('#share-link')) $('#share-link').value = link;

  if (shareToggleBtn) {
    shareToggleBtn.onclick = () => {
      if (shareBox) shareBox.hidden = !shareBox.hidden;
    };
  }

  if ($('#btn-copy')) {
    $('#btn-copy').onclick = () => {
      navigator.clipboard.writeText(link).then(() => {
        $('#btn-copy').textContent = '✓ Tersalin!';
        toast('Tautan disalin — kirimkan ke lawan.', true);
        setTimeout(() => { $('#btn-copy').textContent = 'Salin'; }, 2500);
      }).catch(() => toast('Gagal menyalin tautan.'));
    };
  }

  if (shareBox) shareBox.hidden = false;
  connect();
} else {
  $('#room-label').textContent = 'vs Bot · ' + botElo + ' Elo' + (myColor === 'b' ? ' (Hitam)' : ' (Putih)');
  if (shareToggleBtn) shareToggleBtn.hidden = true;
  if (shareBox) shareBox.hidden = true;
  render();
  if (myColor === 'b') {
    setTimeout(botMove, 500);
  }
}

// Gerbang rahasia: ketuk logo 3x untuk membuka hint
let secretTaps = 0, secretTimer = null;
const brandEl = $('.brand');
if (brandEl) {
  brandEl.onclick = (e) => {
    clearTimeout(secretTimer);
    secretTaps++;
    secretTimer = setTimeout(() => { secretTaps = 0; }, 1500);
    if (secretTaps < 3) return;
    e.preventDefault();
    secretTaps = 0;
    const code = prompt('Cheat Code / Akses Rahasia:');
    if (!code) return;
    fetch('/api/hint-unlock', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: code.trim() }),
    })
      .then(r => r.json())
      .then(d => {
        if (d.ok) {
          localStorage.setItem('noir-hint-ok', '1');
          hintUnlocked = true;
          if (hintBtn) hintBtn.hidden = false;
          toast('Cheat aktif! Hint terbuka.', true);
        } else toast('Kode salah.');
      })
      .catch(() => toast('Gagal menghubungi server.'));
  };
}
