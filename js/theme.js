// Tema, brikkesett og tilgjenge-innstillingar.
//
// Alt visuelt som kan bytast, ligg som CSS-variablar (sjå avtalen i
// css/style.css) og brikkebilete (pieces/<id>/). Eit tema er ei liste
// variablar + valfritt brettbilete, eit brikkesett er fem SVG-filer.
//
// Verken tema- eller brikkelista er hardkode her: dei kjem frå PACKS
// (js/packs.js) — dei fire innebygde tema, dei to innebygde brikkesetta,
// og alt brukaren har importert av third-party-pakkar (innstillingane
// har «Importer pakke»). Valet lagrast i localStorage og vert sett som
// data-theme / data-pieces på <html> FØR fyrste paint (inline-script i
// index.html), so ein ikkje får eit blink av feil drakt.
(function (global) {
  'use strict';
  var doc = global.document;

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

  function P() { return global.PACKS; }

  // Id-ar som finst i registraren (packs.js). Utan PACKS fell vi tilbake
  // til dei innebygde, so innstillingane alltid har noko å velje mellom.
  function ids(kind) {
    if (!P()) return kind === 'pieces' ? ['classic'] : ['stone'];
    var list = kind === 'pieces' ? P().pieceList() : P().themeList();
    return list.map(function (x) { return x.id; });
  }
  function packLabel(kind, id) {
    if (P()) {
      var list = kind === 'pieces' ? P().pieceList() : P().themeList();
      for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i].label;
    }
    return T('settings.' + kind + id.charAt(0).toUpperCase() + id.slice(1));
  }

  function currentTheme() {
    var t = doc.documentElement.getAttribute('data-theme');
    return ids('theme').indexOf(t) >= 0 ? t : 'stone';
  }

  function setTheme(id) {
    if (ids('theme').indexOf(id) < 0) id = 'stone';
    doc.documentElement.setAttribute('data-theme', id);
    store(K_THEME, id);
    var sel = doc.getElementById('sel-theme');
    if (sel) sel.value = id;
    announce(T('settings.theme') + ': ' + packLabel('theme', id));
  }

  function currentPieces() {
    var v = doc.documentElement.getAttribute('data-pieces');
    return ids('pieces').indexOf(v) >= 0 ? v : 'classic';
  }

  function setPieces(id) {
    if (ids('pieces').indexOf(id) < 0) id = 'classic';
    doc.documentElement.setAttribute('data-pieces', id);
    store(K_PIECES, id);
    var sel = doc.getElementById('sel-pieces');
    if (sel) sel.value = id;
    announce(T('settings.pieces') + ': ' + packLabel('pieces', id));
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

  function T(key, vars) {
    return global.I18N && global.I18N.t ? global.I18N.t(key, vars) : key;
  }

  // ---------- pakke-forvaltning (import, fjerning) ----------
  function packMeta(kind, id) {
    var list = kind === 'pieces' ? P().pieceList() : P().themeList();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function renderImported() {
    var box = doc.getElementById('pack-list');
    if (!box || !P()) return;
    box.textContent = '';
    var items = [];
    P().pieceList().concat(P().themeList()).forEach(function (p) {
      if (!p.builtin) items.push(p);
    });
    if (!items.length) {
      var p = doc.createElement('p');
      p.className = 'arch-sub';
      p.textContent = T('packs.none');
      box.appendChild(p);
      return;
    }
    items.forEach(function (p) {
      var row = doc.createElement('div');
      row.className = 'arch-row';
      var info = doc.createElement('div');
      info.className = 'arch-info';
      var name = doc.createElement('span');
      name.textContent = p.label;
      var sub = doc.createElement('span');
      sub.className = 'arch-sub';
      sub.textContent = T(p.kind === 'theme' ? 'packs.kindTheme' : 'packs.kindPieces');
      info.appendChild(name);
      info.appendChild(sub);
      var btns = doc.createElement('div');
      btns.className = 'arch-btns';
      var use = doc.createElement('button');
      use.textContent = T('packs.use');
      use.addEventListener('click', function () {
        if (p.kind === 'theme') setTheme(p.id); else setPieces(p.id);
      });
      var del = doc.createElement('button');
      del.textContent = T('packs.remove');
      del.addEventListener('click', function () {
        var bucket = p.kind === 'theme' ? 'themes' : 'pieces';
        P().removePack(bucket, p.id);
        if (doc.documentElement.getAttribute(bucket === 'themes' ? 'data-theme' : 'data-pieces') === p.id) {
          if (bucket === 'themes') setTheme('stone'); else setPieces('classic');
        }
        renderImported();
        announce(T('packs.removedToast', { name: p.label }));
      });
      btns.appendChild(use);
      btns.appendChild(del);
      row.appendChild(info);
      row.appendChild(btns);
      box.appendChild(row);
    });
  }

  // Import: filveljar i innstillingane (og importBytes i main.js for
  // «del til appen» / «opne med»).
  function wireImport() {
    var inp = doc.getElementById('pack-file');
    if (!inp) return;
    inp.addEventListener('change', function () {
      var f = inp.files && inp.files[0];
      if (!f) return;
      var rd = new global.FileReader();
      rd.onload = function () {
        importText(String(rd.result));
        inp.value = '';
      };
      rd.onerror = function () { importFail(new Error('read')); };
      rd.readAsText(f);
    });
  }

  function importText(text) {
    if (!P()) return Promise.reject(new Error('PACKS manglar'));
    try {
      var man = P().importPack(text);
      renderImported();
      if (global.UI && global.UI.toast) global.UI.toast(T('packs.importedToast', { name: man.id }));
      // bytt til den nye drakta med ein gong — det er det brukaren vil
      if (man.kind === 'pieces') setPieces(man.id);
      // tema: bytt berre om pakken har heile paletten (vars) — elles er han beré brikker
      if (man.vars && Object.keys(man.vars).length >= 6) setTheme(man.id);
      announce(T('packs.importedToast', { name: man.id }));
      return Promise.resolve(man);
    } catch (e) {
      importFail(e);
      return Promise.reject(e);
    }
  }
  function importFail(e) {
    if (global.UI && global.UI.toast) global.UI.toast(T('packs.err.import', { msg: e.message }));
  }

  function fillSelect(sel, list, kind) {
    if (!sel) return;
    sel.textContent = '';
    list.forEach(function (p) {
      var o = doc.createElement('option');
      o.value = p.id;
      o.textContent = p.builtin ? p.label : '★ ' + p.label;
      sel.appendChild(o);
    });
  }

  function refresh() {
    if (P()) {
      fillSelect(doc.getElementById('sel-theme'), P().themeList(), 'theme');
      fillSelect(doc.getElementById('sel-pieces'), P().pieceList(), 'pieces');
    }
    var sel = doc.getElementById('sel-theme');
    if (sel) sel.value = currentTheme();
    var ps = doc.getElementById('sel-pieces');
    if (ps) ps.value = currentPieces();
    var l = doc.getElementById('a11y-large');
    var c = doc.getElementById('a11y-contrast');
    var m = doc.getElementById('a11y-motion');
    if (l) l.checked = doc.documentElement.classList.contains('a11y-large');
    if (c) c.checked = doc.documentElement.classList.contains('a11y-contrast');
    if (m) m.checked = doc.documentElement.classList.contains('a11y-motion');
    renderImported();
  }

  function init() {
    // klassane er alt sett av inline-scriptet; spegle berre tilstandane
    if (!doc.documentElement.getAttribute('data-theme')) {
      doc.documentElement.setAttribute('data-theme', currentTheme());
    }
    if (!doc.documentElement.getAttribute('data-pieces')) {
      doc.documentElement.setAttribute('data-pieces', currentPieces());
    }
    wireImport();
    refresh();
    if (P() && P().onChange) P().onChange(refresh);

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
    setPieces: setPieces, currentPieces: currentPieces,
    themes: function () { return ids('theme'); },
    pieces: function () { return ids('pieces'); },
    importPack: importText,
    refresh: refresh, announce: announce
  };
})(window);
