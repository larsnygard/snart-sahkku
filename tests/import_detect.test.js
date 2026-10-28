// Import-gjenkjenning gjennom FILSKJEMAET (ikkje berre ARCH.importSpg direkte).
//
// Feilen denne pinnar: ein .spg byrjar med «[Event …]». Fyrste utgåve las
// fyrste teikn: «[» => JSON => JSON.parse kasta => fila vart avvist.
// No vert alt lese som bytes og avgjort på innhaldet, so testen lastar inn
// JSON, SPG og SPGZ gjennom <input type=file> og krev at alle tre hamnar i
// arkivet — òg når endinga lyg (SPG-innhald i ei .json-fil).
//
// Køyr:  node tests/import_detect.test.js
const fs = require('fs');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
               '.png': 'image/png', '.css': 'text/css', '.webmanifest': 'application/manifest+json' };

// ---- fixture: eit lovleg, avslutta parti bygd utan nettlesar ------------
global.SS = require(path.join(ROOT, 'js/engine.js'));
require(path.join(ROOT, 'js/fen.js'));
require(path.join(ROOT, 'js/spg.js'));
require(path.join(ROOT, 'js/zip.js'));
require(path.join(ROOT, 'js/archive.js'));
const SS = global.SS, SPG = global.SPG, ZIP = global.ZIP;

const store = {};
global.localStorage = { getItem: k => (k in store ? store[k] : null),
                        setItem: (k, v) => { store[k] = String(v); },
                        removeItem: k => { delete store[k]; } };

function playGame(seed) {
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const st = SS.newGame({ first: 0 });
  SS.openingRoll(st, rnd);
  let mv = 0, it = 0;
  while (st.winner === null && mv < 90 && it < 3000) {
    it++;
    if (st.phase === 'roll') { SS.roll(st, rnd); st.phase = 'move'; continue; }
    const lm = SS.legalMoves(st, st.turn);
    if (!lm.length) { SS.passRemaining(st); continue; }
    SS.applyMove(st, lm[Math.floor(rnd() * lm.length)]); mv++;
    SS.settle(st);
  }
  return st;
}

const st = playGame(4242);
const spgText = SPG.toSPG(st, { event: 'Importtest', start: '2026-10-27T22:00:00Z',
                                menn: 'ImportMenn', koner: 'ImportKoner' });
const rec = {
  id: 'json-1', ts: '2026-10-27T21:00:00Z', mode: 'cpu', engine: 'json', level: 2,
  first: 0, result: st.winner === 0 ? '1-0' : '0-1', reason: st.winReason, plies: 0,
  steps: global.ARCH.stepsFrom(st), menn: 'JsonMenn', koner: 'JsonKoner',
  spg: spgText,
};
rec.plies = rec.steps.reduce((a, s) => a + s.moves.length, 0);
const jsonBundle = JSON.stringify({ v: 1, app: 'SnartSahkku', games: [rec] });

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
  await new Promise(r => server.listen(8097, r));
  const browser = await chromium.launch({
    executablePath: path.join(process.env.HOME, '.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'),
    headless: true, args: ['--no-sandbox'],
  });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto('http://127.0.0.1:8097/index.html');
  await page.waitForFunction(() => window.ARCH && window.SPG);

  async function importFile(name, mime, content) {
    await page.evaluate(() => { window.ARCH.clear(); });
    await page.setInputFiles('#arch-file', { name, mimeType: mime, buffer: Buffer.from(content) });
    await page.waitForTimeout(700);
    return page.evaluate(() => window.ARCH.list().map(g => ({ plies: g.plies,
      fens: (g.fens || []).length, menn: g.menn || '', harSpg: !!g.spg })));
  }

  // 1. JSON-arkiv
  let games = await importFile('arkiv.json', 'application/json', jsonBundle);
  ok('JSON via filskjema', games.length === 1 && games[0].plies > 0, JSON.stringify(games));

  // 2. SPG — dette var feilen: byrjar med «[Event»
  games = await importFile('parti.spg', 'text/plain', spgText);
  ok('SPG via filskjema', games.length === 1 && games[0].plies > 0, JSON.stringify(games));
  ok('SPG: namna kom med', /ImportMenn/.test(games[0].menn), games[0].menn);
  ok('SPG: FEN per stilling', games[0].fens === games[0].plies + 1, JSON.stringify(games[0]));
  ok('SPG: notasjonen vart halden', games[0].harSpg === true);

  // 3. SPGZ (zip)
  const zipBytes = await ZIP.write([{ name: 'parti.spg', text: spgText }]);
  games = await importFile('parti.spgz', 'application/zip', Buffer.from(zipBytes));
  ok('SPGZ via filskjema', games.length === 1 && games[0].plies > 0, JSON.stringify(games));

  // 4. feil ending: SPG-innhald i ei .json-fil -> innhaldet skal avgjere
  games = await importFile('lurer.json', 'application/json', spgText);
  ok('feil ending vert gjennomskua', games.length === 1 && games[0].plies > 0, JSON.stringify(games));

  // 5. søppel vert avvist (og arkivet står tomt)
  games = await importFile('søppel.txt', 'text/plain', 'dette er ingenting');
  ok('søppel vert avvist', games.length === 0, JSON.stringify(games));

  ok('ingen JS-feil', errs.length === 0, errs.join(' | '));

  console.log('import: ' + pass + ' pass, ' + fail + ' fail');
  await browser.close();
  server.close();
  process.exit(fail ? 1 : 0);
})();
