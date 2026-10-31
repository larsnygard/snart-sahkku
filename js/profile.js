// Spelarprofil: namn, kallenamn og biletе.
//
// Profilen ligg i localStorage (same nettlesar, ingen konto) og vert brukt tre
// stader: i notasjonen (SPG sine [Menn]/[Koner]-hovud), i nettspel (namn og
// biletе fylgjer med lobby-meldingane) og i topplinja (so ein ser kven ein er).
(function (global) {
  'use strict';
  var doc = global.document;
  var T = function (k, v) { return global.I18N ? global.I18N.t(k, v) : k; };

  var KEY = 'sahkku.profile';

  // Biletеa er genererte, søte vesen frå norrøn, samisk og islandsk folklore
  // (img/avatars/avatar-<id>.jpg). Ingen menneske — dette er troll, vetter og
  // huldrefolk, teikna som små plysjvesen med store augo.
  var AVATARS = ['troll', 'fenris', 'ratatoskr', 'noaide',
                 'gufihtar', 'stallo', 'alfur', 'nykur',
                 // andre bolk: samiske vette og norrøne/islandske vesen
                 'ulda', 'haldi', 'bieggolmmai', 'vuovdegaddi',
                 'jiehtanas', 'cahceravga', 'boazu', 'goaskin',
                 'huldra', 'nisse', 'draug', 'selkie',
                 'fossegrim', 'dverg', 'mare', 'lindorm'];

  var p = { realName: '', nick: '', avatar: AVATARS[0] };

  // ---- biletpool: 256 genererte vesen (tools/make_avatar_pool.py) ----------
  // Profilen viser berre 16 om gongen. Kven dei 16 er, er avgjort av kven du er
  // (ein tilfeldig id i localStorage) og kva dag det er — so to nettlesarar får
  // ulike sett, og settet skiftar ved midnatt. Ingenting er sendt nokon stad.
  var SHOWN = 16;
  var K_UID = 'sahkku.uid';
  var poolPromise = null;

  function uid() {
    try {
      var v = global.localStorage.getItem(K_UID);
      if (!v) {
        v = '';
        var buf = new Uint8Array(16);
        if (global.crypto && global.crypto.getRandomValues) global.crypto.getRandomValues(buf);
        else for (var i = 0; i < 16; i++) buf[i] = Math.floor(Math.random() * 256);
        for (var j = 0; j < 16; j++) v += ('0' + buf[j].toString(16)).slice(-2);
        global.localStorage.setItem(K_UID, v);
      }
      return v;
    } catch (e) { return 'anon'; }
  }

  function dayKey() {
    var d = new Date();
    var m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
  }

  function hash32(s) {                       // FNV-1a
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }

  function rng(seed) {                       // mulberry32
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function loadPool() {
    if (poolPromise) return poolPromise;
    poolPromise = fetch('img/avatars/pool.json', { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) {
        var files = (j && j.files) || [];
        return files.length ? files : AVATARS.slice();
      })
      .catch(function () { return AVATARS.slice(); });   // utan pool: dei namngjevne
    return poolPromise;
  }

  // 16 bilet-id-ar for denne brukaren, denne dagen.
  function gallery() {
    return loadPool().then(function (pool) {
      var all = AVATARS.concat(pool);       // dei namngjevne er alltid med i trekninga
      var rand = rng(hash32(uid() + '|' + dayKey()));
      var idx = all.map(function (_, i) { return i; });
      for (var i = idx.length - 1; i > 0; i--) {         // Fisher-Yates
        var j = Math.floor(rand() * (i + 1));
        var tmp = idx[i]; idx[i] = idx[j]; idx[j] = tmp;
      }
      var out = idx.slice(0, Math.min(SHOWN, all.length)).map(function (k) { return all[k]; });
      // Det du alt har valt skal alltid visast, so profilen ikkje ser framand ut.
      if (p.avatar && out.indexOf(p.avatar) < 0) out[out.length - 1] = p.avatar;
      return out;
    });
  }

  function clean(s, max) {
    return String(s == null ? '' : s).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max);
  }

  function load() {
    try {
      var raw = global.localStorage.getItem(KEY);
      if (!raw) return;
      var o = JSON.parse(raw);
      if (!o || typeof o !== 'object') return;
      p.realName = clean(o.realName, 40);
      p.nick = clean(o.nick, 24);
      if (AVATARS.indexOf(o.avatar) >= 0 || String(o.avatar).indexOf('pool/') === 0) p.avatar = o.avatar;
    } catch (e) { /* privat modus / sund JSON */ }
  }

  function get() {
    return { realName: p.realName, nick: p.nick, avatar: p.avatar };
  }

  function set(o) {
    o = o || {};
    if (o.realName !== undefined) p.realName = clean(o.realName, 40);
    if (o.nick !== undefined) p.nick = clean(o.nick, 24);
    if (o.avatar && (AVATARS.indexOf(o.avatar) >= 0 || String(o.avatar).indexOf('pool/') === 0)) {
      p.avatar = o.avatar;
    }
    try { global.localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) {}
    apply();
    return get();
  }

  // Kva skal visast? Kallenamn > namn > «gjest».
  function name() {
    return p.nick || p.realName || T('profile.anon');
  }

  // Namn til SPG-hovudet: «Etternamn, Fornamn» om vi kan, elles som skrive.
  function spgName() {
    var full = p.realName || p.nick;
    if (!full) return '';
    if (p.realName && p.realName.indexOf(',') < 0 && p.realName.indexOf(' ') > 0) {
      var parts = p.realName.split(/\s+/);
      var last = parts.pop();
      return last + ', ' + parts.join(' ');
    }
    return full;
  }

  function url(id) {
    id = id || p.avatar;
    if (String(id).indexOf('pool/') === 0) return 'img/avatars/' + id + '.jpg';
    return 'img/avatars/avatar-' + id + '.jpg';
  }
  function avatarLabel(id) {
    if (String(id).indexOf('pool/') === 0) return T('profile.poolName');
    return T('profile.av.' + id);
  }

  // Oppdater topplinja (avatar-knappen) og namnemerke i spelet.
  function apply() {
    var btn = doc.getElementById('btn-profile');
    if (btn) {
      var img = btn.querySelector('img');
      if (!img) {
        img = doc.createElement('img');
        img.alt = '';
        img.width = 26; img.height = 26;
        btn.insertBefore(img, btn.firstChild);
      }
      img.src = url();
      btn.setAttribute('aria-label', T('profile.open') + ' — ' + name());
      btn.setAttribute('title', T('profile.open') + ' — ' + name());
    }
    var nm = doc.getElementById('prof-name-badge');
    if (nm) nm.textContent = name();
  }

  function init() {
    load();
    apply();
    return get();
  }

  global.PROFILE = {
    init: init, get: get, set: set, name: name, spgName: spgName,
    url: url, avatarLabel: avatarLabel, avatars: AVATARS, apply: apply,
    gallery: gallery, uid: uid, dayKey: dayKey, shown: SHOWN
  };
})(window);
