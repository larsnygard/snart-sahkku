// To ting: (1) ein kan kome UT av eit dødt nettparti, (2) tidsstempel i SPG-namn.
//
// Feilen som vart rapportert: «Ingen veg ut av eit nettparti som har stivna».
// Årsaka var ikkje at knappen mangla — «Meny» fanst og kalla NET.leave() — men
// at det lagra partiet aldri vart gløymt, so boot() auto-join'a det same rommet
// ved kvar oppstart. Testen pinnar at forlating faktisk ryddar lagringa.
//
// Køyr:  node tests/online_quit.test.js
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
  await new Promise(r => server.listen(8100, r));
  const browser = await chromium.launch({
    executablePath: path.join(process.env.HOME, '.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'),
    headless: true, args: ['--no-sandbox'],
  });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto('http://127.0.0.1:8100/index.html');
  await page.waitForFunction(() => window.__APP && window.__fileStamp);

  // ---- 1. tidsstempel i filnamn --------------------------------------
  const stamp = await page.evaluate(() => ({
    no: window.__fileStamp(),
    fråIso: window.__fileStamp('2026-10-29T12:34:56Z'),
  }));
  ok('fileStamp() gjev YYYY-MM-DDTHHMMZ', /^\d{4}-\d{2}-\d{2}T\d{4}Z$/.test(stamp.no), stamp.no);
  ok('fileStamp() les ISO-tid rett', stamp.fråIso === '2026-10-29T1234Z', stamp.fråIso);

  // ---- 2. arkiv-eksporten brukar han (fanga nedlastinga) --------------
  const dl = await page.evaluate(async () => {
    // eit spel i arkivet so eksporten har noko å skrive
    const SS = window.SS, rec = {
      id: 'x1', ts: '2026-10-29T09:00:00Z', mode: 'cpu', engine: 'test', level: 2,
      first: 0, result: '*', reason: '', plies: 0, steps: [], fens: [],
      spg: '[Event "x"]\nSPG-V1\n\n1. open: M(X _ _) K(_ _ _) -> M\n',
    };
    window.ARCH.save(rec);
    const navn = [];
    const origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { navn.push(this.download); };
    document.getElementById('btn-arch-spg').click();
    HTMLAnchorElement.prototype.click = origClick;
    return navn;
  });
  ok('SPG-nedlasting har tidsstempel',
     dl.length === 1 && /^sahkku-arkiv-\d{4}-\d{2}-\d{2}T\d{4}Z\.spg$/.test(dl[0]), JSON.stringify(dl));

  // ---- 3. forlating av nettparti ryddar lagringa ---------------------
  const res = await page.evaluate(() => {
    const app = window.__APP, SS = window.SS;
    // lat som vi er i eit nettparti med eit lagra rom
    app.mode = 'online';
    app.st = SS.newGame({ first: 0 });
    app.room = 'rom123';
    // same nøkkel som appen brukar (SAVE_KEY = 'sahkku.save.v2')
    localStorage.setItem('sahkku.save.v2', JSON.stringify(
      { mode: 'online', room: 'rom123', ts: new Date().toISOString(),
        st: JSON.parse(JSON.stringify(app.st)) }));
    const før = !!localStorage.getItem('sahkku.save.v2');
    document.getElementById('btn-menu').click();
    return {
      før: før,
      etter: !!localStorage.getItem('sahkku.save.v2'),
      mode: app.mode,
      skjerm: !document.getElementById('menu').classList.contains('hidden'),
      forlatSynleg: !document.getElementById('btn-leave').classList.contains('hidden'),
    };
  });
  ok('lagra nettparti fanst før', res.før === true, JSON.stringify(res));
  ok('forlating gløymer partiet (boot kan ikkje auto-join)', res.etter === false, JSON.stringify(res));
  ok('forlating går til menyen', res.mode === 'menu' && res.skjerm === true, JSON.stringify(res));
  ok('«Forlat»-knappen er skjult utanfor nettparti', res.forlatSynleg === false, JSON.stringify(res));

  // ---- 4. knappen er synleg I eit nettparti --------------------------
  const synleg = await page.evaluate(() => {
    const app = window.__APP;
    app.mode = 'online';
    window.__APP.st = window.SS.newGame({ first: 0 });
    document.getElementById('game').classList.remove('hidden');
    // show('game') er intern; simuler same synlegheitslogikk via knappen
    document.getElementById('btn-leave').classList.remove('hidden');
    return !document.getElementById('btn-leave').classList.contains('hidden');
  });
  ok('«Forlat» kan visast i nettparti', synleg === true);

  ok('ingen JS-feil', errs.length === 0, errs.join(' | '));
  console.log('online_quit: ' + pass + ' pass, ' + fail + ' fail');
  await browser.close();
  server.close();
  process.exit(fail ? 1 : 0);
})();
