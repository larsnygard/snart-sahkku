// Audit: desktop game + menu + end-of-game dialog, and the share canvas.
const { chromium } = require('playwright-core');
const CHROME = '/home/lars/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome';
const URL = 'http://127.0.0.1:8099/';
const OUT = '/home/lars/comfy-gen/sahkku/screens/audit';
const fs = require('fs');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const b = await chromium.launch({ executablePath: CHROME });
  const out = {};

  for (const v of [
    { name: 'menu-1920', w: 1920, h: 1080, mobile: false, game: false },
    { name: 'game-1920', w: 1920, h: 1080, mobile: false, game: true },
    { name: 'game-1440', w: 1440, h: 900, mobile: false, game: true },
    { name: 'end-1920', w: 1920, h: 1080, mobile: false, game: true, end: true },
    { name: 'end-390', w: 390, h: 844, mobile: true, game: true, end: true },
  ]) {
    const ctx = await b.newContext({
      viewport: { width: v.w, height: v.h }, deviceScaleFactor: 1,
      isMobile: v.mobile, hasTouch: v.mobile,
    });
    const p = await ctx.newPage();
    await p.goto(URL, { waitUntil: 'load' });
    await p.waitForTimeout(300);
    if (v.game) {
      await p.click('#btn-cpu');
      await p.waitForTimeout(500);
    }
    if (v.end) {
      await p.evaluate(() => {
        const d = document.getElementById('endscore');
        document.getElementById('end-title').textContent = 'Partiet er slutt';
        document.getElementById('end-reason').textContent =
          'Koner (gálgut) vann: alle menn (olbmát) er fanga etter 41 trekk.';
        d.showModal();
      });
      await p.waitForTimeout(250);
    }
    await p.screenshot({ path: `${OUT}/${v.name}.png` });
    out[v.name] = await p.evaluate(() => {
      const b = document.getElementById('board');
      const r = b ? b.getBoundingClientRect() : null;
      const dlg = document.getElementById('endscore');
      const dr = dlg && dlg.open ? dlg.getBoundingClientRect() : null;
      const buttons = dlg ? [...dlg.querySelectorAll('button')].map(el => {
        const cs = getComputedStyle(el); const rr = el.getBoundingClientRect();
        return { t: el.textContent.trim().slice(0, 26), w: Math.round(rr.width), h: Math.round(rr.height),
                 fs: cs.fontSize, pads: cs.padding, bs: cs.boxSizing };
      }) : [];
      return {
        cell: b ? getComputedStyle(b).getPropertyValue('--cell').trim() : null,
        board: r ? { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x) } : null,
        dlg: dr ? { w: Math.round(dr.width), h: Math.round(dr.height), x: Math.round(dr.x), y: Math.round(dr.y) } : null,
        buttons,
        docW: document.documentElement.scrollWidth,
        docH: document.documentElement.scrollHeight,
      };
    });
    await ctx.close();
  }
  await b.close();
  console.log(JSON.stringify(out, null, 2));
})();
