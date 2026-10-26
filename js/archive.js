// archive — kamparkiv med avspeling (lagre, laste, bla gjennom, slette, eksportere).
//
// Kvar avslutta parti vert lagra i localStorage på eit kompakt «steg»-format:
//   { id, ts, mode, engine, level, result, reason, plies, first,
//     steps: [ { t: side, rolls: [[fjes…], …], moves: [[fråIdx, tilIdx], …] } ],
//     spg: '<SPG 1.0-tekst>' }
// Eitt steg = éin tur: sida som spela, alle kasta i turen (kast + ev. omkast)
// og trekka i den rekkjefylgja dei vart spela. Det er nok til å spele partiet
// opp att nøyaktig — sjå tests/archive.test.js.
//
// API:  ARCH.save(rec) · ARCH.list() · ARCH.get(id) · ARCH.remove(id)
//       ARCH.clear() · ARCH.stepsFrom(st) · ARCH.replay(rec, n) · ARCH.findMove
(function (global) {
  'use strict';
  var KEY = 'sahkku.archive.v1';
  var MAX = 200;                       // hald arkivet lite; eldste fell ut

  function read() {
    try {
      var raw = global.localStorage.getItem(KEY);
      var a = raw ? JSON.parse(raw) : [];
      return Array.isArray(a) ? a : [];
    } catch (e) { return []; }
  }
  function write(a) {
    try { global.localStorage.setItem(KEY, JSON.stringify(a)); return true; }
    catch (e) { return false; }
  }

  function save(rec) {
    var a = read();
    rec.id = rec.id || (Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7));
    rec.ts = rec.ts || new Date().toISOString();
    a.unshift(rec);
    if (a.length > MAX) a.length = MAX;
    return write(a) ? rec.id : null;
  }
  function list() { return read(); }
  function get(id) { return read().filter(function (r) { return r.id === id; })[0] || null; }
  function remove(id) { return write(read().filter(function (r) { return r.id !== id; })); }
  function clear() { return write([]); }

  // ---- heile arkivet som éi fil (og inn att) ---------------------------
  function dumpAll() {
    return { v: 1, app: 'SnartSahkku', exported: new Date().toISOString(), games: read() };
  }

  // Tek imot ei fil frå dumpAll(), eit einskilt parti, eller ein array.
  // Postar med same id som alt ligg i arkivet vert hoppa over, so import
  // av same fil to gonger ikkje dupliserer noko.
  function importBundle(obj) {
    var games = (obj && obj.games) || (Array.isArray(obj) ? obj : null) ||
                (obj && (obj.steps || obj.fens) ? [obj] : null);
    if (!games || !games.length) return { added: 0, skipped: 0, error: 'fann ingen parti i fila' };
    var cur = read(), ids = {}, added = 0, skipped = 0;
    cur.forEach(function (g) { if (g && g.id) ids[g.id] = 1; });
    games.forEach(function (g) {
      if (!g || (!g.steps && !g.fens)) { skipped++; return; }
      var rec = JSON.parse(JSON.stringify(g));
      if (rec.id && ids[rec.id]) { skipped++; return; }
      rec.id = rec.id || (Date.now().toString(36) + Math.random().toString(36).slice(2, 7));
      ids[rec.id] = 1;
      cur.push(rec);
      added++;
    });
    cur.sort(function (a, b) { return String(b.ts || '').localeCompare(String(a.ts || '')); });
    if (cur.length > MAX) cur.length = MAX;
    write(cur);
    return { added: added, skipped: skipped };
  }

  // ---- frå levande spel: st.log  ->  steps ------------------------------
  // st.log er [{t, roll:[[fjes…], …], mv:[{from,to,…}], closed}, …]: éin ply
  // per tur, med sida `t`, alle kast i turen og trekka.
  function stepsFrom(st) {
    var log = (st && st.log) || [];
    var steps = [];
    log.forEach(function (ply) {
      var rolls = (ply.roll || []).map(function (r) { return r.slice(); });
      var moves = (ply.mv || [])
        .filter(function (e) { return e && typeof e.from === 'number' && typeof e.to === 'number'; })
        .map(function (e) { return [e.from, e.to, e.v, e.rel ? 1 : 0]; });
      if (!rolls.length && !moves.length) return;
      steps.push({ t: ply.t, rolls: rolls, moves: moves });
    });
    return steps;
  }

  function totalMoves(rec) {
    var fens = (rec && rec.fens) || [];
    if (fens.length > 1) return fens.length - 1;
    var n = 0;
    ((rec && rec.steps) || []).forEach(function (s) { n += (s.moves || []).length; });
    return n;
  }

  // ---- avspeling: bygg stillinga etter `upto` trekk ---------------------
  // Sida ligg i kvart steg (loggen veit kven som spela). Finst ikkje trekket
  // med gjeldande kast, prøver me neste kast i same steg — det er der eit
  // omkast har vore.
  function replay(rec, upto) {
    var SS = global.SS;
    // Føretrekt: FEN for kvar stilling — eksakt, ingen tolking på nytt.
    var fens = (rec && rec.fens) || [];
    if (fens.length > 1) {
      var last = fens.length - 1;
      var ix = (upto === undefined || upto === null) ? last : Math.max(0, Math.min(last, upto));
      return { st: SS.fromFEN(fens[ix]), total: last, at: ix };
    }
    var st = SS.newGame({ first: 0 });
    var steps = (rec && rec.steps) || [];
    var total = totalMoves(rec);
    var want = (upto === undefined || upto === null) ? total : Math.max(0, Math.min(total, upto));
    var done = 0;

    function setDice(faces) {
      st.phase = 'move';
      st.dice = (faces || []).slice();
      st.used = st.dice.map(function (d) { return d === '_'; });
      st.diceBy = st.turn;
    }

    for (var i = 0; i < steps.length && done < want; i++) {
      var s = steps[i];
      if (s.t != null) st.turn = s.t;
      else if (i === 0 && rec && rec.first != null) st.turn = rec.first;

      var rolls = (s.rolls && s.rolls.length) ? s.rolls : [[]];
      var ri = 0;
      setDice(rolls[0]);

      var moves = s.moves || [];
      for (var k = 0; k < moves.length && done < want; k++) {
        var mm = moves[k];
        // om terningen trekket trong ikkje finst lenger, har det vore omkast
        if (mm[2] != null && !hasDie(st, mm[2]) && ri + 1 < rolls.length) {
          ri++;
          setDice(rolls[ri]);
        }
        var mv = findMove(st, mm[0], mm[1], mm[2], mm[3]);
        while (!mv && ri + 1 < rolls.length) {
          ri++;
          setDice(rolls[ri]);
          mv = findMove(st, mm[0], mm[1], mm[2], mm[3]);
        }
        if (!mv) return { st: st, total: total, at: done, broken: true };
        SS.applyMove(st, mv);
        done++;
        if (st.winner != null) break;
        if (done < want) SS.settle(st);
      }
      if (st.winner != null) break;
    }
    return { st: st, total: total, at: done };
  }

  // trekket som går frå felt `from` til felt `to` i denne stillinga.
  // `v`/`rel` (om dei finst) skil to lovlege trekk som elles ser like ut —
  // t.d. same felt med ulikt terningfjes — so avspelinga vert eintydig.
  function findMove(st, from, to, v, rel) {
    var SS = global.SS;
    var lms = SS.legalMoves(st, st.turn), best = null;
    for (var i = 0; i < lms.length; i++) {
      var p = SS.piece(st, lms[i].pid);
      var f = p.t === 's' ? SS.soldierAt(p.o, p.at) : p.at;
      if (f !== from || SS.moveDest(st, lms[i]) !== to) continue;
      if (v == null) return lms[i];
      var isRel = lms[i].kind === 'rel' ? 1 : 0;
      if (lms[i].v === v && isRel === (rel || 0)) return lms[i];
      if (!best) best = lms[i];
    }
    return best;
  }

  // finst det ei ubrukt terning med dette fjeset?
  function hasDie(st, v) {
    var face = v === 1 ? 'X' : (v === 2 ? 'II' : 'III');
    for (var i = 0; i < st.dice.length; i++) {
      if (!st.used[i] && st.dice[i] === face) return true;
    }
    return false;
  }

  global.ARCH = {
    save: save, list: list, get: get, remove: remove, clear: clear,
    dumpAll: dumpAll, importBundle: importBundle,
    stepsFrom: stepsFrom, totalMoves: totalMoves, replay: replay,
    findMove: findMove, KEY: KEY
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
