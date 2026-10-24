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
let op = SS.openingRoll();
ok(op.rolls[0].filter(d => d === 'X').length !== op.rolls[1].filter(d => d === 'X').length, 'åpning: ulikt antall X');
ok(op.first === 0 || op.first === 1, 'åpning velger førstespiller');

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

/* ---- kongen: kapring, deler ikke felt, rette trekk i 4 retninger ---- */
st = SS.newGame({ first: 0 });
let k = SS.king(st);
// fjern dronningene fra banen (stå hjemme på D2/L2 og blokkerer; testene
// stykker brettet selv):
SS.queen(st, 0).captured = true; SS.queen(st, 1).captured = true;
st.queenMode = false;
k.o = 0;   // P1 har kapret kongen og rører den
st.dice = ['II', 'II', 'II']; st.used = [false,false,false]; st.phase = 'move';
// kongen H2 (rad1, kol7). II: R: H2->I2->J2, L: H2->G2->F2. F: H3 stopp. B: H1 stopp.
let kMoves = SS.legalMoves(st, 0).filter(m => m.pid === k.id);
eq(kMoves.length, 2, 'kongen på H2 har nøyaktig R og L med II');
ok(kMoves.every(m => m.v === 2), 'II-trekk');
// dokumentets eksempel: B2 med II -> D2 (R) eller A3 (L: B2->A2->A3).
// A3 er P2s hjemrad: P2-soldaten som starter der (syklusstart 14) må bort:
SS.soldiers(st, 1).forEach(x => { if (x.at === SS.startT(1, 0)) x.captured = true; });
k.at = SS.idx(1, 1);      // B2
st.dice = ['II', 'II', 'II']; st.used = [false,false,false]; st.phase = 'move';
kMoves = SS.legalMoves(st, 0).filter(m => m.pid === k.id);
let landings = kMoves.map(m => SS.name(SS.pathFor(st, k, m.dir, 2).path[1])).sort();
eq(landings, ['D2', 'A3'].sort(), 'dok-eksemplet: B2 med II -> D2 eller A3');
// ulovlige II (per dokumentet): «1 opp + 1 ned» (tilbake til start),
// «1 opp + 1 sideveis» (L-form). Fra H2 med II: kun R og L — ingen
// landing på H3, H1, G3, I3, G1, I1:
k.at = SS.idx(7, 1);
st.dice = ['II', 'II', 'II']; st.used = [false,false,false]; st.phase = 'move';
kMoves = SS.legalMoves(st, 0).filter(m => m.pid === k.id);
var kLand = kMoves.map(m => SS.name(SS.pathFor(st, k, m.dir, 2).path[1]));
ok(!kLand.includes('H3') && !kLand.includes('H1'), 'ikke 2 loddrett fra H2');
ok(!kLand.includes('G3') && !kLand.includes('I3') && !kLand.includes('G1') && !kLand.includes('I1'), 'ikke L-formet 1-opp-1-side');
// hjørnet teller som «rett»: B2 -II-> A3 er dokumentert lovlig (venstre)
// A2: «opp» (F) finnes ikke (A2->A3 er venstre); R: B2->C2 lovlig:
k.at = SS.idx(0, 1);
st.dice = ['II', 'II', 'II']; st.used = [false,false,false]; st.phase = 'move';
kMoves = SS.legalMoves(st, 0).filter(m => m.pid === k.id);
ok(kMoves.length === 1 && kMoves[0].dir === 'R', 'fra A2 med II: kun R (B2->C2)');
// O1: R wrapper videre over i midtraden (O1->O2->O3): O3 er P2-hjørnefelt
// — P2-soldaten som starter der må bort:
SS.soldiers(st, 1).forEach(x => { if (SS.pt(SS.soldierAt(1, x.at)).col === 14 && SS.pt(SS.soldierAt(1, x.at)).row === 2) x.captured = true; });
k.at = SS.idx(14, 0);
st.dice = ['II', 'II', 'II']; st.used = [false,false,false]; st.phase = 'move';
kMoves = SS.legalMoves(st, 0).filter(m => m.pid === k.id && m.dir === 'R');
eq(kMoves.length, 1, 'fra O1: R II = O1->O2->O3 (hjørnet fortsetter rett)');
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
lm = SS.legalMoves(st, 0).filter(m => m.pid === k.id && (m.dir === 'F' || m.dir === 'B'));
eq(lm.length, 0, 'konge kan ikke gå 2 loddrett fra midtraden (muren)');
// étt loddrett med X: H3 (P2-hjem) og H1 (P1-hjem) må være tomme felt:
SS.soldiers(st, 1).forEach(x => { var b = SS.pt(SS.soldierAt(1, x.at)); if (b.col === 7 && b.row === 2) x.captured = true; });
SS.soldiers(st, 0).forEach(x => { if (x.at === 7 && !x.released) x.captured = true; });
st.dice = ['X', 'X', 'X']; st.used = [false,false,false]; st.phase = 'move';
lm = SS.legalMoves(st, 0).filter(m => m.pid === k.id && (m.dir === 'F' || m.dir === 'B') && m.kind === 'mv');
ok(lm.length === 2, 'konge kan gå 1 opp (F) og 1 ned (B) med X');

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
last.released = true; last.at = 29;   // P2 t29 = O2 (brettidx 15)
let f3 = null; SS.soldiers(st, 0).forEach(x => { if (!f3 || x.at > f3.at) f3 = x; });
f3.released = true; f3.at = 14;     // O1: P1 front; X -> O2
st.dice = ['X', 'X', '_']; st.used = [false,false,true]; st.phase = 'move';
lm = SS.legalMoves(st, 0).filter(m => m.pid === f3.id);
ok(lm.length >= 1, 'X-flytt mot siste fiendesoldat');
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
  let st = SS.newGame({ first: SS.openingRoll(rnd).first });
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

console.log('\n' + pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);