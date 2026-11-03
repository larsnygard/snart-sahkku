// Stillingsvurdering (📊-knappen): motoren svarar med eit tal for stillinga
// som står, og UI-et frys ikkje medan ho reknar (arbeidet ligg i ein Worker).
//
// Testar gjennom den verkelege app-koden:
//  1. knappen finst og har omsett tekst (ikkje nøkkelen «game.eval»)
//  2. trykk -> linja over loggen viser «📊 <motor>: ±0.00 (<side>, d1)»
//  3. trykk att -> linja vert skjult (toggle)
//  4. ingen pageerror
const { chromium } = require('playwright-core');
const path = require('path');
const http = require('http');
const fs = require('fs');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) pass++;
  else { fail++; console.log('  FAIL ' + name + (extra ? ' :: ' + extra : '')); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

const ROOT = path.join(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
               '.png': 'image/png', '.css': 'text/css', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});

(async () => {
  await new Promise(r => server.listen(8183, r));
  const browser = await chromium.launch({
    executablePath: path.join(process.env.HOME, '.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'),
    headless: true, args: ['--no-sandbox']
  });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto('http://127.0.0.1:8183/index.html');
  await page.waitForFunction(() => window.SS && window.__rollPhase);

  // 1. knappen
  const label = await page.evaluate(() => {
    const b = document.getElementById('btn-eval');
    return b ? b.textContent.trim() : null;
  });
  ok('knappen finst', label !== null);
  ok('knappen har omsett tekst', !!label && label.indexOf('game.eval') !== 0 && label.length > 2, label);

  // 2. to-spelar-parti, so ingenting går av seg sjølv, og so vurder
  await page.click('#btn-local');
  await sleep(1200);
  await page.click('#btn-eval');
  const shown = await page.waitForFunction(() => {
    const b = document.getElementById('eval-bar');
    return b && !b.classList.contains('hidden') && /📊/.test(b.textContent) && !/⏳/.test(b.textContent)
      ? b.textContent : false;
  }, null, { timeout: 180000 }).then(h => h.jsonValue()).catch(() => null);
  ok('vurderinga vert vist', !!shown, shown);
  ok('formatet er «motor: tal (side, d1)»',
     !!shown && /^📊 .+: [+-]?\d\.\d\d \((Menn|Koner), d1\)$/.test(shown), shown);

  const logHas = await page.evaluate(() => /Vurdering/.test(document.getElementById('log').textContent));
  ok('vurderinga hamnar òg i loggen', logHas);

  // 3. toggle av
  await page.click('#btn-eval');
  const hidden = await page.evaluate(() => document.getElementById('eval-bar').classList.contains('hidden'));
  ok('andre trykk skjuler linja', hidden);

  ok('ingen pageerror', errs.length === 0, errs.join(' | '));

  await browser.close();
  server.close();
  console.log(`eval_button: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
