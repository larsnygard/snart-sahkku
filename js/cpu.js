// SnartSáhkku — CPU: punktbasert greedy med litt bredd
(function (global) {
  'use strict';
  var SS = global.SS;

  function scoreMove(st, mv) {
    var p = SS.piece(st, mv.pid), me = st.turn;
    var s = 0;
    // simulering: kopier og kjør
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
    // fremdrift: soldatens syklusposisjon (rundt 75-punkts løypa;
    // 15-29-45-59-74 = farlig for fienden)
    if (p.t === 's' && p.o === me) {
      var prog = SS.mod(p.at + (mv.kind === 'rel' ? 1 : mv.v), 75) - p.at;
      s += prog * 12;
      // trakk mot fiendens dronning:
      var foeQ = SS.queen(st, 1 - me);
      if (foeQ) {
        var here = SS.atIdx(st, p), dest = SS.soldierAt(me, p.at + (mv.kind === 'rel' ? 1 : mv.v));
        var fq = SS.atIdx(st, foeQ);
        var d1 = Math.min(Math.abs(SS.pt(here).col - SS.pt(fq).col), 15 - Math.abs(SS.pt(here).col - SS.pt(fq).col));
        var d2 = Math.min(Math.abs(SS.pt(dest).col - SS.pt(fq).col), 15 - Math.abs(SS.pt(dest).col - SS.pt(fq).col));
        s += (d1 - d2) * 30;
      }
      s += (p.released ? 0 : 260);   // løsne soldat: bra
    }
    if (p.t === 'k' && p.o === me) {
      // konge: styr unna fiendens rekkje for å true hjemraden
      s += 60;
    }
    if (p.t === 'q' && p.o === me) {
      s += 120;   // dronning: hold den i spill
      // ikke la dronningen lande i åpenangrep: sjekk at feltet trygt:
      var foeSold = SS.soldiers(st, 1 - me);
      for (var j = 0; j < foeSold.length; j++) {
        var f = foeSold[j];
        if (!f.released || f.captured) continue;
        for (var v = 1; v <= 3; v++) {
          if (SS.soldierAt(1 - me, f.at + v) === SS.pathFor(st, p, mv.dir, mv.v).path[SS.pathFor(st, p, mv.dir, mv.v).path.length - 1]) s -= 800;
        }
      }
    }
    // egen dronning i fare etter trekket? (fienden kan kapre)
    var myQ = SS.queen(st, me);
    if (myQ) {
      var mqAfter = SS.queen(copy, me);
      if (!mqAfter) s -= 40000;
    }
    // kongen min i fare (fienden kan kapre den): landes felt i nærheten av
    // fiendtlige soldaters landinger
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

  // velg trekk: level 1 = tilfeldig blant lovlig, 2 = greedy, 3 = greedy + støy
  function pick(st, level, rnd) {
    rnd = rnd || Math.random;
    var lm = SS.legalMoves(st, st.turn);
    if (!lm.length) return null;
    if (level <= 1) return lm[Math.floor(rnd() * lm.length)];
    var best = [], bs = -Infinity;
    for (var i = 0; i < lm.length; i++) {
      var s = scoreMove(st, lm[i]);
      if (level === 2) s += (rnd() - 0.5) * 250;      // litt uforutsigbarhet
      if (s > bs) { bs = s; best = [lm[i]]; }
      else if (s === bs) best.push(lm[i]);
    }
    return best[Math.floor(rnd() * best.length)];
  }
  var CPU = { pick: pick };
  global.CPU = CPU;
  if (typeof module !== 'undefined' && module.exports) module.exports = CPU;
})(typeof globalThis !== 'undefined' ? globalThis : this);
