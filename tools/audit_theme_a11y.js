// Audit: themes, accessibility, and desktop scroll across viewports.
const { chromium } = require('playwright-core');
const fs = require('fs');
const CHROME = '/home/lars/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome';
const URL = 'http://127.0.0.1:8099/';
const OUT = '/home/lars/comfy-gen/sahkku/screens/themes';
fs.mkdirSync(OUT, { recursive: true });

const SIZES = [
  { n: 'desk-1920', w: 1920, h: 1080 },
  { n: 'desk-1440', w: 1440, h: 900 },
  { n: 'desk-1280', w: 1280, h: 720 },
  { n: 'desk-1024', w: 1024, h: 700 },
  { n: 'phone', w: 390, h: 844, mobile: true },
  { n: 'phone-land', w: 844, h: 390, mobile: true },
];

(async () => {
  const b = await chromium.launch({ executablePath: CHROME });
  const out = { scroll: {}, themes: {}, a11y: {} };

  // ---- 1. no page scroll anywhere, with a long move log ----
  for (const s of SIZES) {
    const ctx = await b.newContext({ viewport: { width: s.w, height: s.h }, isMobile: !!s.mobile, hasTouch: !!s.mobile });
    const p = await ctx.newPage();
    await p.goto(URL, { waitUntil: 'load' });
    await p.click('#btn-cpu');
    await p.waitForFunction(() => document.querySelectorAll('#board .cell').length > 40);
    // fill the log with 40 lines, like a long game
    await p.evaluate(() => {
      const log = document.getElementById('log');
      for (let i = 0; i < 40; i++) {
        const d = document.createElement('div');
        d.textContent = 'M (' + i + ') H2 → G2';
        log.appendChild(d);
      }
    });
    await p.waitForTimeout(200);
    out.scroll[s.n] = await p.evaluate(() => {
      const de = document.documentElement;
      const log = document.getElementById('log').getBoundingClientRect();
      return {
        docH: de.scrollHeight, vh: window.innerHeight, docW: de.scrollWidth, vw: window.innerWidth,
        scrollsY: de.scrollHeight > window.innerHeight + 1, scrollsX: de.scrollWidth > window.innerWidth + 1,
        logH: Math.round(log.height), logBottom: Math.round(log.bottom),
      };
    });
    await p.screenshot({ path: `${OUT}/scroll-${s.n}.png` });
    await ctx.close();
  }

  // ---- 2. the four themes at desktop ----
  for (const theme of ['stone', 'birch', 'midnight', 'contrast']) {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
    const p = await ctx.newPage();
    await p.goto(URL, { waitUntil: 'load' });
    await p.evaluate((t) => { localStorage.setItem('sahkku.theme', t); }, theme);
    await p.reload({ waitUntil: 'load' });
    await p.click('#btn-cpu');
    await p.waitForFunction(() => document.querySelectorAll('#board .cell').length > 40);
    await p.waitForTimeout(300);
    await p.screenshot({ path: `${OUT}/theme-${theme}.png` });
    out.themes[theme] = await p.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      return {
        attr: document.documentElement.getAttribute('data-theme'),
        ink: cs.getPropertyValue('--ink').trim(),
        boardImg: cs.getPropertyValue('--board-img').trim().slice(0, 46),
        bg: cs.getPropertyValue('--bg-app').trim().slice(0, 40),
      };
    });
    await ctx.close();
  }

  // ---- 3. a11y: roles, labels, keyboard, settings dialog ----
  {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
    const p = await ctx.newPage();
    await p.goto(URL, { waitUntil: 'load' });
    await p.click('#btn-cpu');
    await p.waitForFunction(() => document.querySelectorAll('#board .cell').length > 40);
    const boardInfo = await p.evaluate(() => {
      const board = document.getElementById('board');
      const cells = [...board.querySelectorAll('.cell')];
      return {
        role: board.getAttribute('role'),
        label: board.getAttribute('aria-label'),
        cells: cells.length,
        cellRole: cells[0].getAttribute('role'),
        tabbable: cells.filter(c => c.getAttribute('tabindex') === '0').length,
        sample: cells.slice(20, 24).map(c => c.getAttribute('aria-label')),
        dice: [...document.querySelectorAll('.die')].map(d => d.getAttribute('aria-label')).slice(0, 4),
        live: document.getElementById('turn-indicator').getAttribute('aria-live'),
        skip: !!document.querySelector('.skip-link'),
        srStatus: !!document.getElementById('sr-status'),
      };
    });
    // keyboard: tab to board, arrow right twice, read the focused cell
    await p.evaluate(() => {
      const c = document.querySelector('#board .cell[tabindex="0"]') || document.querySelector('#board .cell');
      c.focus();
    });
    await p.keyboard.press('ArrowRight');
    await p.keyboard.press('ArrowRight');
    const focused = await p.evaluate(() => {
      const a = document.activeElement;
      return { cls: a.className, idx: a.dataset.idx, label: a.getAttribute('aria-label') };
    });
    // settings dialog
    await p.click('#btn-settings');
    const dlg = await p.evaluate(() => {
      const d = document.getElementById('settings');
      return {
        open: d.open,
        themeOptions: [...document.querySelectorAll('#sel-theme option')].map(o => o.value + ':' + o.textContent),
        themeValue: document.getElementById('sel-theme').value,
        boxes: ['a11y-large', 'a11y-contrast', 'a11y-motion'].map(id => id + '=' + document.getElementById(id).checked),
      };
    });
    await p.screenshot({ path: `${OUT}/settings-dialog.png` });
    // toggle large text + contrast, check the html class
    await p.check('#a11y-large');
    await p.check('#a11y-contrast');
    await p.waitForTimeout(150);
    const afterToggle = await p.evaluate(() => ({
      cls: document.documentElement.className,
      stored: ['sahkku.a11yLarge', 'sahkku.a11yContrast'].map(k => localStorage.getItem(k)),
      bodyFont: getComputedStyle(document.querySelector('.chip')).fontSize,
    }));
    out.a11y = { boardInfo, focused, dlg, afterToggle };
    await ctx.close();
  }

  await b.close();
  console.log(JSON.stringify(out, null, 2));
})();
