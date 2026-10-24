// Fullt parti MOT CPU-en i ekte nettlesar: boten spelar den vaksne sida
// (kast, omkast, trekk via brikke- og feltklikk, pass). Måler kast per side
// og langaste kast-strekk — CPU-sløyfe-utarming (buggen) skal gi STOR ubalanse.
const path = require('path');
const { chromium } = require('playwright-core');

(async () => {
  const browser = await chromium.launch({
    executablePath: path.join(process.env.HOME, '.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'),
    headless: true, args: ['--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:8090/index.html?cb=' + Date.now(), { waitUntil: 'networkidle' });
  await page.evaluate(() => { globalThis.__FAST = true; });
  await page.click('#btn-cpu');

  const t0 = Date.now();
  let lastLog = 0, cpuStreak = 0, maxCpuStreak = 0, humanRolls = 0, cpuRolls = 0, myMoves = 0;
  let lastProgress = Date.now(), prevMoves = 0, starved = false;

  const countRolls = async () => {
    const lines = await page.evaluate(() => Array.from(document.getElementById('log').children).map(e => e.textContent.trim()));
    const fresh = lines.slice(lastLog); lastLog = lines.length;
    for (const l of fresh) {
      if (/^Du kastet/i.test(l)) { humanRolls++; cpuStreak = 0; }
      else if (/^Koner: kast/i.test(l)) { cpuRolls++; cpuStreak++; maxCpuStreak = Math.max(maxCpuStreak, cpuStreak); }
    }
  };

  while (Date.now() - t0 < 150000) {
    await countRolls();
    const st = await page.evaluate(() => {
      const app = window.__APP;
      if (!app.st) return null;
      const vis = id => { const e = document.getElementById(id); return e && e.offsetParent !== null; };
      return {
        turn: app.st.turn, phase: app.st.phase, moves: app.st.moves,
        winner: app.st.winner, busy: app.busy,
        canRoll: vis('die-roll'), canReroll: vis('btn-reroll'), canPass: vis('btn-pass'),
      };
    });
    if (!st || st.winner !== null || st.phase === 'over') break;
    if (st.moves !== prevMoves) { prevMoves = st.moves; lastProgress = Date.now(); }

    if (st.turn === 0 && !st.busy) {
      if (st.canReroll) { await page.click('#btn-reroll'); lastProgress = Date.now(); continue; }
      if (st.canRoll) { await page.click('#die-roll'); lastProgress = Date.now(); continue; }
      if (st.phase === 'move') {
        const dest = await page.evaluate(() => {
          const lm = SS.legalMoves(window.__APP.st, 0);
          if (!lm.length) return -1;
          const chosen = lm.find(m => m.kind === 'rel') || lm[0];
          const p = SS.piece(window.__APP.st, chosen.pid);
          let d;
          if (p.t === 's') d = SS.soldierAt(p.o, p.at + chosen.v);
          else d = SS.pathFor(window.__APP.st, p, chosen.dir, chosen.v).path.slice(-1)[0];
          UI.selectPiece(chosen.pid);
          return d;
        });
        if (dest >= 0) {
          const ok = await page.evaluate((d) => {
            const cell = document.querySelector('.cell[data-idx="' + d + '"].target');
            if (cell) { cell.click(); return true; }
            return false;
          }, dest);
          if (ok) { myMoves++; lastProgress = Date.now(); continue; }
        }
        if (st.canPass) { await page.click('#btn-pass'); lastProgress = Date.now(); continue; }
      }
    }
    if (Date.now() - lastProgress > 20000) { starved = true; break; }
    await page.waitForTimeout(150);
  }
  await countRolls();
  const final = await page.evaluate(() => ({ turn: window.__APP.st.turn, phase: window.__APP.st.phase, moves: window.__APP.st.moves, winner: window.__APP.st.winner }));
  const log = await page.evaluate(() => Array.from(document.getElementById('log').children).map(e => e.textContent.trim()));
  console.log('PARTI=' + JSON.stringify({
    vaksne_kast: humanRolls, cpu_kast: cpuRolls, vaksne_trekk: myMoves,
    langaste_cpu_strekk: maxCpuStreak, utarming: starved,
    slutt: final, tid_ms: Date.now() - t0,
    siste_log: log.slice(-6), feil: errors.length ? errors.slice(0, 3) : 'ingen',
  }));
  await browser.close();
})().catch(e => { console.error('FEIL:', e.message); process.exit(2); });
