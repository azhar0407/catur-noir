// Lobi: ID anonim persisten, buat/gabung ruang, gerbang rahasia hint.
let id = localStorage.getItem('noir-id');
if (!id) {
  id = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  localStorage.setItem('noir-id', id);
}

const $ = s => document.querySelector(s);

$('#btn-create').onclick = async () => {
  const res = await fetch('/api/room', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id }),
  });
  const data = await res.json();
  if (data.room) location.href = '/game?m=pvp&r=' + data.room;
  else alert(data.error || 'Gagal membuat ruang.');
};

$('#btn-join').onclick = () => {
  const code = $('#inp-code').value.trim().toUpperCase();
  if (/^[A-Z]{4}$/.test(code)) location.href = '/game?m=pvp&r=' + code;
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
        alert('Hint terbuka di semua mode.');
      } else alert('Kode salah.');
    })
    .catch(() => alert('Gagal menghubungi server.'));
};
