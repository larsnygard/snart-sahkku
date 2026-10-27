// «Autokast»: kast terningane automatisk når det er din tur — men OMKAST av X
// skal framleis vere manuelt (Lars 2026-10-27).
//
// Testar gjennom den verkelege app-koden (window.__rollPhase), ikkje ein kopi:
//  1. brytaren finst og heiter «Autokast»
//  2. påslått  -> terningane vert kasta av seg sjølv i mennesket sin tur
//  3. avslått  -> ingenting skjer av seg sjølv
//  4. påslått + blokkert X -> INGEN automatisk omkast (omkast er manuelt)
//  5. valet vert hugsa i localStorage
const { chromium } = require('playwright-core');
const path = require('path');
const http = require('http');
const fs = require('fs');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) pass++;
  else { fail++; console.log('  FAIL ' + name + (extra ? ' :: ' + extra : '')); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

const ROOT = path.join(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});

(async () => {
  await new Promise(r => server.listen(8094, r));
  const browser = await chromium.launch({
    executablePath: path.join(process.env.HOME, '.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'),
    headless: true, args: ['--no-sandbox']
  });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto('http://127.0.0.1:8094/index.html');
  await page.waitForFunction(() => window.SS && window.__APP && window.__rollPhase);

  // 1. brytaren
  const box = await page.evaluate(() => {
    const el = document.getElementById('chk-autocast');
    const wrap = document.getElementById('autocast-wrap');
    return {
      finst: !!el, type: el && el.type,
      tekst: wrap ? wrap.textContent.trim() : '',
      iDiceRow: !!(el && el.closest('.dicerow')),
      synleg: !!(el && getComputedStyle(el).display !== 'none')
    };
  });
  ok('brytaren finst', box.finst && box.type === 'checkbox', JSON.stringify(box));
  ok('merket står ved terningane', box.iDiceRow, JSON.stringify(box));
  ok('merket heiter Autokast', /autokast/i.test(box.tekst), JSON.stringify(box));

  // Hjelpar: set opp mennesket sin tur i kastefasen og køyr den verkelege rollPhase.
  // Vi tel SS.roll-kall, ikkje terningane: eit kast med berre blanke avsluttar turen
  // og går rett i ein ny kastefase, so «terningar ligg der» er eit flakete mål.
  async function køyrRollPhase(autocast) {
    // Fersk side per scenario: elles kan ein CPU-tur frå førre scenario
    // kaste terningar inn i teljinga (det var nettopp det som gjorde testen flakete).
    await page.reload();
    await page.waitForFunction(() => window.SS && window.__APP && window.__rollPhase);
    await page.evaluate(a => {
      const SS = window.SS, app = window.__APP, UI = window.UI;
      const st = SS.newGame({ first: 0, queenMode: false });
      app.st = st; app.mode = 'cpu'; app.busy = false; app.over = false; app.autocast = a;
      UI.st = st;
      window.__rolls = 0;
      const orig = SS.roll;
      SS.roll = function (x) { window.__rolls++; return orig.call(SS, x); };
      window.__rollPhase();
    }, autocast);
  }

  await køyrRollPhase(true);
  await sleep(1600);
  const med = await page.evaluate(() => ({ rolls: window.__rolls }));
  ok('påslått -> terningane vart kasta automatisk', med.rolls >= 1, JSON.stringify(med));

  await køyrRollPhase(false);
  await sleep(1600);
  const utan = await page.evaluate(() => ({ rolls: window.__rolls, phase: window.__APP.st.phase }));
  ok('avslått -> inga automatisk kasting', utan.rolls === 0 && utan.phase === 'roll', JSON.stringify(utan));

  // 4. Blokkert X med autokast på: ingen automatisk omkast
  await page.reload();
  await page.waitForFunction(() => window.SS && window.__APP && window.__settle);
  const blocked = await page.evaluate(() => {
    const SS = window.SS, app = window.__APP, UI = window.UI;
    let val = null;
    for (let sq = 12; sq < 40 && !val; sq++) for (let qq = 12; qq < 40 && !val; qq++) {
      if (sq === qq) continue;
      const st = SS.newGame({ first: 0, queenMode: false });
      st.phase = 'move'; st.turn = 0;
      st.pieces.forEach(p => { if (p.t === 's') p.captured = true; });
      const s = SS.soldiers(st, 0)[0]; s.captured = false; s.released = true; s.at = sq;
      const q = SS.queen(st, 0); q.captured = false; q.released = false; q.at = qq;
      st.dice = ['X', '_', '_']; st.used = [false, true, true];
      if (SS.legalMoves(st, 0).length === 0 && SS.canRerollX(st)) val = { st, sq, qq };
    }
    if (!val) return null;
    app.st = val.st; app.mode = 'cpu'; app.busy = false; app.over = false; app.autocast = true;
    UI.st = val.st;
    window.__rerolls = 0;
    const orig = SS.rerollX;
    SS.rerollX = function (x) { window.__rerolls++; return orig.call(SS, x); };
    window.__settle();          // den verkelege vegen: skal ikkje kaste om sjølv
    return { rerolls: window.__rerolls, dice: app.st.dice.join(''), turn: app.st.turn };
  });
  ok('blokkert X -> inga automatisk omkast', blocked && blocked.rerolls === 0, JSON.stringify(blocked));
  ok('blokkert X -> terningane står urørt', blocked && blocked.dice === 'X__', JSON.stringify(blocked));

  // 5. Hugsar valet
  await page.evaluate(() => { const b = document.getElementById('chk-autocast'); b.checked = true; b.dispatchEvent(new Event('change')); });
  const lagra = await page.evaluate(() => localStorage.getItem('sahkku.autocast'));
  ok('valet vert hugsa', lagra === '1', String(lagra));

  ok('ingen JS-feil', errs.length === 0, errs.join(' | '));

  console.log('autocast: ' + pass + ' pass, ' + fail + ' fail');
  await browser.close();
  server.close();
  process.exit(fail ? 1 : 0);
})();
