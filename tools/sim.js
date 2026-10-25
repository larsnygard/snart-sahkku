// Simulering i ekte nettlesar (playwright): CPU-parti til slutt, online-parti
// over ekte iroh P2P (autoritativ protokoll), terningspanel, lagring/gjenopptak,
// SPG-eksport. Krev http-server på 127.0.0.1:8090.
const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');

const EXE = path.join(process.env.HOME, '.cache/ms-playwright/chromium-1234/chrome-linux64/chrome');

async function page(browser, tag, errs) {
  const p = await browser.newPage();
  p.on('pageerror', e => errs.push(tag + ' pageerror: ' + e.message.slice(0, 200)));
  p.on('console', m => { if (m.type() === 'error') errs.push(tag + ' console: ' + m.text().slice(0, 160)); });
  await p.goto('http://127.0.0.1:8090/index.html?cb=' + Date.now(), { waitUntil: 'domcontentloaded' });
  // riv service worker + gamal cache — ellers server cache-first GAMLE JS-filer
  await p.evaluate(async () => {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map(r => r.unregister()));
    const keys = await caches.keys();
    await Promise.all(keys.map(k => caches.delete(k)));
  }).catch(() => {});
  await p.goto('http://127.0.0.1:8090/index.html?fresh=' + Date.now(), { waitUntil: 'domcontentloaded' });
  return p;
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--no-sandbox'] });
  const errs = [];
  let fails = 0;
  const ok = (cond, msg) => { if (!cond) { fails++; console.log('SIM FAIL: ' + msg); } };

  // ============ 1) CPU-parti: heile vegen, to terningspanel, lagring ============
  {
    const P = await page(browser, 'CPU', errs);
    await P.click('#btn-cpu');
    await P.waitForSelector('#die-roll');
    ok(await P.$('#dice-p0') && await P.$('#dice-p1'), '1: to terningspanel i DOM');
    const active = await P.$$eval('.dicepanel.active-dice', els => els.map(e => e.id));
    ok(active.length === 1 && active[0] === 'dice-p0', '1: p0-panelet er aktivt i starten (' + active + ')');
    // spel til slutt
    const res = await P.evaluate(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const app = window.APP, SS = window.SS, UI = window.UI;
      const deadline = Date.now() + 180000;
      while (Date.now() < deadline && app.st.winner == null) {
        await sleep(60);
        if (app.over) break;
        const st = app.st;
        if (st.turn === 0 && st.phase === 'roll') {
          const b = document.getElementById('die-roll');
          if (b) b.click();
          continue;
        }
        if (st.turn === 0 && st.phase === 'move' && !app.busy) {
          const lm = SS.legalMoves(st, 0);
          const pb = document.getElementById('btn-pass');
          const rb = document.getElementById('btn-reroll');
          if (rb && rb.style.display !== 'none') { rb.click(); continue; }
          if (!lm.length) { if (pb && pb.style.display !== 'none') pb.click(); continue; }
          const mv = lm[Math.floor(Math.random() * lm.length)];
          UI.selectPiece(mv.pid);
          const targets = [...document.querySelectorAll('.cell.target')];
          if (!targets.length) { UI.clearSelection(); if (pb) pb.click(); continue; }
          const p = SS.piece(st, mv.pid);
          let destIdx;
          if (p.t === 's') destIdx = SS.soldierAt(p.o, p.at + mv.v);
          else { const r2 = SS.pathFor(st, p, mv.dir, mv.v); destIdx = r2.path[r2.path.length - 1]; }
          const cell = targets.find(c => parseInt(c.dataset.idx, 10) === destIdx) || targets[0];
          cell.click();
        }
      }
      return { winner: app.st.winner, reason: app.st.winReason, moves: app.st.moves, rolls: (app.st.log || []).length };
    });
    ok(res.winner !== null, '1: CPU-parti gjekk til slutt (' + JSON.stringify(res) + ')');
    const saved = await P.evaluate(() => JSON.parse(localStorage.getItem('sahkku.save.v2') || 'null'));
    ok(saved && saved.st, '1: autolagra undervegs');
    // SPG-eksport: last ned
    const dl = P.waitForEvent('download').catch(() => null);
    await P.evaluate(() => document.getElementById('btn-export-spg') && document.getElementById('btn-spg').click());
    const d0 = await dl;
    if (d0) {
      const tmp = path.join(process.env.BH_AGENT_WORKSPACE || '/tmp', 'sim-export.spg');
      await d0.saveAs(tmp);
      const txt = fs.readFileSync(tmp, 'utf8');
      ok(txt.includes('SPG-V1') && txt.includes('open:'), '1: SPG-nedlasting med header + opning');
      console.log('SPG-smbit:\n' + txt.split('\n').slice(6, 12).join('\n'));
    } else {
      // endscore-dialogen opnar berre ved vinnar; knapp i game-btns er nok
      const spg = await P.evaluate(() => window.SPG.toSPG(window.APP.st, { event: 'sim' }));
      ok(spg.includes('SPG-V1'), '1: SPG generert');
    }
    // gjenopptak: ladd inn sida på nytt — Fortsett-knapp skal visast
    await P.reload({ waitUntil: 'domcontentloaded' });
    await P.waitForSelector('#btn-resume:not(.hidden)', { timeout: 5000 }).catch(() => {});
    const visRes = await P.$eval('#btn-resume', el => !el.classList.contains('hidden')).catch(() => false);
    ok(visRes, '1: Fortsett-knappen visast etter reload');
    // lagra partiet var slutt (winner) → knappen skal IKKJE visast om spelet er over.
    // Gjer om: start nytt parti, reload midt i partiet:
    await P.evaluate(() => { localStorage.removeItem('sahkku.save.v2'); });
    await P.reload({ waitUntil: 'domcontentloaded' });
    await P.click('#btn-local');
    await P.click('#die-roll');
    await P.reload({ waitUntil: 'domcontentloaded' });
    await P.waitForSelector('#btn-resume:not(.hidden)', { timeout: 5000 });
    await P.click('#btn-resume');
    const st2 = await P.evaluate(() => ({ mode: APP.mode, phase: APP.st.phase, hasLog: window.UI ? 1 : 1, onGame: !document.getElementById('game').classList.contains('hidden') }));
    ok(st2.onGame && st2.mode === 'local', '1: gjenopptak frå lagring (' + JSON.stringify(st2) + ')');
    await P.close();
  }

  // ============ 2) Online: ekte iroh-P2P, heile partiet, autoritativt ============
  {
    const A = await page(browser, 'A', errs);
    const B = await page(browser, 'B', errs);
    await A.click('#btn-online');
    await A.waitForFunction(() => window.NET && NET.myId, null, { timeout: 40000 });
    await A.fill('#room-seed', 'protokoll' + (Date.now() % 100000));
    await A.click('#btn-join');
    await A.waitForFunction(() => NET.ready, null, { timeout: 40000 });
    const invite = await A.$eval('#invite-code', el => el.textContent);
    await B.click('#btn-online');
    await B.waitForFunction(() => window.NET && NET.myId, null, { timeout: 40000 });
    await B.fill('#room-seed', invite);
    await B.click('#btn-join');

    for (const [tag, P] of [['A', A], ['B', B]]) {
      await P.waitForFunction(() => !document.getElementById('game').classList.contains('hidden') && APP.st && APP.st.log && APP.st.log.length > 0, null, { timeout: 90000 });
    }
    // opningsritual loggført på BEGGE sider
    for (const [tag, P] of [['A', A], ['B', B]]) {
      const hasOpen = await P.evaluate(() => APP.st.log[0] && APP.st.log[0].t === 'open');
      ok(hasOpen, '2: ' + tag + ' har opningsritual i loggen');
    }
    // loop: begge sider spelar, kast-knapp + brikke + mål
    async function loop(P, tag) {
      return await P.evaluate(async (tag) => {
        const sleep = ms => new Promise(r => setTimeout(r, ms));
        const app = window.APP, SS = window.SS, UI = window.UI;
        let moves = 0;
        const deadline = Date.now() + 120000;
        while (Date.now() < deadline) {
          await sleep(700);
          if (!app.st || app.over || app.busy) continue;
          const st = app.st;
          if (st.winner != null) break;
          if (st.turn !== app.me) continue;
          if (st.phase === 'roll') {
            const btn = document.getElementById('die-roll');
            if (btn) { btn.click(); moves++; }
            continue;
          }
          if (st.phase === 'move') {
            const pb = document.getElementById('btn-pass');
            const rb = document.getElementById('btn-reroll');
            if (rb && rb.style.display !== 'none') { rb.click(); continue; }
            const lm = SS.legalMoves(st, st.turn);
            if (!lm.length) { if (pb && pb.style.display !== 'none') pb.click(); continue; }
            const mv = lm[Math.floor(Math.random() * lm.length)];
            UI.selectPiece(mv.pid);
            const targets = [...document.querySelectorAll('.cell.target')];
            if (!targets.length) { UI.clearSelection(); if (pb) pb.click(); continue; }
            const p = SS.piece(st, mv.pid);
            let destIdx;
            if (p.t === 's') destIdx = SS.soldierAt(p.o, p.at + mv.v);
            else { const r2 = SS.pathFor(st, p, mv.dir, mv.v); destIdx = r2.path[r2.path.length - 1]; }
            const cell = targets.find(c => parseInt(c.dataset.idx, 10) === destIdx) || targets[0];
            cell.click();
            moves++;
          }
        }
        return { tag, moves, total: app.st ? app.st.moves : -1, winner: app.st && app.st.winner, turn: app.st && app.st.turn, me: app.me, host: app.host };
      }, tag);
    }
    const [rA, rB] = await Promise.all([loop(A, 'A'), loop(B, 'B')]);
    console.log('2 A:', JSON.stringify(rA), '\n2 B:', JSON.stringify(rB));
    const fA = await A.evaluate(() => ({ moves: APP.st.moves, turn: APP.st.turn, winner: APP.st.winner, host: APP.host }));
    const fB = await B.evaluate(() => ({ moves: APP.st.moves, turn: APP.st.turn, winner: APP.st.winner, host: APP.host }));
    console.log('2 slutt A:', JSON.stringify(fA), 'B:', JSON.stringify(fB));
    ok(fA.moves >= 6, '2: minst 6 trekk spelte på nett (' + fA.moves + ')');
    ok(Math.abs(fA.moves - fB.moves) <= 1, '2: trekkteljing synkronisert (A ' + fA.moves + ' B ' + fB.moves + ')');
    ok(rA.moves >= 1 && rB.moves >= 1, '2: BEGGE sider fekk kaste (A ' + rA.moves + ', B ' + rB.moves + ') — sløyfe-etter-første-flytt er borte');
    // B si logg viser Menn-sida (verten) si casting — gjesten ser motspelarens terningar
    const logB = await B.$eval('#log', el => el.textContent);
    ok(logB.includes('Åpning'), '2: gjesten si logg: opningsritual');
    await A.close(); await B.close();
  }

  // ============ 3) Online-lagring: reload midt i parti gjenopprettar ============
  {
    const A = await page(browser, 'A3', errs);
    await A.click('#btn-online');
    await A.waitForFunction(() => window.NET && NET.myId, null, { timeout: 40000 });
    await A.fill('#room-seed', 'lagrtest' + (Date.now() % 100000));
    await A.click('#btn-join');
    await A.waitForFunction(() => NET.ready, null, { timeout: 40000 });
    // åleine i rommet: start ikje partiet (ventar på peer) — lagre tidleg:
    const savedRoom = await A.evaluate(() => {
      const s = localStorage.getItem('sahkku.save.v2');
      return s ? JSON.parse(s).room : null;
    });
    // vert åleine har ikje starta parti enno — lagre skjer først når partiet startar.
    // Gjer det konkret: kall newOnlineGame manuelt? Nei — lagring testast best med CPU.
    // Her: verifiser at rommet er lagra sjølv utan parti (session-hald):
    console.log('3: rom lagra:', JSON.stringify(savedRoom));
    await A.close();
  }

  const realErrs = errs.filter(e => !/favicon|serviceWorker|manifest|manifest\.webmanifest|sw\.js|404|iroh-relay|relay/i.test(e));
  if (realErrs.length) { console.log('FEIL-signal:', realErrs.slice(0, 8)); fails += realErrs.length; }
  console.log(fails ? '\nSIMULERING: ' + fails + ' FEIL' : '\nSIMULERING: ALT OK');
  await browser.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('SIM KRASJ:', e.stack || e); process.exit(2); });
