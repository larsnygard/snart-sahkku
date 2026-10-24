// SnartSáhkku — hovedkontroller: meny, spill-løkke, CPU, nett
(function (global) {
  'use strict';
  var SS = global.SS, UI = global.UI, CPU = global.CPU, NET = global.NET;
  var doc = global.document;
  function $(id) { return doc.getElementById(id); }

  var app = {
    mode: 'cpu',       // 'cpu' | 'local' | 'online'
    me: 0,             // min spiller (online)
    level: 2,
    st: null,
    host: false,       // online: vert = P0, autoritativ
    busy: false,
    over: false
  };

  function D(ms) { return (typeof globalThis !== 'undefined' && globalThis.__FAST) ? 30 : ms; }

  // ---------- skjermbytter ----------
  function show(id) {
    ['menu', 'room', 'game'].forEach(function (s) {
      $(s).classList.toggle('hidden', s !== id);
    });
  }

  // ---------- spillflyt (lokalt: cpu/local) ----------
  function humanTurn() {
    if (app.mode === 'online') return app.st.turn === app.me;
    return app.mode === 'local' || (app.mode === 'cpu' && app.st.turn === 0);
  }
  function refresh() {
    UI.st = app.st;
    UI.render();
    UI.markLastMove();
    UI.setInteractive(!app.busy && !app.over && app.st.winner == null && humanTurn());
  }
  function describeMv(mv) {
    var st = app.st, p = SS.piece(st, mv.pid);
    var who = p.o === 0 ? 'Menn' : 'Koner';
    if (p.t === 'k') return who + ': kongen ' + SS.name(p.at) + ' → ' + SS.name(SS.pathFor(st, p, mv.dir, mv.v).path.slice(-1)[0]);
    if (p.t === 'q') return who + ': dronninga ' + SS.name(p.at) + ' → ' + SS.name(SS.pathFor(st, p, mv.dir, mv.v).path.slice(-1)[0]);
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
    if (checkEnd()) { if (app.mode === 'online') NET.send(snapshotMsg()); return; }
    rollPhase();
    if (app.mode === 'online' && app.host) NET.send(snapshotMsg());
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
    var mv = CPU.pick(app.st, app.level);
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
    if (app.mode === 'online') {
      if (app.host) {
        // vert: anvend pass lokalt, send autoritativ snapshot
        var ev = SS.passRemaining(app.st);
        announceEvents(ev);
        NET.send(snapshotMsg());
        afterTurnChange();
      } else NET.send({ t: 'pass' });
      return;
    }
    var ev = SS.passRemaining(app.st);
    UI.log('Gjenværende terninger ble sprunget over');
    announceEvents(ev);
    afterTurnChange();
  }
  function onSurrender() {
    if (app.over) return;
    if (app.mode === 'online') { NET.send({ t: 'resign' }); }
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
    var first = SS.openingRoll().first;
    app.st = SS.newGame({ first: first });
    UI.clearLog();
    UI.log('Åpning: ' + (first === 0 ? 'Menn' : 'Koner') + ' begynner');
    UI.flip = (app.mode === 'cpu' || app.mode === 'local') ? false : (app.me === 1);
    show('game');
    refresh();
    rollPhase();
    if (!humanTurn()) setTimeout(cpuTurn, D(700));
  }
  function newOnlineGame() {
    app.over = false;
    app.st = SS.newGame({ first: 0 });
    UI.clearLog();
    UI.flip = app.me === 1;
    show('game');
    refresh();
    app.st.phase = 'roll'; app.st.dice = []; app.st.used = [];
    if (app.host) {
      // vert: kast åpning
      SS.roll(app.st);
      app.st.phase = 'move';
      NET.send({ t: 'roll', dice: app.st.dice.slice() });
      UI.log('Du kastet ' + app.st.dice.join(' '));
      settleAndContinue();
    }
  }

  // ---------- nettverk ----------
  function snapshotMsg() {
    var s = JSON.parse(SS.serialize(app.st));
    s.phase = 'roll';   // tur-oversyting: gjesten skal kaste selv
    return { t: 'state', s: s };
  }
  function applySnapshot(s) {
    app.st = SS.deserialize(s.s);
    app.over = app.st.winner != null;
    UI.clearSelection();
    refresh();
    UI.markLastMove();
    if (app.over) checkEnd();
  }
  function onlineRoll() {
    if (app.st.turn !== app.me) return;
    SS.roll(app.st);
    app.st.phase = 'move';
    NET.send({ t: 'roll', dice: app.st.dice.slice() });
    UI.log('Du kastet ' + app.st.dice.join(' '));
    settleAndContinue();
  }
  function onlineReroll() {
    var r = SS.rerollX(app.st);
    if (r) { NET.send({ t: 'roll', dice: app.st.dice.slice() }); UI.log('Kastet om X-ene'); }
    settleAndContinue();
  }
  function onlineMove(mv) {
    if (app.st.turn !== app.me) return;
    if (app.host) {
      // vert: valider og anvend, send snapshot
      var legal = SS.legalMoves(app.st, app.st.turn).some(function (m) {
        return m.pid === mv.pid && m.v === mv.v && m.kind === mv.kind && (m.dir === mv.dir);
      });
      if (!legal) { UI.toast('Ulovlig trekk'); return; }
      var ev = SS.applyMove(app.st, mv);
      announceEvents(ev);
      NET.send(snapshotMsg());
      refresh(); UI.markLastMove();
      settleAndContinue();
    } else {
      NET.send({ t: 'move', mv: mv });
      UI.setInteractive(false);
    }
  }
  function onlinePass() {
    NET.send({ t: 'pass' });
  }
  function onlineNetApplyMove(mv) {
    // vert mottar trekk fra gjest: valider
    var legal = SS.legalMoves(app.st, app.st.turn).some(function (m) {
      return m.pid === mv.pid && m.v === mv.v && m.kind === mv.kind && (m.dir === mv.dir);
    });
    if (!legal) { NET.send(snapshotMsg()); return; }   // resynk
    var ev = SS.applyMove(app.st, mv);
    announceEvents(ev);
    NET.send(snapshotMsg());
    refresh(); UI.markLastMove();
    settleAndContinue();
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
          if (app.host) {
            NET.send({ t: 'start', s: JSON.parse(SS.serialize(app.st)) });
            $('room-hint').textContent = 'Du er vert — du kaster først.';
          } else {
            $('room-hint').textContent = 'Motspilleren er vert og starter.';
          }
          return;
        }
        if (!connected && app.st && !app.over) UI.toast('Motspiller forsvant');
      }
    };
    NET.handlers.onMsg = function (m) {
      var d = m.data;
      if (d.t === 'roll') {
        app.st.dice = d.dice; app.st.used = d.dice.map(function (x) { return x === '_'; });
        app.st.phase = 'move';
        UI.log('Motspiller kastet ' + d.dice.join(' '));
        refresh();
      } else if (d.t === 'move') {
        if (app.host) onlineNetApplyMove(d.mv);
      } else if (d.t === 'state') {
        if (!app.host) {
          applySnapshot(d);
          // om vertens snapshot sier det er min tur men jeg mangler terninger:
          // be om kast (defensiv re-synk mot tapte roll-beskeder)
          var st = app.st;
          if (st.phase === 'roll' && st.turn === app.me && !st.dice.length && !app.busy) {
            app.busy = true;
            SS.roll(st);
            app.st.phase = 'move';
            app.busy = false;
            NET.send({ t: 'roll', dice: st.dice.slice() });
            UI.log('Du kastet ' + st.dice.join(' '));
            settleAndContinue();
          }
        }
      } else if (d.t === 'start') {
        if (!app.host) { app.onlineStarted = true; applySnapshot(d); }
      } else if (d.t === 'pass') {
        if (app.host) {
          var ev = SS.passRemaining(app.st);
          UI.log('Motspiller hoppet over resten');
          NET.send(snapshotMsg());
          afterTurnChange();
        }
      } else if (d.t === 'resign') {
        app.st.winner = app.me; app.st.winReason = 'overgivelse'; app.st.phase = 'over';
        checkEnd();
      }
    };
  }

  // ---------- knytters ----------
  function wireUI() {
    UI.init({
      onRoll: onRoll, onReroll: onReroll, onPass: onPass,
      onMove: onMove, onSurrender: onSurrender
    });
    $('btn-cpu').addEventListener('click', function () {
      app.mode = 'cpu'; app.level = parseInt($('cpu-level').value, 10) || 2;
      newGame();
    });
    $('btn-local').addEventListener('click', function () { app.mode = 'local'; newGame(); });
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
        if (app.host) { newOnlineGame(); NET.send({ t: 'start', s: JSON.parse(SS.serialize(app.st)) }); }
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
    show('menu');
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot);
  else boot();
  global.APP = app;
})(typeof globalThis !== 'undefined' ? globalThis : this);
