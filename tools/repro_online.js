// Repro/harness for online play: two pages in the same iroh room, play N turns.
// Prints the state of both sides at every step so a stall is visible.
const path = require('path');
const http = require('http');
const fs = require('fs');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const PORT = 8110;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
               '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
               '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm' };

const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function snap(page) {
  return page.evaluate(() => ({
    turn: window.__APP.st ? window.__APP.st.turn : null,
    phase: window.__APP.st ? window.__APP.st.phase : null,
    dice: window.__APP.st ? (window.__APP.st.dice || []).join(' ') : '',
    me: window.__APP.me, host: window.__APP.host, busy: !!window.__APP.busy,
    mode: window.__APP.mode, gameId: window.__APP.gameId || null,
    over: !!window.__APP.over,
  }));
}

(async () => {
  const LIVE = process.env.LIVE || '';
  const BASE = LIVE || `http://127.0.0.1:${PORT}`;
  if (!LIVE) await new Promise(r => server.listen(PORT, r));
  const browser = await chromium.launch({
    executablePath: '/home/lars/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome',
    headless: true, args: ['--no-sandbox'],
  });
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const A = await ctxA.newPage();   // challenges
  const B = await ctxB.newPage();   // accepts

  const errs = [];
  for (const [name, p] of [['A', A], ['B', B]]) {
    p.on('pageerror', e => errs.push(name + ': ' + e.message));
    p.on('response', r => { if (r.status() >= 400) errs.push(name + ' ' + r.status() + ' ' + r.url()); });
    p.on('console', m => { if (m.type() === 'error') errs.push(name + ' console: ' + m.text().slice(0, 160)); });
  }

  for (const pg of [A, B]) {
    pg.on('load', () => {});
  }
  // kvar side får ein profil, so lobbyen skal vise kallenamn
  await A.addInitScript(() => localStorage.setItem('sahkku.profile',
    JSON.stringify({ nick: 'Lars', realName: 'Lars Nygård', avatar: 'herder' })));
  await B.addInitScript(() => localStorage.setItem('sahkku.profile',
    JSON.stringify({ nick: 'Kåre', realName: 'Kåre Hansen', avatar: 'fisher' })));

  await A.goto(`${BASE}/index.html`);
  await A.waitForFunction(() => window.NET && window.LOBBY);
  await A.click('#btn-online');
  await A.waitForFunction(() => window.NET && NET.myId, null, { timeout: 60000 });
  await A.fill('#room-seed', 'hermestest');
  await A.click('#btn-join');
  await A.waitForFunction(() => NET.ready, null, { timeout: 90000 });
  const invite = await A.$eval('#invite-code', el => el.textContent);
  console.log('A joined, invite:', invite.slice(0, 30) + '…');

  await B.goto(`${BASE}/index.html`);
  await B.waitForFunction(() => window.NET && window.LOBBY);
  await B.click('#btn-online');
  await B.waitForFunction(() => window.NET && NET.myId, null, { timeout: 60000 });
  await B.fill('#room-seed', invite);
  await B.click('#btn-join');
  await B.waitForFunction(() => NET.ready, null, { timeout: 90000 });
  console.log('B joined');
  await sleep(2500);
  for (const [n, p] of [['A', A], ['B', B]]) {
    console.log(n, 'lobby rows:', JSON.stringify(await p.evaluate(() =>
      [...document.querySelectorAll('#lobby-list .lobby-row')].map(li => li.textContent.trim() + (li.querySelector('img') ? ' [avatar]' : '')))));
  }

  // A challenges B (gossip can drop a message right after join: retry)
  await A.waitForFunction(() => document.querySelectorAll('#lobby-list .lobby-row button').length > 0, null, { timeout: 60000 });
  await sleep(2000);
  let opened = false;
  for (let attempt = 0; attempt < 3 && !opened; attempt++) {
    await A.click('#lobby-list .lobby-row button');
    opened = await B.waitForSelector('#chaldlg[open]', { timeout: 6000 }).then(() => true).catch(() => false);
    if (!opened) { await A.evaluate(() => window.LOBBY.reset()); await sleep(1500); }
  }
  if (!opened) { console.log('!! challenge never reached B'); }
  await B.click('#btn-chal-accept');
  await A.waitForSelector('#game:not(.hidden)', { timeout: 30000 });
  await B.waitForSelector('#game:not(.hidden)', { timeout: 30000 });
  for (const [n, p] of [['A', A], ['B', B]]) {
    await p.evaluate(() => {
      window.__siLog = [];
      const orig = UI.setInteractive;
      UI.setInteractive = function (v) {
        window.__siLog.push(v + ' @' + (window.__APP.st ? window.__APP.st.phase : '?') +
                            '/' + (window.__APP.st ? window.__APP.st.turn : '?') + ' me' + window.__APP.me);
        return orig.call(UI, v);
      };
    });
  }
  for (const [n, p] of [['A', A], ['B', B]]) {
    await p.evaluate(() => {
      window.__msgs = [];
      window.__sent = [];
      const orig = NET.handlers.onMsg;
      NET.handlers.onMsg = function (m) {
        window.__msgs.push((m.data && m.data.t) + (m.data && m.data.g ? '' : '(nog)'));
        try { return orig(m); }
        catch (e) { window.__onMsgErr = String(e && e.message || e); throw e; }
      };
      const s0 = NET.send;
      NET.send = function (o) {
        window.__sent.push(o && o.t);
        return s0.call(NET, o).catch(function (e) { window.__sendErr = String(e && e.message || e); });
      };
    });
  }
  console.log('game started');
  console.log('names:', JSON.stringify(await A.evaluate(() => window.__APP.names)),
              JSON.stringify(await B.evaluate(() => window.__APP.names)));
  console.log('board labels:', JSON.stringify(await A.evaluate(() => [
    document.getElementById('label-p0').textContent, document.getElementById('label-p1').textContent])));
  console.log('A:', JSON.stringify(await snap(A)));
  console.log('B:', JSON.stringify(await snap(B)));

  // play up to 24 half-turns
  for (let step = 0; step < 24; step++) {
    let acted = false;
    for (const [name, p] of [['A', A], ['B', B]]) {
      const s = await snap(p);
      if (s.over) { console.log(`GAME OVER after ${step} steps`); return done(); }
      if (s.turn !== s.me || s.mode !== 'online') continue;
      if (s.phase === 'roll') {
        const btn = await p.$('#die-roll');
        if (!btn) { console.log(name, 'no roll button though phase=roll', JSON.stringify(s)); continue; }
        await btn.click();
        let after = await snap(p);
        await sleep(800);
        // vent på at kastet landar (fasen går til move, eller turen går vidare)
        for (let w = 0; w < 10 && after.phase === 'roll' && after.turn === s.turn; w++) {
          await sleep(300);
          after = await snap(p);
        }
        console.log(`step ${step} ${name} rolled ->`, after.phase, after.dice || '(none)',
                    'turn', after.turn, '| interactive:', await p.evaluate(() => UI.interactive));
        if (after.phase === 'roll' && after.turn === s.turn) {
          console.log('!! STALL: still in roll phase after clicking roll on', name);
          // virkar sendinga framleis? Send eit merke og sjå om det kjem fram
          await A.evaluate(() => { window.__msgs = []; NET.send({ t: 'pingtest' }).catch(e => { window.__sendErr = String(e); }); });
          await sleep(1500);
          console.log('ping reached B?:', JSON.stringify(await B.evaluate(() => (window.__msgs || []).slice(-5))));
          console.log('send error A:', JSON.stringify(await A.evaluate(() => window.__sendErr || null)));
          for (const [n, pg] of [['A', A], ['B', B]]) {
            console.log(n, 'counts:', JSON.stringify(await pg.evaluate(() => ({
              sent: (window.__sent || []).reduce((a, t) => (a[t] = (a[t] || 0) + 1, a), {}),
              got: (window.__msgs || []).reduce((a, t) => (a[t] = (a[t] || 0) + 1, a), {}),
              onMsgErr: window.__onMsgErr || null, sendErr: window.__sendErr || null,
            }))));
          }
          console.log('NET state A:', JSON.stringify(await A.evaluate(() => ({ ready: NET.ready, peers: NET.peers.length, seed: !!NET.seed }))));
          console.log('NET state B:', JSON.stringify(await B.evaluate(() => ({ ready: NET.ready, peers: NET.peers.length, seed: !!NET.seed }))));
          for (const [n, pg] of [['A', A], ['B', B]]) {
            console.log(n, 'diag:', JSON.stringify(await pg.evaluate(() => ({
              busy: !!__APP.busy, host: __APP.host, me: __APP.me,
              turn: __APP.st.turn, phase: __APP.st.phase, dice: __APP.st.dice,
              interactive: window.UI.interactive,
              msgs: (window.__msgs || []).slice(-8),
            }))));
          }
          console.log('A:', JSON.stringify(await snap(A)));
          console.log('B:', JSON.stringify(await snap(B)));
          return done();
        }
        acted = true;
      } else if (s.phase === 'move') {
        const side = s.me === 0 ? 'red' : 'blue';
        let moved = false;
        // soldatar først — dronning/konge kan gjere partiet kort av feil grunn
        const pieces = (await p.$$(`#board .piece.${side}`))
          .concat(await p.$$('#board .piece.king'));
        for (const piece of pieces) {
          await piece.click().catch(() => {});
          await sleep(150);
          const target = await p.$('#board .cell.target');
          if (target) {
            await target.click().catch(() => {});
            await sleep(1200);
            console.log(`step ${step} ${name} moved | interactive:`,
                        await p.evaluate(() => UI.interactive));
            acted = true; moved = true;
            break;
          }
        }
        if (!moved) {
          const pass = await p.$('#btn-pass');
          const visible = pass && await pass.isVisible();
          if (visible) { await pass.click(); await sleep(500); console.log(`step ${step} ${name} passed`); acted = true; }
          else {
            const diag = await p.evaluate(() => {
              const st = window.__APP.st;
              const lm = window.SS.legalMoves(st, st.turn);
              const pb = document.getElementById('btn-pass');
              return {
                interactive: window.UI.interactive, busy: !!window.__APP.busy,
                dice: st.dice, used: st.used, phase: st.phase, turn: st.turn,
                legalMoves: lm.length,
                passDisplay: pb ? getComputedStyle(pb).display : 'no button',
                passVisible: pb ? pb.offsetParent !== null : false,
                pieces: document.querySelectorAll('#board .piece').length,
                targets: document.querySelectorAll('#board .cell.target').length,
              };
            });
            console.log(name, 'STALL DIAG', JSON.stringify(diag));
          }
        }
      }
    }
    if (!acted) {
      // storleikstest: kor stort er eit snapshot no, og kjem eit slikt fram?
      const probe = await B.evaluate(async () => {
        const st = __APP.st;
        const payload = { t: 'sizetest', s: JSON.parse(SS.serialize(st)) };
        const len = JSON.stringify(payload).length;
        window.__sizeGot = null;
        await NET.send(payload);
        return { len };
      });
      await sleep(2000);
      const sizeGot = await A.evaluate(() => {
        const el = (window.__msgs || []).filter(x => x.indexOf('sizetest') === 0);
        return el.length;
      });
      console.log('snapshot size test:', JSON.stringify(probe), 'arrived:', sizeGot);

      // gi sjølvhelinga (3 s puls + sync) tid før vi kallar det stopp
      for (let w = 0; w < 15 && !acted; w++) {
        await sleep(1000);
        for (const pg of [A, B]) {
          const s = await snap(pg);
          if (s.turn !== s.me || s.mode !== 'online') continue;
          const btn = await pg.$('#die-roll');
          const tgt = await pg.$('#board .cell.target');
          if (btn || tgt) { acted = true; break; }
        }
      }
      if (acted) continue;
      // prøv ei manuell synk frå kvar side og sjå om noko kjem tilbake
      for (const [n, pg] of [['A', A], ['B', B]]) {
        await pg.evaluate(() => { window.__got2 = []; const h = NET.handlers.onMsg;
          NET.handlers.onMsg = function (m) { window.__got2.push(m.data && m.data.t); return h(m); };
          NET.send({ t: 'sync' }); });
      }
      await sleep(2500);
      for (const [n, pg] of [['A', A], ['B', B]]) {
        console.log(n, 'after manual sync:', JSON.stringify(await pg.evaluate(() => ({
          got: window.__got2, interactive: window.UI.interactive, heal: !!__APP._heal,
        }))));
      }
      const a = await snap(A), b = await snap(B);
      console.log('!! no side could act. A:', JSON.stringify(a), 'B:', JSON.stringify(b));
      for (const [n, pg] of [['A', A], ['B', B]]) {
        console.log(n, 'diag:', JSON.stringify(await pg.evaluate(() => ({
          heal: !!__APP._heal, busy: !!__APP.busy, host: __APP.host, me: __APP.me,
          interactive: window.UI.interactive, msgs: (window.__msgs || []).slice(-10),
        }))));
      }
      for (const [n, p] of [['A', A], ['B', B]]) {
        console.log(n, 'panels:', JSON.stringify(await p.evaluate(() => ({
          p0: document.getElementById('dicebox-p0').innerHTML.slice(0, 120),
          p1: document.getElementById('dicebox-p1').innerHTML.slice(0, 120),
          rollBtn: !!document.getElementById('die-roll'),
          interactive: window.UI.interactive,
        }))));
      }
      return done();
    }
  }
  console.log('played 24 steps without stalling');

  async function done() {
    for (const [n, p] of [['A', A], ['B', B]]) {
      console.log(n, 'setInteractive log:', JSON.stringify(await p.evaluate(() => (window.__siLog || []).slice(-12))));
    }
    console.log('errors:', errs.length ? errs.join('\n') : 'none');
    await browser.close();
    server.close();
  }
})().catch(async e => { console.error('FEIL:', e.message); server.close(); process.exit(1); });
