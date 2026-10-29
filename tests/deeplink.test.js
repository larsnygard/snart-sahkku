// Delingslenkjer: #challenge=<rom>&to=<node> skal opne rommet og utfordre.
//
// Nettverket er stubba (iroh-relayet finst ikkje i testen), men alt fram til
// første nettverkskall er ekte: URL-en vert lesen, skjermen bytt, romnamnet
// sett inn, og utfordringa lagd med rett mottakar.
//
// Køyr:  node tests/deeplink.test.js
const fs = require('fs');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
               '.png': 'image/png', '.css': 'text/css', '.webmanifest': 'application/manifest+json' };
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' :: ' + String(x).slice(0, 240) : '')); } };

const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});

(async () => {
  await new Promise(r => server.listen(8111, r));
  const browser = await chromium.launch({
    executablePath: path.join(process.env.HOME, '.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'),
    headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));

  // Nettet vert stubba FØR appen lastar, so ingenting prøver å nå eit relay.
  await page.addInitScript(() => {
    window.__netCalls = [];
    window.NET_STUB = true;
    const stub = {
      load: () => Promise.resolve(stub),
      join: (seed) => { window.__netCalls.push(['join', seed]); return Promise.resolve(); },
      leave: () => Promise.resolve(),
      send: (o) => { window.__netCalls.push(['send', o]); return Promise.resolve(); },
      isLowest: () => true,
      short: (id) => String(id || '').slice(0, 8),
      myId: 'aaa-mynode',
      seed: null, peers: [], ready: true, handlers: {},
    };
    // Appen gjer «global.NET = net» i online.js — her skal det vere ein no-op,
    // elles forsvinn stubben med ein gong modulen vert lasta.
    Object.defineProperty(window, 'NET', {
      configurable: true,
      get: () => stub,
      set: () => { /* ignorer appens tildeling */ },
    });
  });

  await page.goto('http://127.0.0.1:8111/index.html#challenge=rom1&to=bbb-other');
  await page.waitForFunction(() => window.__APP && window.LOBBY, null, { timeout: 20000 });
  await page.waitForTimeout(1200);

  const res = await page.evaluate(() => {
    const calls = window.__netCalls || [];
    return {
      skjerm: !document.getElementById('room').classList.contains('hidden'),
      seed: document.getElementById('room-seed').value,
      join: (calls.find(c => c[0] === 'join') || [])[1],
      sends: calls.filter(c => c[0] === 'send').map(c => c[1]),
      pending: window.LOBBY.state.pending,
      hash: location.hash,
    };
  });

  ok('lenkja opna romskjermen', res.skjerm === true, JSON.stringify(res));
  ok('romnamnet vart sett inn frå lenkja', res.seed === 'rom1', res.seed);
  ok('motparten sin node-id vart brukt som bootstrap', res.join === 'rom1#bbb-other', res.join);
  ok('utfordringa vart send til rett node',
     res.sends.some(m => m.t === 'chal' && m.to === 'bbb-other'), JSON.stringify(res.sends));
  ok('utfordringa står som «ventar»', !!res.pending && res.pending.to === 'bbb-other', res.pending);
  ok('lenkja vart rydda frå adressa', res.hash === '', res.hash);

  // ---- #lobby=<rom> skal berre opne rommet, utan utfordring --------------
  // ny hash lastar ikkje dokumentet på nytt — tving ei full innlasting
  await page.goto('http://127.0.0.1:8111/index.html?x=2#lobby=rom2');
  await page.waitForFunction(() => window.__APP && window.LOBBY, null, { timeout: 20000 });
  await page.waitForTimeout(1000);
  const lob = await page.evaluate(() => ({
    seed: document.getElementById('room-seed').value,
    join: (window.__netCalls.find(c => c[0] === 'join') || [])[1],
    sends: window.__netCalls.filter(c => c[0] === 'send').length,
  }));
  ok('#lobby= opnar rommet', lob.seed === 'rom2' && lob.join === 'rom2', JSON.stringify(lob));
  ok('#lobby= sender inga utfordring', lob.sends === 0, JSON.stringify(lob));

  ok('ingen JS-feil', errs.length === 0, errs.join(' | '));
  console.log('deeplink: ' + pass + ' pass, ' + fail + ' fail');
  await browser.close();
  server.close();
  process.exit(fail ? 1 : 0);
})();
