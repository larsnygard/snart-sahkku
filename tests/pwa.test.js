// PWA: manifestet må vere gyldig JSON, og appen må ikkje laste seg sjølv
// på nytt utan grunn (det var det som gav «opnar i ny fane» ved oppfrisking).
//
// Køyr:  node tests/pwa.test.js
const fs = require('fs');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
               '.png': 'image/png', '.css': 'text/css',
               '.webmanifest': 'application/manifest+json' };
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) pass++; else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' :: ' + extra : '')); }
};

// ---- 1. manifestet -----------------------------------------------------
const manPath = path.join(ROOT, 'manifest.webmanifest');
const raw = fs.readFileSync(manPath, 'utf8');
let man = null;
try { man = JSON.parse(raw); } catch (e) { /* fallet under */ }
ok('manifest.webmanifest er gyldig JSON', !!man, String(raw.slice(0, 40)).replace(/\n/g, ' '));
if (man) {
  ok('har name/short_name', !!man.name && !!man.short_name);
  ok('start_url og scope', man.start_url === './' && man.scope === './', JSON.stringify([man.start_url, man.scope]));
  ok('display=standalone (held seg i same vindauge)', man.display === 'standalone', man.display);
  ok('tema-/bakgrunnsfarge', !!man.theme_color && !!man.background_color);
  const icons = man.icons || [];
  ok('ikon 192 og 512', icons.some(i => /192/.test(i.sizes)) && icons.some(i => /512/.test(i.sizes)));
  ok('maskable ikon', icons.some(i => /maskable/.test(i.purpose || '')));
  icons.forEach(i => ok('ikonet finst: ' + i.src, fs.existsSync(path.join(ROOT, i.src))));
}
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
ok('index.html lenkjer manifestet', /rel="manifest"/.test(html) && /manifest\.webmanifest/.test(html));

// ---- 2. appen må ikkje laste seg sjølv på nytt ------------------------
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});

(async () => {
  await new Promise(r => server.listen(8098, r));
  const browser = await chromium.launch({
    executablePath: path.join(process.env.HOME, '.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'),
    headless: true, args: ['--no-sandbox'],
  });
  const page = await browser.newPage();
  let navs = 0;
  page.on('framenavigated', f => { if (f === page.mainFrame()) navs++; });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto('http://127.0.0.1:8098/index.html');
  await page.waitForFunction(() => window.APP !== undefined || window.__APP);
  const navsAfterLoad = navs;
  await page.waitForTimeout(3500);            // lat SW registrere seg og ev. oppdatere

  const state = await page.evaluate(() => ({
    harKrok: typeof window.__APP._checkUpdate === 'function',
    updateReady: !!window.__APP._updateReady,
    mann: !!window.APP,
  }));
  ok('oppdateringskroken finst', state.harKrok === true, JSON.stringify(state));
  ok('inga oppdatering ventar ved fyrste lasting', state.updateReady === false, JSON.stringify(state));
  ok('sida lasta ikkje seg sjølv på nytt', navs === navsAfterLoad, `${navsAfterLoad} -> ${navs}`);
  ok('ingen JS-feil', errs.length === 0, errs.join(' | '));

  // manifestet må òg gå gjennom nettlesaren sin eigen JSON-lesar
  const manOk = await page.evaluate(async () => {
    const r = await fetch('manifest.webmanifest', { cache: 'reload' });
    const j = await r.json();
    return !!j.name && j.display === 'standalone';
  });
  ok('nettlesaren les manifestet', manOk === true);

  console.log('pwa: ' + pass + ' pass, ' + fail + ' fail');
  await browser.close();
  server.close();
  process.exit(fail ? 1 : 0);
})();
