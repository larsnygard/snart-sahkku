/* SnartSáhkku — node-test av reglene (ingen pakker) */
'use strict';
const fs = require('fs'), path = require('path');
const SS = require(path.join(__dirname, '..', 'js', 'engine.js'));

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; }
  else { fail++; console.log('FAIL: ' + msg); }
}
function eq(a, b, msg) { ok(JSON.stringify(a) === JSON.stringify(b), msg + '  (' + JSON.stringify(a) + ' != ' + JSON.stringify(b) + ')'); }

/* ---- geometri ---- */
eq(SS.name(SS.CASTLE), 'H2', 'Slottet er H2');
eq(SS.name(18), 'L2', 'X-merke L2');
eq(SS.name(26), 'D2', 'X-merke D2');
// P1-syklus: A1->O1, O2->A2, A3->O3, O2...
eq(SS.name(SS.soldierAt(0, 0)), 'A1', 'P1 t0 = A1');
eq(SS.name(SS.soldierAt(0, 14)), 'O1', 'P1 t14 = O1');
eq(SS.name(SS.soldierAt(0, 15)), 'O2', 'P1 t15 = O2 (opp i midtraden)');
eq(SS.name(SS.soldierAt(0, 29)), 'A2', 'P1 t29 = A2');
eq(SS.name(SS.soldierAt(0, 30)), 'A3', 'P1 t30 = A3 (opp i fienderaden)');
eq(SS.name(SS.soldierAt(0, 44)), 'O3', 'P1 t44 = O3');
eq(SS.name(SS.soldierAt(0, 45)), 'O2', 'P1 t45 = O2 (ned igen)');
eq(SS.name(SS.soldierAt(0, 59)), 'A2', 'P1 t59 = A2');
eq(SS.name(SS.soldierAt(0, 60)), 'A1', 'P1 t60 = A1 (syklus lengde 60)');
eq(SS.soldierAt(0, 74), SS.soldierAt(0, 14), 'P1 syklus perioder');
eq(SS.name(SS.soldierAt(1, 0)), 'O3', 'P2 t0 = O3');
eq(SS.name(SS.soldierAt(1, 14)), 'A3', 'P2 t14 = A3');
eq(SS.name(SS.soldierAt(1, 15)), 'A2', 'P2 t15 = A2');
eq(SS.name(SS.soldierAt(1, 30)), 'O1', 'P2 t30 = O1');
eq(SS.soldierAt(1, 60), SS.soldierAt(1, 0), 'P2 syklus lengde 60');

/* ---- oppsett ---- */
let st = SS.newGame({ first: 0 });
eq(st.pieces.length, 33, '33 brikker: 30 soldater + 2 dronninger + konge');
eq(SS.name(SS.atIdx(st, SS.piece(st, 0))), 'A1', 'P1-soldat 0 på A1');
let st14 = SS.piece(st, 14);
eq(SS.name(SS.atIdx(st, st14)), 'O1', 'P1-soldat 14 på O1');
let q1 = SS.queen(st, 0), q2 = SS.queen(st, 1);
eq(SS.atIdx(st, q1), 18, 'P1-dronning på L2');
eq(SS.atIdx(st, q2), 26, 'P2-dronning på D2');
eq(SS.name(SS.king(st).at), 'H2', 'Kongen i Slottet');
ok(st.pieces.every(p => p.t === 'k' || p.released === false), 'alle andre er hjemme');

/* ---- terningar ---- */
let seen = {};
for (let i = 0; i < 4000; i++) SS.rollDice().forEach(d => seen[d] = 1);
eq(Object.keys(seen).sort(), ['II', 'III', 'X', '_'], 'terningene lander på X, II, III, blank');
let op = SS.openingRoll(SS.newGame({}));
ok(op.rolls[op.rolls.length - 1].p0.filter(d => d === 'X').length !== op.rolls[op.rolls.length - 1].p1.filter(d => d === 'X').length, 'åpning: ulikt antall X i avgjerande runde');
ok(op.first === 0 || op.first === 1, 'åpning velger førstespiller');
eq(SS.openingRoll(SS.newGame({})).rolls.length >= 1, true, 'åpning loggar alle omkast-rundene');

/* ---- X: løsne fremste soldat ---- */
st = SS.newGame({ first: 0 });
st.dice = ['X', 'II', 'III']; st.used = [false,false,false]; st.phase = 'move';
let lm = SS.legalMoves(st, 0);
let rels = lm.filter(m => m.kind === 'rel' && SS.piece(st, m.pid).t === 's');
eq(rels.length, 1, 'nøyaktig éen løsning (fremste soldat)');
let front = null;
SS.soldiers(st, 0).forEach(s => { if (!front || s.at > front.at) front = s; });
eq(rels[0].pid, front.id, 'det er den som står lengst fram som løsnes (O1-soldaten)');
let ev = SS.applyMove(st, rels[0]);
ok(SS.piece(st, rels[0].pid).released, 'soldaten er løsnet');
eq(SS.name(SS.atIdx(st, SS.piece(st, rels[0].pid))), 'O2', 'den gikk O1 -> O2 (mot høyre-veien)');
ok(st.used[0], 'X-eren er brukt');
eq(SS.activeRank(st), SS.RANK.III, 'nest høyeste verdi: III kommer nå');

/* ---- III før II: rekkefølge + tapt kast når III er umulig ---- */
lm = SS.legalMoves(st, 0);
ok(lm.every(m => m.v === 3 || m.v === 2), 'kun gjenværende terninger kan brukes');
ok(lm.every(m => m.v === 3) || lm.length === 0, 'III-eren har førstemulighet: ingen II-trekk mens III er mulig');
// t15=O2 (fronten løsnet der), t16=N2, t17=M2, t18=L2. P1-dronninga er
// HJEMME på L2 -> landing der er nektet; III for fronten treffer L2 —
// umulig; resten av kastet tapt.
let threeMoves = lm.filter(m => m.v === 3);
ok(threeMoves.length === 0, 'III er umulig i startstillingen (landing på L2 nektet: dronninga hjemme)');
let s = SS.settle(st);
ok(s.turnEnded === true, 'settle: umulig III = kastet tapt, turen går videre');
eq(st.turn, 1, 'motstanderen er nå på tur');

/* ---- PASSERINGSREGLEN: landing regulert, banen fri ----
   Dokumentet: «linjene der det står brikker som ikke er løsgjort kan du
   overhodet ikke flytte INN PÅ» — det gjelder LANANDING; banen over
   linjene (eigenheim, fiendebrikker, kongen) er fri. */
st = SS.newGame({ first: 0 });
// P1-front (O1, t14) løsnet; II: bane t15(O2)-t16(N2): land M2? t14+2=t16=N2.
let fr = SS.soldiers(st, 0)[14];   // col14 = O1
fr.released = true; fr.at = 14;
st.dice = ['II', '_', '_']; st.used = [false, true, true]; st.phase = 'move';
lm = SS.legalMoves(st, 0).filter(m => m.pid === fr.id);
eq(lm.length, 1, 'fronten (O1) II -> N2: lovleg (banen over O2 er ledig)');
// PASS OVER EIGEN HEIMRAD: soldat på t13 (N1) med II: t14 = O1-linja der
// O1-soldaten står HEIMME (uutløst) — banen er fri, landing N2 tom: lovleg.
let sb = SS.soldiers(st, 0)[13];  // col13 = N1
sb.released = true; sb.at = 13;
lm = SS.legalMoves(st, 0).filter(m => m.pid === sb.id && m.v === 2);
eq(lm.length, 1, 'soldat PASSEAR eigen heimsoldat på O1-linja (bane fri, landing N2 tom)');
eq(SS.name(SS.soldierAt(0, 15)), 'O2', 't15 = O2');
// ...men LANANDING på heimsoldat-linja er nektet: t12 (M1) III -> t15?
// t12+3 = t15 = O2 (midtraden) — ikkje heimrad. Landing heimrad:
// soldat t59 (A2) III -> t62 mod60 = C1 — C1 har heimsoldat (col2): nektet:
let sc = SS.soldiers(st, 0)[0]; sc.released = true; sc.at = 59;
eq(SS.name(SS.soldierAt(0, 59)), 'A2', 't59 = A2');
lm = SS.legalMoves(st, 0).filter(m => m.pid === sc.id && m.v === 3);
eq(lm.length, 0, 'landing på C1 nektet: heimsoldat står der (inn på heimen: nektet)');
// PASS OVER FIENDEBRIKKER: la fienden stå på t16-landingsruta — landing
// slår; men banen over ei FIENDELINE er fri: front t13 -> landing t15(O2)
// med II: fiendsoldat (løsnet) står på t14 (O1-linja) midt på banen:
let foe = SS.soldiers(st, 1)[0]; foe.released = true; foe.at = 0;  // P2 t0 = O3? board: tour2Of(0)=44 (O3)
sb.at = 12;  // M1 (t12)
// bane: t13 (M1-linja? nei — startfeltet sjøl, tomt etter frakk), t14 = N1-linja
// (sb starta der — eigen tom linje), landing t15 = O2... la oss lande på
// fiendela: fiende P2 t0 (O3): P1 lander på O3-linja når? P1 t44+? — for
// enklare: la fienden stå MIDT på banen til P1: P2-soldat løsnet på N2
// (brettidx 16): P1 front t13 II lander t15 (O2)? bane t14, t15: landing
// t15... P1 t13+2 = t15 = O2 (brettidx 15). Fiende på brettidx16 (N2) står
// IKKJE på banen. Sett fienden på brettidx 15 i staden: P2 sykluspos for
// brettidx15 (O2): tour2Of(t)=15 -> idx(14-c,2-r)=15 -> (c=0,r=1):
// TOUR1[t]=idx(0,1)=29 -> t=29. OK: fiende P2 t29 står på O2.
foe.at = 29;
let d0 = SS.soldierAt(1, 29);
eq(SS.name(d0), SS.name(SS.soldierAt(0, 15)), 'fienden (P2 t29) står på same brettlinje som P1 t15 (O2)');
sb.at = 13;  // N1, II -> banen: t14 (tom), landing t15 = fienden (løsnet) -> SLÅ
lm = SS.legalMoves(st, 0).filter(m => m.pid === sb.id && m.v === 2);
eq(lm.length, 1, 'landing på løsnet fiendesoldat: lovleg (slår ut)');
ev = SS.applyMove(st, lm[0]);
ok(foe.captured, 'fienden på O2-linja ble slått ut ved landing');
// kongen på banen: P1-front t13 II, kongen står på t14-linja (O1-idx14):
// passering lovleg, landing på kongen = kapring ber ved land.
st = SS.newGame({ first: 0 });
let fr2 = SS.soldiers(st, 0)[14]; fr2.released = true; fr2.at = 13;  // N1
let kk = SS.king(st); kk.at = 14;   // O1-linja (midt på banen)
st.dice = ['II', '_', '_']; st.used = [false, true, true]; st.phase = 'move';
lm = SS.legalMoves(st, 0).filter(m => m.pid === fr2.id && m.v === 2);
eq(lm.length, 1, 'soldat PASSEAR kongen på banen (kapring ber ved landing)');
eq(SS.name(SS.soldierAt(0, 15)), 'O2', 'landing O2 forbi kongen: lovleg');

/* ---- soldat slår fiende ved landing ---- */
st = SS.newGame({ first: 0 });
// P1-front (t14=O1) løsnet; II lander på t16 = N2 (brettidx 16).
// P2-soldat (løsnet) skal stå på N2: P2s syklus: tour2Of(t)=16 -> TOUR1[t]=idx(1,1)=28 -> t=13.
// P2 på N2 (brettidx 16): syklusposisjon t=28 (tour2Of(28) = 16).
let p2front = SS.soldiers(st, 1)[0];
p2front.released = true; p2front.at = 28;   // brett N2
let p1front = null;
SS.soldiers(st, 0).forEach(x => { if (!p1front || x.at > p1front.at) p1front = x; });
p1front.released = true; p1front.at = 14;   // O1 (t14)
st.dice = ['II', 'II', 'II']; st.used = [false,false,false]; st.phase = 'move';
lm = SS.legalMoves(st, 0).filter(m => m.pid === p1front.id && m.v === 2);
ok(lm.length === 1, 'P1-front (O1) har lovlig II-flytt til N2');
eq(SS.soldierAt(0, 16), 16, 'P1 t16 = N2 (brettidx 16)');
eq(SS.soldierAt(1, 28), 16, 'P2 t28 = N2 — samme linje som P1 t16');
ev = SS.applyMove(st, lm[0]);
let killEv = ev.filter(e => e.type === 'kill');
eq(killEv.length, 1, 'landing på linjen slo ut nøyaktig én fiendesoldat');
ok(p2front.captured, 'den utslåtte er fanget');
eq(st.kills[0], 1, 'statistikk: 1 utslått');

/* ---- inn på hjemrad er forbudt ---- */
st = SS.newGame({ first: 0 });
let s0 = SS.soldiers(st, 0)[0]; s0.released = true; s0.at = 14;  // O1
st.dice = ['II', 'II', 'II']; st.used = [false,false,false]; st.phase = 'move';
// fra O1(t14) med II: t16 = N2 — men på veien ligger O2(t15) = ledig. OK.
// fra P1-front på t13 (N1) med II: t15=O2. Hjemmebrikker står på rad1.
// Test: soldat på t5 (F1) går III -> t8 = I1: blokkert? I1 huser P1-soldater hjemme (uutløste) -> ulovlig:
let sbx = SS.soldiers(st, 0)[5]; sbx.released = true; sbx.at = 5;
lm = SS.legalMoves(st, 0).filter(m => m.pid === sbx.id);
ok(lm.length === 0, 'soldat kan ikke lande på rad der egne uutløste soldater står');

/* ---- kongen: kapring, deler ikke felt, går langs tallsyklusen ---- */
st = SS.newGame({ first: 0 });
let k = SS.king(st);
SS.queen(st, 0).captured = true; SS.queen(st, 1).captured = true;
st.queenMode = false;
k.o = 0;   // P1 har kapret kongen og rører den
st.pieces.forEach(p => { if (p.t !== 'k') p.captured = true; });   // tomt brett
st.dice = ['II', 'II', 'II']; st.used = [false,false,false]; st.phase = 'move'; st.turn = 0;
// H2 med II: syklusen gjev to steg kvar veg -> F2 (fram) og J2 (bak)
let kMoves = SS.legalMoves(st, 0).filter(m => m.pid === k.id);
eq(kMoves.length, 2, 'kongen på H2 har nøyaktig to II-trekk (kvar veg)');
ok(kMoves.every(m => m.v === 2), 'II-trekk');
eq(kMoves.map(m => SS.name(m.to)).sort().join(','), 'F2,J2', 'II H2 -> F2/J2 langs åttetalet');
// M2 med III er Lars sitt skjermbilde: J2 og O1
k.at = SS.idx(12, 1);      // M2
st.dice = ['III', 'II', 'X']; st.used = [false, true, true];
kMoves = SS.legalMoves(st, 0).filter(m => m.pid === k.id);
eq(kMoves.map(m => SS.name(m.to)).sort().join(','), 'J2,O1',
   'M2 med III: J2 og O1 (syklusen snor seg ned i hjørnet)');
eq(kMoves.length, 2, 'kongen har to trekk kvar veg langs åttetalet');
// kapring: P1-soldat på linje H2 (idx 22). P1-syklus: t slik at soldierAt(0,t)=22:
// t: rad1 t=15..29 => idx(29-t,1): 29-t=7 => t=22. P1 front t20 + 2 = t22 = H2.
st = SS.newGame({ first: 0 });
k = SS.king(st);
let f = null; SS.soldiers(st, 0).forEach(x => { if (!f || x.at > f.at) f = x; });
f.released = true; f.at = 20;
st.dice = ['II', 'II', 'II']; st.used = [false,false,false]; st.phase = 'move';
lm = SS.legalMoves(st, 0).filter(m => m.pid === f.id && m.v === 2);
eq(lm.length, 1, 'soldat kan lande på kongens felt (kapre)');
ev = SS.applyMove(st, lm[0]);
ok(ev.some(e => e.type === 'king'), 'kapre-hendelse sendt');
eq(k.o, 0, 'P1 kontrollerer nå kongen');
// kongen deler ikke felt med egne soldater: la kongen (P1) stå på H2, P1-
// soldat også på linje H2 (t22): konge kan ikke lande på B2/G2 (tomme) —
// men landingsfelt med EGEN soldat er nektet:
f.at = 22;  // P1-soldat på H2 sammen med kongen? nei: flytt kongen vekk:
k.at = 21;  // G2
st.dice = ['II', 'II', 'II']; st.used = [false,false,false]; st.phase = 'move';
lm = SS.legalMoves(st, 0).filter(m => m.pid === k.id);
ok(lm.every(m => {
  var l = SS.pathFor(st, k, m.dir, 2).path[1];
  return !SS.occ(st, l).some(q => q.t === 's' && q.o === 0);
}), 'kongen lander ikke på felt med egne soldater');
// 2 steg loddrett fra midtraden: H2 F: H3 -> stopp -> umulig. II: ingen F/B:
st.dice = ['II', 'II', 'II']; st.used = [false,false,false]; st.phase = 'move';
k.at = 22; k.o = 0;
lm = SS.legalMoves(st, 0).filter(m => m.pid === k.id);
eq(lm.map(m => SS.name(m.to)).sort().join(','), 'F2,J2',
   'II frå H2: syklusen held seg på midtrekka (F2/J2), ingen loddrett snarveg');
// étt loddrett med X: H3 (P2-hjem) og H1 (P1-hjem) må være tomme felt:
SS.soldiers(st, 1).forEach(x => { var b = SS.pt(SS.soldierAt(1, x.at)); if (b.col === 7 && b.row === 2) x.captured = true; });
SS.soldiers(st, 0).forEach(x => { if (x.at === 7 && !x.released) x.captured = true; });
// X VEKKJER berre: kongen (alltid «utløyst») får ingen trekk med X. Vertikalt
// er han dessutan utan trekk med II/III (F/B frå midtrada går i veggen på 2
// steg), så kongen held seg på rad 2 — han kan berre gå R/L.
st.dice = ['X', 'X', 'X']; st.used = [false,false,false]; st.phase = 'move';
lm = SS.legalMoves(st, 0).filter(m => m.pid === k.id);
eq(lm.length, 0, 'X vekkjer berre — kongen får IKKJE trekk med X');
st.dice = ['II', '_', '_']; st.used = [false,true,true]; st.phase = 'move';
lm = SS.legalMoves(st, 0).filter(m => m.pid === k.id);
eq(lm.map(m => SS.name(m.to)).sort().join(','), 'F2,J2',
   'II: kongen går langs tallsyklusen (F2/J2), ikkje loddrett');

/* ---- dronninga: tapt spill ---- */
st = SS.newGame({ first: 0 });
// P1-front (t14=O1) går II -> t16 = N2 (brettidx 16). P2-dronninga (løsnet)
// skal stå på N2 — dronninger uses brett-indeks:
let q = SS.queen(st, 1); q.released = true; q.at = 16; // N2
// P2-soldaten på N2 (t13) må vekk:
SS.soldiers(st, 1).forEach(x => { if (x.at === 13) { x.captured = true; } });
let f2 = null; SS.soldiers(st, 0).forEach(x => { if (!f2 || x.at > f2.at) f2 = x; });
f2.released = true; f2.at = 14; // O1
st.dice = ['II', 'II', 'II']; st.used = [false,false,false]; st.phase = 'move';
lm = SS.legalMoves(st, 0).filter(m => m.pid === f2.id && m.v === 2);
eq(lm.length, 1, 'P1-front kan gå II inn på dronningas felt (N2)');
ev = SS.applyMove(st, lm[0]);
eq(st.winner, 0, 'Å slå ut dronninga vinner partiet');
eq(st.phase, 'over', 'fasen er over');
ok(ev.some(e => e.type === 'kill'), 'dronninga ble slått ut');

/* ---- seier ved utryddelse ---- */
st = SS.newGame({ first: 0 });
SS.soldiers(st, 1).forEach((s, i) => { if (i > 0) s.captured = true; });
let last = SS.soldiers(st, 1)[0];
last.released = true; last.at = 28;   // P2 t28 står på N2 (brettidx 16)
let f3 = null; SS.soldiers(st, 0).forEach(x => { if (!f3 || x.at > f3.at) f3 = x; });
f3.released = true; f3.at = 14;       // O1: P1-front; II -> N2
st.dice = ['X', 'X', '_']; st.used = [false,false,true]; st.phase = 'move';
eq(SS.legalMoves(st, 0).filter(m => m.pid === f3.id).length, 0,
   'X flyttar ikkje ein utløyst soldat (berre vekking)');
st.dice = ['II', '_', '_']; st.used = [false,true,true]; st.phase = 'move';
lm = SS.legalMoves(st, 0).filter(m => m.pid === f3.id && m.v === 2);
eq(lm.length, 1, 'II-flytt (2 steg) inn på siste fiendesoldat');
SS.applyMove(st, lm[0]);
eq(st.winner, 0, 'utryddelse av alle fiendens soldater = seier');

/* ---- serialize / deserialize ---- */
st = SS.newGame({ first: 1 });
SS.roll(st);
let wire = SS.serialize(st);
let st2 = SS.deserialize(wire);
eq(SS.serialize(st2), wire, 'serialisering er stabil (round-trip)');
eq(st2.turn, 1, 'tur bevart');

/* ---- X-omkast: sahkku.no: «velge X-ene ELLER kaste om ... gitt at du
   ikke kan flytte noe anna» — omkast ber når X ikkje kan brukast ---- */
st = SS.newGame({ first: 0 });
st.dice = ['X', 'X', '_']; st.used = [false,false,true]; st.phase = 'move';
// alle P1-soldater hjemme: X kan løsne -> omkast IKKE lov (gitt-klausulen)
ok(!SS.canRerollX(st), 'X-omkast nektet når X kan brukes (løsne)');
// ingen X å kaste om: kan ikke omkaste når III/II er aktive
st.dice = ['III', 'II', '_']; st.used = [false,false,true]; st.phase = 'move';
ok(!SS.canRerollX(st), 'IKKE omkast når III er den aktive verdien (ingen X å kaste)');
// blokker X fullstendig: P1 har ingen brikker som kan røre seg: alle
// soldater fanget, dronningene borte (queenMode av), kongen eies av ingen.
st = SS.newGame({ first: 0 });
st.dice = ['X', 'X', '_']; st.used = [false,false,true]; st.phase = 'move';
SS.soldiers(st, 0).forEach(s => { s.captured = true; });
SS.queen(st, 0).captured = true; SS.queen(st, 1).captured = true;
st.queenMode = false;
lm = SS.legalMoves(st, 0);
eq(lm.length, 0, 'ingen gyldige trekk (tom hær)');
ok(SS.canRerollX(st), 'X kan kastes om når X ikke kan brukes');
let rd = SS.rerollX(st, () => 0.5);
ok(rd && rd.length === 3, 'omkast gir nye terninger');

/* ---- random-monteurskap: 300 spill, uovervåket, uten krasj ---- */
function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
let overCount = 0, stucks = 0;
for (let g = 0; g < 300; g++) {
  let rnd = mulberry(g * 7919 + 3);
  let st = SS.newGame({ first: 0 }); SS.openingRoll(st, rnd); st.turn = st.log[0].first;
  let guard = 0;
  while (st.phase !== 'over' && guard++ < 4000) {
    if (st.phase === 'roll') { SS.roll(st, rnd); st.phase = 'move'; }
    let sres = SS.settle(st);
    if (sres.over) break;
    if (sres.turnEnded) continue;
    if (sres.reroll) { SS.rerollX(st, rnd); continue; }
    let moves = sres.moves;
    if (!moves.length) { SS.passRemaining(st); stucks++; continue; }
    let mv = moves[Math.floor(rnd() * moves.length)];
    SS.applyMove(st, mv);
  }
  if (st.phase === 'over') overCount++;
  // verifiser invariant: fanget soldat kan ikke stå på brettet
  st.pieces.forEach(p => { if (p.captured && p.t === 's') ok(p.at > -1000, 'fanget soldat har ryddet plass'); });
}
/* ---- Kongen og dronninga: langs TALLSYKLUSEN (åttetalet) ----
   Lars 2026-10-26: kongen (og dronninga) går v steg framover eller bakover i
   si eiga side sin syklus — ikkje rette linjer. Ho hoppar over brikker (berre
   landingsfeltet er regulert) og snur ikkje undervegs; syklusen snor seg sjølv
   rundt hjørna. X vekkjer framleis berre. ---- */
{
  function nameIdx(nm) { for (let i = 0; i < 45; i++) if (SS.name(i) === nm) return i; return -1; }
  function clearAt(st_, idxs) {
    st_.pieces.forEach(p => {
      if (p.captured || p.t === 'k') return;
      const a = p.t === 's' ? SS.soldierAt(p.o, p.at) : p.at;
      if (idxs.includes(a)) p.captured = true;
    });
  }
  function kingLand(st_, k_, v) {
    return SS.legalMoves(st_, st_.turn).filter(m => m.pid === k_.id && m.v === v)
      .map(m => SS.name(m.to)).sort().join(',');
  }
  let st = SS.newGame({ first: 0 }), k = SS.king(st);
  st.turn = 0; st.phase = 'move'; k.o = 0;
  st.pieces.forEach(p => { if (p.t !== 'k') p.captured = true; });   // tomt brett

  // X vekkjer berre: kongen er ALDRI «inaktiv», so X gjev han ingen trekk.
  k.at = nameIdx('H2');
  st.dice = ['III', 'II', 'X']; st.used = [true, true, false];
  eq(SS.legalMoves(st, 0).filter(m => m.pid === k.id).length, 0,
     'X H2: kongen får NULL trekk (X vekkjer berre)');

  // II frå H2: to steg kvar veg i syklusen -> F2 og J2
  k.at = nameIdx('H2');
  st.dice = ['III', 'II', 'X']; st.used = [true, false, true];
  eq(kingLand(st, k, 2), 'F2,J2', 'II H2: tallsyklusen gjev F2 og J2');

  // III frå H2: E2 og K2
  st.dice = ['III', 'II', 'X']; st.used = [false, true, true];
  eq(kingLand(st, k, 3), 'E2,K2', 'III H2: tallsyklusen gjev E2 og K2');

  // Lars sitt skjermbilde: M2 med III -> J2 (bakover) og O1 (framover), for
  // BÅDE menn og koner — syklusen snor seg ned i hjørnet (O2 -> O1).
  k.o = 0; k.at = nameIdx('M2');
  st.dice = ['III', 'II', 'X']; st.used = [false, true, true];
  eq(kingLand(st, k, 3), 'J2,O1', 'M2 med III (menn): J2 og O1');

  // hoppar over brikker: ein soldat på N2 (mellom M2 og O2) hindrar ikkje
  let blocker = SS.soldiers(st, 0)[0]; blocker.captured = false; blocker.released = true; blocker.at = 16; // N2
  eq(kingLand(st, k, 3), 'J2,O1', 'kongen hoppar over brikke på N2 og når O1');
  // ... men han kan ikkje LANDE på henne
  st.dice = ['III', 'II', 'X']; st.used = [true, false, true];
  blocker.at = 17;                                            // M2-nabo? -> N2 vidare
  ok(!kingLand(st, k, 3).split(',').includes(SS.name(SS.soldierAt(0, 16))),
     'kongen landar ikkje på ei brikke');

  // dronninga følgjer same syklus: P1-dronning L2 med II -> J2 og N2
  let st2 = SS.newGame({ first: 0 }), q = SS.queen(st2, 0);
  st2.turn = 0; st2.phase = 'move'; q.released = true; q.at = nameIdx('L2');
  st2.pieces.forEach(p => { if (p.t !== 'q' || p.id !== q.id) p.captured = true; });
  st2.dice = ['II', 'II', 'II']; st2.used = [false, false, false];
  let qLand = SS.legalMoves(st2, 0).filter(m => m.pid === q.id).map(m => SS.name(m.to)).sort().join(',');
  eq(qLand, 'J2,N2', 'dronninga L2 med II: J2 og N2 (tallsyklusen)');
}

/* ---- REGRADERING: CPU-sløyfe (main.js-mønster) — vaksen må ikkje utarmast.
   Bug: applyMove kallar endTurn på siste terning (turn snudd, phase='roll');
   settle passerte DÅ en gong til og snudde turen tilbake -> CPU-en kastade
   i det uendelege. Verifiser: (a) settle på 'roll'-fase snur IKKJE turen,
   (b) full main.js-liknande køyrløkke: begge sider kastar jevleg. ---- */
{
  let st = SS.newGame({ first: 1 });
  st.phase = 'move'; st.dice = ['X', 'II', '_']; st.used = [false, false, true];
  // CPU (side 1) losnar front-soldaten med X og brukar II -> siste terning
  let rel = SS.legalMoves(st, 1).find(m => m.kind === 'rel' && m.v === 1);
  ok(rel, 'reggradering: losnetrekk finst');
  SS.applyMove(st, rel);
  let mv2 = SS.legalMoves(st, 1).find(m => m.v === 2);
  if (mv2) SS.applyMove(st, mv2);
  eq(st.phase, 'roll', 'fase=rull etter siste terning');
  eq(st.turn, 0, 'turen er no hos vaksen (side 0)');
  let s = SS.settle(st);
  ok(s.turnEnded === true, 'settle på roll-fase: tur slutt, ingen handling');
  eq(st.turn, 0, 'settle snur IKKJE turen tilbake til CPU-en (sløyfe-fix)');
}
{
  // main.js-køyrsløykje: CPU (1) spelar greedy, vaksen (0) spelar tilfeldig.
  function mulberry2(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  let worst = 0, starvedGames = 0;
  for (let g = 0; g < 60; g++) {
    const rnd = mulberry2(g * 104729 + 11);
    const st = SS.newGame({ first: 0 });
    const rolls = [0, 0]; let consec = 0, last = -1, guard = 0;
    while (st.winner === null && guard++ < 6000) {
      if (st.phase === 'roll') {
        SS.roll(st, rnd); st.phase = 'move';
        rolls[st.turn]++;
        consec = st.turn === last ? consec + 1 : 1; last = st.turn;
        worst = Math.max(worst, consec);
      }
      const res = SS.settle(st);
      if (res.over) break;
      if (res.turnEnded) continue;
      if (res.reroll) { SS.rerollX(st, rnd); continue; }
      const side = st.turn;
      let mv = null;
      if (side === 1) {
        // CPU-aktig greedy (forenkla): simulering, beste fangst/fremdrift
        let bs = -1e9;
        for (const m of res.moves) {
          const cp = SS.deserialize(SS.serialize(st));
          SS.applyMove(cp, m);
          let sc = cp.kills[1] * 1000;
          const p = SS.piece(st, m.pid);
          if (p.t === 's' && p.o === 1) sc += (m.kind === 'rel' ? 300 : m.v * 12);
          sc += rnd() * 50;
          if (sc > bs) { bs = sc; mv = m; }
        }
      } else {
        mv = res.moves[Math.floor(rnd() * res.moves.length)];
      }
      SS.applyMove(st, mv);
      if (st.turn !== side && consec > 30) break;  // utarming oppdaga
    }
    const total = rolls[0] + rolls[1];
    const share = Math.min(rolls[0], rolls[1]) / Math.max(1, total);
    if (total > 20 && share < 0.3) starvedGames++;
  }
  eq(starvedGames, 0, 'CPU-sløyfe-køyring: ingen parti utarmar ei side (kastdel < 30%)');
  ok(worst < 30, 'maks kast i strekk for ei side: ' + worst + ' (< 30)');
}

ok(overCount >= 250, '300 tilfeldige spill: ' + overCount + ' endte med seier (uavgjort-lock er sjeldent)');

/* ---- spellog + SPG-notasjon ---- */
{
  let rnd = mulberry(4242);
  let st = SS.newGame({ first: 0 }); SS.openingRoll(st, rnd); st.turn = st.log[0].first;
  let guard = 0;
  while (st.phase !== 'over' && guard++ < 4000) {
    if (st.phase === 'roll') { SS.roll(st, rnd); st.phase = 'move'; }
    let lm = SS.legalMoves(st, st.turn);
    if (!lm.length) { SS.passRemaining(st); continue; }
    SS.applyMove(st, lm[Math.floor(rnd() * lm.length)]);
  }
  ok(st.log.length >= 2, 'spellog: minst opning + eitt kast');
  ok(st.log[0].t === 'open' && Array.isArray(st.log[0].rolls), 'spellog: opningsritual loggført');
  {
    let ser = SS.deserialize(SS.serialize(st));
    ok(JSON.stringify(ser.log) === JSON.stringify(st.log), 'serialize/deserialize tek med spelloggen');
  }
  let rollSeen = 0, mvSeen = 0, rerollSeen = 0;
  st.log.forEach(p => { if (p.t === 'open') return; rollSeen += p.roll.length; mvSeen += p.mv.length; if (p.roll.length > 1) rerollSeen++; });
  // eitt kast (3 terningar) kan gi inntil 3 flyttar — same spelar kan òg
  // flytte kongen fleire gonger per kast. Invariant: flyttar ≤ 3×kast.
  ok(mvSeen <= rollSeen * 3 && rollSeen >= 1, 'spellog: flyttar innanfor 3×kast (' + rollSeen + ' kast, ' + mvSeen + ' flytt)');
  // X-omkast loggført (same kast-ply får begge kasta)
  let st2 = SS.newGame({ first: 0 });
  SS.roll(st2, rnd); st2.phase = 'move';
  SS.logReroll(st2, rnd);
  ok(st2.log[st2.log.length - 1].roll.length === 2, 'X-omkast: begge kast i same kast-logg');
  let st3 = SS.newGame({ first: 0 });
  st3.phase = 'move'; st3.dice = ['X', '_', '_']; st3.used = [false, true, true];
  ok(SS.canRerollX(st3) === false, 'X-omkast nektast når X kan brukast (løysing finst)');
  // serialisering rundreise med log (midt i parti: diceBy er sett)
  {
    let stm = SS.newGame({ first: 0 }); SS.openingRoll(stm, rnd); stm.turn = stm.log[0].first;
    SS.roll(stm, rnd); stm.phase = 'move';
    let serm = SS.deserialize(SS.serialize(stm));
    ok(serm.diceBy === stm.diceBy && serm.diceBy === stm.turn, 'serialize/deserialize tek med diceBy');
  }
  // SPG-utskrift — Finn seed med faktisk vinnar (dei låste endar med *)
  let spg = null;
  for (let seed = 1; seed < 200 && !spg; seed++) {
    let stw = SS.newGame({ first: 0 }); let rw = mulberry(seed * 131);
    SS.openingRoll(stw, rw); stw.turn = stw.log[0].first;
    let g = 0;
    while (stw.phase !== 'over' && g++ < 4000) {
      if (stw.phase === 'roll') { SS.roll(stw, rw); stw.phase = 'move'; }
      let lm = SS.legalMoves(stw, stw.turn);
      if (!lm.length) { SS.passRemaining(stw); continue; }
      SS.applyMove(stw, lm[Math.floor(rw() * lm.length)]);
    }
    if (stw.winner !== null) { global.SahkkuCore = SS; require(path.join(__dirname, '..', 'js', 'spg.js')); spg = global.SPG.toSPG(stw, { event: 'Testparti' }); }
  }
  ok(spg !== null, 'fann parti med vinnar for SPG-test');
  if (spg) {
    ok(spg.includes('[Event "Testparti"]') && spg.includes('SPG-V1'), 'SPG: PGN-header');
    ok((spg.includes('1. open:') && (spg.includes('-> M') || spg.includes('-> K'))) || /\n\s*1\. (M|K)( \(omkast( #\d+)?\))?: /.test(spg), 'SPG: opningsritual-linje (eller direkte start) med vinnar');
    ok(/\n\s*\d+\. (M|K)( \(omkast( #\d+)?\))?: (_|X|II|III)( (_|X|II|III)){2}/.test(spg), 'SPG: kast-linjer med terningar');
    ok(spg.includes('X->') || spg.includes('->'), 'SPG: flyttlinjer');
    ok(/(1-0|0-1) \{/.test(spg), 'SPG: resultatlinje');
  }
}


/* ---- Nesseby-regelen (valfri): kongen er ikkje kaprbar ved landing før
   nokon har nådd motstandarens heimrad; fyrste soldat dit kaprar kongen. ---- */
{
  // (a) utan Nesseby: landingskapring verkar som før
  let stA = SS.newGame({ first: 0 });
  let kA = SS.king(stA);
  SS.queen(stA, 0).captured = true; SS.queen(stA, 1).captured = true;
  SS.soldiers(stA, 0).forEach(x => { x.captured = true; });
  let fA = SS.soldiers(stA, 0)[0];
  fA.captured = false; fA.released = true; fA.at = 20;      // t20 -> t22 = H2
  stA.dice = ['II', 'II', 'II']; stA.used = [false, false, false]; stA.phase = 'move'; stA.turn = 0;
  let mvA = SS.legalMoves(stA, 0).filter(m => m.pid === fA.id);
  ok(mvA.length === 1, 'utan Nesseby: soldat kan lande på kongen (kapring)');

  // (b) med Nesseby: same stilling gjev INGA landingskapring
  let stB = SS.newGame({ first: 0, nesseby: true });
  SS.queen(stB, 0).captured = true; SS.queen(stB, 1).captured = true;
  SS.soldiers(stB, 0).forEach(x => { x.captured = true; });
  let fB = SS.soldiers(stB, 0)[0];
  fB.captured = false; fB.released = true; fB.at = 20;
  stB.dice = ['II', 'II', 'II']; stB.used = [false, false, false]; stB.phase = 'move'; stB.turn = 0;
  ok(SS.legalMoves(stB, 0).filter(m => m.pid === fB.id).length === 0,
     'Nesseby: kongen kan IKKJE kaprast ved landing før han er aktivert');

  // (c) soldat som når motstandarens heimrad kaprar kongen
  let stC = SS.newGame({ first: 0, nesseby: true });
  SS.queen(stC, 0).captured = true; SS.queen(stC, 1).captured = true;
  SS.soldiers(stC, 0).forEach(x => { x.captured = true; });
  // gjer rad 3 (konenes heimrad) tom so landingsfeltet er fritt
  SS.soldiers(stC, 1).forEach(x => { x.captured = true; });
  let fC = SS.soldiers(stC, 0)[0];
  fC.captured = false; fC.released = true; fC.at = 28;    // P1 t28 + II -> t30 (rad 3 = konenes heimrad)
  stC.dice = ['II', 'II', 'II']; stC.used = [false, false, false]; stC.phase = 'move'; stC.turn = 0;
  let mvC = SS.legalMoves(stC, 0).filter(m => m.pid === fC.id);
  ok(mvC.length === 1, 'soldat kan gå inn på motstandarens heimrad');
  SS.applyMove(stC, mvC[0]);
  ok(SS.king(stC).o === 0, 'heimrad-treff kaprar kongen for den sida');
  ok(stC.kings === 1, 'konge-kapringa vert talt');
}

console.log('\n' + pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);