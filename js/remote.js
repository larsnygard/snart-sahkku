// Fjernmotor over HTTP(S) — ein S-UCI-motor som køyrer på ein annan maskin.
//
// Protokoll (sjå sahkku_ai/server.py):
//   GET  /v1/info   → {name, protocol}                      handtrykk
//   POST /v1/move   → {move: "O1-O2"}   body {fen: "<S-UCI-FEN>"}
//   Auth: Authorization: Bearer <nøkkel>   (eller X-API-Key)
//
// Appen er dommaren: han sender stillinga som FEN og får eit trekk-token
// tilbake, som vert matcha mot sin eigen lovlege pool. Svarar tenaren noko
// anna enn eit lovleg trekk, vert det avvist her — ein fjernmotor kan altso
// ikkje øydeleggje eit parti.
//
// Nøkkelen vert lagra i localStorage (berre i denne nettlesaren). Han skal
// ALDRI i repoet eller i engines.json, som er offentleg.
(function (global) {
  'use strict';
  var T = function (key, vars) { return global.I18N ? global.I18N.t(key, vars) : key; };

  var STORE = 'sahkku.remote.v1';
  var TIMEOUT = 20000;
  var st = { url: '', key: '', name: '', connected: false, ms: 0, err: null };

  function base(u) { return String(u || '').trim().replace(/\/+$/, ''); }

  function load() {
    try {
      var j = JSON.parse(global.localStorage.getItem(STORE) || '{}');
      st.url = base(j.url || '');
      st.key = String(j.key || '');
    } catch (e) { /* privat modus */ }
    return st;
  }

  function save(url, key) {
    st.url = base(url);
    st.key = String(key || '');
    try {
      global.localStorage.setItem(STORE, JSON.stringify({ url: st.url, key: st.key }));
    } catch (e) { /* privat modus */ }
  }

  function clear() {
    st.url = ''; st.key = ''; st.name = ''; st.connected = false; st.err = null;
    try { global.localStorage.removeItem(STORE); } catch (e) { /* ignore */ }
  }

  // ---- HTTP ---------------------------------------------------------------
  function request(path, opts) {
    opts = opts || {};
    if (!st.url) return Promise.reject(new Error(T('remote.noUrl')));
    var ctrl = (global.AbortController ? new global.AbortController() : null);
    var hdrs = { Accept: 'application/json' };
    if (st.key) hdrs.Authorization = 'Bearer ' + st.key;
    if (opts.body) hdrs['Content-Type'] = 'application/json';
    var init = { method: opts.method || 'GET', headers: hdrs, credentials: 'omit' };
    if (ctrl) init.signal = ctrl.signal;
    if (opts.body) init.body = JSON.stringify(opts.body);
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, TIMEOUT);

    return global.fetch(st.url + path, init).then(function (r) {
      clearTimeout(timer);
      return r.text().then(function (txt) {
        var j = {};
        try { j = txt ? JSON.parse(txt) : {}; } catch (e) { j = {}; }
        if (!r.ok) {
          var err = new Error(j.error || ('HTTP ' + r.status));
          err.status = r.status;
          err.detail = j;
          throw err;
        }
        return j;
      });
    }, function (e) {
      clearTimeout(timer);
      var err = new Error(e && e.name === 'AbortError' ? T('remote.timeout') : T('remote.unreachable'));
      err.network = true;
      throw err;
    });
  }

  function errText(e) {
    if (!e) return '';
    if (e.status === 401) return T('remote.badKey');
    if (e.status === 429) return T('remote.rateLimited');
    if (e.status === 400) return T('remote.badRequest') + ' ' + (e.message || '');
    if (e.status) return 'HTTP ' + e.status + ': ' + (e.message || '');
    return e.message || String(e);
  }

  // ---- handtrykk ----------------------------------------------------------
  function connect(url, key) {
    var before = { url: st.url, key: st.key };
    st.url = base(url);
    st.key = String(key || '');
    return request('/v1/info').then(function (j) {
      save(st.url, st.key);
      st.name = (j && j.name) || 'engine';
      st.connected = true;
      st.err = null;
      return { name: st.name, protocol: (j && j.protocol) || 1 };
    }).catch(function (e) {
      st.url = before.url; st.key = before.key;
      st.connected = false;
      st.err = errText(e);
      throw new Error(st.err);
    });
  }

  // ---- trekk --------------------------------------------------------------
  // Speglar runner_template sin encode(): FROM-TO med bindestrek, òg for løysing
  // (frå heimefeltet til feltet framfor).
  function tokenOf(s, mv) {
    var p = global.SS.piece(s, mv.pid);
    if (p.t === 's') {
      var from = global.SS.soldierAt(p.o, p.at);
      var to = global.SS.soldierAt(p.o, p.at + (mv.kind === 'rel' ? 1 : mv.v));
      return global.SS.sqName(from) + '-' + global.SS.sqName(to);
    }
    return global.SS.sqName(p.at) + '-' + global.SS.sqName(global.SS.moveDest(s, mv));
  }

  function matchToken(s, tok) {
    var pool = global.SS.legalMoves(s, s.turn);
    for (var i = 0; i < pool.length; i++) {
      if (tokenOf(s, pool[i]) === tok) return pool[i];
    }
    return null;
  }

  // Svarar motoren «pass»/«reroll»/«none», vert det ei avgjerd, ikkje eit trekk.
  function action(s) {
    var t0 = Date.now();
    return request('/v1/move', { method: 'POST', body: { fen: global.SS.toFEN(s) } })
      .then(function (j) {
        st.ms = Date.now() - t0;
        st.err = null;
        var tok = String((j && j.move) || '').trim();
        if (!tok || tok === 'none') return null;
        if (tok === 'pass') return { kind: 'pass' };
        if (tok === 'reroll') return { kind: 'reroll', slot: null };
        var mv = matchToken(s, tok);
        if (!mv) {
          st.err = T('remote.illegal', { move: tok });
          var e = new Error(st.err);
          e.illegal = true;
          throw e;
        }
        return { kind: 'move', mv: mv };
      });
  }

  function move(s) {
    return action(s).then(function (a) { return a && a.kind === 'move' ? a.mv : null; });
  }

  load();

  global.REMOTE = {
    get state() { return st; },
    get connected() { return !!(st.connected && st.url); },
    url: function () { return st.url; },
    name: function () { return st.name; },
    connect: connect, clear: clear, action: action, move: move,
    errText: errText, matchToken: matchToken, tokenOf: tokenOf
  };
})(window);
