// Screenshot + layout audit for SnartSahkku at three viewports.
const { chromium } = require('playwright-core');
const CHROME = '/home/lars/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome';
const URL = 'http://127.0.0.1:8099/';
const OUT = '/home/lars/comfy-gen/sahkku/screens';

const VIEWS = [
  { name: 'portrait', width: 390, height: 844, dpr: 2 },
  { name: 'landscape', width: 844, height: 390, dpr: 2 },
  { name: 'desktop', width: 1280, height: 800, dpr: 1 },
];

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME });
  const report = [];
  for (const v of VIEWS) {
    const ctx = await browser.newContext({
      viewport: { width: v.width, height: v.height },
      deviceScaleFactor: v.dpr,
      hasTouch: v.name !== 'desktop',
      isMobile: v.name !== 'desktop',
    });
    const page = await ctx.newPage();
    const errors = [];
    const missing = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    page.on('response', (r) => { if (r.status() >= 400) missing.push(r.status() + ' ' + r.url()); });

    await page.goto(URL, { waitUntil: 'load' });
    await page.waitForTimeout(400);
    await page.click('#btn-cpu');
    await page.waitForTimeout(700);

    // roll if the dice button is there, so the board shows a real state
    const roll = page.locator('#die-roll');
    if (await roll.count()) { await roll.first().click({ timeout: 2000 }).catch(() => {}); }
    await page.waitForTimeout(500);

    const m = await page.evaluate(() => {
      const de = document.documentElement;
      const board = document.getElementById('board').getBoundingClientRect();
      const game = document.getElementById('game').getBoundingClientRect();
      const cell = getComputedStyle(document.getElementById('board')).getPropertyValue('--cell');
      const piece = document.querySelector('.piece');
      const pr = piece ? piece.getBoundingClientRect() : null;
      return {
        cell: cell.trim(),
        innerH: window.innerHeight,
        innerW: window.innerWidth,
        docScrollH: de.scrollHeight,
        docScrollW: de.scrollWidth,
        scrollsY: de.scrollHeight > window.innerHeight + 1,
        scrollsX: de.scrollWidth > window.innerWidth + 1,
        board: { x: Math.round(board.x), y: Math.round(board.y), w: Math.round(board.width), h: Math.round(board.height), bottom: Math.round(board.bottom) },
        game: { y: Math.round(game.y), h: Math.round(game.height) },
        piece: pr ? { w: Math.round(pr.width), h: Math.round(pr.height) } : null,
      };
    });
    await page.screenshot({ path: `${OUT}/${v.name}.png`, fullPage: false });
    report.push({ view: v.name, ...m, errors, missing });
    await ctx.close();
  }
  await browser.close();
  console.log(JSON.stringify(report, null, 2));
})();
