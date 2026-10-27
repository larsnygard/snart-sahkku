// Omkast av X er eit VAL, ikkje noko som skjer automatisk (Lars 2026-10-27).
//
// Testar den verkelege settle-vegen i appen (window.__settle), ikkje ein kopi:
//  1. NN-motor som seier «pass»  -> appen skal IKKJE kaste om, men avslutte turen
//  2. NN-motor som seier «reroll» -> appen skal kaste om (motoren sitt val)
//  3. Ingen motor (klassisk CPU)  -> klassisk kastar om, som før (ho har ingen strategi)
//  4. Menneske i same stilling    -> både «kast om» og «hopp over» skal vere synlege
const { chromium } = require('playwright-core');
const path = require('path');
const http = require('http');
const fs = require('fs');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' :: ' + extra : '')); }
}

const ROOT = path.join(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});

(async () => {
  await new Promise(r => server.listen(8093, r));
  const browser = await chromium.launch({
    executablePath: path.join(process.env.HOME, '.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'),
    headless: true, args: ['--no-sandbox']
  });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto('http://127.0.0.1:8093/index.html');
  await page.waitForFunction(() => window.SS && window.__APP && window.__settle);

  // Still inn ein «blokkert» stilling: aktiv X, inga lovleg trekk, men aktive brikker
  const setup = await page.evaluate(() => {
    const SS = window.SS;
    const finn = side => {
      for (let sq = 12; sq < 40; sq++) for (let qq = 12; qq < 40; qq++) {
        if (sq === qq) continue;
        const st = SS.newGame({ first: side, queenMode: false });
        st.phase = 'move'; st.turn = side;
        st.pieces.forEach(p => { if (p.t === 's') p.captured = true; });
        const s = SS.soldiers(st, side)[0]; s.captured = false; s.released = true; s.at = sq;
        const q = SS.queen(st, side); q.captured = false; q.released = false; q.at = qq;
        st.dice = ['X', '_', '_']; st.used = [false, true, true];
        if (SS.legalMoves(st, side).length === 0 && SS.canRerollX(st)) return { sq, qq };
      }
      return null;
    };
    return { cpu: finn(1), menneske: finn(0) };
  });
  ok('fann blokkert stilling (CPU-sida)', !!setup.cpu, JSON.stringify(setup));
  ok('fann blokkert stilling (mennesket)', !!setup.menneske, JSON.stringify(setup));
  if (!setup) { await browser.close(); server.close(); process.exit(1); }

  // Køyr ein «runde» med oppgitt motoroppførsel; tel om appen kastar om sjølv
  async function run(engineKind, engineChoice) {
    return page.evaluate(({ eng, choice, sq, qq }) => {
      const SS = window.SS, app = window.__APP, UI = window.UI;
      const st = SS.newGame({ first: 1, queenMode: false });
      st.phase = 'move'; st.turn = 1;               // CPU-sida (Koner) i tur
      st.pieces.forEach(p => { if (p.t === 's') p.captured = true; });
      const s = SS.soldiers(st, 1)[0]; s.captured = false; s.released = true; s.at = sq;
      const q = SS.queen(st, 1); q.captured = false; q.released = false; q.at = qq;
      st.dice = ['X', '_', '_']; st.used = [false, true, true];
      app.st = st; app.mode = 'cpu'; app.busy = false; app.over = false;
      app.engine = eng; app.level = 3;
      UI.st = st;
      let rerolls = 0;
      const orig = SS.rerollX;
      SS.rerollX = function (x) { rerolls++; return orig.call(SS, x); };
      if (!window.__realENG) window.__realENG = window.ENG;   // ta vare på den ekte
      if (eng === 'stub') {
        window.ENG = { ready: () => true, action: () => ({ kind: choice }), name: () => 'stub', move: () => null };
      } else {
        window.ENG = window.__realENG;                        // ikkje lat stubben lække
      }
      window.__settle();
      SS.rerollX = orig;
      return { rerolls, turn: app.st.turn, dice: (app.st.dice || []).join('') };
    }, { eng: engineKind, choice: engineChoice, sq: setup.cpu.sq, qq: setup.cpu.qq });
  }

  const a = await run('stub', 'pass');
  ok('NN seier pass -> ingen omkast', a.rerolls === 0, JSON.stringify(a));
  ok('NN seier pass -> turen er avslutta', a.turn === 0, JSON.stringify(a));

  const b = await run('stub', 'reroll');
  ok('NN seier omkast -> appen kastar om', b.rerolls === 1, JSON.stringify(b));

  // Klassisk CPU: ingen motor-modul å spørje, so ho skal IKKJE kaste om på eiga
  // hand — ho avsluttar turen (same val som eit menneske som ikkje vil kaste om).
  const c = await run('classic', null);
  ok('klassisk CPU -> ingen automatisk omkast', c.rerolls === 0, JSON.stringify(c));
  ok('klassisk CPU -> turen går vidare', c.turn === 0, JSON.stringify(c));

  // Menneske: INGEN «kast om»-knapp lenger — ein klikkar terningen sjølv.
  // Og slår ein TO X, skal eit klikk kaste om berre den eine (Lars 2026-10-27).
  const human = await page.evaluate(({ sq, qq }) => {
    const SS = window.SS, app = window.__APP, UI = window.UI;
    const st = SS.newGame({ first: 0, queenMode: false });
    st.phase = 'move'; st.turn = 0;
    st.pieces.forEach(p => { if (p.t === 's') p.captured = true; });
    const s = SS.soldiers(st, 0)[0]; s.captured = false; s.released = true; s.at = sq;
    const q = SS.queen(st, 0); q.captured = false; q.released = false; q.at = qq;
    st.dice = ['X', 'X', '_']; st.used = [false, false, true];   // TO X
    app.st = st; app.mode = 'cpu'; app.busy = false; app.over = false;
    UI.st = st; UI.setInteractive(true); UI.render();
    const box = document.getElementById('dicebox-p0');
    const dice = Array.from(box.querySelectorAll('.die'));
    const klikkbare = dice.map(el => el.classList.contains('rerollable'));
    // Klikk den ANDRE X-en (indeks 1); den fyrste skal stå urørt.
    // Fast RNG (=> III) so testen ikkje kan slå X på nytt (1/4 flak).
    const før = st.dice.slice();
    const ekteRandom = Math.random;
    Math.random = () => 0.5;
    const orig = SS.rerollX;
    const kall = [];
    SS.rerollX = function (st_, rnd, slot) {
      const res = orig.call(SS, st_, rnd, slot);
      kall.push({ slot: slot, før: før.slice(), etter: (res || []).slice() });
      return res;
    };
    if (dice[1]) dice[1].click();
    SS.rerollX = orig;
    Math.random = ekteRandom;
    const etter = st.dice.slice();
    return {
      knappFinst: !!document.getElementById('btn-reroll'),
      klikkbare, før, etter, kall,
      kunEinEndra: kall.length === 1 && kall[0].slot === 1 &&
                   kall[0].før[0] === kall[0].etter[0] &&
                   kall[0].før[2] === kall[0].etter[2] &&
                   kall[0].etter[1] !== 'X',
      passSynleg: (() => { const el = document.getElementById('btn-pass');
        return !!el && getComputedStyle(el).display !== 'none'; })(),
    };
  }, { sq: setup.menneske.sq, qq: setup.menneske.qq });
  ok('ingen «kast om»-knapp', human.knappFinst === false, JSON.stringify(human));
  ok('terningane er klikkbare sjølv', human.klikkbare[0] === true && human.klikkbare[1] === true,
     JSON.stringify(human.klikkbare));
  ok('klikk på éin X kastar om BERRE den eine', human.kunEinEndra === true,
     JSON.stringify({ kall: human.kall }));
  ok('menneske ser «hopp over» (omkast valfritt)', human.passSynleg === true, JSON.stringify(human));
  ok('ingen JS-feil', errs.length === 0, errs.join(' | '));

  console.log('reroll: ' + pass + ' pass, ' + fail + ' fail');
  await browser.close();
  server.close();
  process.exit(fail ? 1 : 0);
})();
