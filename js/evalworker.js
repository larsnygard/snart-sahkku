// evalworker.js — stillingsvurdering i eigen tråd.
//
// Alpha-beta-en i S-UCI-motoren er rein JS og kan bruke fleire sekund på ei
// stilling (kastfasen reknar 64 utfall). Køyrer vi han i hovudtråden, frys
// brettet og knappane. Difor: motoren vert lasta her, og svaret kjem som ei
// melding når det er klart.
//
//   {type:'load',  script, weights, lookahead}   -> {type:'ready'} | {type:'error'}
//   {type:'score', id, fen, depth, nodes}        -> {type:'score', id, value} | {type:'error', id}
'use strict';
var mod = null;

function post(m) { self.postMessage(m); }

function answer(m) {
  var v = mod.exported.scoreFen(m.fen, m.depth || 0, m.nodes || 1500);
  post({ type: 'score', id: m.id, value: v });
}

self.onmessage = function (e) {
  var m = e.data || {};
  if (m.type === 'load') {
    try {
      if (!mod) { importScripts(m.script); mod = self.NN; }
      if (!mod || !mod.exported || typeof mod.exported.scoreFen !== 'function') {
        throw new Error('motoren kan ikkje score stillingar (scoreFen manglar)');
      }
      fetch(m.weights, { cache: 'force-cache' })
        .then(function (r) { if (!r.ok) throw new Error('vekter: HTTP ' + r.status); return r.json(); })
        .then(function (w) {
          mod.exported.loadWeights(w);
          if (m.lookahead != null) mod.exported.setLookahead(m.lookahead);
          post({ type: 'ready' });
          if (m.fen) answer(m);            // «load og score i same slag»
        })
        .catch(function (err) { post({ type: 'error', id: m.id, error: String(err) }); });
    } catch (err) {
      post({ type: 'error', id: m.id, error: String(err) });
    }
  } else if (m.type === 'score') {
    try {
      if (!mod) throw new Error('motoren er ikkje lasta');
      answer(m);
    } catch (err) {
      post({ type: 'error', id: m.id, error: String(err) });
    }
  }
};
