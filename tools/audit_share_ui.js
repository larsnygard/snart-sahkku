// Render the share card + audit desktop layout and dialogs.
const { chromium } = require('playwright-core');
const fs = require('fs');
const CHROME = '/home/lars/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome';
const URL = 'http://127.0.0.1:8099/';
const OUT = '/home/lars/comfy-gen/sahkku/screens/audit2';

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch({ executablePath: CHROME });
  const notes = {};

  // ---- share card ----
  {
    const ctx = await b.newContext({ viewport: { width: 1200, height: 900 } });
    const p = await ctx.newPage();
    await p.goto(URL, { waitUntil: 'load' });
    await p.waitForFunction(() => window.__APP && window.SHARE && window.SS);
    const bytes = await p.evaluate(async () => {
      const SS = window.SS;
      const st = SS.newGame({ first: 0, nesseby: true });
      let r = 12345;
      SS.openingRoll(st, () => ((r = (r * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff));
      // flytt nokre brikker inn i midtraden so biletet syner eit spelebilete
      const moves = ['C2', 'M2'];
      const img = await window.SHARE.image(st, {
        spg: '[Event "Demo"]', software: 'SnartSáhkku',
        title: 'Sáhkku — koner (gálgut) vann',
        subtitle: '41 trekk · NAIS.4',
        footer: 'Menn fanga: 15 · Kongen hjå koner',
        stamp: '2026-10-30 15:20 UTC',
      });
      return Array.from(img.bytes);
    });
    fs.writeFileSync(`${OUT}/share-card.png`, Buffer.from(bytes));
    notes.share = { bytes: bytes.length };
    await ctx.close();
  }

  // ---- desktop layouts + dialogs ----
  for (const v of [
    { name: 'game-1920', w: 1920, h: 1080, end: false },
    { name: 'game-1440', w: 1440, h: 900, end: false },
    { name: 'end-1920', w: 1920, h: 1080, end: true },
    { name: 'end-390', w: 390, h: 844, end: true, mobile: true },
  ]) {
    const ctx = await b.newContext({ viewport: { width: v.w, height: v.h }, isMobile: !!v.mobile, hasTouch: !!v.mobile });
    const p = await ctx.newPage();
    await p.goto(URL, { waitUntil: 'load' });
    await p.click('#btn-cpu');
    await p.waitForTimeout(500);
    if (v.end) {
      await p.evaluate(() => {
        document.getElementById('end-title').textContent = 'Partiet er slutt';
        document.getElementById('end-reason').textContent =
          'Koner (gálgut) vann: alle menn (olbmát) er fanga etter 41 trekk.';
        document.getElementById('endscore').showModal();
      });
      await p.waitForTimeout(200);
    }
    await p.screenshot({ path: `${OUT}/${v.name}.png` });
    notes[v.name] = await p.evaluate(() => {
      const b = document.getElementById('board');
      const r = b.getBoundingClientRect();
      const d = document.getElementById('endscore');
      const dr = d.open ? d.getBoundingClientRect() : null;
      const bs = d.open ? [...d.querySelectorAll('button')].map(el => {
        const rr = el.getBoundingClientRect();
        return { t: el.textContent.trim().slice(0, 18), w: Math.round(rr.width), h: Math.round(rr.height) };
      }) : [];
      return {
        cell: getComputedStyle(b).getPropertyValue('--cell').trim(),
        board: { w: Math.round(r.width), h: Math.round(r.height), bottom: Math.round(r.bottom), right: Math.round(r.right) },
        docW: document.documentElement.scrollWidth, docH: document.documentElement.scrollHeight,
        dialog: dr ? { w: Math.round(dr.width), h: Math.round(dr.height) } : null,
        buttons: bs,
      };
    });
    await ctx.close();
  }
  await b.close();
  console.log(JSON.stringify(notes, null, 2));
})();
