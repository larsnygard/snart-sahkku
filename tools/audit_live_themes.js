// Live verification: themes, a11y, and no page scroll on desktop.
const { chromium } = require('playwright-core');
const fs = require('fs');
const OUT = '/home/lars/comfy-gen/sahkku/screens/live3';
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const b = await chromium.launch({ executablePath: '/home/lars/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome' });
  const res = {};
  for (const [name, theme, w, h] of [
    ['desk-stone', 'stone', 1920, 1080],
    ['desk-birch', 'birch', 1440, 900],
    ['desk-contrast', 'contrast', 1440, 900],
  ]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h } });
    const p = await ctx.newPage();
    const errs = [], miss = [];
    p.on('pageerror', e => errs.push(String(e)));
    p.on('response', r => { if (r.status() >= 400) miss.push(r.status() + ' ' + r.url()); });
    await p.goto('https://snart.com/sahkku/?v=1270', { waitUntil: 'load' });
    await p.evaluate(t => localStorage.setItem('sahkku.theme', t), theme);
    await p.reload({ waitUntil: 'load' });
    await p.waitForSelector('#btn-cpu');
    await p.click('#btn-cpu');
    await p.waitForFunction(() => document.querySelectorAll('#board .cell').length > 40, null, { timeout: 30000 });
    await p.evaluate(() => {
      const log = document.getElementById('log');
      for (let i = 0; i < 60; i++) { const d = document.createElement('div'); d.textContent = 'M (' + i + ') H2 → G2'; log.appendChild(d); }
    });
    await p.waitForTimeout(300);
    await p.screenshot({ path: `${OUT}/${name}.png` });
    res[name] = await p.evaluate(() => ({
      theme: document.documentElement.getAttribute('data-theme'),
      docH: document.documentElement.scrollHeight, vh: window.innerHeight,
      scrollsY: document.documentElement.scrollHeight > window.innerHeight + 1,
      grid: document.getElementById('board').getAttribute('role'),
      cells: document.querySelectorAll('#board .cell').length,
      label: document.querySelector('#board .cell.castle').getAttribute('aria-label'),
    }));
    res[name].errors = errs; res[name].missing = miss;
    await ctx.close();
  }
  await b.close();
  console.log(JSON.stringify(res, null, 2));
})();
