// SnartSáhkku — UI: brett-rendering + touch-kontrollere
(function (global) {
  'use strict';
  var SS = global.SS;
  var doc = global.document;
  var T = function (key, vars) { return global.I18N ? global.I18N.t(key, vars) : key; };

  var ui = {
    st: null,            // spilltilstand
    flip: false,         // brettet rotert (P2 ser sin rekke nede)
    sel: null,           // valgt brikke-id
    targets: [],         // [{mv, cellIdx}]
    interactive: true,   //false under CPU/nett-trekk
    onMove: null,        // callback(mv)
    onRoll: null,
    onReroll: null,
    onPass: null,
    onSurrender: null
  };

  var boardEl, diceEl, actionEl, turnEl, kingEl, logEl, label0, label1, wrapEl;
  function $(id) { return doc.getElementById(id); }
  function initEls() {
    boardEl = $('board'); actionEl = $('actionbox');
    turnEl = $('turn-indicator'); kingEl = $('king-chip'); logEl = $('log');
    label0 = $('label-p0'); label1 = $('label-p1'); wrapEl = $('boardwrap');
  }

  // ---------- rendering ----------
  function cellOrder() {
    // returner brettindekser i visningsrekkefølge: rad-oversikt
    // rad2 (øverst), rad1, rad0 — med kolonne-orientering per flip
    var rows = ui.flip ? [0, 1, 2] : [2, 1, 0];
    var out = [];
    rows.forEach(function (r) {
      var line = SS.rowLine(r); // indeks A..O for den raden
      if (r === 1) line = line.slice().reverse(); // indeksrekke A..O = 29..15; vis A..O:
      // for rad 1: brettindeks idx(col,1)=29-col; ønsket synlig venstre->høyre:
      // flip=false: P1-ser: A til venstre: vis kol 0..14 => indekser 29..15
      // flip=true : P2-ser (speil): kol 14..0 => indekser 15..29
      if (r === 1) {
        line = ui.flip ? [15,16,17,18,19,20,21,22,23,24,25,26,27,28,29]
                       : [29,28,27,26,25,24,23,22,21,20,19,18,17,16,15];
      } else {
        var cols = [];
        for (var c = 0; c < 15; c++) cols.push(c);
        if (ui.flip) cols.reverse();
        line = cols.map(function (cc) { return SS.idx(cc, r); });
      }
      out = out.concat(line);
    });
    return out;
  }

  function glyph(p) {
    if (p.t === 'k') return '♔';
    if (p.t === 'q') return p.o === 0 ? '♀' : '⚕';
    return p.o === 0 ? '♙' : '⚘';
  }
  function klassOf(p) {
    var k = 'piece ' + (p.o === 0 ? 'red' : 'blue');
    if (p.t === 'k') {
      k = 'piece king' + (p.o == null ? ' king-free' : (p.o === 0 ? ' king-p0' : ' king-p1'));
    }
    if (p.t === 'q') k += ' queen';
    if (SS.isHome(p)) k += ' home';
    return k;
  }

  // Skjermlesar-tekst for ei rute: kva som står der, ikkje berre «H2».
  function sideName(o) {
    return T(o === 0 ? 'a11y.sideMenn' : 'a11y.sideKoner');
  }
  function cellLabel(i, occ) {
    var sq = SS.name(i);
    if (!occ.length) return T('a11y.cellEmpty', { sq: sq });
    var king = occ.filter(function (p) { return p.t === 'k'; })[0];
    if (king) return T('a11y.cellKing', { sq: sq });
    var queen = occ.filter(function (p) { return p.t === 'q'; })[0];
    if (queen) return T('a11y.cellQueen', { sq: sq, side: sideName(queen.o) });
    var sol = occ.filter(function (p) { return p.t === 's'; });
    if (sol.length === 1) return T('a11y.cellSoldier', { sq: sq, side: sideName(sol[0].o) });
    return T('a11y.cellSoldiers', { sq: sq, n: sol.length, side: sideName(sol[0].o) });
  }

  function render() {
    var st = ui.st;
    if (!st || !boardEl) return;
    boardEl.innerHTML = '';
    var order = cellOrder();
    order.forEach(function (i) {
      var cell = doc.createElement('div');
      cell.className = 'cell';
      cell.dataset.idx = i;
      cell.setAttribute('role', 'gridcell');
      cell.setAttribute('tabindex', '-1');
      if (i === SS.CASTLE) cell.classList.add('castle');
      if (i === 18 || i === 26) cell.classList.add('xmark');
      var occ = SS.occ(st, i).filter(function (p) { return !p.captured; });
      if (occ.length) {
        if (occ.length === 1) {
          var p = occ[0];
          var el = doc.createElement('div');
          el.className = klassOf(p);
          el.dataset.pid = p.id;
          el.textContent = glyph(p);
          cell.appendChild(el);
        } else {
          var stack = doc.createElement('div');
          stack.className = 'stack';
          occ.forEach(function (q) {
            var e2 = doc.createElement('div');
            e2.className = klassOf(q);
            e2.dataset.pid = q.id;
            e2.textContent = glyph(q);
            stack.appendChild(e2);
          });
          cell.appendChild(stack);
        }
      }
      cell.setAttribute('aria-label', cellLabel(i, occ));
      cell.dataset.label = cell.getAttribute('aria-label');
      var lbl = doc.createElement('span');
      lbl.className = 'lbl';
      lbl.textContent = SS.name(i);
      cell.appendChild(lbl);
      var mk = doc.createElement('span');
      mk.className = 'mark';
      cell.appendChild(mk);
      boardEl.appendChild(cell);
    });
    paintTargets();
    paintChrome();
    // éi rute er tabbar inn til brettet; resten får fokus via piltastane
    if (!boardEl.querySelector('.cell[tabindex="0"]')) {
      var first = boardEl.querySelector('.cell');
      if (first) first.setAttribute('tabindex', '0');
    }
  }
  function paintTargets() { showTargets(); }

  // Fangstrader: kva kvar side har TEKE. Vi les brikkene (captured + eigar)
  // i staden for berre st.kills, so vi kan vise kva SLAG det var: prikkar for
  // soldatar, «♀/⚕» for fiendedronninga, «♔» om sida eig kongen.
  function renderCaptured(st) {
    if (!st) return;
    [0, 1].forEach(function (side) {
      var list = doc.getElementById('caplist-p' + side);
      var box = doc.getElementById('cap-p' + side);
      if (!list || !box) return;
      list.innerHTML = '';
      var soldiers = 0, gotQueen = false;
      st.pieces.forEach(function (p) {
        if (p.captured && p.o != null && p.o !== side) {
          if (p.t === 's') soldiers++;
          else if (p.t === 'q') gotQueen = true;
        }
      });
      var k = SS.king(st);
      var ownsKing = k && k.o === side;
      for (var i = 0; i < soldiers; i++) {
        var d = doc.createElement('span');
        d.className = 'capdot';
        list.appendChild(d);
      }
      if (gotQueen) {
        var q = doc.createElement('span');
        q.className = 'capq';
        q.textContent = '♀';
        q.title = T('ui.queenOutTitle');
        list.appendChild(q);
      }
      if (ownsKing) {
        var kk = doc.createElement('span');
        kk.className = 'capk';
        kk.textContent = '♔';
        kk.title = 'kongen er kapra';
        list.appendChild(kk);
      }
      if (!soldiers && !gotQueen && !ownsKing) {
        var none = doc.createElement('span');
        none.className = 'capnone';
        none.textContent = '–';
        list.appendChild(none);
      }
      box.title = T('ui.capturedTitle', {
        side: T(side === 0 ? 'side.Menn' : 'side.Koner'),
        n: soldiers,
        soldiers: T(soldiers === 1 ? 'piece.soldier' : 'piece.soldierPl'),
        queen: gotQueen ? T('ui.capturedQueen') : '',
        king: ownsKing ? T('ui.capturedKing') : ''
      });
    });
  }

  function paintChrome() {
    var st = ui.st;
    if (!st) return;
    turnEl.className = 'chip ' + (st.turn === 0 ? 'p0' : 'p1');
    turnEl.textContent = T('game.turn') + ' ' + T(st.turn === 0 ? 'side.mennOlmat' : 'side.konerGalgut');
    var k = SS.king(st);
    kingEl.className = 'chip ' + (k.o == null ? 'neutral' : (k.o === 0 ? 'p0' : 'p1'));
    kingEl.textContent = k.o == null ? T('game.kingFree')
      : T('ui.kingChipMine', { side: T(k.o === 0 ? 'side.Menn' : 'side.Koner') });
    label0.parentNode.classList.toggle('active-p0', st.turn === 0);
    label1.parentNode.classList.toggle('active-p1', st.turn === 1);
    renderDice();
    renderCaptured(st);
    renderActions();
  }

  function renderDice() {
    var st = ui.st;
    // to sett — eitt per spelar. Det aktive panelet har kast-knappen og
    // viser gjeldande terningar; det inaktive viser sist kast for si side.
    var by = [null, null];
    var log = st.log || [];
    for (var i = log.length - 1; i >= 0; i--) {
      var p = log[i];
      if (p.t === 'open' || p.t == null) continue;
      if (by[p.t] == null && p.roll && p.roll.length) by[p.t] = p.roll[p.roll.length - 1];
      if (by[0] != null && by[1] != null) break;
    }
    if (st.dice && st.dice.length) by[st.diceBy != null ? st.diceBy : st.turn] = st.dice;
    [0, 1].forEach(function (o) {
      var panel = doc.getElementById(o === 0 ? 'dice-p0' : 'dice-p1');
      var box = doc.getElementById(o === 0 ? 'dicebox-p0' : 'dicebox-p1');
      if (!panel || !box) return;
      panel.classList.toggle('active-dice', st.turn === o && st.winner == null);
      box.innerHTML = '';
      var isMineTurn = (st.turn === o) && st.winner == null;
      if (isMineTurn && st.phase === 'roll') {
        var b = doc.createElement('button');
        b.className = 'die roll';
        b.textContent = '🎲';
        b.id = 'die-roll';
        b.setAttribute('aria-label', T('a11y.roll'));
        b.title = 'Kast terningene';
        b.addEventListener('click', function () { if (ui.interactive && ui.onRoll) ui.onRoll(); });
        box.appendChild(b);
        return;
      }
      var d = by[o];
      if (!d) {
        var ph = doc.createElement('div');
        ph.className = 'die empty';
        ph.textContent = '·';
        ph.setAttribute('aria-hidden', 'true');
        box.appendChild(ph);
        return;
      }
      var isCurrent = (st.diceBy != null ? st.diceBy : st.turn) === o && st.phase === 'move' && !!st.dice.length;
      // Kan X kastast om? Gjer då terningane klikkbare — det er den mest
      // opplagde måten å kaste om på (Lars 2026-10-26).
      // Kvar X-terning er klikkbar for seg (Lars 2026-10-27): slår ein to X,
      // kastar ein om berre den eine. Difor ingen «kast om»-knapp lenger.
      var canRe = isCurrent && ui.interactive && SS.canRerollX(st);
      box.classList.toggle('rerollable', !!canRe);
      box.title = '';
      box.onclick = null;
      d.forEach(function (face, ix) {
        var el = doc.createElement('div');
        var used = isCurrent && st.used && st.used[ix];
        var solo = canRe && face === 'X' && !used;
        el.className = 'die' + (face === 'X' ? ' X' : '') + (solo ? ' rerollable' : '');
        if (used) el.classList.add('used');
        el.textContent = face === '_' ? '·' : face;
        el.setAttribute('role', 'img');
        el.setAttribute('aria-label', face === '_' ? T('a11y.dieBlank') : T('a11y.die', { face: face }));
        if (solo) {
          el.title = T('ui.xRerollTitle');
          el.onclick = function () { if (ui.onReroll) ui.onReroll(ix); };
        }
        box.appendChild(el);
      });
    });
  }

  function renderActions() {
    var st = ui.st;
    // Ingen «kast om»-knapp: X-ane vert kasta om ved å klikke på terningen
    // sjølv (og berre den eine, om ein slo fleire).
    var pb = doc.createElement('button');
    pb.id = 'btn-pass';
    pb.textContent = T('ui.pass');
    pb.style.display = 'none';
    pb.onclick = function () { if (ui.onPass) ui.onPass(); };
    actionEl.innerHTML = '';
    actionEl.appendChild(pb);
    if (st.phase === 'move' && ui.interactive) {
      var lm = SS.legalMoves(st, st.turn);
      // Inga lovleg trekk: omkast er VALFRITT (klikk på ein X-terning) —
      // «hopp over» let spelaren avslutte turen i staden.
      if (!lm.length) pb.style.display = '';
    }
  }

  function log(msg, cls) {
    if (!logEl) return;
    var line = doc.createElement('div');
    if (cls) line.className = cls;
    line.textContent = msg;
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
  }
  function clearLog() { if (logEl) logEl.innerHTML = ''; }

  function toast(msg) {
    var t = doc.querySelector('.toast');
    if (!t) {
      t = doc.createElement('div');
      t.className = 'toast';
      doc.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._h);
    t._h = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }

  // ---------- pekermarkeringer ----------
  function pieceCenter(pid) {
    var st = ui.st, p = SS.piece(st, pid);
    var i = SS.atIdx(st, p);
    var cell = boardEl.querySelector('[data-idx="' + i + '"]');
    if (!cell) return null;
    var el = cell.querySelector('[data-pid="' + pid + '"]') || cell;
    var r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, cell: cell };
  }

  function showTargets() {
    // fjern gamle
    boardEl.querySelectorAll('.cell.target, .cell.target-kill').forEach(function (c) {
      c.classList.remove('target', 'target-kill');
    });
    ui.targets.forEach(function (t) {
      var cell = boardEl.querySelector('[data-idx="' + t.cellIdx + '"]');
      if (!cell) return;
      cell.classList.add('target');
      cell.setAttribute('aria-label', (cell.dataset.label || '') + ', ' + T('a11y.target'));
      var occ = SS.occ(ui.st, t.cellIdx);
      var kill = occ.some(function (q) {
        return !q.captured && q.o !== ui.st.turn && (q.t === 's' || q.t === 'q');
      });
      if (kill) cell.classList.add('target-kill');
      cell.onclick = function (e) {
        e.stopPropagation();
        if (!ui.interactive) return;
        var mv = t.mv;
        clearSelection();
        if (ui.onMove) ui.onMove(mv);
      };
    });
  }

  function clearSelection() {
    ui.sel = null;
    ui.targets = [];
    boardEl.querySelectorAll('.piece.sel').forEach(function (el) { el.classList.remove('sel'); });
    boardEl.querySelectorAll('.cell.target, .cell.target-kill').forEach(function (c) {
      c.classList.remove('target', 'target-kill');
      c.onclick = null;
    });
  }

  function selectPiece(pid) {
    var st = ui.st;
    var p = SS.piece(st, pid);
    if (!p || p.captured) return;
    var lm = SS.legalMoves(st, st.turn).filter(function (m) { return m.pid === pid; });
    if (!lm.length) { toast(T('ui.cannotMove')); return; }
    ui.sel = pid;
    ui.targets = lm.map(function (m) {
      var dest;
      if (p.t === 's') dest = SS.soldierAt(p.o, p.at + m.v);
      else if (m.to !== undefined && m.to !== null) dest = m.to;
      else {
        var res = SS.pathFor(st, p, m.dir, m.v);
        dest = res.path[res.path.length - 1];
      }
      return { mv: m, cellIdx: dest };
    });
    var center = pieceCenter(pid);
    if (center) center.cell.querySelectorAll('[data-pid="' + pid + '"]').forEach(function (el) { el.classList.add('sel'); });
    showTargets();
  }

  // Tastatur: piltastane flyttar fokus til ruta som ligg nærast i den retninga
  // (uavhengig av spegelvending), Enter/romklaff spelar ruta.
  function focusCell(cell, setTab) {
    if (!cell) return;
    if (setTab !== false) {
      boardEl.querySelectorAll('.cell').forEach(function (c) { c.setAttribute('tabindex', '-1'); });
      cell.setAttribute('tabindex', '0');
    }
    cell.focus();
  }

  function bindKeyboard() {
    boardEl.addEventListener('keydown', function (e) {
      var cell = e.target.closest ? e.target.closest('.cell') : null;
      if (!cell || !boardEl.contains(cell)) return;
      var key = e.key;
      if (key === 'Enter' || key === ' ' || key === 'Spacebar') {
        e.preventDefault();
        var tgt = cell.classList.contains('target') ? cell : (cell.querySelector('.piece') || cell);
        tgt.dispatchEvent(new global.MouseEvent('click', { bubbles: true }));
        return;
      }
      var dirs = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      var d = dirs[key];
      if (!d) return;
      e.preventDefault();
      var home = cell.getBoundingClientRect();
      var hx = home.left + home.width / 2, hy = home.top + home.height / 2;
      var best = null, bestScore = Infinity;
      boardEl.querySelectorAll('.cell').forEach(function (c) {
        if (c === cell) return;
        var r = c.getBoundingClientRect();
        var dx = (r.left + r.width / 2) - hx, dy = (r.top + r.height / 2) - hy;
        var along = dx * d[0] + dy * d[1];
        var across = Math.abs(dx * d[1] - dy * d[0]);
        if (along <= 1) return;
        var score = along + across * 3;
        if (score < bestScore) { bestScore = score; best = c; }
      });
      focusCell(best);
    });
    boardEl.addEventListener('focusin', function (e) {
      var cell = e.target.closest ? e.target.closest('.cell') : null;
      if (cell) focusCell(cell);
    });
  }

  function bindBoard() {
    boardEl.addEventListener('click', function (e) {
      if (!ui.interactive || !ui.st || ui.st.winner != null) return;
      var pieceEl = e.target.closest('.piece');
      var cellEl = e.target.closest('.cell');
      if (pieceEl) {
        var pid = parseInt(pieceEl.dataset.pid, 10);
        // Andre klikk på same brikke = opphev valet (toggle).
        if (pid === ui.sel) { clearSelection(); return; }
        var p = SS.piece(ui.st, pid);
        var mine = p.o === ui.st.turn ||
          (p.t === 'q' && p.o === ui.st.turn) ||
          (p.t === 'k' && p.o === ui.st.turn);
        if (p.t === 'k' && p.o == null) { toast(T('ui.kingFreeNoMove')); return; }
        if (!mine) { toast(T('ui.notYours')); return; }
        selectPiece(pid);
        return;
      }
      if (cellEl) clearSelection();
    });
  }

  function markLastMove() {
    if (!ui.st || !ui.st.lastMove) return;
    var lm = ui.st.lastMove;
    [lm.from, lm.to].forEach(function (i) {
      var cell = boardEl.querySelector('[data-idx="' + i + '"]');
      if (cell) cell.classList.add('lastmove');
    });
  }

  ui.init = function (opts) {
    initEls();
    Object.assign(ui, opts || {});
    bindBoard();
    bindKeyboard();
    $('btn-surrender').addEventListener('click', function () {
      if (ui.onSurrender) ui.onSurrender();
    });
  };
  ui.setFlip = function (f) { ui.flip = f; render(); markLastMove(); };
  ui.selectPiece = function (pid) { selectPiece(pid); };
  ui.render = render;
  ui.renderCaptured = renderCaptured;
  ui.markLastMove = markLastMove;
  ui.log = log;
  ui.clearLog = clearLog;
  ui.toast = toast;
  ui.clearSelection = clearSelection;
  ui.selectPiece = selectPiece;
  ui.setInteractive = function (v) { ui.interactive = v; render(); };
  global.UI = ui;
})(typeof globalThis !== 'undefined' ? globalThis : this);
