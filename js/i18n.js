// Sprostøtte: bokmål, nynorsk, nordsamisk og engelsk.
//
// Alle tekstane ligg i i18n/<språk>.json med flate, prikk-namespaca nøklar
// («menu.playCpu», «rules.dice» …). Filene har IDENTISK nøkkelsett — det er
// testa (tests/i18n.test.js), so ein manglande omsetjing vert fanga med ein
// gong i staden for å dukke opp som engelsk midt i ein nynorsk tekst.
//
// I HTML: <button data-i18n="menu.playCpu">, data-i18n-html (tillèt <b>/<i>),
// data-i18n-title, data-i18n-ph (placeholder), data-i18n-aria.
// I JS:    I18N.t('log.killed', { piece: 'Soldat', sq: 'H2' })
//
// Nytt språk: legg ein fil i i18n/ og ein rad i LANGS. Ingenting annan kode
// treng å endrast.
(function (global) {
  'use strict';
  var doc = global.document;

  var LANGS = [
    { id: 'nb', label: 'Bokmål' },
    { id: 'nn', label: 'Nynorsk' },
    { id: 'se', label: 'Sámegiella' },
    { id: 'en', label: 'English' }
  ];
  var STORE = 'sahkku.lang';
  var dict = {};
  var lang = 'nb';
  var loaded = false;

  function has(id) { return LANGS.some(function (l) { return l.id === id; }); }

  // Vel språk: lagra val > nettlesaren sitt språk > bokmål.
  function pick() {
    try {
      var s = global.localStorage.getItem(STORE);
      if (s && has(s)) return s;
    } catch (e) { /* privat modus */ }
    var nav = (global.navigator && (global.navigator.languages && global.navigator.languages.length
      ? global.navigator.languages : [global.navigator.language])) || [];
    for (var i = 0; i < nav.length; i++) {
      var v = String(nav[i]).toLowerCase();
      if (v.indexOf('nn') === 0) return 'nn';
      if (v.indexOf('nb') === 0 || v.indexOf('no') === 0) return 'nb';
      if (v.indexOf('se') === 0 || v.indexOf('smi') === 0) return 'se';
      if (v.indexOf('en') === 0) return 'en';
    }
    return 'nb';
  }

  function t(key, vars) {
    var s = dict[key];
    if (s == null) return key;                 // synleg feil, ikkje tom tekst
    if (!vars) return s;
    return s.replace(/\{(\w+)\}/g, function (m, name) {
      return vars[name] != null ? String(vars[name]) : m;
    });
  }

  function apply(root) {
    root = root || doc;
    root.querySelectorAll('[data-i18n]').forEach(function (el) {
      el.textContent = t(el.getAttribute('data-i18n'));
    });
    root.querySelectorAll('[data-i18n-html]').forEach(function (el) {
      el.innerHTML = t(el.getAttribute('data-i18n-html'));
    });
    root.querySelectorAll('[data-i18n-title]').forEach(function (el) {
      el.setAttribute('title', t(el.getAttribute('data-i18n-title')));
    });
    root.querySelectorAll('[data-i18n-ph]').forEach(function (el) {
      el.setAttribute('placeholder', t(el.getAttribute('data-i18n-ph')));
    });
    root.querySelectorAll('[data-i18n-aria]').forEach(function (el) {
      el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria')));
    });
  }

  function load(id) {
    return global.fetch('i18n/' + id + '.json', { cache: 'no-cache' })
      .then(function (r) {
        if (!r.ok) throw new Error('i18n ' + id + ': HTTP ' + r.status);
        return r.json();
      })
      .then(function (d) { dict = d; });
  }

  function set(id) {
    if (!has(id)) id = 'nb';
    return load(id).then(function () {
      lang = id; loaded = true;
      try { global.localStorage.setItem(STORE, id); } catch (e) {}
      doc.documentElement.setAttribute('lang', id);
      apply(doc);
      var sel = doc.getElementById('sel-lang');
      if (sel) sel.value = id;
      doc.dispatchEvent(new global.CustomEvent('langchange', { detail: { lang: id } }));
      return id;
    }).catch(function (err) {
      // Manglar språkfila, held vi fram på bokmål i staden for å vise nøklar.
      if (id !== 'nb') { return set('nb'); }
      throw err;
    });
  }

  // Fyll språkveljaren og set i gang.
  function init() {
    var sel = doc.getElementById('sel-lang');
    if (sel && !sel.options.length) {
      LANGS.forEach(function (l) {
        var o = doc.createElement('option');
        o.value = l.id; o.textContent = l.label;
        sel.appendChild(o);
      });
    }
    var id = pick();
    return set(id).then(function () {
      if (sel) {
        sel.value = id;
        sel.addEventListener('change', function () { set(sel.value); });
      }
      return id;
    });
  }

  global.I18N = {
    LANGS: LANGS, init: init, set: set, apply: apply,
    t: t,
    get lang() { return lang; },
    get ready() { return loaded; },
    keys: function () { return Object.keys(dict); },
    dict: function () { return dict; }
  };
})(window);
