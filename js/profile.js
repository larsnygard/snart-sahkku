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
                 'gufihtar', 'stallo', 'alfur', 'nykur'];

  var p = { realName: '', nick: '', avatar: AVATARS[0] };

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
      if (AVATARS.indexOf(o.avatar) >= 0) p.avatar = o.avatar;
    } catch (e) { /* privat modus / sund JSON */ }
  }

  function get() {
    return { realName: p.realName, nick: p.nick, avatar: p.avatar };
  }

  function set(o) {
    o = o || {};
    if (o.realName !== undefined) p.realName = clean(o.realName, 40);
    if (o.nick !== undefined) p.nick = clean(o.nick, 24);
    if (o.avatar && AVATARS.indexOf(o.avatar) >= 0) p.avatar = o.avatar;
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

  function url(id) { return 'img/avatars/avatar-' + (id || p.avatar) + '.jpg'; }
  function avatarLabel(id) { return T('profile.av.' + id); }

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
    url: url, avatarLabel: avatarLabel, avatars: AVATARS, apply: apply
  };
})(window);
