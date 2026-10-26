// Online-parti: to sider, ekte DOM-klikk, trekk reiser over iroh-gossip
const { chromium } = require('playwright-core');
const path = require('path');

(async () => {
  const browser = await chromium.launch({
    executablePath: path.join(process.env.HOME, '.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'),
    headless: true, args: ['--no-sandbox']
  });
  async function makePage(tag) {
    const page = await browser.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(tag + ' pageerror: ' + e.message.slice(0, 160)));
    await page.goto('http://127.0.0.1:8090/index.html', { waitUntil: 'domcontentloaded' });
    return { page, errs };
  }
  const A = await makePage('A'), B = await makePage('B');

  await A.page.click('#btn-online');
  await A.page.waitForFunction(() => window.NET && NET.myId, null, { timeout: 30000 });
  await A.page.fill('#room-seed', 'partytest');
  await A.page.click('#btn-join');
  await A.page.waitForFunction(() => NET.ready, null, { timeout: 30000 });
  const invite = await A.page.$eval('#invite-code', el => el.textContent);
  console.log('invite:', invite.slice(0, 24) + '…');

  await B.page.click('#btn-online');
  await B.page.waitForFunction(() => window.NET && NET.myId, null, { timeout: 30000 });
  await B.page.fill('#room-seed', invite);
  await B.page.click('#btn-join');

  // begge skal havne i spillet (start sendes av vert når peer vises)
  for (const [tag, P] of [['A', A], ['B', B]]) {
    await P.page.waitForFunction(() => !document.getElementById('game').classList.contains('hidden') && APP.st, null, { timeout: 60000 });
    console.log(tag, 'i spillet: me=' + (await P.page.evaluate(() => APP.me)));
  }

  // sløyfe: begge sidene spiller sine trekk via DOM (kast-knapp + brikke + mål)
  async function loop(P, tag) {
    return await P.page.evaluate(async (tag) => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const app = window.APP, SS = window.SS, UI = window.UI;
      let moves = 0, last = -1, idle = 0;
      const deadline = Date.now() + 75000;
      while (Date.now() < deadline) {
        await sleep(900);
        if (!app.st || app.over || app.busy) continue;
        const st = app.st;
        if (st.winner != null) break;
        if (st.turn !== app.me) { idle = 0; continue; }   // venter på motspiller (normalt)
        idle = 0;
        if (st.phase === 'roll') {
          const btn = document.getElementById('die-roll');
          if (btn) btn.click();
          continue;
        }
        const pb = document.getElementById('btn-pass');
        if (pb && pb.style.display !== 'none') { pb.click(); continue; }
        const lm = SS.legalMoves(st, st.turn);
        if (!lm.length) { if (pb) pb.click(); continue; }
        const mv = lm[Math.floor(Math.random() * lm.length)];
        UI.selectPiece(mv.pid);
        const targets = [...document.querySelectorAll('.cell.target')];
        if (!targets.length) continue;
        const p = SS.piece(st, mv.pid);
        let destIdx;
        if (p.t === 's') destIdx = SS.soldierAt(p.o, p.at + mv.v);
        else { destIdx = SS.moveDest(st, mv); }
        let cell = targets.find(c => parseInt(c.dataset.idx, 10) === destIdx) || targets[0];
        cell.click();
        moves++;
      }
      return { tag, moves, total: app.st ? app.st.moves : -1, winner: app.st && app.st.winner, turn: app.st && app.st.turn };
    }, tag);
  }
  const [rA, rB] = await Promise.all([loop(A, 'A'), loop(B, 'B')]);
  console.log('A:', JSON.stringify(rA));
  console.log('B:', JSON.stringify(rB));
  const fA = await A.page.evaluate(() => ({ moves: APP.st.moves, turn: APP.st.turn, host: APP.host }));
  const fB = await B.page.evaluate(() => ({ moves: APP.st.moves, turn: APP.st.turn, host: APP.host }));
  console.log('slutt A:', JSON.stringify(fA), 'B:', JSON.stringify(fB));
  const synced = Math.abs(fA.moves - fB.moves) <= 1 && fA.moves > 4;
  console.log('errors:', A.errs.concat(B.errs).slice(0, 6));
  const pass = synced && A.errs.length === 0 && B.errs.length === 0;
  console.log(pass ? 'ONLINE SPILL OK' : 'ONLINE SPILL FEIL');
  await browser.close();
  process.exit(pass ? 0 : 1);
})().catch(e => { console.error('FEIL:', e.message); process.exit(2); });
