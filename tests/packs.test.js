// Pakkesystemet: validering, id-samanslett, import heilt veg gjennom
// innstillingane i ein ekte nettlesar, og at ein importert pakke faktisk
// teiknar brikkene sine.
//
// Køyr:  node tests/packs.test.js   (startar sin eigen server på 8103)
const fs = require('fs');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const PORT = 8103;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
               '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
               '.css': 'text/css', '.webmanifest': 'application/manifest+json',
               '.pakke': 'application/json' };
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

const goodSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 110"><path d="M30 34 L44 100 L16 100 Z" fill="#e8b64c"/></svg>';
const packSvg = (id) => JSON.stringify({
  format: 'snartsahkku-pakke', kind: 'pieces', id,
  names: { nb: 'Testsett ' + id, en: 'Test set ' + id },
  svg: { 'men-p0': goodSvg, 'men-p1': goodSvg, 'queen-p0': goodSvg, 'queen-p1': goodSvg, king: goodSvg },
});

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const browser = await chromium.launch({
    executablePath: path.join(process.env.HOME, '.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'),
    headless: true, args: ['--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/index.html`);
  await page.waitForFunction(() => window.PACKS && window.THEME && window.__APP);

  // ---------- 1. rein validering (PACKS.importPack i sida) ----------
  const validate = (text) => page.evaluate((t) => {
    try { return { id: window.PACKS.importPack(t).id }; }
    catch (e) { return { err: e.message }; }
  }, text);

  const good = await validate(packSvg('testsett'));
  ok('gyldig pakke vert importert', good.id === 'testsett', JSON.stringify(good));

  const evil = await validate(JSON.stringify({
    format: 'snartsahkku-pakke', kind: 'pieces', id: 'onda',
    svg: { 'men-p0': '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
           'men-p1': goodSvg, 'queen-p0': goodSvg, 'queen-p1': goodSvg, king: goodSvg },
  }));
  ok('SVG med script vert avvist', /unsafe|avvist|script/i.test(evil.err || 'AVVIST'), JSON.stringify(evil));

  const partial = await validate(JSON.stringify({
    format: 'snartsahkku-pakke', kind: 'pieces', id: 'halv',
    svg: { 'men-p0': goodSvg, 'men-p1': goodSvg, 'queen-p0': goodSvg },
  }));
  ok('pakke utan alle fem filer vert avvist', !!partial.err, JSON.stringify(partial));

  const notPack = await validate(JSON.stringify({ games: [] }));
  ok('SPG-bunt er ikkje ein pakke', !!notPack.err, JSON.stringify(notPack));

  const clash = await validate(packSvg('classic'));
  ok('innebygd id låst: classic → classic-2', clash.id === 'classic-2', JSON.stringify(clash));

  // ---------- 2. den importerte pakken teiknar ----------
  const bg = await page.evaluate(() => {
    window.THEME.setPieces('testsett');
    const el = document.createElement('div');
    el.className = 'piece red';
    el.style.cssText = 'position:absolute;left:-9999px;width:20px;height:40px';
    document.body.appendChild(el);
    const v = getComputedStyle(el).backgroundImage;
    el.remove();
    return { v, attr: document.documentElement.getAttribute('data-pieces') };
  });
  ok('importert sett teiknar data-URL', /data:image\/svg/.test(bg.v), bg.v.slice(0, 60));
  ok('data-pieces er sett', bg.attr === 'testsett', bg.attr);

  const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('sahkku.packs') || '{}'));
  ok('pakken ligg i localStorage', !!(persisted.pieces && persisted.pieces.testsett),
     JSON.stringify(Object.keys(persisted.pieces || {})));

  // reload: importert sett skal vere att i veljaren og i bruk
  await page.reload();
  await page.waitForFunction(() => window.PACKS && window.THEME);
  const after = await page.evaluate(() => ({
    attr: document.documentElement.getAttribute('data-pieces'),
    opts: [...document.querySelectorAll('#sel-pieces option')].map(o => o.value),
  }));
  ok('importert sett overlever reload', after.attr === 'testsett' && after.opts.includes('testsett'),
     JSON.stringify(after));

  // ---------- 3. import via filveljaren i innstillingane ----------
  await page.click('#btn-settings');
  await page.waitForSelector('#settings[open]');
  const tmp = path.join(process.env.BH_AGENT_WORKSPACE || '/tmp', 'fragmette.sahkku-pakke');
  fs.writeFileSync(tmp, packSvg('fragmette'));
  await page.setInputFiles('#pack-file', tmp);
  await page.waitForFunction(() =>
    [...document.querySelectorAll('#sel-pieces option')].some(o => o.value === 'fragmette'), { timeout: 5000 });
  const frag = await page.evaluate(() => ({
    attr: document.documentElement.getAttribute('data-pieces'),
    rows: document.querySelectorAll('#pack-list .arch-row').length,
  }));
  ok('filimport verkar gjennom Innstillingar', frag.attr === 'fragmette', JSON.stringify(frag));
  ok('importerte pakkar lista med Bruk/Fjern', frag.rows >= 2, frag.rows);

  // ---------- 4. fjerning ----------
  const delN = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#pack-list .arch-row')];
    const row = rows.find(r2 => /fragmette/i.test(r2.textContent));
    return !!row && row.querySelectorAll('button').length === 2;
  });
  ok('kvar pakke har Bruk + Fjern', delN);
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#pack-list .arch-row')];
    const row = rows.find(r => /fragmette/i.test(r.textContent));
    [...row.querySelectorAll('button')].pop().click();   // Fjern
  });
  await page.waitForFunction(() =>
    ![...document.querySelectorAll('#sel-pieces option')].some(o => o.value === 'fragmette'));
  const gone = await page.evaluate(() => ({
    attr: document.documentElement.getAttribute('data-pieces'),
    stored: (JSON.parse(localStorage.getItem('sahkku.packs') || '{}').pieces || {}).fragmette,
  }));
  ok('fjerna pakke forsvinn frå veljar og lagring',
     gone.attr !== 'fragmette' && !gone.stored, JSON.stringify(gone));

  // ---------- 5. innebygde manifest finst og blir lasta ----------
  const manifests = await page.evaluate(async () => {
    const out = {};
    for (const id of ['classic', 'short']) {
      const r = await fetch('pieces/' + id + '/manifest.json');
      out[id] = r.ok ? (await r.json()).format : r.status;
    }
    return out;
  });
  ok('innebygde manifest er pakker', manifests.classic === 'snartsahkku-pakke' && manifests.short === 'snartsahkku-pakke',
     JSON.stringify(manifests));

  ok('ingen feil i sidekoden', errs.length === 0, errs.join(' | '));

  await browser.close();
  server.close();
  console.log(`packs: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FEIL:', e.message); process.exit(1); });
