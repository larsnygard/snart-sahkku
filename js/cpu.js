// SnartSáhkku — CPU: FLOKK, deterministisk regelstyrt spelar
//
// Bygd 2026-11-02 på alt lært i AIL/NAIS-treninga (sjå ../sahkku-ai:
// straffar-proben, Nesseby-analysen, paritetstestane). FLOKK spelar utan
// tilfeldige tal: same stilling + same terningar = same trekk, kvar gong.
//
// Dei seks reglane (Lars 2026-11-02):
//  1. Dronninga vert IKKJE aktivert når mi saldatstyrke < 3 OG fienden
//     har meir enn 5 aktive.
//  2. Hald 3–6 soldatar aktive, og gå dei fram som ein JAMN FLOKK: jamn
//     avstand i tallsyklusen, ikkje klistra i hop, ikkje kløyvd i to hoper.
//  3. Kapra kongen: trekk han attende, og bruk han til slag berre når han
//     ETTER slaget har minst 5 i avstand til nærmaste fiendtsoldat.
//  4. Kongen held seg heime på heimrekkja i sikkerheit; slår loddrett
//     berre når landingsfeltet er trygt.
//  5. Soldatar slår fiendebrikker når rádet er for det.
//  6. Heilt deterministisk: ingen kast, inga støy — fyrste beste trekk i
//     lovlige-rekkjefylgje vinn.
//
// Nivå i CPU.pick(st, level):
//   1 = tilfeldig (gamal «Lett»-reserve)
//   2 = gamal greedy-poieng med litt støy (gamal «Litt hardere», uendra)
//   3 = FLOKK (ny, deterministisk — «Tøff»)
(function (global) {
  'use strict';
  var SS = global.SS;

  // ---------- hjelparar ----------
  function activeSoldiers(st, o) {
    return SS.soldiers(st, o).filter(function (p) { return p.released && !p.captured; });
  }
  var HARD = 200000;   // hard regel: skal ikkje brytast når noko anna står att

  // avstand på brettet: kolonna wrapar rundt (15 breitt), raden gjer det ikkje
  function dist(a, b) {
    var pa = SS.pt(a), pb = SS.pt(b);
    var dc = Math.abs(pa.col - pb.col); if (dc > 7) dc = 15 - dc;
    return dc + Math.abs(pa.row - pb.row);
  }
  function homeRow(o) { return o === 0 ? 0 : 2; }   // heimrekkjer: menn (side 0) rad 0 (botn), giera (side 1) rad 2 (topp)

  // Kva felt kan fienden lande på neste tur? (trusselssona)
  // Soldatar: berre FRAMOVER 1..3 i si eiga syklus (soldatar går ikkje baklengs).
  // Dronning/konge: langs syklusen ±1..3, loddrett 1..3 steg.
  function threatZone(st, me) {
    var set = {}, foe = 1 - me, i, k;
    for (i = 0; i < st.pieces.length; i++) {
      var p = st.pieces[i];
      if (p.captured || p.o === me) continue;
      if (p.t === 's') {
        if (!p.released) continue;
        for (k = 1; k <= 3; k++) set[SS.soldierAt(p.o, p.at + k)] = true;
      } else if (p.t === 'q' && p.released) {
        var tq = cycleIndexOf(p.o, p.at);
        if (tq >= 0) for (k = 1; k <= 3; k++) {
          set[SS.soldierAt(p.o, tq + k)] = true;
          set[SS.soldierAt(p.o, tq - k)] = true;
        }
        for (k = 1; k <= 3; k++) {
          var f = pathAlong(p.at, 'F', k); if (f >= 0) set[f] = true;
          var b = pathAlong(p.at, 'B', k); if (b >= 0) set[b] = true;
        }
      } else if (p.t === 'k' && p.o === foe) {
        var tk = cycleIndexOf(foe, p.at);
        if (tk >= 0) for (k = 1; k <= 3; k++) {
          set[SS.soldierAt(foe, tk + k)] = true;
          set[SS.soldierAt(foe, tk - k)] = true;
        }
        for (k = 1; k <= 3; k++) {
          var f2 = pathAlong(p.at, 'F', k); if (f2 >= 0) set[f2] = true;
          var b2 = pathAlong(p.at, 'B', k); if (b2 >= 0) set[b2] = true;
        }
      }
    }
    return set;
  }
  // syklusindeks for konge/dronning-felt (fyrste pass), -1 utanfor
  var CYC = [];
  function cycleIndexOf(pl, sq) {
    var m = CYC[pl];
    if (!m) {
      m = CYC[pl] = {};
      for (var t = 0; t < 60; t++) { var s = SS.soldierAt(pl, t); if (m[s] === undefined) m[s] = t; }
    }
    return m[sq] === undefined ? -1 : m[sq];
  }
  // konge/dronning-geometri: feltet av n loddrette steg frå sq ('F' opp/'B' ned)
  function pathAlong(sq, dir, n) {
    var cur = sq, i, c, r;
    for (i = 0; i < n; i++) {
      c = SS.pt(cur).col; r = SS.pt(cur).row;
      if (dir === 'F') {
        if (r === 0) cur = SS.idx(c, 1);
        else if (r === 1) cur = SS.idx(c, 2);
        else return -1;
      } else {
        if (r === 2) cur = SS.idx(c, 1);
        else if (r === 1) cur = SS.idx(c, 0);
        else return -1;
      }
    }
    return cur;
  }
  // Tryggleik for kongen: land han i slagavstand (<5) til nokon fiendesoldat,
  // eller i slagfeltet til fiendedronninga (hennar syklus ±3 / loddrett ±3)?
  // Berre desse to tel — flokken sin landingssone er ikkje kongefare.
  function kingSafe(st, sq, me) {
    var foe = 1 - me, i, k;
    for (i = 0; i < st.pieces.length; i++) {
      var f = st.pieces[i];
      if (f.captured || f.o === me || f.t !== 's') continue;
      var d = dist(sq, SS.atIdx(st, f));
      if (d < 5) return false;
    }
    var fq = SS.queen(st, foe);
    if (fq && fq.released) {
      var tq = cycleIndexOf(fq.o, fq.at);
      if (tq >= 0) for (k = 1; k <= 3; k++) {
        if (SS.soldierAt(fq.o, tq + k) === sq || SS.soldierAt(fq.o, tq - k) === sq) return false;
      }
      for (k = 1; k <= 3; k++) {
        if (pathAlong(fq.at, 'F', k) === sq || pathAlong(fq.at, 'B', k) === sq) return false;
      }
    }
    return true;
  }
  // jamn flokk: poeng på syklusavstandane mellom dei aktive soldatane.
  // Heimen (t ≥ 60) er ein eigen stabel — han tel ikkje med i flokkjamnen.
  // Jamn avstand = alle gapa mellom min 2 og max 60/n (flokkens naturlege steg).
  function flockEvenness(st, me) {
    var act = activeSoldiers(st, me).filter(function (x) { return x.at < 60; }), s = 0, i;
    if (act.length < 2) return 0;
    var n = act.length, maxGap = 60 / n;
    var ts = act.map(function (x) { return SS.mod(x.at, 60); })
                .sort(function (a, b) { return a - b; });
    var gaps = [];
    for (i = 1; i < ts.length; i++) gaps.push(ts[i] - ts[i - 1]);
    gaps.push(60 - ts[ts.length - 1] + ts[0]);
    for (i = 0; i < gaps.length; i++) {
      if (gaps[i] < 2) s -= 150;              // klistra i hop: lette å slå attom
      else if (gaps[i] > maxGap) s -= 25;     // kløyvd: flokken heng ikkje i hop
    }
    return s;
  }

  // ---------- FLOKK-poieng ----------
  // Hard regel (±HARD) = skal regelbunden brytast nokon gong. Mjuk
  // preferanse (±300-åra) = kvar vi går fram når reglane ikkje seier noko.
  // Trekket vert køyrd på ein kopi; poiengtet reknast på STILLINGA ETTER.
  function flokkScore(st, mv) {
    var me = st.turn, foe = 1 - me;
    var p = SS.piece(st, mv.pid);
    var copy = SS.deserialize(SS.serialize(st));
    var ev = SS.applyMove(copy, mv);
    var s = 0, i, landSq;

    if (copy.winner === me) return 1000000;

    var myActNow = activeSoldiers(st, me).length;     // FØR trekket
    var foeAct = activeSoldiers(st, foe).length;
    var thr = threatZone(st, me);                     // fienden sin landingsradius NO
    landSq = SS.moveDest(st, mv);                     // landingsfeltet for alle trekk

    // ---- regel 1: dronninga kem ikkje tidleg ----
    if (p.t === 'q' && mv.kind === 'rel') {
      if (myActNow < 3 && foeAct > 5) s -= HARD;
      else s += 120;                                  // seint løp: rett investering
    }

    // ---- regel 5: soldaten slår når rádet er for det ----
    for (i = 0; i < ev.length; i++) {
      var e = ev[i];
      if (e.type === 'kill') {
        var q = SS.piece(copy, e.pid);
        s += (p.t === 's') ? (q && q.t === 'q' ? 1200 : 900)
                           : (p.t === 'k' ? 800 : 950);
      }
      if (e.type === 'king') s += 1400;               // Nesseby: soldaten kaprar kongen
    }

    // ---- regel 3 + 4: kongen si rørsle ----
    if (p.t === 'k' && p.o === me) {
      var kk = SS.king(copy);
      landSq = SS.atIdx(copy, kk);
      var struck = false;
      for (i = 0; i < ev.length; i++) if (ev[i].type === 'kill' && ev[i].by === me) struck = true;
      if (struck) {
        // regel 3: kongen slår berre om han ETTER slaget har ≥ 5 i avstand
        // til nærmaste fiendsoldat (ikkje utsett for attmøte). Berre
        // soldatar og fiendedronninga tel — flokken sin sone er ikkje farleg.
        if (!kingSafe(copy, landSq, me)) s -= HARD;
      } else if (mv.kind === 'mv' && (mv.dir === 'F' || mv.dir === 'B') &&
                 !kingSafe(st, landSq, me)) {
        // regel 4: loddrett slag berre når landingsfeltet er trygt
        s -= HARD;
      }
      // regel 4: heime på heimrekkja er tryggast; trekke attende er framgang
      var rowBefore = SS.pt(SS.atIdx(st, p)).row, rowAfter = SS.pt(landSq).row;
      var hr = homeRow(me);
      if (rowAfter === hr) s += 300;
      if (Math.abs(rowAfter - hr) < Math.abs(rowBefore - hr)) s += 120;   // retreat
      if (rowAfter !== hr && rowBefore === hr) s -= 150;                  // går ut i banen
    }

    // ---- regel 2: 3–6 aktive, jamn flokk fram mot fienden ----
    var nAct = activeSoldiers(copy, me).length;
    if (nAct < 3) s -= (3 - nAct) * 60;
    if (nAct > 6) s -= (nAct - 6) * 40;
    if (p.t === 's') {
      landSq = SS.moveDest(st, mv);
      if (mv.kind === 'rel') s += (myActNow < 3 ? 150 : 60);   // rom i flokken: løys
      s += (mv.kind === 'rel' ? 1 : mv.v) * 15;                // framdrift i flokken
      if (p.released && thr[SS.atIdx(st, p)] && !thr[landSq]) s += 200;  // rømmer frå trusa felt
      if (p.released && thr[landSq]) s -= 250;                 // land i trusselssona
    }
    s += flockEvenness(copy, me);
    s -= flockEvenness(st, me);                                  // berre endringa tel

    // ---- eiga dronning: i spill, men ikkje åleine i faret ----
    var myQ = SS.queen(st, me);
    if (myQ) {
      if (!SS.queen(copy, me)) s -= 40000;                       // tapt: katastrofe
      if (p.t === 'q' && p.released) {
        if (thr[landSq] && nAct < 4) s -= 350;                   // treng flokken rundt seg
        s += 30;                                                 // ho skal vera i spel
      }
    }
    // eigen konge i landingsfaret til fienden etter trekket: utsett
    var kAfter = SS.king(copy);
    if (kAfter.o === me && thr[kAfter.at] && p.t !== 'k') s -= 350;
    // fienden sin konge i fare: jakta han ikkje heim (han er ein trofé)
    if (kAfter.o === foe && dist(SS.atIdx(st, SS.king(st)), kAfter.at) < 99) {
      // kongen til fienden står ledig — flokken kan gå mot han
      s += 20;
    }
    return s;
  }

  // FLOKK: deterministisk — fyrste beste i lovlige-rekkjefylgje vinn
  function flokkPick(st) {
    var lm = SS.legalMoves(st, st.turn);
    if (!lm.length) return null;
    var best = lm[0], bs = -Infinity;
    for (var i = 0; i < lm.length; i++) {
      var sc = flokkScore(st, lm[i]);
      if (sc > bs) { bs = sc; best = lm[i]; }
    }
    return best;
  }

  // ---------- gamal Klassisk-poieng (nivå 2, uendra adferd) ----------
  function scoreMove(st, mv, rnd) {
    var p = SS.piece(st, mv.pid), me = st.turn;
    var s = 0;
    var copy = SS.deserialize(SS.serialize(st));
    var ev = SS.applyMove(copy, mv);
    if (copy.winner === me) return 100000;
    for (var i = 0; i < ev.length; i++) {
      var e = ev[i];
      if (e.type === 'kill') {
        var q = SS.piece(copy, e.pid);
        s += (q && q.t === 'q') ? 50000 : 900;
      }
      if (e.type === 'king') s += 1400;
    }
    if (p.t === 's' && p.o === me) {
      var prog = SS.mod(p.at + (mv.kind === 'rel' ? 1 : mv.v), 75) - p.at;
      s += prog * 12;
      var foeQ = SS.queen(st, 1 - me);
      if (foeQ) {
        var here = SS.atIdx(st, p), dest = SS.soldierAt(me, p.at + (mv.kind === 'rel' ? 1 : mv.v));
        var fq = SS.atIdx(st, foeQ);
        var d1 = Math.min(Math.abs(SS.pt(here).col - SS.pt(fq).col), 15 - Math.abs(SS.pt(here).col - SS.pt(fq).col));
        var d2 = Math.min(Math.abs(SS.pt(dest).col - SS.pt(fq).col), 15 - Math.abs(SS.pt(dest).col - SS.pt(fq).col));
        s += (d1 - d2) * 30;
      }
      s += (p.released ? 0 : 260);
    }
    if (p.t === 'k' && p.o === me) s += 60;
    if (p.t === 'q' && p.o === me) {
      s += 120;
      var foeSold = SS.soldiers(st, 1 - me);
      for (var j = 0; j < foeSold.length; j++) {
        var f = foeSold[j];
        if (!f.released || f.captured) continue;
        for (var v = 1; v <= 3; v++) {
          if (SS.soldierAt(1 - me, f.at + v) === SS.moveDest(st, mv)) s -= 800;
        }
      }
    }
    var myQ = SS.queen(st, me);
    if (myQ) {
      var mqAfter = SS.queen(copy, me);
      if (!mqAfter) s -= 40000;
    }
    var k = SS.king(copy);
    if (k && k.o === me) {
      var foes = SS.soldiers(copy, 1 - me);
      for (var j2 = 0; j2 < foes.length; j2++) {
        var f2 = foes[j2];
        if (!f2.released || f2.captured) continue;
        var here2 = SS.pt(SS.atIdx(copy, k)), f2c = SS.pt(SS.atIdx(copy, f2));
        if (Math.abs(here2.col - f2c.col) <= 3 && here2.row !== (1 - me === 0 ? 0 : 2)) s -= 120;
      }
    }
    return s;
  }

  // vel g trekk: 1 = tilfeldig, 2 = gamal greedy + støy, 3 = FLOKK
  function pick(st, level, rnd) {
    rnd = rnd || Math.random;
    var lm = SS.legalMoves(st, st.turn);
    if (!lm.length) return null;
    var lv = level || 2;
    if (lv <= 1) return lm[Math.floor(rnd() * lm.length)];
    if (lv >= 3) return flokkPick(st);
    var best = [], bs = -Infinity;
    for (var i = 0; i < lm.length; i++) {
      var s = scoreMove(st, lm[i], rnd) + (rnd() - 0.5) * 250;
      if (s > bs) { bs = s; best = [lm[i]]; }
      else if (s === bs) best.push(lm[i]);
    }
    return best[Math.floor(rnd() * best.length)];
  }

  var CPU = { pick: pick, flokk: { pick: flokkPick, score: flokkScore, threatZone: threatZone } };
  global.CPU = CPU;
  if (typeof module !== 'undefined' && module.exports) module.exports = CPU;
})(typeof globalThis !== 'undefined' ? globalThis : this);
