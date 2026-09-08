// Uji E2E browser: mode bot + hint via Stockfish WASM di Chromium headless.
// Pakai: BASE=https://<url> node tests/e2e-bot.mjs   (perlu playwright + chromium)
let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.log('SKIP: playwright belum terpasang (npm i -D playwright).');
  process.exit(0);
}

const base = process.env.BASE || 'http://127.0.0.1:8787';
const results = [];
const ok = (name, cond, extra = '') => {
  results.push([cond ? 'PASS' : 'FAIL', name, extra]);
  if (!cond) process.exitCode = 1;
};

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', e => results.push(['PAGEERROR', String(e), '']));
page.on('console', m => { if (m.type() === 'error') results.push(['CONSOLE', m.text(), '']); });

// Mode bot level 1
await page.goto(base + '/game?m=bot&s=1');
await page.evaluate(() => localStorage.setItem('noir-hint-ok', '1'));
await page.reload();
await page.waitForSelector('#board .cell');

ok('papan 64 kotak', (await page.locator('#board .cell').count()) === 64);
const status0 = await page.locator('#status').textContent();
ok('status giliran putih', status0.includes('Giliran'), status0);
const hintVisible = await page.locator('#btn-hint').isVisible();
ok('hint tampil (unlocked, giliran saya)', hintVisible);

// Hint: klik -> engine -> 2 kotak disorot
await page.click('#btn-hint');
await page.waitForFunction(() => {
  const b = document.getElementById('status');
  return !b.textContent.includes('Menghitung');
}, null, { timeout: 60000 });
const hintCells = await page.locator('#board .cell.hint').count();
ok('hint: 2 kotak disorot', hintCells === 2, 'hintCells=' + hintCells);

// Main e2e4: pion e2 = index rank2 kolom e (baris ke-2, kolom ke-5 => 8+4=12)
await page.locator('#board .cell').nth(12).click();
await page.waitForTimeout(200);
await page.locator('#board .cell').nth(28).click(); // e4
// tunggu bot membalas (riwayat jadi 2 langkah)
await page.waitForFunction(() => {
  const h = document.getElementById('moves').textContent;
  return (h.match(/\d+\./g) || []).length >= 1 && h.trim().split(/\s+/).length >= 3;
}, null, { timeout: 60000 });
const moves = await page.locator('#moves').textContent();
ok('bot membalas (>=2 langkah)', moves.trim().split(/\s+/).length >= 3, moves);

// Status giliran kembali ke putih
const status1 = await page.locator('#status').textContent();
ok('giliran kembali ke putih', status1.includes('Giliran') && status1.includes('kamu'), status1);

// Kotak asal bot berwarna last-move
const lastCells = await page.locator('#board .cell.last').count();
ok('sorotan langkah terakhir', lastCells === 2, 'lastCells=' + lastCells);

await browser.close();
for (const [s, n, e] of results) console.log(`${s} ${n}${e ? ' :: ' + e : ''}`);
console.log(`\n${results.filter(r => r[0] === 'PASS').length} pass, ${results.filter(r => r[0] !== 'PASS').length} fail`);
