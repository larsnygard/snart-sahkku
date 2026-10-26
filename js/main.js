// SnartSáhkku — hovedkontroller: meny, spill-løkke, CPU, nett
(function (global) {
  'use strict';
  var SS = global.SS, UI = global.UI, CPU = global.CPU, NET = global.NET;
  var doc = global.document;
  function $(id) { return doc.getElementById(id); }

  var app = {
    mode: 'cpu',       // 'cpu' | 'local' | 'online'
    me: 0,             // min spiller (online)
    level: 2,          // klassisk CPU: 1-3
    engine: 'classic', // 'classic' (js/cpu.js) | 'nn' (engines/sahkku-nn.js)
    st: null,
    host: false,       // online: vert = P0, autoritativ
    busy: false,
    over: false
  };
  globalThis.__APP = app;   // feilsøkingshandtak (testar + devtools)

  function D(ms) { return (typeof globalThis !== 'undefined' && globalThis.__FAST) ? 30 : ms; }

  // ---------- skjermbytter ----------
  function show(id) {
    ['menu', 'room', 'game', 'archive'].forEach(function (s) {
      $(s).classList.toggle('hidden', s !== id);
    });
  }

  // ---------- spillflyt (lokalt: cpu/local) ----------
  function humanTurn() {
    if (app.mode === 'online') return app.st.turn === app.me;
    return app.mode === 'local' || (app.mode === 'cpu' && app.st.turn === 0);
  }
  function refresh() {
    // FEN-augefrysing: arkivet spelar partiet opp att ved å laste stillingane
    // direkte (eksakt, uavhengig av korleis trekka vert tolka på nytt).
    try {
      if (app.st && app.mode !== 'review') {
        var fen = SS.toFEN(app.st);
        if (!app.fens) app.fens = [];
        if (app.fens[app.fens.length - 1] !== fen) app.fens.push(fen);
      }
    } catch (e) { /* FEN skal alltid gå, men arkivet er ikkje kritisk */ }
    UI.st = app.st;
    UI.render();
    UI.markLastMove();
    UI.setInteractive(!app.busy && !app.over && app.st.winner == null && humanTurn());
    saveGame();
  }
  function describeMv(mv) {
    var st = app.st, p = SS.piece(st, mv.pid);
    var who = p.o === 0 ? 'Menn' : 'Koner';
    if (p.t === 'k') return who + ': kongen ' + SS.name(p.at) + ' → ' + SS.name(SS.moveDest(st, mv));
    if (p.t === 'q') return who + ': dronninga ' + SS.name(p.at) + ' → ' + SS.name(SS.moveDest(st, mv));
    return who + ': soldat ' + (mv.kind === 'rel' ? 'løses fra ' : 'fra ') + SS.name(SS.soldierAt(p.o, p.at)) + ' (' + mv.v + ')';
  }
  function announceEvents(ev) {
    ev.forEach(function (e) {
      if (e.type === 'mv') UI.log(describeMv({ pid: e.pid, dir: e.dir, v: e.v, kind: e.rel ? 'rel' : 'mv' }));
      if (e.type === 'kill') {
        var q = SS.piece(app.st, e.pid);
        UI.log((q.t === 'q' ? 'DRONNINGA' : 'Soldat') + ' ble slått ut på ' + SS.name(e.at) + '!', 'kill');
      }
      if (e.type === 'king') UI.log('Kongen ble kapret av ' + (e.by === 0 ? 'menn' : 'koner') + '!', 'king');
    });
  }
  function checkEnd() {
    var st = app.st;
    if (st.winner == null) return false;
    app.over = true;
    var who = st.winner === 0 ? 'Menn' : 'Koner';
    var why = { dronning: 'Dronninga ble slått ut.', utryddelse: 'Alle soldatene var utradert.',
                overgivelse: 'Motstanderen ga seg.' }[st.winReason] || st.winReason;
    UI.log('SEIER: ' + who + '! ' + why, 'win');
    $('end-title').textContent = 'Seier: ' + who + '!';
    $('end-reason').textContent = why;
    $('endscore').showModal();
    archiveCurrentGame();
    UI.render();
    return true;
  }

  function settleAndContinue() {
    if (checkEnd()) return;
    var s = SS.settle(app.st);
    if (s.over) { checkEnd(); return; }
    if (s.turnEnded) { afterTurnChange(); return; }
    if (s.moves && s.moves.length) {
      if (humanTurn()) { refresh(); }
      else if (app.mode === 'online') { /* vent på motspillerens trekk */ }
      else { setTimeout(cpuStep, D(550)); }
      return;
    }
    if (s.reroll) {
      if (humanTurn()) { refresh(); }   // vis omkast-knapp
      else if (app.mode === 'online') { /* motspilleren avgjør selv */ }
      else {
        // CPU: kast om X-ene
        SS.rerollX(app.st);
        UI.log((app.st.turn === 0 ? 'Menn' : 'Koner') + ': kastet om X-ene');
        setTimeout(cpuStep, D(550));
      }
      return;
    }
    refresh();
  }

  function afterTurnChange() {
    UI.clearSelection();
    saveGame();
    if (checkEnd()) { if (app.mode === 'online' && app.host) onlineSnapshot(); return; }
    rollPhase();
    if (app.mode === 'online' && app.host) onlineSnapshot();
  }

  function rollPhase() {
    app.st.phase = 'roll';
    app.st.dice = []; app.st.used = [];
    UI.clearSelection();
    refresh();
    if (!humanTurn() && !app.over) setTimeout(cpuTurn, D(600));
  }

  function cpuTurn() {
    if (app.mode === 'online') return;   // online: motspilleren trekker selv
    if (app.over) return;
    app.busy = true;
    UI.render();
    SS.roll(app.st);
    UI.log((app.st.turn === 0 ? 'Menn' : 'Koner') + ': kast ' + app.st.dice.join(' '));
    app.st.phase = 'move';
    app.busy = false;
    settleAndContinue();
  }
  function cpuStep() {
    if (app.over) return;
    app.busy = true;
    UI.render();
    // Den nevrale motoren tenkjer ~0,5 s; lat UI-en male «tenkjer …» fyrst.
    if (app.engine === 'nn' && global.SahkkuNN && global.SahkkuNN.ready()) {
      setTimeout(cpuPlay, 20);
    } else {
      cpuPlay();
    }
  }

  function cpuPlay() {
    if (app.over) return;
    var mv = null;
    if (app.engine === 'nn' && global.SahkkuNN && global.SahkkuNN.ready()) {
      mv = global.SahkkuNN.move(app.st);      // {pid,dir,v,kind} | null
    }
    if (!mv) mv = CPU.pick(app.st, app.level); // klassisk CPU (òg reserve)
    if (!mv) { app.busy = false; settleAndContinue(); return; }
    var ev = SS.applyMove(app.st, mv);
    app.busy = false;
    announceEvents(ev);
    refresh();
    UI.markLastMove();
    settleAndContinue();
  }

  // ---------- interaktive handlinger ----------
  function onRoll() {
    if (app.mode === 'online') return onlineRoll();
    if (app.st.phase !== 'roll' || app.busy) return;
    SS.roll(app.st);
    var d = app.st.dice.slice();
    UI.log('Du kastet ' + d.join(' '));
    app.st.phase = 'move';
    // animasjon
    UI.render();
    doc.querySelectorAll('.die').forEach(function (el) { el.classList.add('rolling'); });
    setTimeout(settleAndContinue, D(420));
  }
  function onReroll() {
    if (app.mode === 'online') return onlineReroll();
    var r = SS.rerollX(app.st);
    if (r) UI.log('Kastet om X-ene: ' + r.join(' '));
    settleAndContinue();
  }
  function onPass() {
    if (app.mode === 'online') return onlinePass();
    var ev = SS.passRemaining(app.st);
    UI.log('Gjenværende terninger ble sprunget over');
    announceEvents(ev);
    afterTurnChange();
  }
  function onSurrender() {
    if (app.over) return;
    if (app.mode === 'online') return onlineResign();
    app.st.winner = 1 - app.st.turn; app.st.winReason = 'overgivelse';
    app.st.phase = 'over';
    checkEnd();
  }
  function onMove(mv) {
    if (app.mode === 'online') return onlineMove(mv);
    var ev = SS.applyMove(app.st, mv);
    announceEvents(ev);
    UI.clearSelection();
    refresh();
    UI.markLastMove();
    settleAndContinue();
  }

  // ---------- oppstart ----------
  function newGame() {
    app.over = false;
    app.st = SS.newGame({ first: 0, nesseby: !!app.nesseby });
    var op = SS.openingRoll(app.st);
    app.st.turn = op.first;
    app.first = op.first;          // kven som byrja (for arkiv-avspeling)
    app.archived = false;
    app.fens = [];                 // FEN etter kvar endring (arkiv/avspeling)
    UI.clearLog();
    op.rolls.forEach(function (r, ix) {
      if (op.rolls.length > 1) UI.log('Åpning ' + (ix+1) + ': Menn ' + r.p0.join(' ') + ' · Koner ' + r.p1.join(' '));
    });
    UI.log('Åpning: ' + (op.first === 0 ? 'Menn' : 'Koner') + ' begynner (flegst X-er)');
    if (app.mode === 'cpu') {
      UI.log('CPU: ' + (app.engine === 'nn' ? 'nevral (NN)' : 'klassisk nivå ' + app.level));
    }
    UI.flip = (app.mode === 'cpu' || app.mode === 'local') ? false : (app.me === 1);
    show('game');
    refresh();
    rollPhase();
    if (!humanTurn()) setTimeout(cpuTurn, D(700));
  }
  function newOnlineGame() {
    app.over = false;
    app.st = SS.newGame({ first: 0, nesseby: !!app.nesseby });
    UI.flip = app.me === 1;
    show('game');
    if (app.host) {
      // vert: opningsritual — kappkast for begge sider (same terning-RNG)
      var op = SS.openingRoll(app.st);
      app.st.turn = op.first;
      UI.clearLog();
      op.rolls.forEach(function (r, ix) {
        if (op.rolls.length > 1) UI.log('Åpning ' + (ix + 1) + ': Menn ' + r.p0.join(' ') + ' · Koner ' + r.p1.join(' '));
      });
      UI.log('Åpning: ' + (op.first === 0 ? 'Menn' : 'Koner') + ' begynner (flest X-er)');
      refresh();
      onlineSnapshot();
      // om verten vann opninga: eigen tur; elles: gjesten sin tur
      if (app.st.turn === app.me) {
        refresh();
      } else {
        $('room-hint').textContent = '';
        refresh();   // gjesten ser Kast-knappen sin via sin eigen rendering
      }
      saveGame();
    }
    // gjesten: ventar på snapshot — ingen eiga terning-tilstand
    refresh();
  }

  // ---------- nettverk ----------
  // Autoritativ protokoll: VERTEN eig all tilstand (terning-RNG hjå vert).
  // Gjesten sender intensjonar (rollreq/move/reroll/pass/resign), vert
  // validerer, utfører, og sender FULLT autoritativt snapshot — aldri
  // faselaugner. Gjesten renderar berre snapshot. Éin sanning, ingen desync.
  function onlineSnapshot() {
    NET.send({ t: 'state', s: JSON.parse(SS.serialize(app.st)) });
  }
  function applySnapshot(s) {
    app.st = SS.deserialize(s.s);
    app.over = app.st.winner != null;
    app.busy = false;
    clearTimeout(app._rt);
    UI.clearSelection();
    renderLogFromState(app.st);
    refresh();
    UI.markLastMove();
    if (app.over) checkEnd();
  }
  function onlineRoll() {
    if (app.st.turn !== app.me || app.st.phase !== 'roll') return;
    if (app.host) {
      SS.roll(app.st);
      app.st.phase = 'move';
      UI.log('Du kastet ' + app.st.dice.join(' '));
      onlineSnapshot();
      settleAndContinue();
    } else {
      app.busy = true; refresh();
      NET.send({ t: 'rollreq' });
      clearTimeout(app._rt);
      app._rt = setTimeout(function () {
        if (app.busy) { app.busy = false; NET.send({ t: 'sync' }); refresh(); }
      }, 6000);
    }
  }
  function onlineReroll() {
    if (app.st.turn !== app.me) return;
    if (app.host) {
      var r = SS.rerollX(app.st);
      if (r) { UI.log('Kastet om X-ene: ' + r.join(' ')); onlineSnapshot(); }
      settleAndContinue();
    } else {
      app.busy = true; refresh();
      NET.send({ t: 'reroll' });
      clearTimeout(app._rt);
      app._rt = setTimeout(function () { if (app.busy) { app.busy = false; NET.send({ t: 'sync' }); refresh(); } }, 6000);
    }
  }
  function onlineMove(mv) {
    if (app.st.turn !== app.me) return;
    if (app.host) {
      var legal = SS.legalMoves(app.st, app.st.turn).some(function (m) {
        return m.pid === mv.pid && m.v === mv.v && m.kind === mv.kind && (m.dir === mv.dir);
      });
      if (!legal) { UI.toast('Ulovleg trekk'); return; }
      var ev = SS.applyMove(app.st, mv);
      announceEvents(ev);
      UI.clearSelection();
      onlineSnapshot();
      refresh(); UI.markLastMove();
      settleAndContinue();
    } else {
      UI.setInteractive(false);
      NET.send({ t: 'move', mv: mv });
    }
  }
  function onlinePass() {
    if (app.st.turn !== app.me) return;
    if (app.host) {
      var ev = SS.passRemaining(app.st);
      announceEvents(ev);
      onlineSnapshot();
      afterTurnChange();
    } else {
      app.busy = true; refresh();
      NET.send({ t: 'pass' });
      clearTimeout(app._rt);
      app._rt = setTimeout(function () { if (app.busy) { app.busy = false; NET.send({ t: 'sync' }); refresh(); } }, 6000);
    }
  }
  function onlineResign() {
    if (app.host) {
      app.st.winner = 1 - app.st.turn; app.st.winReason = 'overgivelse'; app.st.phase = 'over';
      onlineSnapshot(); checkEnd();
    } else {
      NET.send({ t: 'resign' });
      UI.setInteractive(false);
      app.st.winner = 1 - app.me; app.st.winReason = 'overgivelse'; app.st.phase = 'over';
      checkEnd();
    }
  }
  function renderLogFromState(st) {
    // gjenoppbygg loggvisa frå spelloggen (for gjest + gjenopptak)
    UI.clearLog();
    (st.log || []).forEach(function (p) {
      if (p.t === 'open') {
        var lastR = p.rolls[p.rolls.length - 1];
        var x = function (d) { return d.filter(function (v) { return v === 'X'; }).length; };
        p.rolls.forEach(function (r, ix) {
          if (p.rolls.length > 1) UI.log('Åpning ' + (ix + 1) + ': Menn ' + r.p0.join(' ') + ' · Koner ' + r.p1.join(' '));
        });
        UI.log('Åpning: ' + (x(lastR.p0) > x(lastR.p1) ? 'Menn' : 'Koner') + ' begynner (flest X-er)');
        return;
      }
      var side = p.t === 0 ? 'Menn' : 'Koner';
      p.roll.forEach(function (d, ix) {
        UI.log(side + (ix > 0 ? ' kasta om X-ene: ' : ': kast ') + d.join(' '));
      });
      p.mv.forEach(function (m) {
        var nm = m.t === 'k' ? 'Kongen' : m.t === 'q' ? 'Dronninga' : (m.o === 0 ? 'Menn' : 'Koner');
        if (m.rel) UI.log(nm + ' løsna på ' + SS.sqName(m.to));
        else UI.log(nm + ' ' + SS.sqName(m.from) + '→' + SS.sqName(m.to) + (m.k > 0 ? ' slo ' + m.k : '') + (m.kg ? ' — kongen kapra!' : ''));
      });
    });
    if (st.winner != null) UI.log('SEIER: ' + (st.winner === 0 ? 'Menn' : 'Koner') + '! ' + (st.winReason || ''), 'win');
  }
  function wireNet() {
    NET.handlers.onStatus = function (s) {
      $('net-status').textContent = s;
    };
    NET.handlers.onPeers = function (peers) {
      $('peer-list').textContent = peers.length ? peers.map(NET.short).join(', ') : 'ingen';
      var me = NET.myId ? NET.short(NET.myId) : '—';
      $('my-node').textContent = me;
      if (app.mode === 'online') {
        var connected = peers.length > 0;
        if (connected && !app.onlineStarted) {
          // rene rekkefølger: lavest node-id = vert og starter partiet
          app.host = NET.isLowest();
          app.me = app.host ? 0 : 1;
          app.onlineStarted = true;
          newOnlineGame();
          return;
        }
        if (connected && app.onlineStarted && app.st) {
          // gjenkopling: vert sender autoritativt snapshot, gjest be om det
          if (app.host) onlineSnapshot(); else NET.send({ t: 'sync' });
          return;
        }
        if (!connected && app.st && !app.over) UI.toast('Motspillar forsvann — spelet er redda, vent på gjenoppkopling');
      }
    };
    NET.handlers.onMsg = function (m) {
      var d = m.data;
      if (d.t === 'state') {
        if (!app.host) applySnapshot(d);
        return;
      }
      if (!app.host) return;   // berre verten utfører
      var foe = 1;              // gjesten sin side
      if (d.t === 'rollreq') {
        if (app.st.phase === 'roll' && app.st.turn === foe) {
          SS.roll(app.st);
          app.st.phase = 'move';
          UI.log('Koner kastet ' + app.st.dice.join(' '));
          onlineSnapshot();
        }
      } else if (d.t === 'reroll') {
        if (app.st.turn === foe && SS.canRerollX(app.st)) {
          SS.rerollX(app.st);
          UI.log('Koner kasta om X-ene: ' + app.st.dice.join(' '));
          onlineSnapshot();
        }
      } else if (d.t === 'move') {
        var legal = SS.legalMoves(app.st, foe).some(function (mm) {
          return mm.pid === d.mv.pid && mm.v === d.mv.v && mm.kind === d.mv.kind && (mm.dir === d.mv.dir);
        });
        if (legal) {
          var ev = SS.applyMove(app.st, d.mv);
          announceEvents(ev);
          onlineSnapshot();
          refresh(); UI.markLastMove();
          settleAndContinue();
        } else onlineSnapshot();   // resynk
      } else if (d.t === 'pass') {
        if (app.st.turn === foe) {
          var ev2 = SS.passRemaining(app.st);
          UI.log('Koner hoppa over resten');
          onlineSnapshot();
          afterTurnChange();
        }
      } else if (d.t === 'resign') {
        app.st.winner = 0; app.st.winReason = 'overgivelse'; app.st.phase = 'over';
        onlineSnapshot(); checkEnd();
      } else if (d.t === 'sync') {
        onlineSnapshot();
      }
    };
  }

  // ---------- lagring: alt tilstand overlev ein attladden nettlesar ----------
  var SAVE_KEY = 'sahkku.save.v2';
  function saveGame() {
    try {
      if (!app.st || app.mode === 'menu') return;
      var rec = {
        v: 2, mode: app.mode, level: app.level, engine: app.engine,
        nesseby: !!app.nesseby, me: app.me, host: app.host,
        over: app.over, flip: UI.flip,
        room: (global.NET && NET.seed) ? NET.seed : null,
        st: JSON.parse(SS.serialize(app.st))
      };
      global.localStorage.setItem(SAVE_KEY, JSON.stringify(rec));
    } catch (e) { /* localStorage full eller utilgjengeleg — ikkje kritisk */ }
  }
  function peekSave() {
    try {
      var raw = global.localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      var rec = JSON.parse(raw);
      if (!rec || !rec.st) return null;
      return rec;
    } catch (e) { return null; }
  }
  function clearSave() { try { global.localStorage.removeItem(SAVE_KEY); } catch (e) {} }
  function resumeGame() {
    var rec = peekSave();
    if (!rec) return false;
    app.mode = rec.mode; app.level = rec.level || 2;
    app.engine = rec.engine === 'nn' ? 'nn' : 'classic';
    app.nesseby = !!rec.nesseby;
    if ($('chk-nesseby')) $('chk-nesseby').checked = app.nesseby;
    if (app.engine === 'nn' && global.SahkkuNN && !global.SahkkuNN.ready()) {
      global.SahkkuNN.load().catch(function () { app.engine = 'classic'; });
    }
    if ($('cpu-engine')) $('cpu-engine').value = app.engine;
    if ($('cpu-level')) $('cpu-level').value = String(app.level);
    app.me = rec.me || 0; app.host = !!rec.host; app.over = !!rec.over;
    app.onlineStarted = (rec.mode === 'online');
    app.st = SS.deserialize(rec.st);
    UI.flip = !!rec.flip;
    UI.clearLog();
    show('game');
    renderLogFromState(app.st);
    refresh();
    UI.markLastMove();
    if (app.over) checkEnd();
    return true;
  }

  // ---------- SPG-notasjon: last ned / kopier ----------
  function spgMeta() {
    var m = { event: { cpu: 'Parti mot CPU', local: 'Parti ved same skjerm', online: 'Parti på nett' }[app.mode] || 'Sáhkku-parti' };
    // Datamaskin-merke etter standarden: «(c) <motor>». Koner er CPU-en.
    if (app.mode === 'cpu') {
      m.koner = 'Gálgut (c) ' + (app.engine === 'nn' ? 'sahkku-nn' : 'klassisk nivå ' + app.level);
    }
    if (app.nesseby) m.event += ' — Nesseby';
    return m;
  }
  function exportSpg() {
    if (!app.st) return;
    var txt = global.SPG.toSPG(app.st, spgMeta());
    var fname = 'sahkku-' + new Date().toISOString().slice(0, 10) + '.spg';
    try {
      var blob = new Blob([txt], { type: 'text/plain' });
      var a = doc.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = fname;
      doc.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
      UI.log('Notasjon eksportert: ' + fname);
    } catch (e) {
      // fallback: kopier til utklippstavla
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(function () { UI.log('Notasjon kopiert til utklippstavla'); });
      }
    }
  }

  // ---------- knytters ----------

  // ---------- arkiv: lagre, liste, avspele, slette ----------
  var review = null, prevMode = 'cpu';

  function downloadText(txt, fname) {
    try {
      var blob = new Blob([txt], { type: 'text/plain' });
      var a = doc.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = fname;
      doc.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    } catch (e) { UI.toast('Kunne ikkje laste ned'); }
  }

  function archiveCurrentGame() {
    if (!app.st || app.archived || app.mode === 'review') return;
    if (app.st.moves === 0) return;
    var steps = global.ARCH.stepsFrom(app.st);
    if (!steps.length) return;
    app.archived = true;
    var rec = {
      mode: app.mode, engine: app.engine, level: app.level, first: app.first,
      nesseby: !!app.nesseby,
      result: app.st.winner == null ? '*' : (app.st.winner === 0 ? '1-0' : '0-1'),
      reason: app.st.winReason || '', plies: app.st.moves,
      steps: (app.fens && app.fens.length > 1) ? [] : steps,
      fens: (app.fens || []).slice(),
      spg: (global.SPG && global.SPG.toSPG) ? global.SPG.toSPG(app.st, spgMeta()) : ''
    };
    if (global.ARCH.save(rec)) UI.log('Partiet er lagra i arkivet');
  }

  function archRow(g) {
    var when = new Date(g.ts);
    var dateStr = when.toLocaleDateString() + ' ' + String(when.getHours()).padStart(2, '0') + ':' +
                  String(when.getMinutes()).padStart(2, '0');
    var mode = g.mode === 'cpu'
      ? ('CPU ' + (g.engine === 'nn' ? 'NN' : 'nivå ' + (g.level || 2)))
      : (g.mode === 'local' ? 'to spillere' : 'nett');
    var res = g.result === '1-0' ? 'Menn vann' : (g.result === '0-1' ? 'Koner vann' : 'ikkje avslutta');
    var row = doc.createElement('div');
    row.className = 'arch-row';
    row.innerHTML = '<div class="arch-info"><b>' + res + '</b><span class="arch-sub">' + dateStr +
                    ' · ' + mode + ' · ' + (g.plies || 0) + ' trekk' +
                    (g.reason ? ' · ' + g.reason : '') + '</span></div>';
    var acts = doc.createElement('div');
    acts.className = 'arch-btns';
    function mkBtn(txt, cls, fn) {
      var b = doc.createElement('button');
      b.textContent = txt; if (cls) b.className = cls;
      b.addEventListener('click', fn);
      acts.appendChild(b);
    }
    mkBtn('Vis', '', function () { openReplay(g.id); });
    mkBtn('SPG', 'ghost', function () {
      downloadText(g.spg || '', 'sahkku-' + String(g.ts).slice(0, 10) + '.spg');
    });
    mkBtn('Slett', 'ghost', function () { global.ARCH.remove(g.id); renderArchive(); });
    row.appendChild(acts);
    return row;
  }

  function renderArchive() {
    var box = $('arch-list');
    box.innerHTML = '';
    var games = global.ARCH.list();
    if (!games.length) {
      box.innerHTML = '<p class="arch-empty">Ingen parti i arkivet enno. Spel eit parti ferdig, so dukkar det opp her.</p>';
      return;
    }
    games.forEach(function (g) { box.appendChild(archRow(g)); });
  }

  function openArchive() {
    renderArchive();
    show('archive');
  }

  function totalMoves(rec) {
    // arkivet veit kva format posten har (FEN-auge eller steg)
    return global.ARCH.totalMoves(rec);
  }

  function openReplay(id) {
    var rec = global.ARCH.get(id);
    if (!rec) return;
    if (app.mode !== 'review') prevMode = app.mode;
    app.mode = 'review';
    review = { rec: rec, total: totalMoves(rec), at: totalMoves(rec) };
    $('replay-bar').classList.remove('hidden');
    show('game');
    UI.clearLog();
    renderReplay();
  }

  function renderReplay() {
    if (!review) return;
    var r = global.ARCH.replay(review.rec, review.at);
    if (review.rec.nesseby) r.st.nesseby = true;   // modus ligg ikkje i FEN
    app.st = r.st;
    app.over = true;                       // ingen CPU/human-flyt i avspeling
    UI.st = app.st;
    UI.render();
    UI.setInteractive(false);
    $('replay-count').textContent = r.at + ' / ' + r.total;
  }

  function replayStep(d) {
    if (!review) return;
    var at = review.at + d;
    if (at < 0) at = 0;
    if (at > review.total) at = review.total;
    if (at === review.at) return;
    review.at = at;
    renderReplay();
  }

  function closeReplay() {
    review = null;
    $('replay-bar').classList.add('hidden');
    app.mode = prevMode;
    openArchive();
  }

  function wireArchive() {
    $('btn-archive').addEventListener('click', openArchive);
    $('btn-arch-back').addEventListener('click', function () { show('menu'); });
    $('btn-arch-clear').addEventListener('click', function () {
      if (!global.ARCH.list().length) { UI.toast('Arkivet er tomt'); return; }
      if (global.confirm && !global.confirm('Slette alle lagra parti?')) return;
      global.ARCH.clear(); renderArchive(); UI.toast('Arkivet er tømt');
    });
    $('btn-prev').addEventListener('click', function () { replayStep(-1); });
    $('btn-next').addEventListener('click', function () { replayStep(1); });
    $('btn-rw').addEventListener('click', function () { review && (review.at = 0, renderReplay()); });
    $('btn-ff').addEventListener('click', function () {
      if (review) { review.at = review.total; renderReplay(); }
    });
    $('btn-replay-back').addEventListener('click', closeReplay);
  }

  function wireUI() {
    UI.init({
      onRoll: onRoll, onReroll: onReroll, onPass: onPass,
      onMove: onMove, onSurrender: onSurrender
    });
    $('btn-cpu').addEventListener('click', function () {
      app.mode = 'cpu';
      app.level = parseInt($('cpu-level').value, 10) || 2;
      app.engine = ($('cpu-engine') && $('cpu-engine').value === 'nn') ? 'nn' : 'classic';
      app.nesseby = !!($('chk-nesseby') && $('chk-nesseby').checked);
      if (app.engine === 'nn' && !(global.SahkkuNN && global.SahkkuNN.ready())) {
        UI.toast('Lastar nevral motor …');
        global.SahkkuNN.load().then(function () {
          UI.toast('Nevral motor klar');
          newGame();
        }, function (e) {
          UI.toast('Nevral motor feila — spelar med klassisk CPU');
          if (global.console) console.warn('NN-last feila:', e);
          app.engine = 'classic';
          newGame();
        });
        return;
      }
      newGame();
    });
    if ($('cpu-engine')) {
      $('cpu-engine').addEventListener('change', function () {
        var nn = $('cpu-engine').value === 'nn';
        if (nn) global.SahkkuNN.load().catch(function (e) {
          UI.toast('Nevral motor feila — klassisk CPU vert brukt');
          if (global.console) console.warn('NN-last feila:', e);
          $('cpu-engine').value = 'classic';
        });
      });
    }
    $('btn-local').addEventListener('click', function () { app.mode = 'local'; newGame(); });
    $('btn-resume').addEventListener('click', function () {
      if (!resumeGame()) { UI.toast('Fann ikje noko lagra parti'); show('menu'); }
    });
    $('btn-spg').addEventListener('click', exportSpg);
    $('btn-export-spg').addEventListener('click', exportSpg);
    $('btn-fen').addEventListener('click', function () {
      if (!app.st) return;
      var fen = SS.toFEN(app.st);
      function done() { UI.toast('FEN kopiert'); UI.log('FEN: ' + fen); }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(fen).then(done, function () { UI.log('FEN: ' + fen); UI.toast('Kunne ikkje kopiere — sjå loggen'); });
      } else {
        var ta = doc.createElement('textarea');
        ta.value = fen; doc.body.appendChild(ta); ta.select();
        try { doc.execCommand('copy'); done(); } catch (e) { UI.log('FEN: ' + fen); }
        ta.remove();
      }
    });
    wireArchive();
    $('btn-online').addEventListener('click', function () {
      app.mode = 'online'; app.onlineStarted = false;
      show('room');
      NET.load().then(function () {
        $('my-node').textContent = NET.short(NET.myId);
      }).catch(function (e) {
        UI.toast('Nettverk feilet: ' + e.message);
      });
    });
    $('btn-join').addEventListener('click', async function () {
      var raw = $('room-seed').value;
      $('btn-join').disabled = true;
      $('room-hint').textContent = 'Kobler til rommet…';
      try {
        await NET.join(raw);
        // vis invitasjonskode så gjesten kan bootstrappe seg inn
        $('invite-code').textContent = NET.seed + '#' + NET.myId;
        $('invite-row').style.display = '';
        $('room-hint').textContent = 'Del invitasjonskoden med motspilleren. Spillet starter når begge er i rommet.';
        app.mode = 'online';
        app.onlineStarted = false;
        app.host = NET.isLowest();
        app.me = app.host ? 0 : 1;
      } catch (e) {
        UI.toast('Kunne ikke bli med: ' + e.message);
        $('room-hint').textContent = 'Feil: ' + e.message;
      }
      $('btn-join').disabled = false;
    });
    $('btn-copy-invite').addEventListener('click', async function () {
      var code = $('invite-code').textContent;
      try { await navigator.clipboard.writeText(code); UI.toast('Invitasjonskodel kopiert'); }
      catch (e) { UI.toast('Kunne ikke kopiere — marker og kopier manuelt'); }
    });
    // --- nettdiagnostikk ---
    $('btn-diag').addEventListener('click', async function () {
      var out = $('diag-out');
      var line = function (s) { out.textContent += s + '\n'; out.parentNode.open = true; };
      $('btn-diag').disabled = true; out.textContent = '';
      try {
        if (!NET.net) await NET.load();
        var a = JSON.parse(NET.net.addr());
        line('Min node: ' + a.id.slice(0, 16) + '…');
        line('Addrs: ' + (a.addrs.length ? a.addrs.join(' | ') : 'INGEN — ikke pålogget relay!'));
        var peer = $('diag-peer').value.trim().split('#')[0].trim();
        if (peer) {
          line('Resolve ' + peer.slice(0, 12) + '…: ' + await NET.net.resolve(peer));
          line('Dial: ' + await NET.net.dial(peer));
        }
        line('Rom: ' + (NET.seed || 'ikke i rom') + ' · peers: ' + (NET.peers.length || 0));
      } catch (e) { line('Feil: ' + e.message); }
      $('btn-diag').disabled = false;
    });
    // --- PWA-install ---
    var installPrompt = null;
    global.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault(); installPrompt = e;
      $('btn-install').classList.remove('hidden');
    });
    global.addEventListener('appinstalled', function () {
      $('btn-install').classList.add('hidden'); installPrompt = null;
    });
    $('btn-install').addEventListener('click', async function () {
      if (!installPrompt) return;
      installPrompt.prompt();
      await installPrompt.userChoice.catch(function () {});
      installPrompt = null; $('btn-install').classList.add('hidden');
    });
    $('btn-back-menu').addEventListener('click', function () {
      NET.leave(); app.mode = 'menu'; show('menu');
    });
    $('btn-menu').addEventListener('click', function () {
      if (app.mode === 'online') NET.leave();
      app.mode = 'menu'; show('menu');
    });
    $('btn-rematch').addEventListener('click', function () {
      $('endscore').close();
      if (app.mode === 'online') {
        if (app.host) newOnlineGame();   // vert: nytt oppningsritual + snapshot
        // gjesten: ventar på verten sin snapshot
      } else newGame();
    });
    $('btn-endmenu').addEventListener('click', function () {
      $('endscore').close();
      if (app.mode === 'online') NET.leave();
      app.mode = 'menu'; show('menu');
    });
    $('btn-help').addEventListener('click', function () { $('rules').showModal(); });
    doc.querySelectorAll('[data-close]').forEach(function (b) {
      b.addEventListener('click', function () { b.closest('dialog').close(); });
    });
  }

  function boot() {
    wireUI();
    wireNet();
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(function () {});
    }
    var rec = peekSave();
    if (rec && rec.st && rec.st.winner == null) {
      $('btn-resume').classList.remove('hidden');
      var what = { cpu: 'CPU-parti', local: 'to spelarar', online: 'nettparti' }[rec.mode] || 'parti';
      $('btn-resume').textContent = '▶ Fortsett ' + what + ' (' + SS.name(SS.king(rec.st).at) + ' · ' + (rec.st.turn === 0 ? 'Menn' : 'Koner') + ' i trekket)';
      // nettparti: gjenopprett rommet automatisk — sessiona skal halde fram åleine
      if (rec.mode === 'online' && rec.room) {
        app.mode = 'online'; app.onlineStarted = false;
        show('room');
        $('room-seed').value = rec.room;
        $('btn-join').disabled = true;
        $('room-hint').textContent = 'Koplar til rommet att…';
        NET.load().then(function () {
          $('my-node').textContent = NET.short(NET.myId);
          return NET.join(rec.room);
        }).then(function () {
          $('invite-code').textContent = NET.seed + '#' + NET.myId;
          $('invite-row').style.display = '';
          $('room-hint').textContent = 'Rommet er attopna. Del invitasjonskoden om motspillar manglar.';
          $('btn-join').disabled = false;
          $('btn-resume').click();   // gjenopprett partiet frå lagring
        }).catch(function (e) {
          $('room-hint').textContent = 'Klarte ikje å kople til att: ' + e.message;
          $('btn-join').disabled = false;
        });
        return;
      }
    }
    show('menu');
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot);
  else boot();
  global.APP = app;
})(typeof globalThis !== 'undefined' ? globalThis : this);
