// Fangstrader i GUI: viser kva kvar side har TEKE (ikkje berre eit tal).
//
// Rendringa les brikkene (captured + eigar), so ho må stemme med det motoren
// seier: soldatar som prikkar, fiendedronninga som «♀», kongen som «♔» når
// sida eig han. Testen byggjer stillingar med kjende tap og tel elementa.
//
// Køyr:  node tests/captured.test.js
const fs = require('fs');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
               '.png': 'image/png', '.css': 'text/css', '.webmanifest': 'application/manifest+json' };
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) pass++; else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' :: ' + extra : '')); }
};

const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});

(async () => {
  await new Promise(r => server.listen(8099, r));
  const browser = await chromium.launch({
    executablePath: path.join(process.env.HOME, '.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'),
    headless: true, args: ['--no-sandbox'],
  });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto('http://127.0.0.1:8099/index.html');
  await page.waitForFunction(() => window.SS && window.UI && window.__APP);

  // Set opp ei stilling med kjende tap: 3 menn-soldatar og menn-dronninga
  // døde (tekne av Koner), 2 koner-soldatar døde (tekne av Menn), kongen
  // kapra av Menn. Så tel vi kva GUI-et viser.
  const res = await page.evaluate(() => {
    const SS = window.SS, app = window.__APP, UI = window.UI;
    const st = SS.newGame({ first: 0, queenMode: true });
    app.st = st; app.mode = 'cpu'; app.busy = false; app.over = false;
    UI.st = st; UI.setInteractive(false);
    // drep 3 menn-soldatar og menn-dronninga (tekne av Koner)
    SS.soldiers(st, 0).slice(0, 3).forEach(s => { s.captured = true; });
    SS.queen(st, 0).captured = true;
    // drep 2 koner-soldatar (tekne av Menn)
    SS.soldiers(st, 1).slice(0, 2).forEach(s => { s.captured = true; });
    SS.king(st).o = 0;
    UI.renderCaptured(st);
    const tell = id => {
      const el = document.getElementById(id);
      return {
        prikkar: el.querySelectorAll('.capdot').length,
        dronning: el.querySelectorAll('.capq').length,
        konge: el.querySelectorAll('.capk').length,
        tom: el.querySelectorAll('.capnone').length,
        tittel: el.parentNode.title || '',
      };
    };
    return { koner: tell('caplist-p1'), menn: tell('caplist-p0'),
             drap: st.kills, kongeEigar: SS.king(st).o };
  });

  // Koner (side 1) tok 3 soldatar + menn-dronninga
  ok('Koner: 3 soldatprikkar', res.koner.prikkar === 3, JSON.stringify(res.koner));
  ok('Koner: dronninga er markert', res.koner.dronning === 1, JSON.stringify(res.koner));
  ok('Koner: ingen konge (Menn eig han)', res.koner.konge === 0, JSON.stringify(res.koner));
  ok('Koner: tittelen nemner 3 soldatar og dronninga',
     /3 soldatar/.test(res.koner.tittel) && /dronninga/.test(res.koner.tittel), res.koner.tittel);

  // Menn (side 0) tok 2 soldatar og eig kongen
  ok('Menn: 2 soldatprikkar', res.menn.prikkar === 2, JSON.stringify(res.menn));
  ok('Menn: kongen er markert', res.menn.konge === 1, JSON.stringify(res.menn));
  ok('Menn: tittelen nemner kongen', /kapra kongen/.test(res.menn.tittel), res.menn.tittel);

  // Tom tilstand: ingenting fanga -> strek, ikkje tom boks
  const tom = await page.evaluate(() => {
    const SS = window.SS, UI = window.UI;
    const st = SS.newGame({ first: 0 });
    UI.st = st; UI.renderCaptured(st);
    const el = document.getElementById('caplist-p0');
    return { prikkar: el.querySelectorAll('.capdot').length,
             tom: el.querySelectorAll('.capnone').length };
  });
  ok('ingen tap -> «–» i staden for tom boks', tom.prikkar === 0 && tom.tom === 1, JSON.stringify(tom));

  ok('ingen JS-feil', errs.length === 0, errs.join(' | '));
  console.log('captured: ' + pass + ' pass, ' + fail + ' fail');
  await browser.close();
  server.close();
  process.exit(fail ? 1 : 0);
})();
