/* SnartSáhkku — testar av FLOKK-CPU-en (js/cpu.js, nivå 3)
 * Kvar av dei seks reglane får sin FEN-fikstur. Heilt deterministisk:
 * same stilling + same terningar = same trekk, så vi kan lesa trekket
 * FLOKK vel og slå det fast. Ingen pakkar, berre node. */
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

/* ============ regel 1: dronninga ikkje før 3 eigne mot 5+ fiendtlege ============ */
{
  // menn: 2 aktive (O2,N2), heime-dronning på L2; giera: 6 aktive på menns heimrekkje
  const r1 = {}; for (let c = 0; c < 6; c++) r1[c] = 'G';
  const st = pos({}, { 7: 'N', 11: 'q', 13: 'M', 14: 'M' }, r1, 'w', 'X23');
  const lm = SS.legalMoves(st, 0);
  const qid = SS.queen(st, 0).id;
  const qRel = lm.filter(m => m.pid === qid && m.kind === 'rel');
  ok(qRel.length > 0, 'r1: dronning-løysing er lovleg (testbar)');
  const mv = CPU.pick(st, 3);
  ok(mv && mv.pid !== qid, 'r1: FLOKK aktivere ikkje dronninga (2 aktive < 3, fiende 6 > 5) — valde ' + (mv ? mvName(st, mv) : 'ingen'));
  // hardt band: poenget til dronning-løysinga er under alt anna
  const sQ = CPU.flokk.score(st, qRel[0]);
  const sS = CPU.flokk.score(st, lm.find(m => m.pid !== qid));
  ok(sQ < sS - 1000, 'r1: dronning-løysing hardt straffa (' + sQ + ' << ' + sS + ')');
  // motsett: fienden berre 2 aktive → løysingja er tillaten (ikkje hardt band)
  const st2 = pos({}, { 7: 'N', 11: 'q', 13: 'M', 14: 'M' }, { 0: 'G', 1: 'G' }, 'w', 'X23');
  const lm2 = SS.legalMoves(st2, 0);
  const sQ2 = CPU.flokk.score(st2, lm2.find(m => m.pid === qid && m.kind === 'rel'));
  ok(sQ2 > -1000, 'r1: med berre 2 fiendtlege aktive er dronning-løysing ikkje bandlyst (' + sQ2 + ')');
}

/* ============ regel 2: jamn flokk — spreid framfor klistra ============ */
{
  // giera heimebrikker i live (ellers = utryddelse på alle trekk).
  // to aktive: J2 (t20) og F2 (t24); III: J2+3→G2 (gap 1 mot F2) vs F2+3→C2 (jamt)
  const st = pos({ 0: 'g', 1: 'g', 2: 'g', 3: 'g' }, { 5: 'M', 9: 'M' }, {}, 'w', '3__');
  const lm = SS.legalMoves(st, 0);
  ok(lm.length === 2, 'r2: to soldattrekk med III');
  const clump = lm.find(m => SS.piece(st, m.pid).at === 20);   // J2 -> G2: landar ved sidan av F2
  const spread = lm.find(m => SS.piece(st, m.pid).at === 24);  // F2 -> C2: jamn avstand
  const sC = CPU.flokk.score(st, clump), sS = CPU.flokk.score(st, spread);
  ok(sS > sC, 'r2: jamn flokk slår klistra (' + sS + ' > ' + sC + ')');
  const mv = CPU.pick(st, 3);
  ok(mv && mv.pid === spread.pid, 'r2: FLOKK går jamt — valde ' + mvName(st, mv));
  // 3–6-området: med 2 aktive + heimebrikker framme, løysing går framfor småsteg
  const st3 = pos({ 0: 'g', 1: 'g', 2: 'g', 3: 'g' }, { 5: 'M', 9: 'M' }, { 0: 'm', 1: 'm', 2: 'm' }, 'w', 'X__');
  const mv3 = CPU.pick(st3, 3);
  ok(mv3 && mv3.kind === 'rel', 'r2: berre 2 aktive → FLOKK løysjer soldat — valde ' + mvName(st3, mv3));
}

/* ============ regel 3: kapra konge slår berre med ≥5 avstand etter slag ============ */
{
  // NM på H2 (middelvegen). X: loddrett fram H2->H-topp slår G på H-topp.
  // Giera sine heimeståande soldatar står på col 12/13 — etter slaget er
  // avstanden 5/6 → slaget er lova (han kaprar berre med luft rundt seg).
  const stA = pos({ 12: 'g', 13: 'g', 7: 'G' }, { 7: 'NM', 2: 'M', 6: 'M' }, { 0: 'm', 1: 'm', 2: 'm' }, 'w', 'X__');
  const lmA = SS.legalMoves(stA, 0);
  const hit = lmA.find(m => SS.piece(stA, m.pid).t === 'k' && SS.moveDest(stA, m) === SS.idx(7, 2));
  ok(hit, 'r3: kongeslag H2->H3 er lovleg (testbar)');
  const sHit = CPU.flokk.score(stA, hit);
  ok(sHit > 0, 'r3: slag med 5 i avstand etterpå er fritt fram (' + sHit + ')');
  const mvA = CPU.pick(stA, 3);
  ok(mvA && hit && mvA.pid === hit.pid, 'r3: FLOKK slår med god avstand — valde ' + (mvA ? mvName(stA, mvA) : 'ingen'));

  // same, men tett av giera: G på I-topp (avstand 1 etter slaget) → hardt band
  const stB = pos({ 12: 'g', 13: 'g', 7: 'G', 8: 'G' }, { 7: 'NM', 2: 'M', 6: 'M' }, { 0: 'm', 1: 'm', 2: 'm' }, 'w', 'X__');
  const lmB = SS.legalMoves(stB, 0);
  const hitB = lmB.find(m => SS.piece(stB, m.pid).t === 'k' && SS.moveDest(stB, m) === SS.idx(7, 2));
  ok(hitB, 'r3: kongeslag H2->H3 (trengsel) er lovleg (testbar)');
  const sHitB = CPU.flokk.score(stB, hitB);
  ok(sHitB < -1000, 'r3: slag etterfølgt av 1 i avstand er hardt band (' + sHitB + ')');
  const mvB = CPU.pick(stB, 3);
  ok(mvB && SS.piece(stB, mvB.pid).t !== 'k', 'r3: FLOKK tek ikkje konge-slag i trengselen — valde ' + (mvB ? mvName(stB, mvB) : 'ingen'));
}

/* ============ regel 4: kongen blir heime; loddrett berre trygt ============ */
{
  // Kongen på A2 (midtre rad, kantlinja). Fiendedronninga 'D' (laus) står på
  // D3 (toppraden): syklusen hennar (side 1, toppraden O3→A3 = t0→t14) gjer
  // D3→A3 = 3 steg → A3 er i slagfeltet hennar. X: loddrett A2->A3 er lovleg,
  // men landing i dronningas felt = hardt band.
  const st = pos({ 3: 'D', 12: 'g' }, { 0: 'NM', 2: 'M', 6: 'M', 14: 'M' }, { 0: 'm', 1: 'm', 2: 'm' }, 'w', 'X__', 'A2');
  const lm = SS.legalMoves(st, 0);
  const kid = SS.king(st).id;
  ok(SS.pt(SS.atIdx(st, SS.king(st))).row === 1 && SS.pt(SS.atIdx(st, SS.king(st))).col === 0,
    'r4: kongen står på A2 (testbar føresetnad)');
  const kToA3 = lm.find(m => m.pid === kid && SS.moveDest(st, m) === SS.idx(0, 2));
  ok(kToA3, 'r4: loddrett A2->A3 er lovleg (testbar)');
  const sV = CPU.flokk.score(st, kToA3);
  ok(sV < -1000, 'r4: loddrett landing i dronningas slagfelt er hardt band (' + sV + ')');
  const mv = CPU.pick(st, 3);
  ok(mv && mv.pid !== kid, 'r4: kongen rører seg ikkje inn i faret — valde ' + (mv ? mvName(st, mv) : 'ingen'));
  // retreat: konge på A2 (midtre rad) som går NED til A1 — menn si heimrekkje
  // (rad 0) — skal telje positivt. Fiendebrikkene står langt unna.
  const st2 = pos({ 5: 'g', 6: 'g' }, { 0: 'NM', 2: 'M', 6: 'M' }, {}, 'w', 'X__', 'A2');
  const lm2 = SS.legalMoves(st2, 0);
  const kUp = lm2.find(m => m.pid === SS.king(st2).id && SS.moveDest(st2, m) === SS.idx(0, 0));
  ok(kUp, 'r4: loddrett A2->A1 er lovleg (testbar)');
  const sD = CPU.flokk.score(st2, kUp);
  ok(sD > 200, 'r4: retreat til heimrekkja tel positivt (' + sD + ')');
}

/* ============ regel 5: soldaten slår når rádet er for det ============ */
{
  // M på F2, åleine G på E2: X +1 slår. Andre soldatar har inge slag.
  const st = pos({}, { 3: 'M', 4: 'G', 5: 'M', 14: 'M' }, {}, 'w', 'X__');
  const lm = SS.legalMoves(st, 0);
  const cap = lm.find(m => SS.moveDest(st, m) === SS.idx(4, 1));
  ok(cap && SS.piece(st, cap.pid).at === 24, 'r5: F2->E2-slag er lovleg (testbar)');
  const mv = CPU.pick(st, 3);
  ok(mv && mv.pid === cap.pid && SS.moveDest(st, mv) === SS.idx(4, 1),
    'r5: FLOKK slær fiendebrikka — valde ' + (mv ? mvName(st, mv) : 'ingen'));
}

/* ============ regel 6: deterministisk ============ */
{
  const st = pos({ 3: 'G', 10: 'G' }, { 7: 'N', 11: 'q', 2: 'M', 6: 'M', 14: 'M' },
    { 0: 'm', 1: 'm', 2: 'm' }, 'w', 'X23');
  const a = CPU.pick(st, 3), b = CPU.pick(st, 3);
  ok(a && b && a.pid === b.pid && a.v === b.v && a.kind === b.kind && a.dir === b.dir,
    'r6: same stilling gjev same trekk (' + mvName(st, a) + ')');
  const fresh = SS.deserialize(SS.serialize(st));
  const c = CPU.pick(fresh, 3);
  ok(c && c.pid === a.pid, 'r6: trekket følgjer stillinga, ikkje minnet');
}

/* ============ gammal Klassisk CPU er uendra (nivå 1-2) ============ */
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
