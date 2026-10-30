// SnartSáhkku — hovedkontroller: meny, spill-løkke, CPU, nett
(function (global) {
  'use strict';
  var SS = global.SS, UI = global.UI, CPU = global.CPU, NET = global.NET;
  var doc = global.document;
  function $(id) { return doc.getElementById(id); }

  // Språk: T() slår opp i gjeldande språkfil; sideName() gjev «Menn»/«Koner».
  var T = function (key, vars) { return global.I18N ? global.I18N.t(key, vars) : key; };
  function sideName(o) { return T(o === 0 ? 'side.Menn' : 'side.Koner'); }

  var app = {
    mode: 'cpu',       // 'cpu' | 'local' | 'online'
    me: 0,             // min spiller (online)
    level: 2,          // klassisk CPU: 1-3
    names: [null, null],   // spelarnamn (profil + motspelar i nettspel)
    engine: 'classic', // motor-id frå engines/engines.json; vert sett til manifestets
                       // «default» (nyaste modell) so snart lista er lasta
    st: null,
    host: false,       // online: vert = P0, autoritativ
    busy: false,
    over: false,
    autocast: false,   // «Autokast»: kast terningane automatisk når turen kjem
    enginePicked: false, // true når BRUKAREN har valt motor (ikkje berre startverdien)
    nesseby: true      // Nesseby-regelen er PÅ som standard (valfri, kan kryssast av)

  };
  var APP_VERSION = 'v1.28.0';   // hald i takt med index.html sin versjonstekst
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
    if (id === 'menu' && app._checkUpdate) setTimeout(app._checkUpdate, 150);
    if (id === 'game' && $('btn-leave')) {
      $('btn-leave').classList.toggle('hidden', app.mode !== 'online');
    }
    ['menu', 'room', 'profile', 'game', 'archive'].forEach(function (s) {
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
    updateNameLabels();
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
      if (e.type === 'king') UI.log(T('log.kingCaptured', { side: T(e.by === 0 ? 'side.menn' : 'side.koner') }), 'king');
    });
  }
  function checkEnd() {
    var st = app.st;
    if (st.winner == null) return false;
    app.over = true;
    var who = sideName(st.winner);
    var why = T({ dronning: 'end.reasonQueen', utryddelse: 'end.reasonAnnihilation',
                  overgivelse: 'end.reasonResign' }[st.winReason] || 'end.reasonQueen');
    app._endWin = { winner: st.winner, why: why };   // so språkbyte kan teikne dialogen på nytt
    UI.log(T('log.win', { side: who, reason: why }), 'win');
    $('end-title').textContent = T(st.winner === 0 ? 'end.winMenn' : 'end.winKoner');
    $('end-reason').textContent = why;
    $('endscore').showModal();
    archiveCurrentGame();
    UI.render();
    return true;
  }

  // Kva motoren vil gjere i ei omkast-stilling: hopp over, kast om, eller trekk.
  // Delt av den lokale og den fjernkøyrde vegen.
  function cpuDecide(act) {
    if (app.over) return;
    if (act && act.kind === 'pass') {
      UI.log(T('log.sideSkipped', { side: sideName(app.st.turn) }));
      SS.passRemaining(app.st);
      afterTurnChange();
      return;
    }
    if (act && act.kind === 'reroll') {
      SS.rerollX(app.st, undefined, (act.slot == null ? null : act.slot));
      UI.log(T('log.sideReroll', { side: sideName(app.st.turn) }));
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
    UI.log(T('log.sideXdead', { side: sideName(app.st.turn) }));
    SS.passRemaining(app.st);
    afterTurnChange();
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
        if (global.ENG && global.ENG.isRemote && global.ENG.isRemote(app.engine)) {
          global.ENG.actionAsync(app.engine, app.st).then(function (act) {
            if (!app.over) cpuDecide(act);
          }).catch(function (e) {
            UI.toast(T('remote.failed', { msg: global.REMOTE ? global.REMOTE.errText(e) : e.message }));
            cpuDecide(null);
          });
          return;
        }
        cpuDecide((global.ENG && global.ENG.ready(app.engine))
          ? global.ENG.action(app.engine, app.st) : null);
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
    if (app.mode === 'online' && app.host) { onlineSnapshot(); armAutoroll(); }
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
    UI.log(T('log.sideRolled', { side: sideName(app.st.turn), dice: app.st.dice.join(' ') }));
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

  function playEngineMove(mv) {
    if (!mv) { app.busy = false; settleAndContinue(); return; }
    var ev = SS.applyMove(app.st, mv);
    app.busy = false;
    announceEvents(ev);
    refresh();
    UI.markLastMove();
    settleAndContinue();
  }

  // Fjernmotor: trekket kjem over HTTP, so vi må vente asynkront. UI-en står
  // ikkje fast — han syner «tenkjer …» medan førespurnaden går.
  function remoteMove() {
    global.ENG.moveAsync(app.engine, app.st).then(function (mv) {
      if (app.over) { app.busy = false; return; }
      playEngineMove(mv || CPU.pick(app.st, app.level));
    }).catch(function (e) {
      app.busy = false;
      UI.toast(T('remote.failed', { msg: global.REMOTE ? global.REMOTE.errText(e) : e.message }));
      // klassisk reserve so partiet går vidare i staden for å henge
      playEngineMove(CPU.pick(app.st, app.level));
    });
  }

  function cpuPlay() {
    if (app.over) return;
    if (global.ENG && global.ENG.isRemote && global.ENG.isRemote(app.engine)) { remoteMove(); return; }
    var mv = null;
    if (global.ENG && global.ENG.ready(app.engine)) {
      mv = global.ENG.move(app.engine, app.st);   // {pid,dir,v,kind} | null
    }
    if (!mv) mv = CPU.pick(app.st, app.level); // klassisk CPU (òg reserve)
    playEngineMove(mv);
  }

  // ---------- interaktive handlinger ----------
  function onRoll() {
    if (app.mode === 'online') return onlineRoll();
    if (app.st.phase !== 'roll' || app.busy) return;
    SS.roll(app.st);
    var d = app.st.dice.slice();
    UI.log(T('log.youRolled', { dice: d.join(' ') }));
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
    if (r) UI.log(T('log.rerolled', { from: before.join(' '), to: r.join(' ') }));
    settleAndContinue();
  }
  function onPass() {
    if (app.mode === 'online') return onlinePass();
    var ev = SS.passRemaining(app.st);
    UI.log(T('log.skipped'));
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

  // ---------- profil ----------
  function profileFill() {
    if (!global.PROFILE) return;
    var pr = global.PROFILE.get();
    var nick = $('prof-nick'), real = $('prof-real'), prev = $('prof-avatar-preview');
    if (nick) nick.value = pr.nick || '';
    if (real) real.value = pr.realName || '';
    if (prev) { prev.src = global.PROFILE.url(pr.avatar); prev.alt = global.PROFILE.avatarLabel(pr.avatar); }
    renderAvatarGrid(pr.avatar);
    var badge = $('prof-name-badge');
    if (badge) badge.textContent = global.PROFILE.name();
    updateNameLabels();
  }

  function renderAvatarGrid(sel) {
    var grid = $('avatar-grid');
    if (!grid || !global.PROFILE) return;
    grid.innerHTML = '';
    global.PROFILE.avatars.forEach(function (id) {
      var b = doc.createElement('button');
      b.type = 'button';
      b.className = 'avatar-opt';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(id === sel));
      b.dataset.avatar = id;
      var img = doc.createElement('img');
      img.src = global.PROFILE.url(id);
      img.alt = '';
      img.loading = 'lazy';
      var nm = doc.createElement('span');
      nm.textContent = global.PROFILE.avatarLabel(id);
      b.appendChild(img); b.appendChild(nm);
      b.addEventListener('click', function () {
        grid.querySelectorAll('.avatar-opt').forEach(function (o) {
          o.setAttribute('aria-checked', String(o === b));
        });
        var prev = $('prof-avatar-preview');
        if (prev) { prev.src = global.PROFILE.url(id); prev.alt = global.PROFILE.avatarLabel(id); }
      });
      grid.appendChild(b);
    });
  }

  // Namnemerka på brettet — berre når vi veit namna.
  function updateNameLabels() {
    var l0 = $('label-p0'), l1 = $('label-p1');
    if (!l0 || !l1) return;
    var n0 = app.names && app.names[0], n1 = app.names && app.names[1];
    l0.textContent = n0 ? n0 + ' · ' + T('game.menn') : T('game.menn');
    l1.textContent = n1 ? n1 + ' · ' + T('game.koner') : T('game.koner');
  }

  function saveProfile() {
    if (!global.PROFILE) return;
    var pick = doc.querySelector('#avatar-grid .avatar-opt[aria-checked="true"]');
    global.PROFILE.set({
      nick: $('prof-nick') ? $('prof-nick').value : '',
      realName: $('prof-real') ? $('prof-real').value : '',
      avatar: pick ? pick.dataset.avatar : undefined
    });
    profileFill();
    UI.toast(T('profile.saved'));
    if (app.mode === 'online' && app.me != null) app.names[app.me] = global.PROFILE.name();
    updateNameLabels();
  }

  function wireOnlineSelfHeal() {
    clearInterval(app._heal);
    app._heal = setInterval(function () {
      if (app.mode !== 'online' || app.host || app.over || app.busy) return;
      var st = app.st;
      if (!st || st.winner != null) return;
      if (st.turn !== app.me) return;
      if (global.UI && UI.interactive) return;      // alt er bra
      sendNet({ t: 'sync' });
    }, 3000);
  }

  function wireProfile() {
    if (!global.PROFILE) return;
    global.PROFILE.init();
    var open = function () { profileFill(); show('profile'); };
    if ($('btn-profile')) $('btn-profile').addEventListener('click', open);
    if ($('btn-profile-menu')) $('btn-profile-menu').addEventListener('click', open);
    if ($('btn-profile-back')) $('btn-profile-back').addEventListener('click', function () { show('menu'); });
    if ($('btn-profile-save')) $('btn-profile-save').addEventListener('click', saveProfile);
    ['prof-nick', 'prof-real'].forEach(function (id) {
      if ($(id)) $(id).addEventListener('input', function () {
        var badge = $('prof-name-badge');
        if (!badge) return;
        var n = ($('prof-nick').value || '').trim() || ($('prof-real').value || '').trim() || T('profile.anon');
        badge.textContent = n;
      });
    });
    doc.addEventListener('langchange', function () { profileFill(); });
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
      if (op.rolls.length > 1) UI.log(T('log.opening', { n: ix + 1, p0: r.p0.join(' '), p1: r.p1.join(' ') }));
    });
    UI.log(T('log.openingFirst', { side: sideName(op.first) }));
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
        if (op.rolls.length > 1) UI.log(T('log.opening', { n: ix + 1, p0: r.p0.join(' '), p1: r.p1.join(' ') }));
      });
      UI.log(T('log.openingFirst', { side: sideName(op.first) }));
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
  // Gjesten kan miste eit snapshot (gossip er ikkje garantert levering). Då
  // står han fast: UI-en er skrudd av og ingen melding kjem. Denne vakthunden
  // ber om nytt snapshot til noko skjer — og ein roleg puls fangar alle andre
  // tilfelle der gjesten sit fast i eigen tur.
  // Om verten ikkje svarar i det heile (snapshot tapt), låser vi ikkje gjesten:
  // han får spele vidare på sin eigen (autoritative-nok) tilstand, og verten
  // validerer trekket uansett. Det er betre å kunne spele enn å fryse.
  function armUnstick() {
    if (app.mode !== 'online' || app.host) return;
    clearTimeout(app._us);
    var snaps = app._snaps || 0;
    app._us = setTimeout(function () {
      if (app.mode !== 'online' || app.host || app.over) return;
      if ((app._snaps || 0) !== snaps) return;            // svar kom
      if (app.st && app.st.winner != null) return;
      app.busy = false;
      UI.setInteractive(true);
      refresh();
      UI.toast(T('toast.slowLink'));
    }, 2500);
  }

  function armSyncWatchdog() {
    if (app.mode !== 'online' || app.host) return;
    clearTimeout(app._wd);
    var started = Date.now();
    var again = function () {
      if (app.mode !== 'online' || app.host || app.over) return;
      if (Date.now() - started > 15000) return;
      sendNet({ t: 'sync' });
      app._wd = setTimeout(again, 2500);
    };
    app._wd = setTimeout(again, 2500);
  }

  // Verten eig terningane. Om gjesten si kast-melding ikkje kjem fram (eller
  // vert ignorert fordi verten enno er i førre trekk), kastar verten sjølv
  // etter eit par sekund — spelet skal aldri kunne stoppe på ei tapt melding.
  function hostAutoroll() {
    clearTimeout(app._ar);
    if (app.mode !== 'online' || !app.host || app.over || !app.st) return;
    if (app.st.turn !== 1 || app.st.phase !== 'roll' || app.st.winner != null) return;
    SS.roll(app.st);
    app.st.phase = 'move';
    UI.log(T('log.sideRolled', { side: sideName(1), dice: app.st.dice.join(' ') }));
    refresh();
    onlineSnapshot();
    settleAndContinue();
  }

  function armAutoroll() {
    clearTimeout(app._ar);
    if (app.mode !== 'online' || !app.host) return;
    if (!app.st || app.st.turn !== 1 || app.st.phase !== 'roll') return;
    app._ar = setTimeout(hostAutoroll, 1600);
  }

  function onlineSnapshot() {
    sendNet({ t: 'state', s: JSON.parse(SS.serialize(app.st)) });
  }
  function applySnapshot(s) {
    app._snaps = (app._snaps || 0) + 1;
    app.st = SS.deserialize(s.s);
    app.over = app.st.winner != null;
    app.busy = false;
    clearTimeout(app._rt);
    clearInterval(app._ri);
    clearTimeout(app._wd);
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
      UI.log(T('log.youRolled', { dice: app.st.dice.join(' ') }));
      onlineSnapshot();
      settleAndContinue();
    } else {
      // Gjesten eig ikkje terningane; han ber verten kaste. Meldinga kan
      // kome fram medan verten enno er i førre trekk, so vi held fram til eit
      // snapshot svarar (applySnapshot nullstiller app.busy) — maks 6 forsøk.
      app.busy = true; refresh();
      clearTimeout(app._rt);
      clearInterval(app._ri);
      var tries = 0;
      var ask = function () {
        if (!app.busy || app.mode !== 'online') return;
        if (app.st.turn !== app.me || app.st.phase !== 'roll') { app.busy = false; refresh(); return; }
        if (++tries > 6) { app.busy = false; sendNet({ t: 'sync' }); refresh(); return; }
        sendNet({ t: 'rollreq' });
      };
      ask();
      app._ri = setInterval(ask, 1200);
      armUnstick();
    }
  }
  function onlineReroll(slot) {
    if (app.st.turn !== app.me) return;
    if (app.host) {
      var r = SS.rerollX(app.st, undefined, slot);
      if (r) { UI.log(T('log.rerolledX', { dice: r.join(' ') })); onlineSnapshot(); }
      settleAndContinue();
    } else {
      app.busy = true; refresh();
      sendNet({ t: 'reroll', slot: slot });
      armSyncWatchdog();
      armUnstick();
      clearTimeout(app._rt);
      app._rt = setTimeout(function () { if (app.busy) { app.busy = false; sendNet({ t: 'sync' }); refresh(); } }, 6000);
    }
  }
  function onlineMove(mv) {
    if (app.st.turn !== app.me) return;
    if (app.host) {
      var legal = SS.legalMoves(app.st, app.st.turn).some(function (m) {
        return m.pid === mv.pid && m.v === mv.v && m.kind === mv.kind && (m.dir === mv.dir);
      });
      if (!legal) { UI.toast(T('log.illegal')); return; }
      var ev = SS.applyMove(app.st, mv);
      announceEvents(ev);
      UI.clearSelection();
      onlineSnapshot();
      refresh(); UI.markLastMove();
      settleAndContinue();
    } else {
      UI.setInteractive(false);
      sendNet({ t: 'move', mv: mv });
      armSyncWatchdog();
      armUnstick();
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
      sendNet({ t: 'pass' });
      clearTimeout(app._rt);
      clearInterval(app._ri);
      app._ri = setInterval(function () {
        if (!app.busy || app.mode !== 'online') { clearInterval(app._ri); return; }
        if (app.st.turn !== app.me) { clearInterval(app._ri); app.busy = false; refresh(); return; }
        sendNet({ t: 'sync' });
      }, 1500);
    }
  }
  function onlineResign() {
    if (app.host) {
      app.st.winner = 1 - app.st.turn; app.st.winReason = 'overgivelse'; app.st.phase = 'over';
      onlineSnapshot(); checkEnd();
    } else {
      sendNet({ t: 'resign' });
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
          if (p.rolls.length > 1) UI.log(T('log.opening', { n: ix + 1, p0: r.p0.join(' '), p1: r.p1.join(' ') }));
        });
        UI.log(T('log.openingFirst', { side: sideName(x(lastR.p0) > x(lastR.p1) ? 0 : 1) }));
        return;
      }
      var side = p.t === 0 ? 'Menn' : 'Koner';
      p.roll.forEach(function (d, ix) {
        UI.log(side + (ix > 0 ? ' kasta om X-ene: ' : ': kast ') + d.join(' '));
      });
      p.mv.forEach(function (m) {
        var nm = m.t === 'k' ? T('piece.king') : m.t === 'q' ? T('piece.queen') : sideName(m.o);
        if (m.rel) UI.log(T('log.released', { piece: nm, sq: SS.sqName(m.to) }));
        else UI.log(nm + ' ' + SS.sqName(m.from) + '→' + SS.sqName(m.to) + (m.k > 0 ? ' ' + T('log.took', { n: m.k }) : '') + (m.kg ? T('log.capturedKing') : ''));
      });
    });
    if (st.winner != null) UI.log('SEIER: ' + (st.winner === 0 ? 'Menn' : 'Koner') + '! ' + (st.winReason || ''), 'win');
  }
  // Alle partimeldingar går gjennom her so kamp-id-en (g) alltid kjem med:
  // fleire parti kan gå i same rom, og da må mottakaren kunne skilje dei.
  function sendNet(obj) {
    if (!global.NET || !NET.ready) return;
    if (app.gameId && obj.g === undefined) obj.g = app.gameId;
    NET.send(obj);
  }

  // Lobby: kven er i rommet, og kven utfordrar kven.
  function initLobby() {
    if (!global.LOBBY) return;
    global.LOBBY.init({
      send: function (o) { NET.send(o); },          // utfordringar treng ingen kamp-id
      render: renderLobby,
      profile: function () {
        return global.PROFILE ? { name: global.PROFILE.name(), avatar: global.PROFILE.get().avatar } : null;
      },
      onStart: function (gameId, isHost, other) {
        app.gameId = gameId;
        app.host = isHost;
        app.me = isHost ? 0 : 1;
        app.onlineStarted = true;
        // Namn på begge sider: vår eigen profil + motparten sitt hello/chal.
        var mine = global.PROFILE ? global.PROFILE.name() : '';
        var theirs = (global.LOBBY && LOBBY.state.profiles && LOBBY.state.profiles[other] || {}).name || '';
        app.names[app.me] = mine || T('profile.anon');
        app.names[1 - app.me] = theirs || NET.short(other || '');
        updateNameLabels();
        $('chaldlg').close();
        UI.toast(T('lobby.challenged', { name: NET.short(NET.peers[0] || '') }));
        newOnlineGame();                             // vert lagar partiet; gjest ventar på snapshot
      },
      onInvite: function (inv) {
        $('chal-text').textContent = T('lobby.incoming', { name: inv.short });
        $('chaldlg').showModal();
      },
      onOutcome: function (kind, from) {
        UI.toast(T(kind === 'no' ? 'lobby.declined' : 'lobby.busy', { name: NET.short(from) }));
        renderLobby();
      }
    });
  }

  function renderLobby() {
    var box = $('lobby-list');
    if (!box || !global.LOBBY) return;
    var st = global.LOBBY.state;
    box.innerHTML = '';
    var others = (st.peers || []).filter(function (id) { return id !== st.myId; });
    if (!others.length) {
      var li = doc.createElement('li');
      li.className = 'lobby-empty';
      li.textContent = T('lobby.needOpponent');
      box.appendChild(li);
      return;
    }
    others.forEach(function (id) {
      var li = doc.createElement('li');
      li.className = 'lobby-row';
      var prof = (st.profiles && st.profiles[id]) || {};
      if (prof.avatar) {
        var av = doc.createElement('img');
        av.className = 'lobby-av';
        av.src = 'img/avatars/avatar-' + prof.avatar + '.jpg';
        av.alt = '';
        li.appendChild(av);
      }
      var nm = doc.createElement('span');
      nm.textContent = prof.name || NET.short(id);
      li.appendChild(nm);
      if (st.pending && st.pending.to === id) {
        var wait = doc.createElement('em');
        wait.textContent = T('lobby.waiting', { name: NET.short(id) });
        li.appendChild(wait);
      } else if (st.gameId) {
        var busy = doc.createElement('em');
        busy.textContent = T('lobby.busy', { name: NET.short(id) });
        li.appendChild(busy);
      } else {
        var b = doc.createElement('button');
        b.className = 'ghost';
        b.textContent = T('lobby.challenge');
        b.addEventListener('click', function () {
          if (global.LOBBY.challenge(id)) UI.toast(T('lobby.challenged', { name: NET.short(id) }));
        });
        li.appendChild(b);
      }
      box.appendChild(li);
    });
  }

  function wireNet() {
    NET.handlers.onStatus = function (s) {
      $('net-status').textContent = s;
    };
    NET.handlers.onPeers = function (peers) {
      $('peer-list').textContent = peers.length ? peers.map(NET.short).join(', ') : T('room.noPeers');
      var me = NET.myId ? NET.short(NET.myId) : '—';
      $('my-node').textContent = me;
      if (app.mode === 'online') {
        // Rommet er ein lobby: alle ser kven som er innom, og eit parti byrjar
        // berre når to av dei har avtalt det med ei utfordring. Før starta
        // appen eit parti automatisk så snart nokon kom inn — det gav ein
        // ufrivillig kamp kvar gong ein tredje person dukka opp.
        global.LOBBY.setIdentity(NET.myId);
        global.LOBBY.setPeers(peers);
        var connected = peers.length > 0;
        if (connected && app.onlineStarted && app.st) {
          // gjenkopling midt i eit parti: vert sender autoritativt snapshot
          if (app.host) onlineSnapshot(); else sendNet({ t: 'sync' });
          return;
        }
        if (!connected && app.st && !app.over) UI.toast(T('toast.peerLost'));
      }
    };
    NET.handlers.onMsg = function (m) {
      var d = m.data;
      // Utfordringar og svar går føre spelmeldingane
      if (global.LOBBY && global.LOBBY.onMsg(d)) return;
      // Partimeldingar ber ein kamp-id når vi er i lobby-modus: to andre kan
      // spele i same rom, og dei meldingane skal ikkje røre vårt parti.
      if (d.g && app.gameId && d.g !== app.gameId) return;
      if (d.g && !app.gameId) return;
      if (d.t === 'state') {
        if (!app.host) applySnapshot(d);
        return;
      }
      if (!app.host) return;   // berre verten utfører
      var foe = 1;              // gjesten sin side
      if (d.t === 'rollreq') {
        clearTimeout(app._ar);
        // Verten er den einaste som kastar (autoritativ RNG). Kan vi ikkje
        // kaste no — t.d. fordi meldinga kom før vi sjølve var ferdige med
        // førre trekk — svarar vi med eit snapshot i staden for å teie:
        // då nullstiller gjesten «ventar»-flagget og kan trykkje på nytt.
        // (Før vart slike meldingar kasta, og spelet sto og hang.)
        if (app.st.phase === 'roll' && app.st.turn === foe) {
          SS.roll(app.st);
          app.st.phase = 'move';
          UI.log(T('log.sideRolled', { side: sideName(foe), dice: app.st.dice.join(' ') }));
          refresh();
          onlineSnapshot();
          // Kast utan brukande terningar skal avslutte turen med éin gong.
          settleAndContinue();
        } else {
          onlineSnapshot();
        }
      } else if (d.t === 'reroll') {
        if (app.st.turn === foe && SS.canRerollX(app.st)) {
          SS.rerollX(app.st, undefined, (d.slot == null ? null : d.slot));
          UI.log(T('log.rerolledX', { dice: app.st.dice.join(' ') }));
          refresh();
          onlineSnapshot();
        } else {
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
    var m = { event: { cpu: T('spg.eventCpu'), local: T('spg.eventLocal'), online: T('spg.eventOnline') }[app.mode] || 'Sáhkku-parti' };
    // SPG 1.2: tidspunktet partiet byrja ([Date]/[Time]/[UTC]), ikkje no.
    if (app.startTs) m.start = app.startTs;
    m.comment = 'SnartSáhkku ' + APP_VERSION +
      (app.mode === 'cpu' ? ', mot ' + (global.ENG ? global.ENG.name(app.engine) : app.engine) : '') +
      '. ' + T('spg.comment');
    // Datamaskin-merke etter standarden: «(c) <motor>». Koner er CPU-en.
    // Profilen er namnet vårt i notasjonen (SPG 1.1: «Etternamn, Fornamn»).
    var meName = global.PROFILE ? global.PROFILE.spgName() : '';
    if (meName) m.menn = meName;
    if (app.mode === 'online') {
      if (app.names && app.names[0]) m.menn = app.names[0];
      if (app.names && app.names[1]) m.koner = app.names[1];
    }
    if (app.mode === 'cpu') {
      m.koner = 'Gálgut (c) ' + (app.engine === 'classic'
        ? T('spg.classicLevel', { n: app.level })
        : (global.ENG ? global.ENG.name(app.engine) : app.engine));
    }
    if (app.nesseby) m.event += ' — Nesseby';
    return m;
  }
  app.spgMeta = spgMeta;      // testbart handtak (tests/profile.test.js)
  app.refresh = refresh;

  // Kva notasjon skal lastast ned no?
  //   - I GJENNOMGANGEN er app.st ein oppspela tilstand frå arkivet. Han har
  //     inga `log` (trekka vart spela opp på nytt, ikkje registrerte), so
  //     SPG.toSPG gav eit hovud utan trekk. Der må den LAGRA teksten brukast.
  //   - Elles: generer frå den levande tilstanden, som før.
  function currentSpgText() {
    if (app.mode === 'review' && review && review.rec) {
      return review.rec.spg || '';
    }
    if (app.st && app.st.log && app.st.log.length) {
      return global.SPG.toSPG(app.st, spgMeta());
    }
    if (app.lastRec && app.lastRec.spg) return app.lastRec.spg;
    return global.SPG.toSPG(app.st, spgMeta());
  }

  function exportSpg() {
    if (!app.st) return;
    var txt = currentSpgText();
    if (!txt) { UI.toast(T('toast.noSpgGames')); return; }
    var fname = 'sahkku-' + fileStamp(app.mode === 'review' && review && review.rec
      ? (review.rec.utc || review.rec.ts) : app.startTs) + '.spg';
    try {
      var blob = new Blob([txt], { type: 'text/plain' });
      var a = doc.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = fname;
      doc.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
      UI.log(T('log.notationExported', { fname: fname }));
    } catch (e) {
      // fallback: kopier til utklippstavla
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(function () { UI.log(T('log.notationCopied')); });
      }
    }
  }

  // ---------- motorar (fleire samtidig) ----------
  function engName(id) { return global.ENG ? global.ENG.name(id) : id; }
  function engReady() { return global.ENG && global.ENG.ready(app.engine); }

  // Testkrok: let testane drive den verkelege settle-/kaste-vegen
  global.__settle = settleAndContinue;
  global.__fileStamp = fileStamp;
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
    (global.ENG.listPublic ? global.ENG.listPublic() : global.ENG.list()).then(function (engines) {
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
      // Behald valet om det finst i lista — men berre når BRUKAREN har valt.
      // Startverdien er 'classic', som òg finst i lista; vart han handsama som
      // eit val, fekk alle klassisk CPU som standard i staden for manifestets
      // «default» (den nyaste modellen).
      var finst = app.enginePicked && engines.some(function (e) { return e.id === app.engine; });
      if (!finst) {
        var want = global.ENG.defaultId ? global.ENG.defaultId() : null;
        app.engine = want && engines.some(function (e) { return e.id === want; })
          ? want : engines[0].id;
      }
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
      $('fen-error').textContent = T('fen.invalid', { msg: (e && e.message ? e.message : e) });
      return;
    }
    app.st = st;
    app.fens = [];
    app.archived = false;
    app.over = st.winner != null;
    if (app.mode === 'menu' || app.mode === 'online') app.mode = 'local';
    $('fenload').close();
    UI.clearLog();
    UI.log(T('toast.fenLoaded', { info: T(st.turn === 0 ? 'side.menn' : 'side.koner') }));
    show('game');
    if (st.winner != null) { refresh(); UI.toast(T('toast.gameOverPosition')); return; }
    if (st.phase === 'roll') { rollPhase(); return; }
    refresh();
    if (!humanTurn() && app.mode === 'cpu') setTimeout(cpuStep, D(500));
  }

  // ---------- knytters ----------

  // ---------- arkiv: lagre, liste, avspele, slette ----------
  var review = null, prevMode = 'cpu';

  // Filnamn med UTC-tidsstempel: 2026-10-29T1220Z. Sorterbart, og utan
  // kolon so det går på alle filsystem. `iso` kan vere eit partis starttid.
  function fileStamp(iso) {
    var d = iso ? new Date(iso) : new Date();
    if (isNaN(d.getTime())) d = new Date();
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()) +
      'T' + p(d.getUTCHours()) + p(d.getUTCMinutes()) + 'Z';
  }

  function downloadText(txt, fname) {
    try {
      var blob = new Blob([txt], { type: 'text/plain' });
      var a = doc.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = fname;
      doc.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    } catch (e) { UI.toast(T('toast.downloadFailed')); }
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
    var lagra = global.ARCH.save(rec);
    if (lagra) { app.lastId = rec.id || (lagra && lagra.id); UI.log(T('log.savedToArchive')); }
    app.lastRec = rec;
  }

  function archRow(g) {
    var when = new Date(g.ts);
    var dateStr = when.toLocaleDateString() + ' ' + String(when.getHours()).padStart(2, '0') + ':' +
                  String(when.getMinutes()).padStart(2, '0');
    var mode = g.mode === 'cpu'
      ? ('CPU ' + (g.engine && g.engine !== 'classic' ? g.engine : T('archive.cpuLevel', { n: g.level || 2 })))
      : (g.mode === 'local' ? T('archive.local') : T('archive.online'));
    var res = g.result === '1-0' ? T('archive.resultMenn') : (g.result === '0-1' ? T('archive.resultKoner') : T('archive.resultOpen'));
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
    mkBtn(T('archive.view'), '', function () { openReplay(g.id); });
    mkBtn('SPG', 'ghost', function () {
      downloadText(g.spg || '', 'sahkku-' + fileStamp(g.utc || g.ts) + '.spg');
    });
    mkBtn(T('archive.delete'), 'ghost', function () { global.ARCH.remove(g.id); renderArchive(); });
    row.appendChild(acts);
    return row;
  }

  function renderArchive() {
    var box = $('arch-list');
    box.innerHTML = '';
    var games = global.ARCH.list();
    if (!games.length) {
      box.innerHTML = '<p class="arch-empty">' + T('archive.empty') + '</p>';
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

  function openReplay(idOrRec) {
    var rec = (typeof idOrRec === 'string') ? global.ARCH.get(idOrRec) : idOrRec;
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
      if (!all.games.length) { UI.toast(T('toast.archiveEmpty')); return; }
      downloadText(JSON.stringify(all, null, 1),
                   'sahkku-arkiv-' + new Date().toISOString().slice(0, 10) + '.json');
      UI.toast(T('toast.imported', { n: all.games.length }));
    });
    $('btn-arch-import').addEventListener('click', function () { $('arch-file').click(); });
    // ---- eksport: SPG (éi fil, mange parti) og SPGZ (zip) ---------------
    $('btn-arch-spg').addEventListener('click', function () {
      var r = global.ARCH.exportSpgText();
      if (!r.games) { UI.toast(T('toast.noSpgGames')); return; }
      downloadText(r.text, 'sahkku-arkiv-' + fileStamp() + '.spg');
      UI.toast(T('toast.exportedSpg', { n: r.games }) +
               (r.missing ? ' (' + r.missing + ' utan notasjon vart hoppa over)' : ''));
    });
    $('btn-arch-spgz').addEventListener('click', function () {
      global.ARCH.exportSpgzBlob().then(function (r) {
        var a = doc.createElement('a');
        a.href = URL.createObjectURL(r.blob);
        a.download = 'sahkku-arkiv-' + fileStamp() + '.spgz';
        doc.body.appendChild(a); a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
        UI.toast(T('toast.exportedZip', { n: r.files }));
      }, function (err) { UI.toast(err.message); });
    });
    // Importerer frå RÅ BYTES og avgjer formatet på innhaldet — ikkje på
    // endinga eller fyrste teiknet. ZIP, JSON, SPG og BILETE (SPG i EXIF) går
    // gjennom same vegen, so filveljaren, delingsruta og «opne med» deler henne.
    function importBytes(bytes, done) {
      done = done || function () {};
      if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b &&
          bytes[2] === 0x03 && bytes[3] === 0x04) {              // PK\x03\x04 = zip
        global.ARCH.importSpgz(bytes).then(done, function (err) {
          UI.toast('Zip: ' + err.message);
        });
        return;
      }
      // Bilete: PNG (89 50 4E 47) eller JPEG (FF D8) — les EXIF og ta SPG der
      if ((bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e) ||
          (bytes[0] === 0xff && bytes[1] === 0xd8)) {
        var ex = global.EXIF ? global.EXIF.read(bytes) : null;
        if (ex && ex.spg) { done(global.ARCH.importSpg(ex.spg)); return; }
        UI.toast(T('toast.noSpgInImage'));
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
      UI.toast(T('toast.unknownFormat'));
    }

    function afterImport(r) {
      if (!r) { UI.toast(T('toast.readFailed')); return; }
      if (r.error && !r.added) { UI.toast(r.error); return; }
      renderArchive();
      UI.toast(T('toast.imported', { n: r.added }) +
               (r.skipped ? ' ' + T('toast.importSkipped', { n: r.skipped }) : '') +
               (r.error ? ' — ' + r.error : ''));
    }
    app.importBytes = importBytes;         // so delingsruta kan bruke henne
    app.afterImport = afterImport;

    $('arch-file').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      var rd = new FileReader();
      rd.onload = function () { importBytes(new Uint8Array(rd.result), afterImport); };
      rd.onerror = function () { UI.toast(T('toast.readFailed')); };
      rd.readAsArrayBuffer(f);
      e.target.value = '';
    });
    $('btn-arch-clear').addEventListener('click', function () {
      if (!global.ARCH.list().length) { UI.toast(T('toast.archiveEmpty')); return; }
      if (global.confirm && !global.confirm(T('archive.confirmClear'))) return;
      global.ARCH.clear(); renderArchive(); UI.toast(T('toast.archiveCleared'));
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
          UI.toast(engName(app.engine) + ' ' + T('toast.engineFailed'));
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
        app.enginePicked = true;            // no er dette eit VAL, ikkje startverdien
        syncLevelSelect();
        if (id && id !== 'classic') {
          global.ENG.load(id).catch(function (e) {
            UI.toast(engName(id) + ' ' + T('toast.engineFailed'));
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
      if (!resumeGame()) { UI.toast(T('toast.noSavedGame')); show('menu'); }
    });
    $('btn-spg').addEventListener('click', exportSpg);
    $('btn-export-spg').addEventListener('click', exportSpg);
    $('btn-fen').addEventListener('click', function () {
      if (!app.st) return;
      var fen = SS.toFEN(app.st);
      function done() { UI.toast('FEN kopiert'); UI.log('FEN: ' + fen); }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(fen).then(done, function () { UI.log('FEN: ' + fen); UI.toast(T('toast.copyFailed')); });
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
        if (global.LOBBY && LOBBY.hello) LOBBY.hello();
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
        $('room-hint').textContent = T('room.inviteHint');
        app.mode = 'online';
        app.onlineStarted = false;
        app.host = NET.isLowest();
        app.me = app.host ? 0 : 1;
        if (global.LOBBY && LOBBY.hello) LOBBY.hello();
      } catch (e) {
        UI.toast(T('toast.joinFailed', { msg: e.message }));
        $('room-hint').textContent = 'Feil: ' + e.message;
      }
      $('btn-join').disabled = false;
    });
    $('btn-copy-invite').addEventListener('click', async function () {
      var code = $('invite-code').textContent;
      try { await navigator.clipboard.writeText(code); UI.toast('Invitasjonskodel kopiert'); }
      catch (e) { UI.toast(T('toast.copyManual')); }
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
    // Forlating av eit nettparti: kopie ned, GLØYM det lagra partiet, og gå
    // til menyen. Utan clearSave() dreg boot() deg rett inn i det same rommet
    // att ved neste oppstart — det var «ingen veg ut av eit dødt nettparti».
    function leaveOnline() {
      if (app.mode !== 'online') return;
      try { NET.leave(); } catch (e) { /* nettverket kan alt vere borte */ }
      app.onlineStarted = false;
      app.busy = false;
      app.gameId = null;
      if (global.LOBBY) global.LOBBY.reset();
      clearSave();
      UI.toast('Forlét nettpartiet');
    }
    $('btn-back-menu').addEventListener('click', function () {
      leaveOnline(); app.mode = 'menu'; show('menu');
    });
    $('btn-menu').addEventListener('click', function () {
      leaveOnline(); app.mode = 'menu'; show('menu');
    });
    // Eigen knapp i spelet: «Forlat» for nettparti (Gi seg krev samband)
    if ($('btn-leave')) {
      $('btn-leave').addEventListener('click', function () {
        leaveOnline(); app.mode = 'menu'; show('menu');
      });
    }
    // Slutten av eit parti -> gjennomgang. Dialogen syner resultatet fyrst;
    // når ho vert lukka (kryss, Escape) går vi rett i gjennomgangen, so ein
    // alltid kan sjå attende på partiet utan å leite i arkivet.
    $('endscore').addEventListener('close', function () {
      if (app._noReview) { app._noReview = false; return; }
      if (app.mode === 'online') return;
      if (app.lastRec && global.ARCH.totalMoves(app.lastRec) > 0) openReplay(app.lastRec);
    });
    $('btn-review').addEventListener('click', function () {
      app._noReview = true;
      $('endscore').close();
      if (app.lastRec) openReplay(app.lastRec);
    });
    // Del bilete: PNG av stillinga med SPG-notasjonen i EXIF. Vert brukt både
    // frå sluttdialogen (sluttstillinga) og frå gjennomgangen (den stillinga
    // ein står på — so ein kan dele akkurat det trekket ein vil vise).
    function sharePosition(rec, at, total) {
      var st = app.st;
      if (!st || !global.SHARE) return;
      rec = rec || {};
      var spg = rec.spg || ((global.SPG && global.SPG.toSPG) ? global.SPG.toSPG(st, spgMeta()) : '');
      var stamp = fileStamp();
      var stilling = (at != null && total != null) ? (' · ' + T('review.position') + ' ' + at + '/' + total) : '';
      SHARE.image(st, {
        spg: spg,
        software: 'SnartSáhkku ' + APP_VERSION,
        title: st.winner == null ? T('share.titleOpen') : T('share.titleWin', { side: sideName(st.winner) }),
        subtitle: (app.mode === 'cpu' ? ('CPU: ' + (app.engine === 'classic' ? 'nivå ' + app.level : app.engine)) : ''),
        footer: (st.winner == null ? '—' : sideName(st.winner)) + ' · ' +
                T({ dronning: 'share.queenOut', utryddelse: 'share.annihilated', overgivelse: 'share.resigned' }[st.winReason] || 'share.unfinished') +
                ' · ' + T('share.moves', { n: st.moves || 0 }) + (st.nesseby ? ' · Nesseby' : '') + stilling,
        stamp: stamp.slice(0, 10) + ' ' + stamp.slice(11, 13) + ':' + stamp.slice(13, 15) + ' UTC · snart.com/sahkku'
      }).then(function (img) {
        return SHARE.share(img.blob, 'sahkku-' + stamp + '.png', 'Sáhkku');
      }).then(function (kva) {
        UI.toast(kva === 'delt' ? T('toast.shared') : T('toast.downloaded'));
      }).catch(function (e) {
        UI.toast(T('toast.imageFailed', { msg: e.message }));
      });
    }
    $('btn-share').addEventListener('click', function () { sharePosition(app.lastRec, null, null); });
    // …og frå gjennomgangen: delar stillinga ein står på, ikkje sluttstillinga
    if ($('btn-share-rev')) {
      $('btn-share-rev').addEventListener('click', function () {
        if (!review) return;
        sharePosition(review.rec, review.at, review.total);
      });
    }
    $('btn-rematch').addEventListener('click', function () {
      app._noReview = true;
      $('endscore').close();
      if (app.mode === 'online') {
        if (app.host) newOnlineGame();   // vert: nytt oppningsritual + snapshot
        // gjesten: ventar på verten sin snapshot
      } else newGame();
    });
    $('btn-endmenu').addEventListener('click', function () {
      app._noReview = true;
      $('endscore').close();
      if (app.mode === 'online') NET.leave();
      app.mode = 'menu'; show('menu');
    });
    // ---- fjernmotor over HTTP -------------------------------------------
    function remoteSelect() {
      if (!global.ENG || !global.REMOTE || !global.REMOTE.connected) return;
      var e = global.ENG.addRemote({ name: global.REMOTE.name() });
      fillEngines();
      app.engine = e.id;
      app.enginePicked = true;
      if ($('cpu-engine')) $('cpu-engine').value = e.id;
      UI.toast(T('remote.ok', { name: global.REMOTE.name() }));
    }
    if ($('btn-remote')) {
      $('btn-remote').addEventListener('click', function () {
        if (global.REMOTE) {
          $('remote-url').value = global.REMOTE.url() || '';
          $('remote-key').value = global.REMOTE.state.key || '';
        }
        $('remote-status').textContent = '';
        $('remotedlg').showModal();
      });
      $('btn-remote-connect').addEventListener('click', function () {
        var url = ($('remote-url').value || '').trim();
        var key = $('remote-key').value || '';
        if (!url) { $('remote-status').textContent = T('remote.noUrl'); return; }
        $('remote-status').textContent = T('remote.connecting');
        $('btn-remote-connect').disabled = true;
        global.REMOTE.connect(url, key).then(function (info) {
          $('btn-remote-connect').disabled = false;
          $('remote-status').textContent = T('remote.ok', { name: info.name });
          remoteSelect();
          setTimeout(function () { $('remotedlg').close(); }, 600);
        }).catch(function (e) {
          $('btn-remote-connect').disabled = false;
          $('remote-status').textContent = T('remote.failed', { msg: e.message });
        });
      });
      $('btn-remote-forget').addEventListener('click', function () {
        if (global.REMOTE) global.REMOTE.clear();
        $('remote-status').textContent = T('remote.forgotten');
      });
    }
    // Attoppkopling: er adresse og nøkkel lagra, prøver vi stille ved oppstart
    // (feilar ho, er det ingen ting å seie — tenaren kan vere nede).
    if (global.REMOTE && global.REMOTE.url()) {
      setTimeout(function () {
        global.REMOTE.connect(global.REMOTE.url(), global.REMOTE.state.key)
          .then(function () { remoteSelect(); })
          .catch(function () { /* stille */ });
      }, 400);
    }

    // ---- utfordring i lobbyen ------------------------------------------
    if ($('btn-chal-accept')) {
      $('btn-chal-accept').addEventListener('click', function () {
        $('chaldlg').close();
        global.LOBBY.accept();
      });
      $('btn-chal-decline').addEventListener('click', function () {
        $('chaldlg').close();
        global.LOBBY.decline();
      });
      // Del lenkje: ein annan kan opne ho og hamne rett i rommet hjå meg
      $('btn-share-challenge').addEventListener('click', function () {
        if (!NET.seed) { UI.toast(T('lobby.needOpponent')); return; }
        var url = location.origin + location.pathname +
                  '#challenge=' + encodeURIComponent(NET.seed) + '&to=' + encodeURIComponent(NET.myId || '');
        var done = function () { UI.toast(T('lobby.linkCopied')); };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url).then(done, function () { UI.log(url); });
        } else { UI.log(url); done(); }
      });
    }

    $('btn-help').addEventListener('click', function () { $('rules').showModal(); });
    doc.querySelectorAll('[data-close]').forEach(function (b) {
      b.addEventListener('click', function () { b.closest('dialog').close(); });
    });
  }

  // Last språkfila FØR appen teiknar, so ingen tekst blinkar på feil språk.
  function boot() {
    if (global.I18N) {
      global.I18N.init().then(function () {
        if (global.THEME) global.THEME.init();
    wireProfile();
    wireOnlineSelfHeal();
        return startApp();
      }).catch(function (e) {
        if (global.console) console.warn('i18n feila:', e);
        startApp();
      });
    } else startApp();
  }

  // Delingslenkjer: #challenge=<rom>&to=<node-id> opnar rommet og utfordrar
  // med ein gong; #lobby=<rom> opnar berre rommet. Fungerer både i nettlesaren
  // og i den installerte appen (same URL, same scope).
  function deepLink() {
    var h = String(location.hash || '').replace(/^#/, '');
    if (!h) return false;
    var q = {};
    h.split('&').forEach(function (kv) {
      var i = kv.indexOf('=');
      if (i > 0) q[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1));
    });
    var seed = q.challenge || q.lobby || q.room;
    if (!seed) return false;
    app.mode = 'online';
    app.onlineStarted = false;
    app.gameId = null;
    show('room');
    $('room-seed').value = seed;
    $('room-hint').textContent = T('room.connecting');
    $('btn-join').disabled = true;
    NET.load().then(function () {
      $('my-node').textContent = NET.short(NET.myId);
      // ta med motparten sin node-id som bootstrap so vi finn kvarandre
      return NET.join(q.to ? seed + '#' + q.to : seed);
    }).then(function () {
      $('invite-code').textContent = NET.seed + '#' + NET.myId;
      $('invite-row').style.display = '';
      $('room-hint').textContent = T('lobby.hint');
      if (global.LOBBY) global.LOBBY.setIdentity(NET.myId);
      if (global.LOBBY && q.challenge) {
        var id = global.LOBBY.challenge(q.to);
        if (id) UI.toast(T('lobby.challenged', { name: NET.short(q.to) }));
      }
      try { history.replaceState({}, '', location.pathname + location.search); } catch (e) {}
    }).catch(function (e) {
      $('room-hint').textContent = T('toast.joinFailed', { msg: e.message });
      $('btn-join').disabled = false;
    });
    return true;
  }

  function startApp() {
    // Språkbyte midt i bruk: teikn alt på nytt med nye tekstar.
    doc.addEventListener('langchange', function () {
      if (app.st) UI.render();
      if (app.mode === 'archive') renderArchive();
      if (app._endWin && $('endscore').open) {
        $('end-title').textContent = T(app._endWin.winner === 0 ? 'end.winMenn' : 'end.winKoner');
        $('end-reason').textContent = app._endWin.why;
      }
    });
    wireUI();
    initLobby();
    wireNet();
    if ('serviceWorker' in navigator) {
      // Ny SW tek over -> sidan må lastast på nytt for å bruke den nye koden.
      // Men: ALDRI midt i eit parti (ein mistar stillinga og kan hamne i ein
      // ny fane), og ALDRI i løkke. Difor: vent til vi er i menyen, og bruk
      // location.replace (inga ny historie-oppføring).
      var hadSW = !!navigator.serviceWorker.controller;
      var RELOAD_KEY = 'sahkku.reloadedAt';
      function canReloadNow() {
        return !app.st || app.over || app.mode === 'menu' || app.mode === 'review';
      }
      function reloadForUpdate() {
        try {
          var last = Number(global.sessionStorage.getItem(RELOAD_KEY) || 0);
          if (last && Date.now() - last < 60000) return false;   // hindrar løkke
          global.sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
        } catch (e) { /* privat modus */ }
        if (global.location) global.location.replace(global.location.href);
        return true;
      }
      function pendingUpdate() {
        app._updateReady = true;
        if (canReloadNow()) { reloadForUpdate(); return; }
        UI.toast(T('toast.newVersion'));
      }
      if (hadSW) navigator.serviceWorker.addEventListener('controllerchange', pendingUpdate);
      app._checkUpdate = function () {           // kallast når vi kjem til menyen
        if (app._updateReady && canReloadNow()) reloadForUpdate();
      };
      navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then(function (reg) {
        try { reg.update().catch(function () {}); } catch (e) {}
      }).catch(function () {});
    }
    var rec = peekSave();
    if (rec && rec.st && rec.st.winner == null) {
      $('btn-resume').classList.remove('hidden');
      var what = { cpu: 'CPU-parti', local: 'to spelarar', online: 'nettparti' }[rec.mode] || 'parti';
      $('btn-resume').textContent = '▶ Fortsett ' + what + ' (' + SS.name(SS.king(rec.st).at) + ' · ' + (rec.st.turn === 0 ? 'Menn' : 'Koner') + ' i trekket)';
      // nettparti: gjenopprett rommet automatisk berre om det er FERSKT.
      // Eit dødt rom frå ein tidlegare dag skal ikkje ta over skjermen; då
      // ligg partiet i arkivet/menyen i staden.
      var _ferskt = (function () {
        try {
          var t = Date.parse(rec.ts || '');
          return !isNaN(t) && (Date.now() - t) < 6 * 3600 * 1000;
        } catch (e) { return false; }
      })();
      if (rec.mode === 'online' && rec.room && _ferskt) {
        app.mode = 'online'; app.onlineStarted = false;
        show('room');
        $('room-seed').value = rec.room;
        $('btn-join').disabled = true;
        $('room-hint').textContent = T('room.connecting');
        NET.load().then(function () {
          $('my-node').textContent = NET.short(NET.myId);
          return NET.join(rec.room);
        }).then(function () {
          $('invite-code').textContent = NET.seed + '#' + NET.myId;
          $('invite-row').style.display = '';
          $('room-hint').textContent = T('room.reopened');
          $('btn-join').disabled = false;
          $('btn-resume').click();   // gjenopprett partiet frå lagring
        }).catch(function (e) {
          $('room-hint').textContent = T('toast.reconnectFailed', { msg: e.message });
          $('btn-join').disabled = false;
        });
        return;
      }
    }
    // ---- delingslenkje, delt fil og «opne med» --------------------------
    // Web Share Target: service workeren legg den delte fila i cachen og
    // sender brukaren hit. Vi les henne, importerer, og ryddar etter oss.
    function importShared() {
      if (!global.caches) return;
      global.caches.open('sahkku-share-v1').then(function (c) {
        return c.match('/__shared__').then(function (res) {
          if (!res) return null;
          return c.delete('/__shared__').then(function () { return res.arrayBuffer(); });
        });
      }).then(function (buf) {
        if (!buf) return;
        show('archive');
        if (app.importBytes) app.importBytes(new Uint8Array(buf), app.afterImport);
        try { history.replaceState({}, '', location.pathname); } catch (e) {}
      }).catch(function () { /* ingen delt fil */ });
    }

    // «Opne med» på skrivebordet (Chromium): installert PWA får fila her.
    if (global.launchQueue && global.launchQueue.setConsumer) {
      global.launchQueue.setConsumer(function (params) {
        var files = (params && params.files) || [];
        if (!files.length) return;
        files[0].getFile().then(function (f) {
          return f.arrayBuffer();
        }).then(function (buf) {
          show('archive');
          if (app.importBytes) app.importBytes(new Uint8Array(buf), app.afterImport);
        }).catch(function () { /* ikkje lesbar */ });
      });
    }

    // Ei lenkje vinn over ein delt fil, og då skal vi IKKJE hamne i menyen —
    // før vart 'show(menu)' køyrt uansett, so rommet vart skjult att med ein gong.
    if (!deepLink()) {
      importShared();
      show('menu');
    }
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot);
  else boot();
  global.APP = app;
})(typeof globalThis !== 'undefined' ? globalThis : this);
