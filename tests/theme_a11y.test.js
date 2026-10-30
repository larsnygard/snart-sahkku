// Tema + tilgjenge: tema-veljaren, CSS-variablane og ARIA-treet på brettet.
//
// Køyr:  node tests/theme_a11y.test.js   (startar sin eigen server på 8102)
//
// Testen held fast på tre ting som er lette å øydeleggje utan at noko krasjar:
//   1. alle tema set variablane sine (så eit tema ikkje berre er eit tomt namn),
//   2. valet overlever reload (localStorage → data-theme før fyrste paint),
//   3. brettet er eit grid med ruter som har skjermlesar-tekst, éi tabbar rute,
//      og piltastane flyttar fokus.
const fs = require('fs');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const PORT = 8102;
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
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/index.html`);
  await page.waitForFunction(() => window.SS && window.UI && window.__APP && window.THEME);

  // ---- 1. tema-veljaren finst med alle tema ----
  await page.click('#btn-settings');
  const opts = await page.$$eval('#sel-theme option', os => os.map(o => o.value));
  ok('fire tema i veljaren', opts.length === 4 && opts.join(',') === 'stone,birch,midnight,contrast', opts.join(','));
  ok('standardtema er stone', (await page.$eval('#sel-theme', s => s.value)) === 'stone');

  // ---- 2. kvart tema set variablane sine ----
  const expect = {
    stone: { board: 'board-stone', ink: '#eef2ff' },
    birch: { board: 'board-birch', ink: '#1b2430' },
    midnight: { board: 'board-basalt', ink: '#eaf1ff' },
    contrast: { board: 'none', ink: '#ffffff' },
  };
  for (const [id, want] of Object.entries(expect)) {
    await page.selectOption('#sel-theme', id);
    const got = await page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      return {
        attr: document.documentElement.getAttribute('data-theme'),
        boardImg: cs.getPropertyValue('--board-img').trim(),
        ink: cs.getPropertyValue('--ink').trim(),
        bg: cs.getPropertyValue('--bg-app').trim(),
      };
    });
    ok(`tema ${id} sett`, got.attr === id, got.attr);
    ok(`tema ${id} har bakgrunnsbilete`, got.boardImg.indexOf(want.board) >= 0, got.boardImg);
    ok(`tema ${id} har tekstfarge`, got.ink === want.ink, got.ink);
    ok(`tema ${id} har bakgrunn`, got.bg.length >= 4, got.bg);
  }

  // ---- 3. valet overlever reload (sett før fyrste paint) ----
  await page.selectOption('#sel-theme', 'birch');
  await page.reload();
  await page.waitForFunction(() => window.THEME);
  const afterReload = await page.evaluate(() => ({
    attr: document.documentElement.getAttribute('data-theme'),
    stored: localStorage.getItem('sahkku.theme'),
  }));
  ok('tema overlever reload', afterReload.attr === 'birch' && afterReload.stored === 'birch',
     JSON.stringify(afterReload));

  // ---- 3b. brikkesett: to sett, og det andre byter biletfila ----
  await page.click('#btn-settings');
  await page.waitForSelector('#settings[open]');
  const sets = await page.$$eval('#sel-pieces option', os => os.map(o => o.value));
  ok('to brikkesett i veljaren', sets.join(',') === 'classic,short', sets.join(','));
  // mål biletfila på eit laust .piece-element — verkar òg før brettet finst
  const pieceBg = () => page.evaluate(() => {
    const el = document.createElement('div');
    el.className = 'piece red';
    el.style.cssText = 'position:absolute;left:-9999px;width:20px;height:40px';
    document.body.appendChild(el);
    const v = getComputedStyle(el).backgroundImage;
    el.remove();
    return v;
  });
  const classicBg = await pieceBg();
  await page.selectOption('#sel-pieces', 'short');
  const shortBg = await pieceBg();
  ok('kort sett byter biletet', /piece-birch-short\.svg/.test(shortBg) && !/short/.test(classicBg),
     classicBg.slice(-40) + ' -> ' + shortBg.slice(-40));
  ok('data-pieces vert sett', (await page.evaluate(() => document.documentElement.getAttribute('data-pieces'))) === 'short');
  await page.keyboard.press('Escape');
  await page.reload();
  await page.waitForFunction(() => window.THEME);
  ok('brikkesettet overlever reload',
     (await page.evaluate(() => document.documentElement.getAttribute('data-pieces'))) === 'short');

  // ---- 4. brettet er eit grid med skjermlesar-tekst ----
  await page.click('#btn-cpu');
  await page.waitForFunction(() => document.querySelectorAll('#board .cell').length === 45);
  const board = await page.evaluate(() => {
    const b = document.getElementById('board');
    const cells = [...b.querySelectorAll('.cell')];
    const castle = cells.find(c => c.classList.contains('castle'));
    return {
      role: b.getAttribute('role'),
      label: b.getAttribute('aria-label') || '',
      n: cells.length,
      cellRole: cells[0].getAttribute('role'),
      tabbable: cells.filter(c => c.getAttribute('tabindex') === '0').length,
      labels: cells.map(c => c.getAttribute('aria-label') || ''),
      castleLabel: castle ? castle.getAttribute('aria-label') : '',
      skip: !!document.querySelector('.skip-link'),
      liveRegion: !!document.getElementById('sr-status'),
    };
  });
  ok('brettet har role=grid', board.role === 'grid', board.role);
  ok('brettet har skjermlesar-tekst', board.label.length > 20);
  ok('45 ruter', board.n === 45, board.n);
  ok('rutene har role=gridcell', board.cellRole === 'gridcell', board.cellRole);
  ok('nøyaktig éi tabbar rute', board.tabbable === 1, board.tabbable);
  ok('alle ruter har tekst', board.labels.every(l => l.length > 2));
  ok('slottet er omtala som kongen', /kongen|gonagas|king/i.test(board.castleLabel), board.castleLabel);
  ok('hopp-til-brettet-lenkje finst', board.skip);
  ok('status-region for skjermlesar finst', board.liveRegion);

  // ---- 5. piltastane flyttar fokus, Enter spelar ruta ----
  const startIdx = await page.evaluate(() => {
    const c = document.querySelector('#board .cell[tabindex="0"]');
    c.focus();
    return c.dataset.idx;
  });
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  const moved = await page.evaluate(() => document.activeElement.dataset.idx);
  ok('piltast flyttar fokus', moved !== startIdx, `${startIdx} -> ${moved}`);

  // ---- 6. terningane har oppleselege merkje ----
  const die = await page.evaluate(() => {
    const roll = document.getElementById('die-roll');
    return {
      rollLabel: roll ? roll.getAttribute('aria-label') : null,
      emptyHidden: [...document.querySelectorAll('.die.empty')].every(d => d.getAttribute('aria-hidden') === 'true'),
    };
  });
  ok('kast-knappen har aria-label', /kast|roll|bálkest/i.test(die.rollLabel || ''), die.rollLabel);

  // ---- 7. tilgjenge-vala vert lagra og verkar ----
  await page.click('#btn-settings');
  await page.check('#a11y-large');
  await page.check('#a11y-motion');
  const toggled = await page.evaluate(() => ({
    cls: document.documentElement.className,
    large: localStorage.getItem('sahkku.a11yLarge'),
    motion: localStorage.getItem('sahkku.a11yMotion'),
    chipPx: parseFloat(getComputedStyle(document.querySelector('.chip')).fontSize),
  }));
  ok('stor tekst vert sett', /a11y-large/.test(toggled.cls) && toggled.large === '1', JSON.stringify(toggled));
  ok('mindre rørsle vert sett', /a11y-motion/.test(toggled.cls) && toggled.motion === '1');
  ok('stor tekst aukar skriftstorleiken', toggled.chipPx > 14, toggled.chipPx);

  ok('ingen feil i sidekoden', errs.length === 0, errs.join(' | '));

  await browser.close();
  server.close();
  console.log(`theme_a11y: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FEIL:', e.message); process.exit(1); });
