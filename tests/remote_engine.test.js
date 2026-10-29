// Fjernmotor over HTTP: heile vegen frå dialog til trekk i spelet.
//
// Startar den verkelege tenaren (sahkku_ai/server.py) med ein S-UCI-motor på
// ein ledig port, koplar appen til han gjennom dialogen, og krev at eit parti
// faktisk kan spelast med trekka som kjem over nettet.
//
// Køyr:  node tests/remote_engine.test.js
const fs = require('fs');
const path = require('path');
const http = require('http');
const net = require('net');
const { spawn } = require('child_process');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const AI = path.join(ROOT, '..', 'sahkku-ai');
const PY = path.join(AI, '.venv', 'bin', 'python3');
const ENGINE = path.join(ROOT, 'engines', 'nais2.js');
const KEY = 'e2e-key-77';

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
               '.png': 'image/png', '.css': 'text/css', '.webmanifest': 'application/manifest+json' };
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' :: ' + String(x).slice(0, 300) : '')); } };

function freePort() {
  return new Promise((res) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
  });
}

const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});

(async () => {
  const port = await freePort();
  const appPort = await freePort();
  const base = `http://127.0.0.1:${port}`;

  const eng = spawn(PY, ['-m', 'sahkku_ai.server', '--engine', ENGINE,
                         '--port', String(port), '--key', KEY, '--rate', '600'],
                    { cwd: AI, stdio: ['ignore', 'pipe', 'pipe'] });
  let engLog = '';
  eng.stdout.on('data', d => { engLog += d; });
  eng.stderr.on('data', d => { engLog += d; });

  let browser;
  try {
    // vent på at tenaren svarar
    let up = false;
    for (let i = 0; i < 120 && !up; i++) {
      try {
        const r = await fetch(base + '/health');
        up = r.ok;
      } catch (e) { await new Promise(r => setTimeout(r, 250)); }
    }
    ok('tenaren starta', up, engLog.slice(-400));
    if (!up) throw new Error('server did not start');

    await new Promise(r => server.listen(appPort, r));
    browser = await chromium.launch({
      executablePath: path.join(process.env.HOME, '.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'),
      headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    const page = await browser.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.goto(`http://127.0.0.1:${appPort}/index.html`);
    await page.waitForFunction(() => window.__APP && window.ENG && window.REMOTE);

    // ---- kopla til gjennom dialogen ------------------------------------
    await page.click('#btn-remote');
    await page.fill('#remote-url', base);
    await page.fill('#remote-key', KEY);
    await page.click('#btn-remote-connect');
    await page.waitForFunction(() => window.REMOTE.connected, null, { timeout: 30000 });
    const st1 = await page.evaluate(() => ({
      status: document.getElementById('remote-status').textContent,
      engine: window.__APP.engine,
      sel: document.getElementById('cpu-engine').value,
      isRemote: window.ENG.isRemote(window.__APP.engine),
      name: window.REMOTE.name(),
    }));
    ok('dialogen stadfester tilkoplinga', /NAIS\.2/.test(st1.status), st1.status);
    ok('fjernmotoren vart valt som motor', st1.isRemote === true && st1.sel === 'remote', JSON.stringify(st1));
    ok('namnet kjem frå tenaren', st1.name === 'NAIS.2', st1.name);

    // ---- spelet må kunne gå med trekk over nettet ----------------------
    const played = await page.evaluate(async () => {
      // tving Koner til å byrje, so CPU-en (fjernmotoren) tek fyrste turen
      const orig = window.SS.openingRoll;
      window.SS.openingRoll = function (st, rnd) {
        const r = orig.call(window.SS, st, rnd);
        st.turn = 1; st.first = 1; return { first: 1, rolls: r.rolls };
      };
      document.getElementById('btn-cpu').click();
      const t0 = Date.now();
      while (Date.now() - t0 < 90000) {
        await new Promise(r => setTimeout(r, 300));
        const st = window.__APP && window.__APP.st;
        if (st && st.moves > 0) return { moves: st.moves, ms: window.REMOTE.state.ms, err: window.REMOTE.state.err };
      }
      const st = window.__APP && window.__APP.st;
      return { moves: st ? st.moves : -1, ms: window.REMOTE.state.ms, timeout: true };
    });
    ok('fjernmotoren spela eit trekk i spelet', played.moves > 0, JSON.stringify(played));
    ok('trekket kom over nettet (målte ms)', played.ms > 0, JSON.stringify(played));
    ok('ingen ulovleg-trekk-feil', !played.err, played.err);

    // ---- feil nøkkel skal gje eit tydeleg avslag ----------------------
    // attende til menyen — knappen er skjult inne i spelet
    await page.click('#btn-menu');
    await page.waitForFunction(() => !document.getElementById('menu').classList.contains('hidden'));
    await page.evaluate(() => { window.REMOTE.clear(); });
    await page.click('#btn-remote');
    await page.fill('#remote-url', base);
    await page.fill('#remote-key', 'feil-nokkel');
    await page.click('#btn-remote-connect');
    await page.waitForFunction(
      () => /401|avvist|rejected/i.test(document.getElementById('remote-status').textContent),
      null, { timeout: 20000 });
    const bad = await page.evaluate(() => ({
      status: document.getElementById('remote-status').textContent,
      connected: window.REMOTE.connected,
    }));
    ok('feil nøkkel vert avvist med melding', /401|avvist|rejected/i.test(bad.status), bad.status);
    ok('feil nøkkel koplar ikkje til', bad.connected === false, JSON.stringify(bad));

    // ---- gløym skal rydde lagringa -----------------------------------
    const forgot = await page.evaluate(() => {
      document.getElementById('btn-remote-forget').click();
      return { stored: localStorage.getItem('sahkku.remote.v1'), connected: window.REMOTE.connected };
    });
    ok('«Gløym» ryddar lagringa', forgot.stored === null, forgot.stored);
    ok('«Gløym» koplar frå', forgot.connected === false);

    // ---- nøkkelen skal aldri hamne i tenarloggen ---------------------
    ok('nøkkelen står ikkje i tenarloggen', engLog.indexOf(KEY) < 0, engLog.slice(-300));
    ok('ingen JS-feil i appen', errs.length === 0, errs.join(' | '));
  } catch (e) {
    ok('testen køyrde utan kast', false, e.message);
  } finally {
    if (browser) await browser.close();
    server.close();
    eng.kill('SIGTERM');
  }
  console.log('remote_engine: ' + pass + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})();
