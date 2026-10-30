// engines.js — motorregister: fleire S-UCI-motorar i same app.
//
// Kva motorar som finst ligg i engines/engines.json, so nye modellar kan
// leggjast til utan å røre koden:
//   { "engines": [
//       { "id": "classic", "name": "Klassisk CPU", "type": "classic" },
//       { "id": "ail0.1",  "name": "AIL0.1", "type": "nn",
//         "script": "engines/ail0.1.js", "weights": "engines/ail0.1.weights.json" } ] }
//
// Kvar NN-motor er ein eigen modul: den fyrste lastinga les scriptet, tek vare
// på modulhandtaket (global NN vert overskrive av neste motor) og lastar
// vektene sine. Sidan kvar modul held CFG/T for seg sjølv, kan fleire leve
// samtidig.
//
// API:  ENG.list()          -> Promise<[{id,name,type,…}]>
//       ENG.load(id)        -> Promise<bool>     (idempotent, lazy)
//       ENG.ready(id)       -> bool
//       ENG.move(id, st)    -> {pid,dir,v,kind} | null
//       ENG.name(id)        -> visingsnamn
(function (global) {
  'use strict';
  var T = function (key, vars) { return global.I18N ? global.I18N.t(key, vars) : key; };
  var MANIFEST = 'engines/engines.json';
  var list = null;                 // [{id,name,type,…}] — ALLE, òg pensjonerte
  var defaultId = null;            // manifestets «default» (nyaste motor)
  var mods = {};                   // id -> {mod, ready, err}

  // Pensjonerte motorar (engines.json: "retired": true) skal ikkje visast i
  // appen, men dei må framleis kunne slåast opp med namn (arkivparti som vart
  // spela mot AIL0.3 skal heite AIL0.3, ikkje «ail0.3»). Difor held list() på
  // heile manifestet medan listPublic() er det veljaren får.
  // Lokal samanlikning: legg til ?engines=all i adressa.
  var showRetired = false;
  try {
    showRetired = /(?:^|[?&])engines=all(?:&|$)/.test((global.location && global.location.search) || '');
  } catch (e) { /* inga location */ }

  // Promise, som list() — kallarane gjer .then(...) på resultatet.
  function listPublic() {
    return fetchList().then(function () {
      return showRetired ? list : list.filter(function (e) { return !e.retired; });
    });
  }

  function fallback() {
    return [{ id: 'classic', name: 'Klassisk CPU', type: 'classic' }];
  }

  function fetchList() {
    if (list) return Promise.resolve(list);
    return fetch(MANIFEST, { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) {
        var e = (j && j.engines) || [];
        list = e.length ? e : fallback();
        defaultId = (j && j["default"]) || null;
        if (defaultId && !list.some(function (x) { return x.id === defaultId; })) defaultId = null;
        return list;
      })
      .catch(function () { list = fallback(); return list; });
  }

  function byId(id) {
    var hit = (list || []).filter(function (e) { return e.id === id; })[0];
    return hit || null;
  }

  // Fjernmotor: REMOTE held sambandet; «lasting» er berre eit handtrykk.
  function addRemote(info) {
    var entry = { id: 'remote', name: 'Fjernmotor — ' + ((info && info.name) || '?'),
                  type: 'remote', url: global.REMOTE ? global.REMOTE.url() : '' };
    list = (list || []).filter(function (e) { return e.id !== 'remote'; }).concat([entry]);
    mods.remote = { ready: true, err: null, mod: null };
    return entry;
  }

  function load(id) {
    var e = byId(id);
    if (e && e.type === 'remote') {
      return Promise.resolve(!!(global.REMOTE && global.REMOTE.connected));
    }
    if (!e || e.type !== 'nn') return Promise.resolve(false);
    if (mods[id] && mods[id].ready) return Promise.resolve(true);
    if (mods[id] && mods[id].pending) return mods[id].pending;

    var entry = mods[id] = { ready: false, err: null, mod: null };
    entry.pending = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = e.script;
      s.async = true;
      s.onload = function () {
        try {
          var mod = global.NN;                       // scriptet sett global NN
          if (!mod || !mod.exported) throw new Error('NN.exported manglar i ' + e.script);
          entry.mod = mod;
          return fetch(e.weights, { cache: 'force-cache' })
            .then(function (r) {
              if (!r.ok) throw new Error('vekter: HTTP ' + r.status);
              return r.json();
            })
            .then(function (w) {
              mod.exported.loadWeights(w);
              if (e.lookahead != null) mod.exported.setLookahead(e.lookahead);
              entry.ready = true;
              resolve(true);
            });
        } catch (err) { reject(err); }
      };
      s.onerror = function () { reject(new Error(T('engines.notFound') + e.script)); };
      document.head.appendChild(s);
    }).catch(function (err) {
      entry.err = err;
      entry.pending = null;
      throw err;
    });
    return entry.pending;
  }

  function ready(id) {
    var e = byId(id);
    if (e && e.type === 'remote') return !!(global.REMOTE && global.REMOTE.connected);
    return !!(mods[id] && mods[id].ready);
  }

  // Asynkrone variantar: lokale motorar svarar straks, fjernmotorar over HTTP.
  // CPU-løkka i main.js brukar desse, so ho ikkje må blokkere på eit nett.
  function actionAsync(id, st) {
    var e = byId(id);
    if (e && e.type === 'remote') return global.REMOTE.action(st);
    return Promise.resolve(action(id, st));
  }

  function moveAsync(id, st) {
    var e = byId(id);
    if (e && e.type === 'remote') return global.REMOTE.move(st);
    var mv = move(id, st);
    return mv ? Promise.resolve(mv) : Promise.resolve(null);
  }

  function move(id, st) {
    var m = mods[id];
    if (!m || !m.ready || !m.mod) return null;
    try {
      var mv = m.mod.exported.chooseMove(st);
      return (mv && mv.pid !== undefined) ? mv : null;
    } catch (e) {
      if (global.console) console.warn('engine ' + id + ': ' + T('engines.moveFailed'), e);
      return null;
    }
  }

  // NN-motoren si eiga avgjerd òg for omkast/pass (ikkje berre trekk)
  function action(id, st) {
    var m = mods[id];
    if (!m || !m.ready || !m.mod) return null;
    try {
      if (typeof m.mod.exported.chooseAction !== 'function') return null;
      return m.mod.exported.chooseAction(st);
    } catch (e) { return null; }
  }

  function name(id) {
    var e = byId(id);
    return e ? e.name : id;
  }
  function type(id) {
    var e = byId(id);
    return e ? (e.type || 'classic') : 'classic';
  }

  global.ENG = {
    listPublic: listPublic,
    list: fetchList, byId: byId, load: load, ready: ready, move: move, action: action,
    moveAsync: moveAsync, actionAsync: actionAsync, addRemote: addRemote,
    isRemote: function (id) { var e = byId(id); return !!(e && e.type === 'remote'); },
    // standardmotor frå manifestet (til dømes den nyaste modellen), elles null
    defaultId: function () { return defaultId; },
    name: name, type: type, error: function (id) { return mods[id] && mods[id].err; }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
