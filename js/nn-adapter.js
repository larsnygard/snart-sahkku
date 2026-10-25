// nn-adapter — lastar den nevrale S-UCI-motoren (sahkku-ai) i nettlesaren.
//
// Motoren er same fil som Node brukar (engines/sahkku-nn.js): ho inneheld
// reglane (injiserte frå js/engine.js + js/fen.js) og nettgrafen i rein JS.
// Han vert LAST LAZY — berre når spelaren vel «Nevral (NN)» — fordi vektene er
// fleire MB. Vektene hentast éin gong og vert liggjande i SW-cachen.
//
// API:  SahkkuNN.load() -> Promise<bool>   (idempotent)
//       SahkkuNN.ready() -> bool
//       SahkkuNN.move(state) -> {pid,dir,v,kind} | null
//       SahkkuNN.setLookahead(k)
(function (global) {
  'use strict';
  var ENGINE_URL = 'engines/sahkku-nn.js';
  var WEIGHTS_URL = 'engines/sahkku-nn.weights.json';
  var loading = null, ready = false, err = null;

  function load() {
    if (ready) return Promise.resolve(true);
    if (loading) return loading;
    loading = new Promise(function (resolve, reject) {
      if (global.NN && global.NN.exported) return resolve(true);   // alt lasta
      var s = document.createElement('script');
      s.src = ENGINE_URL;
      s.async = true;
      s.onload = function () {
        try {
          if (!global.NN || !global.NN.exported) throw new Error('NN.exported manglar');
          return fetch(WEIGHTS_URL)
            .then(function (r) {
              if (!r.ok) throw new Error('vekter: HTTP ' + r.status);
              return r.json();
            })
            .then(function (w) {
              global.NN.exported.loadWeights(w);
              global.NN.exported.setLookahead(4);
              ready = true;
              resolve(true);
            });
        } catch (e) { reject(e); }
      };
      s.onerror = function () { reject(new Error('fann ikkje ' + ENGINE_URL)); };
      document.head.appendChild(s);
    }).catch(function (e) {
      err = e;
      loading = null;                 // lat eit nytt forsøk vere mogleg
      throw e;
    });
    return loading;
  }

  function move(st) {
    if (!ready || !global.NN || !global.NN.exported) return null;
    try {
      return global.NN.exported.chooseMove(st);
    } catch (e) {
      if (global.console) console.warn('NN: trekk feila', e);
      return null;
    }
  }

  global.SahkkuNN = {
    load: load,
    ready: function () { return ready; },
    move: move,
    error: function () { return err; },
    setLookahead: function (k) {
      if (ready && global.NN && global.NN.exported) global.NN.exported.setLookahead(k);
    }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
