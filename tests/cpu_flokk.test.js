/* SnartSáhkku — testar av FLOKK-CPU-en (js/cpu.js, nivå 3)
 * Kvar av dei sju reglane (Lars 2026-11-04) får sin FEN-fikstur:
 *   1. dronninga ikkje aktivert med >3 soldatar (aktive eller heime)
 *   2. X løyser soldatar til 6 er aktive
 *   3. ikkje setje soldatar på same felt
 *   4. hald flokken saman, gå fram som ein flokk
 *   5. soldaten slår alltid når han kan
 *   6. kongen attende til heimrekkja
 *   7. kongen slår berre når han kan attende til trygg grunn same tur
 * Heilt deterministisk: same stilling + same terningar = same trekk, så vi
 * kan lesa trekket FLOKK vel og slå det fast. Ingen pakkar, berre node. */
'use strict';
const path = require('path');
const SS = require(path.join(__dirname, '..', 'js', 'engine.js'));
require(path.join(__dirname, '..', 'js', 'fen.js'));
const CPU = require(path.join(__dirname, '..', 'js', 'cpu.js'));

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; }
  else { fail++; console.log('FAIL: ' + msg); }
}

// byggjer FEN: r3/r2/r1 = rekkjer (kol 0=A..14=O), konge-felt, terningar
function row(map) {
  const a = []; for (let c = 0; c < 15; c++) a.push(map[c] || '.');
  return a.join('-');
}
function pos(r3, r2, r1, side, dice, kingSq) {
  return SS.fromFEN([row(r3), row(r2), row(r1)].join('/') + ' ' + side + ' move ' +
    dice + ' 000 ' + (kingSq || 'H2') + ' 0:0 10 *');
}
function mvName(st, mv) {
  const p = SS.piece(st, mv.pid);
  const from = SS.sqName(SS.atIdx(st, p));
  const to = SS.sqName(SS.moveDest(st, mv));
  return p.t + ':' + p.id + ' ' + from + '->' + to + ' v=' + mv.v + ' ' + mv.kind;
}
// heimesoldatar mot utrydding (dei tel ikkje i trusselssona)
const gHome = { 0: 'g', 1: 'g', 2: 'g', 3: 'g' };

/* ===== regel 1: dronninga vert ikkje aktivert med >3 soldatar ===== */
{
  // 2 utløyste + 2 heime = 4 soldatar i live -> vekking forbode
  const st = pos(gHome, { 7: 'M', 13: 'M', 11: 'q' }, { 0: 'm', 1: 'm' }, 'w', 'X23');
  const lm = SS.legalMoves(st, 0);
  const qid = SS.queen(st, 0).id;
  const qRel = lm.filter(m => m.pid === qid && m.kind === 'rel');
  ok(qRel.length > 0, 'r1: dronning-løysing er lovleg (testbar)');
  const sQ = CPU.flokk.score(st, qRel[0]);
  ok(sQ < -1000, 'r1: løysing hardt straffa med 4 soldatar (' + sQ + ')');
  const mv = CPU.pick(st, 3);
  ok(mv && mv.pid !== qid, 'r1: FLOKK aktiverer ikkje dronninga — valde ' + (mv ? mvName(st, mv) : 'ingen'));

  // berre 3 soldatar i live -> løysing tillaten (ikkje hardt band)
  const st3 = pos(gHome, { 7: 'M', 13: 'M', 11: 'q' }, { 0: 'm' }, 'w', 'X23');
  const qRel3 = SS.legalMoves(st3, 0).filter(m => m.pid === qid && m.kind === 'rel');
  ok(qRel3.length > 0, 'r1: løysing lovleg også med 3 soldatar (testbar)');
  ok(CPU.flokk.score(st3, qRel3[0]) > -1000,
    'r1: med 3 soldatar er løysing ikkje bandlyst (' + CPU.flokk.score(st3, qRel3[0]) + ')');
}

/* ===== regel 2: X løyser soldatar til 6 er aktive ===== */
{
  // 2 aktive + heimebrikker: X skal LØYSE
  const st = pos(gHome, { 5: 'M', 9: 'M' }, { 0: 'm', 1: 'm' }, 'w', 'X__');
  const mv = CPU.pick(st, 3);
  ok(mv && mv.kind === 'rel', 'r2: med 2 aktive løyser FLOKK ein soldat — valde ' + (mv ? mvName(st, mv) : 'ingen'));

  // 6 aktive: løysing er ikkje lenger noko mål (X går til framdrift)
  const r2 = { 1: 'M', 4: 'M', 7: 'M', 10: 'M', 12: 'M', 13: 'M' };
  const st6 = pos(gHome, r2, { 0: 'm', 1: 'm' }, 'w', 'X__');
  const lm6 = SS.legalMoves(st6, 0);
  const rel6 = lm6.filter(m => m.kind === 'rel');
  const adv6 = lm6.filter(m => m.kind === 'mv');
  ok(rel6.length > 0 && adv6.length > 0, 'r2: både løysing og framdrift er lovlege (testbar)');
  const sRel = Math.max.apply(null, rel6.map(m => CPU.flokk.score(st6, m)));
  const sAdv = Math.max.apply(null, adv6.map(m => CPU.flokk.score(st6, m)));
  ok(sAdv > sRel, 'r2: med 6 aktive går framdrift framfor løysing (' + sAdv + ' > ' + sRel + ')');
}

/* ===== regel 3: ikkje setje soldatar på same felt ===== */
{
  // M på t20 (J2) og t23 (G2), III: 20+3=23 (stabling) mot 23+3=26 (fritt)
  const st = pos(gHome, { 9: 'M', 6: 'M' }, {}, 'w', '3__');
  const lm = SS.legalMoves(st, 0);
  const stack = lm.find(m => SS.piece(st, m.pid).at === 20);
  const free = lm.find(m => SS.piece(st, m.pid).at === 23);
  ok(stack && free, 'r3: stabling og fritt trekk er båe lovlege (testbar)');
  const sS = CPU.flokk.score(st, stack), sF = CPU.flokk.score(st, free);
  ok(sF > sS, 'r3: fritt felt slår stabling (' + sF + ' > ' + sS + ')');
  const mv = CPU.pick(st, 3);
  ok(mv && SS.piece(st, mv.pid).at === 23, 'r3: FLOKK stablar ikkje — valde ' + (mv ? mvName(st, mv) : 'ingen'));
}

/* ===== regel 4: hald flokken saman, gå fram som ein flokk ===== */
{
  // M på t20 (J2) og t30 (A3), III: 20->23 kryp mot flokken, 30->33 fjernar seg
  const st = pos({ 0: 'M', 12: 'g', 13: 'g' }, { 9: 'M' }, {}, 'w', '3__');
  const lm = SS.legalMoves(st, 0);
  const near = lm.find(m => SS.piece(st, m.pid).at === 20);
  const far = lm.find(m => SS.piece(st, m.pid).at === 30);
  ok(near && far, 'r4: båe soldattrekka er lovlege (testbar)');
  const sN = CPU.flokk.score(st, near), sF = CPU.flokk.score(st, far);
  ok(sN > sF, 'r4: tett på flokken slår å fjerna seg (' + sN + ' > ' + sF + ')');
  const mv = CPU.pick(st, 3);
  ok(mv && SS.piece(st, mv.pid).at === 20, 'r4: den bakarste går fyrst — valde ' + (mv ? mvName(st, mv) : 'ingen'));
}

/* ===== regel 5: soldaten slår ALLTID når han kan ===== */
{
  // M på D1 (3), G på E1 (4): X slår. Samstundes kan X løysa ein soldat.
  const st = pos(gHome, {}, { 3: 'M', 4: 'G', 0: 'm', 1: 'm' }, 'w', 'X__');
  const lm = SS.legalMoves(st, 0);
  const cap = lm.find(m => SS.moveDest(st, m) === SS.idx(4, 0));
  const rel = lm.find(m => m.kind === 'rel');
  ok(cap && rel, 'r5: både slag og løysing er lovlege (testbar)');
  const sC = CPU.flokk.score(st, cap), sR = CPU.flokk.score(st, rel);
  ok(sC > sR, 'r5: slaget slår løysinga (' + sC + ' > ' + sR + ')');
  const mv = CPU.pick(st, 3);
  ok(mv && SS.moveDest(st, mv) === SS.idx(4, 0), 'r5: FLOKK slår fiendebrikka — valde ' + (mv ? mvName(st, mv) : 'ingen'));
}

/* ===== regel 6: kongen attende til heimrekkja ===== */
{
  // konge A2 (midtrada): A2->A1 er attende, A2->A3 er ut i banen
  const st = pos({ 5: 'g', 6: 'g' }, { 0: 'NM', 2: 'M', 6: 'M' }, {}, 'w', 'X__', 'A2');
  const lm = SS.legalMoves(st, 0);
  const kid = SS.king(st).id;
  const back = lm.find(m => m.pid === kid && SS.moveDest(st, m) === SS.idx(0, 0));
  const fwd = lm.find(m => m.pid === kid && SS.moveDest(st, m) === SS.idx(0, 2));
  ok(back && fwd, 'r6: både attende og fram er lovlege (testbar)');
  ok(CPU.flokk.score(st, back) > CPU.flokk.score(st, fwd) + 1000,
    'r6: attende til heimrekkja slår fram (' + CPU.flokk.score(st, back) + ' > ' + CPU.flokk.score(st, fwd) + ')');
  const mv = CPU.pick(st, 3);
  ok(mv && mv.pid === kid && SS.moveDest(st, mv) === SS.idx(0, 0),
    'r6: FLOKK flyttar kongen attende — valde ' + (mv ? mvName(st, mv) : 'ingen'));
}

/* ===== regel 7: kongen slår berre når han kan attende same tur ===== */
{
  const mHome = { 0: 'm', 1: 'm', 2: 'm' };
  // Konge H2 slår G på H-topp. Utan ubrukt terning etter slaget: forbode.
  const stNo = pos({ 7: 'G', 12: 'g' }, { 7: 'NM', 2: 'M', 6: 'M' }, mHome, 'w', 'X__');
  const hitNo = SS.legalMoves(stNo, 0)
    .find(m => SS.piece(stNo, m.pid).t === 'k' && SS.moveDest(stNo, m) === SS.idx(7, 2));
  ok(hitNo, 'r7: kongeslag H2->H3 er lovleg (testbar)');
  ok(CPU.flokk.score(stNo, hitNo) < -1000,
    'r7: utan terning til retrett er slaget forbode (' + CPU.flokk.score(stNo, hitNo) + ')');

  // same slag, men '23' står att: retrett til H1 (v=2) er trygg -> tillate
  const stOk = pos({ 7: 'G', 12: 'g' }, { 7: 'NM', 2: 'M', 6: 'M' }, mHome, 'w', 'X23');
  const hitOk = SS.legalMoves(stOk, 0)
    .find(m => SS.piece(stOk, m.pid).t === 'k' && SS.moveDest(stOk, m) === SS.idx(7, 2));
  ok(hitOk, 'r7: kongeslag med terningar att er lovleg (testbar)');
  ok(CPU.flokk.score(stOk, hitOk) > -1000,
    'r7: med trygg retrett er slaget tillate (' + CPU.flokk.score(stOk, hitOk) + ')');

  // retrettfelta er dekte: fiende på K1 gjer H1 farleg -> forbode
  const stBad = pos({ 7: 'G', 12: 'g' }, { 7: 'NM', 2: 'M', 6: 'M' },
    { 10: 'G', 0: 'm', 1: 'm', 2: 'm' }, 'w', 'X23');
  const hitBad = SS.legalMoves(stBad, 0)
    .find(m => SS.piece(stBad, m.pid).t === 'k' && SS.moveDest(stBad, m) === SS.idx(7, 2));
  ok(hitBad, 'r7: kongeslag med dekt retrett er lovleg (testbar)');
  ok(CPU.flokk.score(stBad, hitBad) < -1000,
    'r7: dekt retrett = slaget forbode (' + CPU.flokk.score(stBad, hitBad) + ')');
}

/* ===== determinisme ===== */
{
  const st = pos({ 3: 'G', 10: 'G' }, { 7: 'N', 11: 'q', 2: 'M', 6: 'M', 14: 'M' },
    { 0: 'm', 1: 'm', 2: 'm' }, 'w', 'X23');
  const a = CPU.pick(st, 3), b = CPU.pick(st, 3);
  ok(a && b && a.pid === b.pid && a.v === b.v && a.kind === b.kind && a.dir === b.dir,
    'r8: same stilling gjev same trekk (' + mvName(st, a) + ')');
  const fresh = SS.deserialize(SS.serialize(st));
  const c = CPU.pick(fresh, 3);
  ok(c && c.pid === a.pid, 'r8: trekket følgjer stillinga, ikkje minnet');
}

/* ===== gammal Klassisk CPU er uendra (nivå 1-2) ===== */
{
  const st = pos({}, { 7: 'N', 11: 'q', 13: 'M', 14: 'M' },
    { 0: 'G', 1: 'G', 2: 'G', 3: 'G', 4: 'G', 5: 'G' }, 'w', 'X23');
  const lm = SS.legalMoves(st, 0);
  const ids = new Set();
  for (let i = 0; i < 30; i++) ids.add(CPU.pick(st, 1, Math.random).pid);
  ok(ids.size === new Set(lm.map(m => m.pid)).size, 'gammal nivå 1: tilfeldig among alle (uendra)');
  const l2 = CPU.pick(st, 2);
  ok(l2 && lm.some(m => m.pid === l2.pid), 'gammal nivå 2: lovleg trekk (uendra)');
}

console.log('cpu_flokk: ' + pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
