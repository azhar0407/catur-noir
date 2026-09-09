// Lobi: ID anonim persisten, buat/gabung ruang, gerbang rahasia hint.
let id = localStorage.getItem('noir-id');
if (!id) {
  id = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  localStorage.setItem('noir-id', id);
}

const $ = s => document.querySelector(s);

function toast(msg, good = false) {
  const box = document.getElementById('toast-box');
  const el = document.createElement('div');
  el.className = 'toast' + (good ? ' good' : '');
  el.textContent = msg;
  box.appendChild(el);
  while (box.children.length > 3) box.firstChild.remove();
  setTimeout(() => el.remove(), 4000);
}
window.noirToast = toast;

$('#btn-create').onclick = async () => {
  const btn = $('#btn-create');
  const timeControl = parseInt($('#sel-time')?.value || '0', 10) || 0;
  const side = $('#sel-side-pvp')?.value || 'w';
  btn.disabled = true;
  btn.textContent = 'Membuat…';
  try {
    const res = await fetch('/api/room', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, timeControl, side, force: true }),
    });
    const data = await res.json();
    if (data.room) location.href = '/game?m=pvp&r=' + data.room;
    else { toast(data.error || 'Gagal membuat ruang.'); btn.disabled = false; btn.textContent = 'Buat Ruang PvP'; }
  } catch {
    toast('Jaringan bermasalah — coba lagi.');
    btn.disabled = false;
    btn.textContent = 'Buat Ruang PvP';
  }
};

$('#btn-join').onclick = () => {
  const code = $('#inp-code').value.trim().toUpperCase();
  if (/^[A-Z]{4}$/.test(code)) location.href = '/game?m=pvp&r=' + code;
  else toast('Kode ruang harus 4 huruf.');
};
$('#inp-code').addEventListener('keydown', e => { if (e.key === 'Enter') $('#btn-join').onclick(); });

const sliderElo = $('#slider-elo');
const eloDisplay = $('#elo-display');

function getEloLabel(elo) {
  if (elo === 0) return '0 Elo · Pemula (Blunder)';
  if (elo < 800) return elo + ' Elo · Pemula';
  if (elo < 1400) return elo + ' Elo · Kasual';
  if (elo < 1900) return elo + ' Elo · Klub / Menengah';
  if (elo < 2500) return elo + ' Elo · Mahir / Master';
  if (elo < 3100) return elo + ' Elo · Grandmaster';
  return elo + ' Elo · Max Super-Engine';
}

if (sliderElo && eloDisplay) {
  sliderElo.oninput = () => {
    const val = parseInt(sliderElo.value, 10);
    eloDisplay.textContent = getEloLabel(val);
  };
}

$('#btn-bot').onclick = () => {
  let side = $('#sel-side')?.value || 'w';
  if (side === 'rnd') side = Math.random() < 0.5 ? 'w' : 'b';
  const elo = sliderElo ? sliderElo.value : '1500';
  location.href = '/game?m=bot&elo=' + elo + '&c=' + side;
};

// Gerbang rahasia: ketuk judul 3x untuk membuka hint di semua mode (kode validasi di server).
let taps = 0, tapTimer = null;
$('#logo').onclick = () => {
  clearTimeout(tapTimer);
  taps++;
  tapTimer = setTimeout(() => { taps = 0; }, 1500);
  if (taps < 3) return;
  taps = 0;
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
        toast('Cheat aktif! Hint terbuka di semua mode.', true);
      } else toast('Kode salah.');
    })
    .catch(() => toast('Gagal menghubungi server.'));
};
