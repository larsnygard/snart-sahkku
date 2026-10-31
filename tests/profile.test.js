// Spelarprofil: namn, kallenamn, bilete — og at profilen faktisk vert brukt
// i notasjonen (SPG) og i spelet.
//
// Køyr:  node tests/profile.test.js   (startar sin eigen server på 8103)
const fs = require('fs');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const PORT = 8103;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
               '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
               '.css': 'text/css', '.webmanifest': 'application/manifest+json' };
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
  await new Promise(r => server.listen(PORT, r));
  const browser = await chromium.launch({
    executablePath: path.join(process.env.HOME, '.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'),
    headless: true, args: ['--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('response', r => { if (r.status() >= 400) errs.push(r.status() + ' ' + r.url()); });
  await page.goto(`http://127.0.0.1:${PORT}/index.html?v=1`);
  await page.waitForFunction(() => window.PROFILE && window.__APP);

  // ---- 1. profile module: standardverdiar ----
  const initial = await page.evaluate(() => window.PROFILE.get());
  ok('profil finst med standardverdiar', initial && typeof initial.avatar === 'string' && initial.avatar.length > 0,
     JSON.stringify(initial));
  // ---- galleriet: 16 per brukar per dag, deterministisk ----
  const g1 = await page.evaluate(() => window.PROFILE.gallery());
  ok('16 bilete i galleriet', g1.length === 16, g1.length);
  const g2 = await page.evaluate(() => window.PROFILE.gallery());
  ok('same sett ved nytt kall (same brukar/dag)', JSON.stringify(g1) === JSON.stringify(g2));
  const uid0 = await page.evaluate(() => window.PROFILE.uid());
  const g3 = await page.evaluate(async () => {
    localStorage.setItem('sahkku.uid', 'annan-brukar-0123456789abcdef');
    return window.PROFILE.gallery();
  });
  ok('annan brukar får anna sett', JSON.stringify(g1) !== JSON.stringify(g3));
  await page.evaluate(u => localStorage.setItem('sahkku.uid', u), uid0);
  const g4 = await page.evaluate(() => window.PROFILE.gallery());
  ok('tilbake til eige sett etter uid-bytе', JSON.stringify(g1) === JSON.stringify(g4));
  // ny dag -> nytt sett (lat som det er i morgon)
  const gTomorrow = await page.evaluate(async () => {
    const RealDate = window.Date;
    const fake = RealDate.now() + 24 * 3600 * 1000;
    window.Date = class extends RealDate {
      constructor(...a) { super(...(a.length ? a : [fake])); }
      static now() { return fake; }
    };
    const g = await window.PROFILE.gallery();
    window.Date = RealDate;
    return g;
  });
  ok('ny dag gir nytt sett', JSON.stringify(g1) !== JSON.stringify(gTomorrow));

  // ---- 2. profilskjermen kan opnast og fyllast ut ----
  await page.click('#btn-profile-menu');
  await page.waitForSelector('#profile:not(.hidden)');
  ok('profilskjermen opnar', true);
  await page.waitForFunction(() => document.querySelectorAll('#avatar-grid .avatar-opt').length === 16,
                             null, { timeout: 8000 });
  const tiles = await page.$$('#avatar-grid .avatar-opt');
  ok('galleriet er rendra', tiles.length === 16, tiles.length);
  const imgsOk = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll('#avatar-grid img')];
    return imgs.length === 16 && imgs.every(i => i.naturalWidth > 0);
  });
  ok('alle bileta lastar', imgsOk);

  await page.fill('#prof-nick', 'Nox');
  await page.fill('#prof-real', 'Lars Christian Nygård');
  await page.click('#avatar-grid .avatar-opt:nth-child(3)');
  await page.click('#btn-profile-save');

  const saved = await page.evaluate(() => ({
    stored: JSON.parse(localStorage.getItem('sahkku.profile') || '{}'),
    badge: document.getElementById('prof-name-badge').textContent,
    topbarImg: (document.querySelector('#btn-profile img') || {}).src || '',
  }));
  ok('kallenamn lagra', saved.stored.nick === 'Nox', JSON.stringify(saved.stored));
  ok('namn lagra', saved.stored.realName === 'Lars Christian Nygård', saved.stored.realName);
  ok('bilete lagra', saved.stored.avatar && saved.stored.avatar.length > 0, saved.stored.avatar);
  ok('vist som kallenamn', saved.badge === 'Nox', saved.badge);
  ok('topplinja viser biletet', /img\/avatars\//.test(saved.topbarImg), saved.topbarImg);

  // ---- 3. profilen overlever reload ----
  await page.reload();
  await page.waitForFunction(() => window.PROFILE && window.__APP);
  const afterReload = await page.evaluate(() => window.PROFILE.get());
  ok('profilen overlever reload', afterReload.nick === 'Nox', JSON.stringify(afterReload));

  // ---- 4. SPG-hovudet brukar profilen ----
  const spg = await page.evaluate(() => {
    window.__APP.mode = 'local';
    const meta = window.__APP.spgMeta();
    const text = window.SPG.toSPG(window.SS.newGame({ first: 0 }), meta);
    return { menn: meta.menn, text: text.split('\n').slice(0, 8).join('\n') };
  });
  ok('SPG-hovudet har profilnamnet', /\[Menn "Nygård, Lars Christian"\]/.test(spg.text), spg.menn);
  ok('SPG har framleis Koner-linje', /\[Koner "/.test(spg.text));

  // ---- 5. terningen som ikkje er kasta har spørjeteikn, ikkje emoji ----
  await page.click('#btn-cpu');
  await page.waitForFunction(() => document.querySelectorAll('#board .cell').length === 45);
  const die = await page.evaluate(() => {
    const b = document.getElementById('die-roll');
    if (!b) return null;
    const cs = getComputedStyle(b);
    return { text: b.textContent.trim(), bg: cs.backgroundImage.slice(0, 80), label: b.getAttribute('aria-label') };
  });
  ok('kast-knappen finst i kastefasen', !!die, JSON.stringify(die));
  if (die) {
    ok('ingen terning-emoji att', die.text === '', JSON.stringify(die.text));
    ok('spørjeteikn-terning som bakgrunn', /dice-question/.test(die.bg), die.bg);
    ok('kast-knappen har aria-label', !!die.label);
  }

  // ---- 6. namnet er med i spelet (etikettane på brettet) ----
  const labels = await page.evaluate(() => {
    window.__APP.names[0] = window.PROFILE.name();
    window.__APP.refresh();
    return [document.getElementById('label-p0').textContent,
            document.getElementById('label-p1').textContent];
  });
  ok('namnet står på brettet', /Nox/.test(labels.join(' | ')), labels.join(' | '));

  ok('ingen feil i sidekoden', errs.length === 0, errs.join(' | '));
  await browser.close();
  server.close();
  console.log(`profile: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FEIL:', e.message); process.exit(1); });
