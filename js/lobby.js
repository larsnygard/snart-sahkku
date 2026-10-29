// Lobby: eit rom der fleire er innom, og to av dei kan avtale eit parti.
//
// Før var eit rom alltid eit parti mellom dei to som var der. No er rommet ein
// stad: alle ser kven som er innom, og kven som helst kan utfordre ein annan.
// Sjølve partiet går framleis over same rom (iroh-gossip), men alle
// partimeldingar ber eit «g»-felt med kamp-id, so dei tre andre i rommet
// overser dei. Det gjer at fleire parti kan gå samtidig i same rom utan at
// nokon må opne nye topic-ar.
//
// Meldingar:
//   {t:'chal',     id, from, to}    utfordring
//   {t:'chal-no',  id, from}        avslag
//   {t:'chal-yes', id, from}        ja takk
//   {t:'chal-busy',id, from}        oppteken
// Vert = den lågaste node-id-en av dei to (deterministisk, so båe er samde
// utan ein ekstra rundtur).
(function (global) {
  'use strict';
  var T = function (key, vars) { return global.I18N ? global.I18N.t(key, vars) : key; };

  var L = {
    myId: null,
    peers: [],
    pending: null,      // {id, from} — eg har utfordra nokon
    incoming: null,     // {id, from} — nokon har utfordra meg
    gameId: null,       // kamp-id når eit parti er i gang
    hooks: {}           // render, send, onStart
  };

  function short(id) { return (id || '').slice(0, 8); }

  function init(hooks) {
    L.hooks = hooks || {};
    return L;
  }

  function setIdentity(myId) { L.myId = myId; }

  function setPeers(peers) {
    L.peers = (peers || []).slice().sort();
    if (L.hooks.render) L.hooks.render({ peers: L.peers, myId: L.myId,
                                          pending: L.pending, incoming: L.incoming,
                                          gameId: L.gameId, short: short });
  }

  function send(obj) {
    if (L.hooks.send) L.hooks.send(obj);
  }

  function newId() {
    return 'c' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
  }

  function challenge(to) {
    if (!to || to === L.myId) return null;
    if (L.pending || L.gameId) return null;              // éi utfordring om gongen
    var id = newId();
    L.pending = { id: id, to: to };
    send({ t: 'chal', id: id, from: L.myId, to: to });
    if (L.hooks.render) setPeers(L.peers);
    return id;
  }

  // Verten er den lågaste id-en av dei to — same regel på båe sider.
  function hostFor(a, b) { return (a || '') <= (b || '') ? a : b; }

  function startGame(id, other) {
    L.gameId = id;
    L.pending = null;
    L.incoming = null;
    var host = hostFor(L.myId, other) === L.myId;
    if (L.hooks.onStart) L.hooks.onStart(id, host, other);
    if (L.hooks.render) setPeers(L.peers);
  }

  function onMsg(m) {
    if (!m || !m.t) return false;
    if (m.t === 'chal') {
      if (m.to && m.to !== L.myId) return true;          // ikkje til meg
      if (L.gameId) { send({ t: 'chal-busy', id: m.id, from: L.myId }); return true; }
      if (L.incoming) { send({ t: 'chal-busy', id: m.id, from: L.myId }); return true; }
      L.incoming = { id: m.id, from: m.from };
      if (L.hooks.onInvite) L.hooks.onInvite({ id: m.id, from: m.from, short: short(m.from) });
      if (L.hooks.render) setPeers(L.peers);
      return true;
    }
    if (m.t === 'chal-no' || m.t === 'chal-busy') {
      if (L.pending && L.pending.id === m.id) {
        L.pending = null;
        if (L.hooks.onOutcome) L.hooks.onOutcome(m.t === 'chal-no' ? 'no' : 'busy', m.from);
      }
      return true;
    }
    if (m.t === 'chal-yes') {
      // eg utfordra, og fekk ja → start partiet
      if (L.pending && L.pending.id === m.id) { startGame(m.id, m.from); return true; }
      // eg svara ja, og motparten stadfesta → start
      if (L.incoming && L.incoming.id === m.id) { startGame(m.id, m.from); return true; }
      return true;
    }
    return false;
  }

  function accept() {
    if (!L.incoming) return null;
    var m = L.incoming;
    send({ t: 'chal-yes', id: m.id, from: L.myId });
    startGame(m.id, m.from);
    return m.id;
  }

  function decline() {
    if (!L.incoming) return false;
    send({ t: 'chal-no', id: L.incoming.id, from: L.myId });
    L.incoming = null;
    if (L.hooks.render) setPeers(L.peers);
    return true;
  }

  function reset() {
    L.pending = null; L.incoming = null; L.gameId = null;
    if (L.hooks.render) setPeers(L.peers);
  }

  global.LOBBY = {
    init: init, setIdentity: setIdentity, setPeers: setPeers,
    challenge: challenge, accept: accept, decline: decline, reset: reset,
    onMsg: onMsg, hostFor: hostFor,
    get state() { return L; }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
