// Arkiv-test: eit parti skal kunne lagrast, listast og spelast opp att NØYAKTIG.
// Avspelinga byggjer på FEN-augefrysing (éin FEN per endring), so kvart steg
// må gje nøyaktig den stillinga som vart spela.
//
//   node tests/archive.test.js
'use strict';
const path = require('path');
global.SS = require(path.join(__dirname, '..', 'js', 'engine.js'));
require(path.join(__dirname, '..', 'js', 'fen.js'));
const SS = global.SS;
global.localStorage = {
  store: {},
  getItem(k) { return Object.prototype.hasOwnProperty.call(this.store, k) ? this.store[k] : null; },
  setItem(k, v) { this.store[k] = String(v); },
  removeItem(k) { delete this.store[k]; }
};
require(path.join(__dirname, '..', 'js', 'archive.js'));
const ARCH = global.ARCH;

let pass = 0, fail = 0;
function ok(c, m) { if (c) pass++; else { fail++; console.log('FAIL: ' + m); } }
function rng(seed) { let s = seed >>> 0; return function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; }

function playRandom(seed) {
  const rnd = rng(seed);
  const st = SS.newGame({ first: 0 });
  const op = SS.openingRoll(st, rnd);
  st.turn = op.first;
  const fens = [SS.toFEN(st)];
  const push = () => { const f = SS.toFEN(st); if (fens[fens.length - 1] !== f) fens.push(f); };
  for (let guard = 0; guard < 800 && st.winner == null; guard++) {
    if (st.phase === 'roll') { SS.roll(st, rnd); st.phase = 'move'; push(); }
    const lm = SS.legalMoves(st, st.turn);
    if (!lm.length) {
      if (SS.canRerollX(st)) { SS.rerollX(st, rnd); st.phase = 'move'; push(); continue; }
      SS.passRemaining(st); SS.settle(st); push(); continue;
    }
    SS.applyMove(st, lm[Math.floor(rnd() * lm.length)]);
    SS.settle(st);
    push();
  }
  return { st, first: op.first, fens };
}

// ---- 1. tre parti: lagre, liste, spele opp att ----------------------------
let n = 0;
for (const seed of [11, 22, 33]) {
  const { st, first, fens } = playRandom(seed);
  const finalFen = SS.toFEN(st);
  ok(fens.length > 3, `seed ${seed}: fekk ${fens.length} stillingar`);
  const id = ARCH.save({ fens, first, plies: st.moves, mode: 'cpu',
                         result: st.winner === 0 ? '1-0' : (st.winner === 1 ? '0-1' : '*') });
  ok(!!id, `seed ${seed}: lagra`);
  const rec = ARCH.get(id);
  ok(rec.fens.length === fens.length, `seed ${seed}: henta att like mange stillingar`);
  ok(ARCH.totalMoves(rec) === fens.length - 1, `seed ${seed}: totalt trekk = stillingar-1`);
  const rep = ARCH.replay(rec, null);
  ok(SS.toFEN(rep.st) === finalFen, `seed ${seed}: sluttstillinga er identisk`);
  n++; n = n;   // (teljinga er uansett over alle tre)
}

// ---- 2. kvart steg må gje nøyaktig den lagra stillinga --------------------
{
  const rec = ARCH.list()[ARCH.list().length - 1];    // seed 11
  const total = ARCH.totalMoves(rec);
  ok(total > 4, 'nok trekk å bla i (' + total + ')');
  let mismatches = 0, distinct = new Set();
  for (let k = 0; k <= total; k++) {
    const f = SS.toFEN(ARCH.replay(rec, k).st);
    if (f !== rec.fens[k]) mismatches++;
    distinct.add(f);
  }
  ok(mismatches === 0, `alle ${total + 1} steg er eksakte (${mismatches} avvik)`);
  ok(distinct.size > 3, 'stillinga endrar seg gjennom partiet');
  // baklengs blaing gjev same stilling
  let backOk = true;
  for (let k = total; k >= 0; k -= 2) {
    if (SS.toFEN(ARCH.replay(rec, k).st) !== rec.fens[k]) backOk = false;
  }
  ok(backOk, 'framlengs og baklengs blaing gjev same stilling');
}

// ---- 3. sletting og tømming --------------------------------------------
{
  const before = ARCH.list().length;
  const id = ARCH.list()[0].id;
  ARCH.remove(id);
  ok(ARCH.list().length === before - 1, 'sletting fjernar éi rad');
  ok(ARCH.get(id) === null, 'sletta rad er borte');
  ARCH.clear();
  ok(ARCH.list().length === 0, 'tømming fjernar alt');
}

// ---- 4. dei lagra stillingane må kunne lesast att av FEN-parsaren -------
{
  const { fens } = playRandom(44);
  let bad = 0;
  fens.forEach(f => { try { SS.fromFEN(f); } catch (e) { bad++; } });
  ok(bad === 0, `alle ${fens.length} FEN-strengar lesast att (${bad} feil)`);
}

console.log(`ARKIV-TEST ${fail ? 'FEILA' : 'OK'}: ${pass} sjekkar, ${fail} feil`);
process.exit(fail ? 1 : 0);
