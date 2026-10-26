/* SPG — «Sáhkku Portable Game» — PGN-inspirert notasjon for sáhkku.
 * Det finst ingen etablert sáhkku-notasjon (verken Ludii, Wikipedia eller
 * regeldokumenta har definert ei), difor denne: tekstfil, éi linje per
 * kast, med terningkast (også X-omkast), flytt og landingseffekt.
 * FULL SPESIFIKASJON: docs/SPG.md.
 *
 *   [Event "Kapplanginga 3. rundar"]        PGN-style header
 *   [Date "2026-10-25"]
 *   [White "Menn (bieljet)"]
 *   [Black "Koner (giera)"]
 *   [Result "1-0"]                            1-0 M · 0-1 K · * ugjort
 *   [Termination "dronning"]                  dronning/utryddelse/overgivelse
 *   SPG-V1
 *
 *   1. open: M(X X X) K(III III III) -> M   # opningsritual: kappkast, vinnar M
 *   1. M: II II III                         # kvart kast: kastNr. side: terningar
 *   2. K: X _ III                           # (omkast #n) markerer omkast-kast
 *      X->A2                                 #   X-løysning (mål-felt identifiserer brikka)
 *      III: QA2->F2                          #   II:/III: = terningsledd (X-ledd har ikje prefiks)
 *   3. M: III III III
 *      III: KA2->D2                          #   soldatar flyttar FRAMOVER i tallsyklusen
 *      III: KD2->G2                          #   same brikke, neste ledd
 *   8. K: X II _
 *      KG2->H2§                              #   § = kongen teken på tårnet (midtre rekkje)
 *      II: KH2->J2
 *   13. M: III III II
 *       II: QI2->G2x [Q]                     #   x = landing tok brikker, [felt+eigar / Q]
 *   1-0 {dronning}                           # sluttlinje: resultat {orsak}
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
    // SPG 1.1: sídene heiter Menn og Koner (ikkje White/Black). Namn på
    // forma «Etternamn, Fornamn». Ukjende namn: dei samiske side-namna
    // (olbmát = menn, gálgut = koner). Datamaskin: «(c) <motor>».
    L.push('[Menn "' + (meta.menn || meta.white || 'Olbmát') + '"]');
    L.push('[Koner "' + (meta.koner || meta.black || 'Gálgut') + '"]');
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
        // die prefix: II/III moves carry their face (m.v is NUMERIC: 1=X, 2, 3);
        // X-slot moves (v=1) and releases (X->) carry none
        var pre = (m.v === 2) ? 'II: ' : (m.v === 3) ? 'III: ' : '';
        if (m.rel) L.push('   X->' + SS.sqName(m.to));
        else L.push('   ' + pre + head + SS.sqName(m.from) + '->' + SS.sqName(m.to) + tail);
      });
    });
    if (st.winner !== null) L.push((st.winner === 0 ? '1-0' : '0-1') + ' {' + (st.winReason || '') + '}');
    return L.join('\n') + '\n';
  }

  global.SPG = { toSPG: toSPG };
})(typeof window !== 'undefined' ? window : globalThis);
