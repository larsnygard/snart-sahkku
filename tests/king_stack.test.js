// Kongestabel i JS-dommaren: konge + kapslande soldat, og kven som elles slepp inn.
//
// Same femtilfelle som tests/test_king_stack.py i sahkku-ai. Dommaren i appen
// må gjere det same som Python-porten, elles spelar spelarane etter andre
// reglar enn netta er trena på.
//
// Køyr:  node tests/king_stack.test.js
global.SS = require('../js/engine.js');
require('../js/fen.js');
const SS = global.SS;

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) pass++; else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' :: ' + extra : '')); }
};

// syklusindeks for eit felt (cycleIndex er ikkje eksportert)
function cyc(side, sq) {
  for (let t = 0; t < 60; t++) if (SS.soldierAt(side, t) === sq) return t;
  return -1;
}

const KING = 22;   // H2, slottet

function base(kingOwner, capturerSide) {
  const st = SS.newGame({ first: 0, queenMode: true });
  st.phase = 'move'; st.turn = 0;
  const k = SS.king(st); k.o = kingOwner === undefined ? null : kingOwner; k.at = KING;
  [0, 1].forEach(side => SS.soldiers(st, side).forEach(s => { s.captured = true; }));
  if (capturerSide !== undefined && capturerSide !== null) {
    const c = SS.soldiers(st, capturerSide)[0];
    c.captured = false; c.released = true; c.at = cyc(capturerSide, KING);
  }
  return st;
}

function putSoldier(st, side, fromSq) {
  const s = SS.soldiers(st, side).find(x => x.captured);
  s.captured = false; s.released = true; s.at = cyc(side, fromSq);
  st.turn = side; st.dice = ['III', '_', '_']; st.used = [false, true, true]; st.phase = 'move';
  return s;
}

function landingsOnKing(st, side) {
  return SS.legalMoves(st, side).filter(m => m.kind !== 'rel' && SS.moveDest(st, m) === KING);
}

// 1. kapsel: konge utan eigar, soldat landar pa han
let didCapture = false;
for (const back of [1, 2, 3]) {
  const st = base(null);
  putSoldier(st, 0, SS.soldierAt(0, cyc(0, KING) - back));
  const hits = landingsOnKing(st, 0);
  if (hits.length) {
    SS.applyMove(st, hits[0]);
    const occ = SS.occ(st, KING).map(q => q.t);
    ok('kapsel: kongen får eigar', SS.king(st).o === 0, String(SS.king(st).o));
    ok('kapsel: konge + soldat deler feltet', occ.length === 2 && occ.includes('k') && occ.includes('s'), JSON.stringify(occ));
    didCapture = true;
    break;
  }
}
ok('fann ein kapsel å prøve', didCapture);

// 2. eigen soldat kjem ikkje inn på eigen konge
for (const back of [1, 2, 3]) {
  const st = base(0);
  putSoldier(st, 0, SS.soldierAt(0, cyc(0, KING) - back));
  ok(`eigen soldat (${back} steg) vert stoppa`, landingsOnKing(st, 0).length === 0);
}

// 3. tredje soldat kjem ikkje inn på konge + kapslar
for (const back of [1, 2, 3]) {
  const st = base(0, 0);
  putSoldier(st, 0, SS.soldierAt(0, cyc(0, KING) - back));
  ok(`tredje soldat (${back} steg) vert stoppa`, landingsOnKing(st, 0).length === 0);
}

// 4. fienden kan ta kongen att
let recaptured = false;
for (const back of [1, 2, 3]) {
  const st = base(0, 0);
  putSoldier(st, 1, SS.soldierAt(1, cyc(1, KING) - back));
  const hits = landingsOnKing(st, 1);
  if (hits.length) {
    SS.applyMove(st, hits[0]);
    const occ = SS.occ(st, KING).map(q => q.t);
    ok('fienden kaprar kongen att', SS.king(st).o === 1, String(SS.king(st).o));
    ok('etter omkapsling: éin soldat med kongen',
       occ.filter(t => t === 's').length === 1, JSON.stringify(occ));
    recaptured = true;
    break;
  }
}
ok('fann eit motkapsel å prøve', recaptured);

// 5. kapslaren kan gå bort
{
  const st = base(0, 0);
  const c = SS.pieces ? null : null;
  const cap = st.pieces.find(p => p.t === 's' && !p.captured && p.o === 0);
  st.turn = 0; st.dice = ['III', '_', '_']; st.used = [false, true, true]; st.phase = 'move';
  const mv = SS.legalMoves(st, 0).filter(m => m.pid === cap.id);
  ok('kapslaren kan flytte seg', mv.length > 0, String(mv.length));
  if (mv.length) {
    SS.applyMove(st, mv[0]);
    ok('kongen står att åleine', SS.occ(st, KING).map(q => q.t).join(',') === 'k',
       SS.occ(st, KING).map(q => q.t).join(','));
  }
}

// 6. dronninga kan heller ikkje lande på EIGEN konge
{
  const st = SS.newGame({ first: 0, queenMode: true });
  st.phase = 'move'; st.turn = 0;
  SS.soldiers(st, 0).forEach(s => { s.captured = true; });
  SS.soldiers(st, 1).forEach(s => { s.captured = true; });
  const k = SS.king(st); k.o = 0; k.at = KING;
  const q = SS.queen(st, 0); q.captured = false; q.released = true;
  let tried = 0, anyLanding = false;
  for (let back = 1; back <= 3; back++) {
    // legg dronninga `back` steg bak kongen i eigen syklus
    const sq = SS.soldierAt(0, cyc(0, KING) - back);
    q.at = sq;
    for (const dice of [['X', '_', '_'], ['II', '_', '_'], ['III', '_', '_']]) {
      st.dice = dice.slice(); st.used = [false, true, true]; st.phase = 'move';
      if (SS.legalMoves(st, 0).some(m => m.pid === q.id && SS.moveDest(st, m) === KING)) {
        anyLanding = true;
      }
      tried++;
    }
  }
  ok('dronninga kan ikkje lande på eigen konge', !anyLanding, `prøvde ${tried} kombinasjonar`);
}

console.log('king_stack (JS): ' + pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
