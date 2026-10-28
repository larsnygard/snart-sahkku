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
    engine: 'classic', // motor-id frå engines/engines.json; vert sett til manifestets
                       // «default» (nyaste modell) so snart lista er lasta
    st: null,
    host: false,       // online: vert = P0, autoritativ
    busy: false,
    over: false,
    autocast: false    // «Autokast»: kast terningane automatisk når turen kjem
  };
  var APP_VERSION = 'v1.10.1';   // hald i takt med index.html sin versjonstekst
  var AC_KEY = 'sahkku.autocast';
  function readAutocast() {
    try { return global.localStorage.getItem(AC_KEY) === '1'; } catch (e) { return false; }
  }
  function writeAutocast(v) {
    try { global.localStorage.setItem(AC_KEY, v ? '1' : '0'); } catch (e) {}
  }
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
        // CPU: omkast er eit VAL, ikkje noko som skjer automatisk. NN-motorane
        // avgjer sjølv; klassisk CPU kastar berre om når ho ikkje kan noko
        // anna (ho har ingen strategi for det).
        var act = (global.ENG && global.ENG.ready(app.engine))
          ? global.ENG.action(app.engine, app.st) : null;
        if (act && act.kind === 'pass') {
          UI.log((app.st.turn === 0 ? 'Menn' : 'Koner') + ': hoppar over resten');
          SS.passRemaining(app.st);
          afterTurnChange();
          return;
        }
        if (act && act.kind === 'reroll') {
          SS.rerollX(app.st, undefined, (act.slot == null ? null : act.slot));
          UI.log((app.st.turn === 0 ? 'Menn' : 'Koner') + ': kastet om X-ene');
          setTimeout(cpuStep, D(550));
          return;
        }
        if (act && act.kind === 'move') {
          var evm = SS.applyMove(app.st, act.mv);
          announceEvents(evm);
          refresh();
          setTimeout(settleAndContinue, D(60));
          return;
        }
        // Klassisk CPU har ingen strategi for omkast, og omkast er eit VAL:
        // ho gjer som eit menneske som ikkje vil kaste om — avsluttar turen.
        // (Før kasta appen om her, heilt utan at nokon hadde valt det.)
        UI.log((app.st.turn === 0 ? 'Menn' : 'Koner') + ': X utan trekk, avsluttar turen');
        SS.passRemaining(app.st);
        afterTurnChange();
      }
      return;
    }
    refresh();
    maybeAutocast(400);   // tryggleiksnett: er vi i kastefasen, kast
  }

  function afterTurnChange() {
    UI.clearSelection();
    saveGame();
    if (checkEnd()) { if (app.mode === 'online' && app.host) onlineSnapshot(); return; }
    rollPhase();
    if (app.mode === 'online' && app.host) onlineSnapshot();
  }

  // Autokast: kast med ein gong når det er vår tur i kastefasen. Berre sjølve
  // kastet — omkast av X er alltid manuelt. Samla i éin funksjon so han ikkje
  // heng på éin bestemt veg gjennom koden (rollPhase, settle, gjenopptaking).
  function maybeAutocast(delay) {
    if (!app.autocast || app.over || app.busy) return;
    if (!app.st || app.st.phase !== 'roll' || !humanTurn()) return;
    clearTimeout(app._ac);
    app._ac = setTimeout(function () {
      // sjekk på nytt: turen kan ha endra seg, eller spelaren ha kasta sjølv
      if (app.autocast && !app.over && !app.busy && humanTurn() &&
          app.st && app.st.phase === 'roll') { onRoll(); }
    }, D(delay === undefined ? 650 : delay));
  }

  function rollPhase() {
    app.st.phase = 'roll';
    app.st.dice = []; app.st.used = [];
    UI.clearSelection();
    refresh();
    if (!humanTurn() && !app.over) { setTimeout(cpuTurn, D(600)); return; }
    maybeAutocast(650);
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
    // Ein NN-motor tenkjer ~0,5 s; lat UI-en male «tenkjer …» fyrst.
    if (global.ENG && global.ENG.ready(app.engine)) {
      setTimeout(cpuPlay, 20);
    } else {
      cpuPlay();
    }
  }

  function cpuPlay() {
    if (app.over) return;
    var mv = null;
    if (global.ENG && global.ENG.ready(app.engine)) {
      mv = global.ENG.move(app.engine, app.st);   // {pid,dir,v,kind} | null
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
  // `slot` = kva X-terning spelaren klikka på (0-2). Utan slot: den fyrste
  // ubrukte X-en, som er kva CPU-en gjer.
  function onReroll(slot) {
    if (app.mode === 'online') return onlineReroll(slot);
    var before = app.st.dice.slice();
    var r = SS.rerollX(app.st, undefined, slot);
    if (r) UI.log('Kastet om ' + (before.join(' ')) + ' → ' + r.join(' '));
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
    app.startTs = new Date().toISOString();   // SPG: [Date]/[Time]/[UTC] = starttida
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
      UI.log('CPU: ' + (global.ENG ? global.ENG.name(app.engine) : app.engine) +
             (app.engine === 'classic' ? ' (nivå ' + app.level + ')' : ''));
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
  function onlineReroll(slot) {
    if (app.st.turn !== app.me) return;
    if (app.host) {
      var r = SS.rerollX(app.st, undefined, slot);
      if (r) { UI.log('Kastet om X-ene: ' + r.join(' ')); onlineSnapshot(); }
      settleAndContinue();
    } else {
      app.busy = true; refresh();
      NET.send({ t: 'reroll', slot: slot });
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
          SS.rerollX(app.st, undefined, (d.slot == null ? null : d.slot));
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
    app.engine = rec.engine || 'classic';
    app.nesseby = !!rec.nesseby;
    if ($('chk-nesseby')) $('chk-nesseby').checked = app.nesseby;
    if (global.ENG && !global.ENG.ready(app.engine)) {
      global.ENG.load(app.engine).catch(function () { app.engine = 'classic'; });
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
    // SPG 1.2: tidspunktet partiet byrja ([Date]/[Time]/[UTC]), ikkje no.
    if (app.startTs) m.start = app.startTs;
    m.comment = 'SnartSáhkku ' + APP_VERSION +
      (app.mode === 'cpu' ? ', mot ' + (global.ENG ? global.ENG.name(app.engine) : app.engine) : '') +
      '. Terningar og trekk er registrerte; kommentarar er frie.';
    // Datamaskin-merke etter standarden: «(c) <motor>». Koner er CPU-en.
    if (app.mode === 'cpu') {
      m.koner = 'Gálgut (c) ' + (app.engine === 'classic'
        ? 'klassisk nivå ' + app.level
        : (global.ENG ? global.ENG.name(app.engine) : app.engine));
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

  // ---------- motorar (fleire samtidig) ----------
  function engName(id) { return global.ENG ? global.ENG.name(id) : id; }
  function engReady() { return global.ENG && global.ENG.ready(app.engine); }

  // Testkrok: let testane drive den verkelege settle-/kaste-vegen
  global.__settle = settleAndContinue;
  global.__rollPhase = rollPhase;
  function syncLevelSelect() {
    var lv = $('cpu-level');
    if (!lv) return;
    var classic = ($('cpu-engine') ? $('cpu-engine').value : 'classic') === 'classic';
    lv.disabled = !classic;
    lv.parentNode.style.opacity = classic ? '' : '.45';
  }
  function fillEngines() {
    var sel = $('cpu-engine');
    if (!sel || !global.ENG) { syncLevelSelect(); return; }
    global.ENG.list().then(function (engines) {
      sel.innerHTML = '';
      engines.forEach(function (e) {
        var o = doc.createElement('option');
        o.value = e.id;
        o.textContent = e.name + (e.type === 'nn' ? ' (nevral)' : '');
        if (e.note) o.title = e.note;
        sel.appendChild(o);
      });
      // Standardmotor = manifestets «default» (den nyaste modellen). Klassisk
      // CPU er framleis reserve om noko feilar med lastinga.
      var want = global.ENG.defaultId ? global.ENG.defaultId() : null;
      if (want) app.engine = want;
      else if (!engines.some(function (e) { return e.id === app.engine; })) app.engine = engines[0].id;
      sel.value = app.engine;
      syncLevelSelect();
    });
  }

  // ---------- last stilling frå FEN ----------
  function loadFromFen() {
    var txt = String($('fen-text').value || '').trim().replace(/\s+/g, ' ');
    if (!txt) return;
    var st;
    try { st = SS.fromFEN(txt); }
    catch (e) {
      $('fen-error').textContent = 'Ugyldig FEN: ' + (e && e.message ? e.message : e);
      return;
    }
    app.st = st;
    app.fens = [];
    app.archived = false;
    app.over = st.winner != null;
    if (app.mode === 'menu' || app.mode === 'online') app.mode = 'local';
    $('fenload').close();
    UI.clearLog();
    UI.log('Stilling lasta frå FEN (' + (st.turn === 0 ? 'menn' : 'koner') + ' i tur)');
    show('game');
    if (st.winner != null) { refresh(); UI.toast('Stillinga er eit ferdigspela parti'); return; }
    if (st.phase === 'roll') { rollPhase(); return; }
    refresh();
    if (!humanTurn() && app.mode === 'cpu') setTimeout(cpuStep, D(500));
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
      ? ('CPU ' + (g.engine && g.engine !== 'classic' ? g.engine : 'nivå ' + (g.level || 2)))
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
    $('btn-arch-export').addEventListener('click', function () {
      var all = global.ARCH.dumpAll();
      if (!all.games.length) { UI.toast('Arkivet er tomt'); return; }
      downloadText(JSON.stringify(all, null, 1),
                   'sahkku-arkiv-' + new Date().toISOString().slice(0, 10) + '.json');
      UI.toast(all.games.length + ' parti lasta ned');
    });
    $('btn-arch-import').addEventListener('click', function () { $('arch-file').click(); });
    // ---- eksport: SPG (éi fil, mange parti) og SPGZ (zip) ---------------
    $('btn-arch-spg').addEventListener('click', function () {
      var r = global.ARCH.exportSpgText();
      if (!r.games) { UI.toast('Ingen parti med notasjon i arkivet'); return; }
      downloadText(r.text, 'sahkku-' + new Date().toISOString().slice(0, 10) + '.spg');
      UI.toast(r.games + ' parti skrivne til SPG' +
               (r.missing ? ' (' + r.missing + ' utan notasjon vart hoppa over)' : ''));
    });
    $('btn-arch-spgz').addEventListener('click', function () {
      global.ARCH.exportSpgzBlob().then(function (r) {
        var a = doc.createElement('a');
        a.href = URL.createObjectURL(r.blob);
        a.download = 'sahkku-' + new Date().toISOString().slice(0, 10) + '.spgz';
        doc.body.appendChild(a); a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
        UI.toast(r.files + ' parti i zip-fila');
      }, function (err) { UI.toast(err.message); });
    });
    $('arch-file').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      var rd = new FileReader();
      rd.onload = function () {
        var res, done = function (r) {
          if (!r) { UI.toast('Kunne ikkje lese fila'); return; }
          if (r.error && !r.added) { UI.toast(r.error); return; }
          renderArchive();
          UI.toast('Importerte ' + r.added + ' parti' +
                   (r.skipped ? ' (' + r.skipped + ' vart ikkje lesne)' : '') +
                   (r.error ? ' — ' + r.error : ''));
        };
        // Alt vert lese som BYTES og avgjort på innhaldet — ikkje på endinga
        // og ikkje på fyrste teiknet. (Ein .spg byrjar med «[Event …]», so
        // «byrjar på [ = JSON» var feil: JSON.parse kasta og fila vart avvist.)
        var bytes = new Uint8Array(rd.result);
        if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b &&
            bytes[2] === 0x03 && bytes[3] === 0x04) {          // PK\x03\x04 = zip
          global.ARCH.importSpgz(bytes)
            .then(done, function (err) { UI.toast('Zip: ' + err.message); });
          return;
        }
        var txt = new TextDecoder('utf-8').decode(bytes).replace(/^\uFEFF/, '');
        var obj = null;
        try { obj = JSON.parse(txt); } catch (err) { obj = null; }
        if (obj && (obj.games || Array.isArray(obj) || obj.steps || obj.fens)) {
          done(global.ARCH.importBundle(obj));
          return;
        }
        if (/SPG-V1|^\s*\[(Event|Menn|Koner|Date)\b/m.test(txt)) {
          done(global.ARCH.importSpg(txt));
          return;
        }
        UI.toast('Kjenner ikkje formatet — ventar JSON-arkiv, SPG eller SPGZ');
      };
      rd.onerror = function () { UI.toast('Kunne ikkje lese fila'); };
      rd.readAsArrayBuffer(f);
      e.target.value = '';
      e.target.value = '';
    });
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
    $('btn-load-fen').addEventListener('click', function () {
      if (app.st) $('fen-text').value = SS.toFEN(app.st);
      $('fen-error').textContent = '';
      $('fenload').showModal();
      setTimeout(function () { $('fen-text').focus(); }, 50);
    });
    $('btn-fen-do').addEventListener('click', loadFromFen);
    $('fen-text').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) loadFromFen();
    });
    $('btn-cpu').addEventListener('click', function () {
      app.mode = 'cpu';
      app.level = parseInt($('cpu-level').value, 10) || 2;
      app.engine = ($('cpu-engine') && $('cpu-engine').value) || 'classic';
      app.nesseby = !!($('chk-nesseby') && $('chk-nesseby').checked);
      if (app.engine !== 'classic' && !engReady()) {
        UI.toast('Lastar ' + engName(app.engine) + ' …');
        global.ENG.load(app.engine).then(function () {
          UI.toast(engName(app.engine) + ' klar');
          newGame();
        }, function (e) {
          UI.toast(engName(app.engine) + ' feila — spelar med klassisk CPU');
          if (global.console) console.warn('motor-last feila:', e);
          app.engine = 'classic';
          newGame();
        });
        return;
      }
      newGame();
    });
    if ($('cpu-engine')) {
      $('cpu-engine').addEventListener('change', function () {
        var id = $('cpu-engine').value;
        app.engine = id || 'classic';       // byte midt i partiet skal gjelde straks
        syncLevelSelect();
        if (id && id !== 'classic') {
          global.ENG.load(id).catch(function (e) {
            UI.toast(engName(id) + ' feila — klassisk CPU vert brukt');
            if (global.console) console.warn('motor-last feila:', e);
            $('cpu-engine').value = 'classic';
            syncLevelSelect();
          });
        }
      });
    }
    $('btn-local').addEventListener('click', function () { app.mode = 'local'; newGame(); });
    // «Autokast»: hugsar valet, og kastar med ein gong om vi alt ventar på kast
    app.autocast = readAutocast();
    if ($('chk-autocast')) {
      $('chk-autocast').checked = app.autocast;
      $('chk-autocast').addEventListener('change', function (e) {
        app.autocast = !!e.target.checked;
        writeAutocast(app.autocast);
        maybeAutocast(0);
      });
    }
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
    if (global.ENG && global.ENG.list) { global.ENG.list().then(fillEngines, fillEngines); }
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
      // Når ein ny SW tek over: last sida på nytt éin gong, so ein open fane
      // ikkje sit att med gamal kode (det var nettopp det som fekk det til å
      // sjå ut som om retta feil var tilbake).
      var hadSW = !!navigator.serviceWorker.controller, reloading = false;
      if (hadSW) {
        navigator.serviceWorker.addEventListener('controllerchange', function () {
          if (reloading) return;
          reloading = true;
          if (global.location) global.location.reload();
        });
      }
      navigator.serviceWorker.register('./sw.js').then(function (reg) {
        try { reg.update().catch(function () {}); } catch (e) {}
      }).catch(function () {});
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
