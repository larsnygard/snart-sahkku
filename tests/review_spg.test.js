// SPG-eksport frå GJENNOMGANGEN var tom (hovud utan trekk).
//
// Årsak: SPG.toSPG byggjer kroppen frå st.log — den levande trekk-loggen. I
// gjennomgangen kjem stillinga frå ARCH.replay(), som spela partiet opp att på
// nytt og ikkje har noka log. Difor vart fila eit hovud og ingenting meir.
// Rett retting: bruk den LAGRA notasjonen når vi er i gjennomgangen.
//
// Køyr:  node tests/review_spg.test.js
const fs = require('fs');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
               '.png': 'image/png', '.css': 'text/css', '.webmanifest': 'application/manifest+json' };
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' :: ' + String(x).slice(0, 260) : '')); } };

const SPG = fs.readFileSync(path.join(__dirname, 'fixtures', 'nesseby-rerolls.spg'), 'utf8');

const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});

(async () => {
  await new Promise(r => server.listen(8112, r));
  const browser = await chromium.launch({
    executablePath: path.join(process.env.HOME, '.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'),
    headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto('http://127.0.0.1:8112/index.html');
  await page.waitForFunction(() => window.__APP && window.ARCH && window.SPG);

  // ---- 1. legg eit verkeleg parti i arkivet ----------------------------
  const seed = await page.evaluate((spg) => {
    window.ARCH.clear();
    const r = window.ARCH.importSpg(spg);
    const g = window.ARCH.list()[0];
    return { added: r.added, id: g && g.id, trekk: g && g.plies, spgLen: g && (g.spg || '').length };
  }, SPG);
  ok('partiet vart importert til arkivet', seed.added === 1 && !!seed.id, JSON.stringify(seed));
  ok('posten har notasjonstekst', seed.spgLen > 100, JSON.stringify(seed));

  // ---- 2. opne gjennomgangen og last ned SPG derfrå --------------------
  const fromReview = await page.evaluate(async (id) => {
    // fang nedlastinga i staden for å skrive til disk
    let blob = null, navn = '';
    const origCreate = URL.createObjectURL;
    const origClick = HTMLAnchorElement.prototype.click;
    URL.createObjectURL = function (b) { blob = b; return origCreate.call(URL, b); };
    HTMLAnchorElement.prototype.click = function () { navn = this.download; };
    try {
      // gå til arkivet og trykk «Vis» på posten
      document.getElementById('btn-archive').click();
      const row = document.querySelector('.arch-row');
      row.querySelector('.arch-btns button').click();     // «Vis»
      const iGjennomgang = window.__APP.mode;
      document.getElementById('btn-spg').click();          // 📜 Notasjon i HUD
      const text = blob ? await blob.text() : '';
      return { mode: iGjennomgang, navn: navn, text: text };
    } finally {
      URL.createObjectURL = origCreate;
      HTMLAnchorElement.prototype.click = origClick;
    }
  }, seed.id);

  ok('vi er i gjennomgangen', fromReview.mode === 'review', fromReview.mode);
  ok('nedlastinga fekk eit .spg-namn', /\.spg$/.test(fromReview.navn || ''), fromReview.navn);
  const reviewText = fromReview.text || '';
  ok('fila har eit hovud', /\[Event /.test(reviewText), reviewText.slice(0, 60));
  const reviewRolls = (reviewText.match(/^\d+\.\s+[MK]/gm) || []).length;
  ok('fila har TRKK (ikkje berre hovud)', reviewRolls > 20, `${reviewRolls} trekk-linjer`);
  ok('fila har resultatlinja', /^1-0 /m.test(reviewText), reviewText.slice(-40));

  // ---- 3. arkivknappen skal gje same innhald ---------------------------
  const fromArchive = await page.evaluate(async () => {
    let blob = null;
    const origCreate = URL.createObjectURL;
    const origClick = HTMLAnchorElement.prototype.click;
    URL.createObjectURL = function (b) { blob = b; return origCreate.call(URL, b); };
    HTMLAnchorElement.prototype.click = function () {};
    try {
      document.getElementById('btn-replay-back').click();   // til arkivet
      const row = document.querySelector('.arch-row');
      const btns = row.querySelectorAll('.arch-btns button');
      btns[1].click();                                      // «SPG»
      return { text: blob ? await blob.text() : '' };
    } finally {
      URL.createObjectURL = origCreate;
      HTMLAnchorElement.prototype.click = origClick;
    }
  });
  const archiveText = fromArchive.text || '';
  const archiveRolls = (archiveText.match(/^\d+\.\s+[MK]/gm) || []).length;
  ok('arkivknappen gjev same tal trekk', archiveRolls === reviewRolls, `${archiveRolls} vs ${reviewRolls}`);
  ok('innhaldet er identisk med det lagra partiet',
     archiveText.trim() === reviewText.trim(), `${archiveText.length} vs ${reviewText.length} teikn`);

  // Den levande eksportvegen (eit parti som nettopp er spelt) er dekt av
  // spg_archive.test.js og share_image.test.js; her pinnar vi berre regresjonen
  // som vart rapportert: gjennomgangen gav ei fil utan trekk.

  ok('ingen JS-feil', errs.length === 0, errs.join(' | '));
  console.log('review_spg: ' + pass + ' pass, ' + fail + ' fail');
  await browser.close();
  server.close();
  process.exit(fail ? 1 : 0);
})();
