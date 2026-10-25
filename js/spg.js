/* SPG — «Sáhkku Portable Game» — PGN-inspirert notasjon for sáhkku.
 * Det finst ingen etablert sáhkku-notasjon (verken Ludii, Wikipedia eller
 * regeldokumenta har definert ei), difor denne: tekstfil, éi linje per
 * kast, med terningkast (også X-omkast), flytt og landingseffekt.
 *
 *   [Event "Vossakapplangen 3. runde"]        PGN-style header
 *   [Date "2026.10.25"]
 *   [White "Menn (bieljet)"]
 *   [Black "Koner (giera)"]
 *   [Result "1-0"]                            1-0 M · 0-1 K · * uavgjort/ugjort
 *   [Termination "dronning"]
 *   SPG-V1
 *
 *   1. open: M(II _ X) K(_ _ X) -> M          # opningsritual: kappkast, vinnar M
 *   1. M: X II _                              # kvart kast: kastNr. side: terningar
 *      X->H2                                  #   X-løysning (fremste soldat)
 *   2. M: II III II
 *      II: K3->K5x [K5]                       #   x = fiende tatt, [felt] = fengsla
 *      III: Q1->Q3                             #   bokstav = II/III-lykkja (ledd)
 *   3. M: X _ X
 *      X!                                     #   X-omkast (alle X på éi gang)
 *      X->B1
 *   7. K: II II II
 *      II: k2->C3§                             #   § = kongen er teken på tårnet
 *
 * Bokstav: M=bielje (menn), K=giera (konar), Q=dronninga, k=kongen.
 * Felt: kolonne A–O, rekkje 1–3. Alle felt namngjevne frå Menn si side.
 */
'use strict';
(function (global) {
  var SS = global.SS || global.SahkkuCore;

  function diceStr(d) { return d.join(' '); }
  function letter(t, o) { return t === 's' ? (o === 0 ? 'M' : 'K') : t === 'q' ? 'Q' : 'k'; }

  function toSPG(st, meta) {
    meta = meta || {};
    var L = [];
    L.push('[Event "' + (meta.event || 'Sáhkku-parti') + '"]');
    L.push('[Date "' + (meta.date || new Date().toISOString().slice(0, 10)) + '"]');
    L.push('[White "' + (meta.white || 'Menn (bieljet)') + '"]');
    L.push('[Black "' + (meta.black || 'Koner (giera)') + '"]');
    L.push('[Result "' + (st.winner === 0 ? '1-0' : st.winner === 1 ? '0-1' : '*') + '"]');
    if (st.winReason) L.push('[Termination "' + st.winReason + '"]');
    L.push('SPG-V1');
    L.push('');
    var plyNo = 0;
    (st.log || []).forEach(function (ply) {
      if (ply.t === 'open') {
        ply.rolls.forEach(function (r, ix) {
          var last = ix === ply.rolls.length - 1;
          var x = function (d) { return d.filter(function (v) { return v === 'X'; }).length; };
          L.push('1. open' + (ply.rolls.length > 1 ? '#' + (ix + 1) : '') +
            ': M(' + diceStr(r.p0) + ') K(' + diceStr(r.p1) + ')' +
            (last ? ' -> ' + (x(r.p0) > x(r.p1) ? 'M' : 'K') : ''));
        });
        return;
      }
      var side = ply.t === 0 ? 'M' : 'K';
      ply.roll.forEach(function (d, ix) {
        plyNo++;
        L.push(plyNo + '. ' + side + (ix > 0 ? ' (omkast #' + ix + ')' : '') + ': ' + diceStr(d));
        if (ix > 0) L.push('   X!');
      });
      ply.mv.forEach(function (m) {
        var head = letter(m.t, m.o);
        var tail = m.kg ? '§' : (m.k > 0 ? 'x [' + (m.cap || []).join(',') + ']' : '');
        if (m.rel) L.push('   X->' + SS.sqName(m.to));
        else if (m.v === 'II' || m.v === 'III') L.push('   ' + m.v + ': ' + head + SS.sqName(m.from) + '->' + SS.sqName(m.to) + tail);
        else L.push('   ' + head + SS.sqName(m.from) + '->' + SS.sqName(m.to) + tail);
      });
    });
    if (st.winner !== null) L.push((st.winner === 0 ? '1-0' : '0-1') + ' {' + (st.winReason || '') + '}');
    return L.join('\n') + '\n';
  }

  global.SPG = { toSPG: toSPG };
})(typeof window !== 'undefined' ? window : globalThis);
