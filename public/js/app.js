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
  btn.disabled = true;
  btn.textContent = 'Membuat…';
  try {
    const res = await fetch('/api/room', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, force: true }),
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

$('#btn-bot').onclick = () => {
  location.href = '/game?m=bot&s=' + $('#sel-level').value;
};

// Gerbang rahasia: ketuk judul 3x untuk membuka hint di semua mode (kode validasi di server).
let taps = 0, tapTimer = null;
$('#logo').onclick = () => {
  clearTimeout(tapTimer);
  taps++;
  tapTimer = setTimeout(() => { taps = 0; }, 1500);
  if (taps < 3) return;
  taps = 0;
  const code = prompt('Kode akses:');
  if (!code) return;
  fetch('/api/hint-unlock', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code }),
  })
    .then(r => r.json())
    .then(d => {
      if (d.ok) {
        localStorage.setItem('noir-hint-ok', '1');
        toast('Hint terbuka di semua mode.', true);
      } else toast('Kode salah.');
    })
    .catch(() => toast('Gagal menghubungi server.'));
};
