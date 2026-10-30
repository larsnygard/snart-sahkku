// Tema + tilgjenge-innstillingar.
//
// Tema er berre eit sett CSS-variablar (css/theme.css), valt med data-theme på
// <html>. Tilgjenge-vala er klassar på same element. Alt ligg i localStorage og
// vert sett FØR fyrste paint av eit lite inline-script i index.html.
(function (global) {
  'use strict';
  var doc = global.document;

  var THEMES = ['stone', 'birch', 'midnight', 'contrast'];
  var PIECES = ['classic', 'short'];          // brikkesett (sjå css/style.css)
  var K_THEME = 'sahkku.theme';
  var K_LARGE = 'sahkku.a11yLarge';
  var K_CONTRAST = 'sahkku.a11yContrast';
  var K_MOTION = 'sahkku.a11yMotion';
  var K_PIECES = 'sahkku.pieces';

  function store(key, val) {
    try {
      if (val == null) global.localStorage.removeItem(key);
      else global.localStorage.setItem(key, val);
    } catch (e) { /* privat modus */ }
  }
  function read(key) {
    try { return global.localStorage.getItem(key); } catch (e) { return null; }
  }

  function currentTheme() {
    var t = doc.documentElement.getAttribute('data-theme');
    return THEMES.indexOf(t) >= 0 ? t : 'stone';
  }

  function setTheme(id) {
    if (THEMES.indexOf(id) < 0) id = 'stone';
    doc.documentElement.setAttribute('data-theme', id);
    store(K_THEME, id);
    var sel = doc.getElementById('sel-theme');
    if (sel) sel.value = id;
    announce(T('settings.theme') + ': ' + T('settings.theme' + id.charAt(0).toUpperCase() + id.slice(1)));
  }

  function currentPieces() {
    var v = doc.documentElement.getAttribute('data-pieces');
    return PIECES.indexOf(v) >= 0 ? v : 'classic';
  }

  function setPieces(id) {
    if (PIECES.indexOf(id) < 0) id = 'classic';
    doc.documentElement.setAttribute('data-pieces', id);
    store(K_PIECES, id);
    var sel = doc.getElementById('sel-pieces');
    if (sel) sel.value = id;
    announce(T('settings.pieces') + ': ' + T('settings.pieces' + id.charAt(0).toUpperCase() + id.slice(1)));
  }

  function toggle(cls, key, on) {
    doc.documentElement.classList.toggle(cls, on);
    store(key, on ? '1' : '0');
  }

  // Skjermlesar-melding (role=status i index.html)
  function announce(msg) {
    var el = doc.getElementById('sr-status');
    if (!el || !msg) return;
    el.textContent = '';
    setTimeout(function () { el.textContent = msg; }, 30);
  }

  function T(key) {
    return global.I18N && global.I18N.t ? global.I18N.t(key) : key;
  }

  function label(id) {
    return T('settings.theme' + id.charAt(0).toUpperCase() + id.slice(1));
  }

  function fillSelect() {
    var sel = doc.getElementById('sel-theme');
    if (sel && !sel.options.length) {
      THEMES.forEach(function (id) {
        var o = doc.createElement('option');
        o.value = id;
        o.textContent = label(id);
        sel.appendChild(o);
      });
    }
    var ps = doc.getElementById('sel-pieces');
    if (ps && !ps.options.length) {
      PIECES.forEach(function (id) {
        var o = doc.createElement('option');
        o.value = id;
        o.textContent = T('settings.pieces' + id.charAt(0).toUpperCase() + id.slice(1));
        ps.appendChild(o);
      });
    }
  }

  function refresh() {
    fillSelect();
    var sel = doc.getElementById('sel-theme');
    if (sel) {
      // fyll att tekstane om språket vart bytt
      for (var i = 0; i < sel.options.length; i++) {
        sel.options[i].textContent = label(sel.options[i].value);
      }
      sel.value = currentTheme();
    }
    var ps = doc.getElementById('sel-pieces');
    if (ps) {
      for (var j = 0; j < ps.options.length; j++) {
        ps.options[j].textContent =
          T('settings.pieces' + ps.options[j].value.charAt(0).toUpperCase() + ps.options[j].value.slice(1));
      }
      ps.value = currentPieces();
    }
    var l = doc.getElementById('a11y-large');
    var c = doc.getElementById('a11y-contrast');
    var m = doc.getElementById('a11y-motion');
    if (l) l.checked = doc.documentElement.classList.contains('a11y-large');
    if (c) c.checked = doc.documentElement.classList.contains('a11y-contrast');
    if (m) m.checked = doc.documentElement.classList.contains('a11y-motion');
  }

  function init() {
    // klassane er alt sett av inline-scriptet; spegle berre tilstandane
    if (!doc.documentElement.getAttribute('data-theme')) {
      doc.documentElement.setAttribute('data-theme', currentTheme());
    }
    refresh();

    var btn = doc.getElementById('btn-settings');
    if (btn) btn.addEventListener('click', function () {
      var dlg = doc.getElementById('settings');
      refresh();
      if (dlg && dlg.showModal) dlg.showModal();
    });

    doc.addEventListener('change', function (e) {
      var id = e.target && e.target.id;
      if (id === 'sel-theme') setTheme(e.target.value);
      else if (id === 'sel-pieces') setPieces(e.target.value);
      else if (id === 'a11y-large') toggle('a11y-large', K_LARGE, e.target.checked);
      else if (id === 'a11y-contrast') toggle('a11y-contrast', K_CONTRAST, e.target.checked);
      else if (id === 'a11y-motion') toggle('a11y-motion', K_MOTION, e.target.checked);
      if (id === 'a11y-large' || id === 'a11y-contrast' || id === 'a11y-motion') {
        announce(e.target.checked ? T('settings.on') : T('settings.off'));
      }
    });

    doc.addEventListener('langchange', refresh);
  }

  global.THEME = {
    init: init, setTheme: setTheme, current: currentTheme,
    setPieces: setPieces, currentPieces: currentPieces, pieces: PIECES,
    themes: THEMES, refresh: refresh, announce: announce
  };
})(window);
