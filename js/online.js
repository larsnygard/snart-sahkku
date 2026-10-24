// SnartSáhkku — nettverk: iroh-gossip P2P (wasm-modulen fra net/pkg)
(function (global) {
  'use strict';
  var doc = global.document;

  var net = {
    net: null,           // Net-instans (wasm)
    seed: null,
    peers: [],
    myId: null,
    ready: false,
    handlers: {},        // onPeers, onMsg, onStatus
    loadPromise: null
  };

  function h(name, arg) { var f = net.handlers[name]; if (f) f(arg); }
  function status(s, cls) { h('onStatus', s); }

  net.load = function () {
    if (net.loadPromise) return net.loadPromise;
    net.loadPromise = (async function () {
      var mod = await import('../net/pkg/snart_sahkku_net.js');
      await mod.default();
      net.Net = mod.Net;
      status('kobler til relay…');
      net.net = await mod.Net.new();
      net.myId = net.net.node_id();
      net.net.set_on_peers(function (json) {
        var p = JSON.parse(json).peers || [];
        var changed = JSON.stringify(p) !== JSON.stringify(net.peers);
        net.peers = p;
        if (changed) h('onPeers', p);
      });
      net.net.set_on_message(function (json) {
        var m = JSON.parse(json);
        h('onMsg', { from: m.from, data: JSON.parse(m.data) });
      });
      status('tilkoblet');
      return net.net;
    })();
    return net.loadPromise;
  };

  net.join = async function (seed) {
    seed = (seed || '').trim().toLowerCase();
    if (!seed) throw new Error('tomt romnavn');
    if (!net.net) await net.load();
    // invittkode: "romnavn#nodeid[#nodeid…]" — bootstrap-jeper
    var hashIx = seed.indexOf('#');
    var boot = [];
    if (hashIx >= 0) {
      boot = seed.slice(hashIx + 1).split('#').map(function (s) { return s.trim(); }).filter(Boolean);
      seed = seed.slice(0, hashIx);
    }
    if (boot.length) await net.net.joinWith(seed, boot);
    else await net.net.join(seed);
    net.seed = seed;
    net.mySeed = seed;
    net.ready = true;
  };
  net.leave = async function () {
    if (net.net) await net.net.leave();
    net.seed = null; net.peers = []; net.ready = false;
  };
  // send til alle i rommet; payload-allerede-JSON-gjenstand
  net.send = async function (obj) {
    if (!net.ready) return;
    await net.net.send(net.seed, JSON.stringify(obj));
  };
  // min node-id som er «mindst» blant meg + peers (deterministisk rolle)
  net.isLowest = function () {
    var ids = net.peers.concat([net.myId]).sort();
    return ids[0] === net.myId;
  };
  net.short = function (id) { return (id || '').slice(0, 8); };
  global.NET = net;
})(typeof globalThis !== 'undefined' ? globalThis : this);
