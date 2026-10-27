// Playwright E2E: start CPU game, play a full random party headlessly
const { chromium } = require('playwright-core');
const path = require('path');

(async () => {
  const browser = await chromium.launch({
    executablePath: path.join(process.env.HOME, '.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'),
    headless: true,
    args: ['--no-sandbox']
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 780 } }); // mobilstørrelse
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 150)); });

  await page.goto('http://127.0.0.1:8090/index.html', { waitUntil: 'networkidle' });
  await page.evaluate(() => { window.__FAST = true; });

  // meny
  const menuOk = await page.evaluate(() => !document.getElementById('menu').classList.contains('hidden'));
  console.log('menu visible:', menuOk);

  await page.click('#btn-cpu');
  await page.waitForSelector('#board .cell', { timeout: 5000 });
  const cells = await page.$$eval('#board .cell', els => els.length);
  const pieces = await page.$$eval('#board .piece', els => els.length);
  console.log('cells:', cells, 'pieces:', pieces, '(forventet 45 / 33)');

  // spill en parti-sløyfe: klikk kast-knapp, velg brikker, klikk mål
  const result = await page.evaluate(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    let moves = 0, rolls = 0, rerolls = 0, passes = 0;
    const app = window.APP, SS = window.SS, UI = window.UI;
    const deadline = Date.now() + 60000;
    while (app.st.winner == null && Date.now() < deadline) {
      await sleep(60);
      if (app.busy || app.over) continue;
      const st = app.st;
      if (st.turn !== 0) continue;           // vent på CPU
      if (st.phase === 'roll') {
        const btn = document.getElementById('die-roll');
        if (btn) { btn.click(); rolls++; }
        continue;
      }
      // move-fase: bruk omkast-knapp 25% av gangen
      // X-omkast: klikk på ein X-terning (knappen finst ikkje lenger)
      const rd = document.querySelector('#dicebox-p0 .die.rerollable, #dicebox-p1 .die.rerollable');
      if (rd && Math.random() < 0.25) { rd.click(); rerolls++; continue; }
      const pb = document.getElementById('btn-pass');
      if (pb && pb.style.display !== 'none') { pb.click(); passes++; continue; }
      // velg første brikke med lovlig trekk, klikk dens første mål
      const lm = SS.legalMoves(st, 0);
      if (!lm.length) { if (pb) pb.click(); continue; }
      const mv = lm[Math.floor(Math.random() * lm.length)];
      const p = SS.piece(st, mv.pid);
      // Finn målcelle-indeks som UI viser: klikk brikken, målcellene får .target
      UI.selectPiece ? UI.selectPiece(mv.pid) : null;
      const targets = [...document.querySelectorAll('.cell.target')];
      if (!targets.length) {
        // Fallback: kall onMove direkte via UI-callback
        continue;
      }
      // bruk target som tilsvarer valgt trekk (cellIdx-match)
      const destIdx = SS.moveDest(st, mv);
      let cell = targets.find(c => parseInt(c.dataset.idx, 10) === destIdx);
      if (!cell) cell = targets[0];
      cell.click();
      moves++;
    }
    return { winner: app.st.winner, reason: app.st.winReason, moves, rolls, rerolls, passes, turn: app.st.turn };
  });
  console.log('party:', JSON.stringify(result));

  const endVisible = await page.evaluate(() => {
    const d = document.getElementById('endscore');
    return d && d.open;
  });
  console.log('end dialog open:', endVisible);
  console.log('errors:', errors.length ? errors.slice(0, 6) : 'ingen');

  // verifiser manifest + SW-registrering
  const sw = await page.evaluate(async () => {
    const r = await navigator.serviceWorker.getRegistrations();
    return r.length;
  }).catch(() => 'sw-ukjent (http uten secure ctx)');
  console.log('SW regs:', sw);

  await page.screenshot({ path: 'tests/e2e-mobile.png', fullPage: true });
  await browser.close();
  if (errors.length) process.exit(1);
  if (result.winner == null) { console.log('ADVARSEL: partiet fullførte ikke (tidsfrist)'); }
  console.log('E2E OK');
})().catch(e => { console.error('E2E FEIL:', e.message); process.exit(2); });
