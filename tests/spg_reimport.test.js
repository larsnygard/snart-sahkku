// SPG-innlesing: omkast-linjer, regelvariant og rundtur.
//
// Bakgrunn: ein brukar fekk «ukjent trekk» på si eiga fil. To feil låg bak:
//   1. Skrivaren legg omkast-merket slik spec-en seier — «10. M (omkast #1): …»
//      — men lesaren venta det på slutten av linja. Difor har INGA fil med
//      X-omkast nokosinne late seg importere.
//   2. Lesaren spela alle parti opp med vanlege reglar, so eit Nesseby-parti
//      hamna i feil stilling (kongen bytte eigar) og braut midtvegs.
//
// Køyr:  node tests/spg_reimport.test.js
const fs = require('fs');
const path = require('path');

// minimum DOM/localStorage for archive.js
const mem = {};
global.localStorage = { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; } };
global.window = global;
global.navigator = { userAgent: 'node' };
['engine', 'fen', 'spg', 'zip'].forEach(f => require(path.join(__dirname, '..', 'js', f + '.js')));
require(path.join(__dirname, '..', 'js', 'archive.js'));

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' :: ' + x : '')); } };

// ---------- 1. brukaren si fil: Nesseby + 12 omkast, utan [Variant]-tag ----------
const userFile = fs.readFileSync(path.join(__dirname, 'fixtures', 'nesseby-rerolls.spg'), 'utf8');
const g = SPG.parseMany(userFile)[0];
const rerolls = g.events.filter(e => e.k === 'reroll').length;
ok('omkast-linjene vert lesne (12 omkast)', rerolls === 12, rerolls);
ok('opningsritualet med to kast er lese', g.events.filter(e => e.k === 'open').length === 2);

ARCH.clear();
const imp = ARCH.importSpg(userFile);
ok('brukaren si fil importerer', imp.added === 1 && !imp.error, JSON.stringify(imp));
const rec = ARCH.list()[0];
ok('141 trekk', rec && rec.plies === 141, rec && rec.plies);
ok('resultat 1-0 (dronning)', rec && rec.result === '1-0' && rec.reason === 'dronning', rec && rec.result + '/' + rec.reason);
ok('Nesseby vert oppdaga utan tag', rec && rec.nesseby === true, rec && rec.nesseby);
ok('FEN-historikk: 142 stillingar', rec && rec.fens.length === 142, rec && rec.fens.length);
ok('[Variant] er skriven inn i den lagra teksten', rec && rec.spg.indexOf('[Variant "Nesseby"]') >= 0);

// spel opp att og samanlikn sluttstillinga med den siste FEN-en
const rep = ARCH.replay(rec, ARCH.totalMoves(rec));
ok('oppspeling endar i same stilling', SS.toFEN(rep.st) === rec.fens[rec.fens.length - 1],
   SS.toFEN(rep.st) + ' != ' + rec.fens[rec.fens.length - 1]);

// ---------- 2. omkast i begge former (bakoverkompatibelt) ----------
const mini = (marker) => [
  '[Event "mini"]', '[Result "*"]', 'SPG-V1', '',
  '1. open: M(X _ _) K(_ _ _) -> M',
  '1. M: X _ _',
  '2. M' + marker + ': II _ _',
  '   X!',
  '   X->O2',
  ''
].join('\n');
[' (omkast #1)'].forEach(m => {
  const gg = SPG.parseMany(mini(m))[0];
  const rr = gg.events.filter(e => e.k === 'reroll');
  ok('omkast i spec-form («M (omkast #1): …») vert lese', rr.length === 1, JSON.stringify(gg.events.map(e => e.k)));
});
// gammal haleform: «2. M: II _ _ (omkast #1)»
const hale = [
  '[Event "mini2"]', '[Result "*"]', 'SPG-V1', '', '1. open: M(X _ _) K(_ _ _) -> M',
  '1. M: X _ _', '2. M: II _ _ (omkast #1)', '   X!', '   X->O2', ''
].join('\n');
ok('gammal haleform vert framleis lesen',
   SPG.parseMany(hale)[0].events.filter(e => e.k === 'reroll').length === 1);

// ---------- 3. rundtur for eit Nesseby-parti skrive av appen ----------
(function () {
  // deterministisk «tilfeldig» so testen gjev same svar kvar gong
  let s = 987654321;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const orig = Math.random;
  Math.random = rnd;
  const st = SS.newGame({ first: 0, nesseby: true });
  SS.openingRoll(st, rnd);
  let guard = 0;
  while (st.winner == null && guard++ < 400) {
    if (st.phase === 'roll') { SS.roll(st); st.phase = 'move'; continue; }
    const lm = SS.legalMoves(st, st.turn);
    if (!lm.length) { SS.passRemaining(st); continue; }
    SS.applyMove(st, lm[Math.floor(rnd() * lm.length)]);
    SS.settle(st);
  }
  Math.random = orig;
  const txt = SPG.toSPG(st, { event: 'Rundtur', comment: 'test' });
  ok('skrivaren merkjer Nesseby-parti med [Variant]', txt.indexOf('[Variant "Nesseby"]') >= 0);
  const back = SPG.parseMany(txt)[0];
  ok('lesaren tek [Variant] med seg', back.nesseby === true, back.nesseby);
  let rr = null;
  try { rr = SPG.toRecord(back, {}); } catch (e) { ok('Nesseby-parti spelar opp att', false, e.message); }
  if (rr) {
    ok('Nesseby-parti spelar opp att', true);
    ok('same sluttstilling etter rundtur',
       rr.fens[rr.fens.length - 1] === SS.toFEN(st),
       rr.fens[rr.fens.length - 1] + ' != ' + SS.toFEN(st));
    ok('Nesseby-flagget fylgjer med i posten', rr.nesseby === true);
  }
})();

// ---------- 4. vanleg parti utan Nesseby er uendra ----------
(function () {
  const st = SS.newGame({ first: 0 });
  const txt = SPG.toSPG(st, { event: 'Vanleg' });
  ok('vanleg parti får ingen [Variant]-tag', txt.indexOf('[Variant') < 0);
})();

console.log('spg_reimport: ' + pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
