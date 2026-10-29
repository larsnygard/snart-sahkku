// Importere SPG frå eit BILETE (EXIF), og frå ei delt fil (Web Share Target).
//
// To ting vert prova:
//   1. EXIF-lesaren: share.js skriv SPG inn i eXIf-chunken på eit PNG — her
//      vert same biletet lese attende og importert som eit parti.
//   2. Delingsruta: service workeren legg den delte fila i cachen før ho
//      sender brukaren til appen. Her legg vi fila i cachen slik arbeidaren
//      gjer, lastar sida på nytt, og krev at partiet hamnar i arkivet.
//
// Køyr:  node tests/exif_import.test.js
const fs = require('fs');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
               '.png': 'image/png', '.css': 'text/css', '.webmanifest': 'application/manifest+json' };
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' :: ' + String(x).slice(0, 300) : '')); } };

// Eit verkeleg parti som let seg spele opp att — eit handskrive fragment utan
// trekk gjev 0 prøver, og då vert det avvist (det er riktig oppførsel).
const SPG = fs.readFileSync(path.join(__dirname, 'fixtures', 'nesseby-rerolls.spg'), 'utf8');

const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});

(async () => {
  await new Promise(r => server.listen(8110, r));
  const browser = await chromium.launch({
    executablePath: path.join(process.env.HOME, '.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'),
    headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto('http://127.0.0.1:8110/index.html');
  await page.waitForFunction(() => window.__APP && window.SHARE && window.EXIF);

  // ---- 1. skriv eit bilete med SPG i EXIF, les det att ------------------
  const round = await page.evaluate(async (spg) => {
    const SS = window.SS;
    const st = SS.newGame({ first: 0, nesseby: true });
    let r = 12345;
    SS.openingRoll(st, () => ((r = (r * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff));
    const img = await window.SHARE.image(st, {
      spg, software: 'SnartSáhkku test', title: 't', subtitle: '', footer: '', stamp: '',
    });
    const back = window.EXIF.read(img.bytes);
    return { bytes: Array.from(img.bytes), exif: back, hasChunk: back !== null };
  }, SPG);
  ok('EXIF-lesaren finn noko i biletet', round.hasChunk === true, JSON.stringify(round.exif && Object.keys(round.exif)));
  ok('ImageDescription er lesen att', (round.exif.description || '') === SPG,
     JSON.stringify((round.exif.description || '').slice(0, 80)));
  ok('Software er lesen att', round.exif.software === 'SnartSáhkku test', round.exif.software);
  ok('SPG-notasjonen vart attkjend i EXIF', (round.exif.spg || '') === SPG, JSON.stringify((round.exif.spg || '').slice(0, 40)));

  // ---- 2. importer biletet gjennom den verkelege importvegen -----------
  const imported = await page.evaluate(async (bytes) => {
    window.ARCH.clear();
    return new Promise((resolve) => {
      window.__APP.importBytes(new Uint8Array(bytes), function (r) {
        const list = window.ARCH.list();
        resolve({ added: r && r.added, n: list.length, trekk: list[0] && list[0].plies,
                  res: list[0] && list[0].result });
      });
    });
  }, round.bytes);
  ok('biletet vart importert som eit parti', imported.n === 1, JSON.stringify(imported));
  ok('partiet har resultatet frå notasjonen', imported.res === '1-0', JSON.stringify(imported));

  // ---- 3. eit bilete utan SPG skal gje ei tydeleg melding ---------------
  const plain = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 8; c.height = 8;
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const before = window.ARCH.list().length;
    return new Promise((resolve) => {
      // fang toasten i staden for å lese DOM-tekst
      const orig = window.UI.toast;
      let said = '';
      window.UI.toast = function (m) { said = m; };
      window.__APP.importBytes(bytes, function () {});
      setTimeout(() => { window.UI.toast = orig; resolve({ said, before, after: window.ARCH.list().length }); }, 400);
    });
  });
  ok('bilete utan EXIF gjev melding, ikkje stille feil', /EXIF|SPG/i.test(plain.said), plain.said);
  ok('bilete utan EXIF legg ikkje til noko', plain.before === plain.after, JSON.stringify(plain));

  // ---- 4. delt fil via service worker-cachen (Web Share Target) --------
  const shared = await page.evaluate(async (spg) => {
    window.ARCH.clear();
    const c = await caches.open('sahkku-share-v1');
    await c.put('/__shared__', new Response(new TextEncoder().encode(spg), {
      headers: { 'Content-Type': 'text/plain', 'X-Filename': 'delt.spg' },
    }));
    return true;
  }, SPG);
  ok('fila vart lagd i delingscachen', shared === true);

  await page.reload();
  await page.waitForFunction(() => window.__APP && window.ARCH, null, { timeout: 20000 });
  await page.waitForFunction(() => window.ARCH.list().length > 0, null, { timeout: 20000 }).catch(() => {});
  const afterReload = await page.evaluate(async () => {
    const list = window.ARCH.list();
    const c = await caches.open('sahkku-share-v1');
    const left = await c.match('/__shared__');
    return { n: list.length, res: list[0] && list[0].result, rest: !!left,
             skjerm: !document.getElementById('archive').classList.contains('hidden') };
  });
  ok('delt fil vart importert ved oppstart', afterReload.n === 1, JSON.stringify(afterReload));
  ok('delingscachen vart rydda', afterReload.rest === false, JSON.stringify(afterReload));
  ok('appen opna arkivet etter deling', afterReload.skjerm === true, JSON.stringify(afterReload));

  ok('ingen JS-feil', errs.length === 0, errs.join(' | '));
  console.log('exif_import: ' + pass + ' pass, ' + fail + ' fail');
  await browser.close();
  server.close();
  process.exit(fail ? 1 : 0);
})();
