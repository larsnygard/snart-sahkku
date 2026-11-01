// Pakkesystem for brikkesett og tema — «Skaparklubben» for SnartSáhkku.
//
// Eit BRIKKESSETT er fem SVG-filer (men-p0, men-p1, queen-p0, queen-p1, king)
// pluss ein manifest. Eit TEMA er eit sett CSS-variablar (sjå avtalen i
// css/theme.css) pluss valfritt brettbilete (board.jpg/board.png/board.svg).
//
// Alle pakkar — innebygde og importerte — går gjennom same registrerings-
// systemet:
//   * innebygde ligg under pieces/<id>/ og themes/<id>/ med manifest.json,
//     og vert lasta ved oppstart (index.html har beré ein liten boot-CSS-del),
//   * importerte pakkar (fil via Innstillingar, delingsmenyen eller «opne
//     med») vert valderte, lagra i localStorage og sprutta ut som <style>-
//     element i nettlesaren — ingen tenar, ingen backend.
//
// Pakk-id:  [a-z0-9][a-z0-9-]{0,31}  — innebygde pakkar har denne id-en
// låst; ein importert pakke med same id får -2, -3, … (skaperen skriv sjølv
// under «mitt-» eller kva han vil, han krasjar ikkje med innebygde).
//
// Pakkefilformatet (.sahkku-pakke / .json) står i docs/PAKKAR.md.
(function (global) {
  'use strict';
  var doc = global.document;

  var K_PACKS = 'sahkku.packs';        // {pieces:{id:manifest}, themes:{id:manifest}}
  var ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
  var MAX_SVG = 48 * 1024;             // per brikke
  var MAX_IMG = 320 * 1024;            // brettbilete
  var MAX_PACK = 700 * 1000;           // rå JSON (base64 er ~33 % større)

  var PIECE_FILES = ['men-p0', 'men-p1', 'queen-p0', 'queen-p1', 'king'];

  // Innebygde pakkar — filane ligg i repoet; manifestet deira vert lasta
  // frå manifest.json under same mappe. Lista her er beré id-ane, så
  // veljaren i Innstillingar kan fyllast før manifesta er komne.
  var BUILTIN_PIECES = ['classic', 'short', 'norge'];
  var BUILTIN_THEMES = ['stone', 'birch', 'midnight', 'contrast'];

  var packs = { pieces: {}, themes: {} };   // importerte (frå localStorage)
  var builtin = { pieces: {}, themes: {} }; // lasta manifest for innebygde

  function T(key, vars) {
    return global.I18N && global.I18N.t ? global.I18N.t(key, vars) : key;
  }

  // ---------- lagring ----------
  function loadStore() {
    try {
      var raw = global.localStorage.getItem(K_PACKS);
      if (!raw) return;
      var obj = JSON.parse(raw);
      if (obj && obj.pieces) packs.pieces = obj.pieces;
      if (obj && obj.themes) packs.themes = obj.themes;
    } catch (e) { /* skada lagring: start utan importerte pakkar */ }
  }
  function saveStore() {
    try {
      global.localStorage.setItem(K_PACKS, JSON.stringify(packs));
    } catch (e) {
      throw new Error(T('packs.err.quota'));
    }
  }

  // ---------- validering ----------
  // Data-URL for SVG: beré reine SVG-filer, ingen script/filter/xlink.
  // Ein SVG som lastast som background-image køyrde allereie ikkje script,
  // men vi valderer likevel for defensjon i djupet.
  function safeSvgText(text) {
    if (typeof text !== 'string' || !/<svg[\s>]/i.test(text)) return false;
    if (/<\s*(script|foreignObject|iframe|embed|object)\b/i.test(text)) return false;
    if (/on[a-z]+\s*=/i.test(text)) return false;
    if (/xlink:href|href\s*=\s*['"]?\s*(https?:|data:|\/\/)/i.test(text)) return false;
    if (/\b(url\s*\(|import\b|filter\s*:)/i.test(text)) return false;
    return true;
  }
  function svgToDataUrl(text) {
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(text.trim());
  }
  // Bilete for brettet: base64-data-URL (png/jpg/svg). Vi insisterer på
  // data-URL — ein importert pakke skal ikkje kunne laste frå nettet.
  function imgDataUrl(value, kind) {
    var m = /^data:image\/(png|jpeg|jpg|webp|svg\+xml);base64,([A-Za-z0-9+/=\s]+)$/.exec(String(value || ''));
    if (!m) return null;
    var b64 = m[2].replace(/\s+/g, '');
    if (b64.length * 3 / 4 > MAX_IMG) throw new Error(T('packs.err.bigImage', { name: kind }));
    if (/svg/i.test(m[1]) && b64.length) {
      var txt = '';
      try { txt = decodeURIComponent(escape(global.atob(b64))); } catch (e) { return null; }
      if (!safeSvgText(txt)) return null;
    }
    return 'data:' + m[1] + ';base64,' + b64;
  }

  function cssSafeColor(v) {
    return typeof v === 'string' && v.length <= 200 && !/[{}<>;@\\]/.test(v);
  }

  // ---------- pakkeformat -> CSS ----------
  // Brikkesett: fem bilete, fem klasser. .piece.red = p0 (røde menn),
  // .piece.blue = p1, .queen = dronning, .king = kongen (felles).
  function pieceCss(id, man) {
    var q = function (s) { return JSON.stringify(s); };
    var sel = function (cls) { return 'html[data-pieces=' + q(id) + '] .piece' + cls; };
    var rules = [
      sel('.red') + '{background-image:url(' + man.images['men-p0'] + ')}',
      sel('.blue') + '{background-image:url(' + man.images['men-p1'] + ')}',
      sel('.red.queen') + '{background-image:url(' + man.images['queen-p0'] + ')}',
      sel('.blue.queen') + '{background-image:url(' + man.images['queen-p1'] + ')}',
      sel('.king') + '{background-image:url(' + man.images.king + ')}'
    ];
    if (man.pieceFilter && cssSafeColor(man.pieceFilter)) {
      rules.push('html[data-pieces=' + q(id) + ']{--piece-filter:' + man.pieceFilter + '}');
    }
    return rules.join('\n');
  }

  function themeVarLines(man) {
    var v = man.vars || {};
    var allowed = ['bg-app', 'ink', 'muted', 'line', 'yellow', 'panel-bg', 'panel-2',
      'btn-bg', 'btn-big-bg', 'dialog-bg', 'log-bg', 'edge-bg', 'lbl', 'board-tint',
      'board-base', 'board-border', 'line-core', 'line-edge', 'piece-filter',
      'chip-p0-bg', 'chip-p0-fg', 'chip-p1-bg', 'chip-p1-fg', 'toast-bg', 'input-bg',
      'red', 'blue'];
    var out = [];
    allowed.forEach(function (name) {
      if (cssSafeColor(v[name])) out.push('--' + name + ':' + v[name]);
    });
    return out;
  }

  function themeCss(id, man) {
    var lines = themeVarLines(man);
    if (man.board) lines.push('--board-img:url(' + JSON.stringify(man.board) + ')');
    if (!man.board && man.vars && man.vars.noBoard) lines.push('--board-img:none');
    var sel = 'html[data-theme=' + JSON.stringify(id) + ']';
    var css = lines.length ? sel + '{' + lines.join(';') + '}' : '';
    if (man.boardCss && /^[a-z0-9 .:#%(),a-fA-F-]+$/.test(man.boardCss)) {
      css += '\n' + sel + ' .board{' + man.boardCss + '}';
    }
    return css;
  }

  // ---------- registreringsmaskineriet ----------
  function freeId(kind, wanted) {
    if (!ID_RE.test(wanted)) wanted = wanted.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 32);
    if (!ID_RE.test(wanted)) wanted = 'pakke';
    var taken = function (id) {
      return builtin[kind][id] || packs[kind][id] ||
        (kind === 'pieces' ? BUILTIN_PIECES : BUILTIN_THEMES).indexOf(id) >= 0;
    };
    if (!taken(wanted)) return wanted;
    for (var n = 2; n < 100; n++) if (!taken(wanted + '-' + n)) return wanted + '-' + n;
    return wanted + '-' + Date.now().toString(36);
  }

  function validatePiecePack(obj) {
    if (!obj || obj.kind !== 'pieces') throw new Error(T('packs.err.kind'));
    var names = obj.names || {};
    var out = { id: String(obj.id || ''), names: names, images: {} };
    PIECE_FILES.forEach(function (f) {
      var t = (obj.svg && obj.svg[f]) || (obj.files && obj.files[f + '.svg']);
      if (!t) throw new Error(T('packs.err.missing', { name: f + '.svg' }));
      if (t.length > MAX_SVG) throw new Error(T('packs.err.big', { name: f }));
      if (!safeSvgText(t)) throw new Error(T('packs.err.unsafe', { name: f }));
      out.images[f] = svgToDataUrl(t);
    });
    if (obj.pieceFilter) out.pieceFilter = String(obj.pieceFilter).slice(0, 200);
    if (obj.palette) out.palette = obj.palette;
    return out;
  }

  function validateThemePack(obj) {
    if (!obj || obj.kind !== 'theme') throw new Error(T('packs.err.kind'));
    var out = { id: String(obj.id || ''), names: obj.names || {}, vars: obj.vars || {} };
    if (obj.board) out.board = imgDataUrl(obj.board, 'board');
    if (obj.boardCss) out.boardCss = String(obj.boardCss).slice(0, 400);
    return out;
  }

  // Hovudinngang: pakke-JSON (streng eller objekt) -> lagra og sprutta pakke.
  function importPack(jsonText) {
    var obj;
    try { obj = JSON.parse(jsonText); } catch (e) { throw new Error(T('packs.err.json')); }
    if (obj.format !== 'snartsahkku-pakke') throw new Error(T('packs.err.format'));
    var kind = obj.kind;
    if (kind !== 'pieces' && kind !== 'theme') throw new Error(T('packs.err.kind'));
    var man = kind === 'pieces' ? validatePiecePack(obj) : validateThemePack(obj);
    man.kind = kind;
    var bucket = kind === 'pieces' ? 'pieces' : 'themes';
    man.id = freeId(bucket, man.id);
    man.imported = true;
    packs[bucket][man.id] = man;
    saveStore();
    inject(man, bucket);
    notify();
    return man;
  }

  function inject(man, bucket) {
    var el = doc.getElementById('pack-' + man.id);
    if (!el) {
      el = doc.createElement('style');
      el.id = 'pack-' + man.id;
      el.setAttribute('data-pack', bucket + '/' + man.id);
      doc.head.appendChild(el);
    }
    el.textContent = bucket === 'pieces' ? pieceCss(man.id, man) : themeCss(man.id, man);
  }

  function removePack(bucket, id) {
    if (builtin[bucket][id] || !packs[bucket][id]) return false;
    delete packs[bucket][id];
    var el = doc.getElementById('pack-' + id);
    if (el) el.remove();
    saveStore();
    notify();
    return true;
  }

  // ---------- lister og manifest-hjelp ----------
  function labelOf(man, id) {
    var n = man.names || {};
    var lang = (global.I18N && global.I18N.lang) || 'nb';
    return n[lang] || n.en || n.nb || man.label || id;
  }

  function pieceList() {
    var out = [];
    BUILTIN_PIECES.forEach(function (id) {
      out.push({ id: id, builtin: true, kind: 'pieces', label: T('settings.pieces' + id.charAt(0).toUpperCase() + id.slice(1)) });
    });
    Object.keys(packs.pieces).forEach(function (id) {
      var m = packs.pieces[id];
      out.push({ id: id, builtin: false, kind: 'pieces', label: labelOf(m, id) });
    });
    return out;
  }
  function themeList() {
    var out = [];
    BUILTIN_THEMES.forEach(function (id) {
      out.push({ id: id, builtin: true, kind: 'theme', label: T('settings.theme' + id.charAt(0).toUpperCase() + id.slice(1)) });
    });
    Object.keys(packs.themes).forEach(function (id) {
      var m = packs.themes[id];
      out.push({ id: id, builtin: false, kind: 'theme', label: labelOf(m, id) });
    });
    return out;
  }
  function known(id, bucket) {
    return (BUILTIN_PIECES.concat(Object.keys(packs.pieces))).indexOf(id) >= 0
      || (BUILTIN_THEMES.concat(Object.keys(packs.themes))).indexOf(id) >= 0;
  }

  // Innebygde manifest: lastast etter tur; kvar manifest.json i
  // pieces/<id>/ eller themes/<id>/ er autoritativ for namn og palett.
  function loadBuiltin() {
    var jobs = [];
    BUILTIN_PIECES.forEach(function (id) {
      jobs.push(global.fetch('pieces/' + id + '/manifest.json', { cache: 'no-cache' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (m) { if (m) builtin.pieces[id] = m; })
        .catch(function () {}));
    });
    BUILTIN_THEMES.forEach(function (id) {
      jobs.push(global.fetch('themes/' + id + '/manifest.json', { cache: 'no-cache' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (m) { if (m) builtin.themes[id] = m; })
        .catch(function () {}));
    });
    return Promise.all(jobs);
  }

  var listeners = [];
  function onChange(fn) { listeners.push(fn); }
  function notify() { listeners.forEach(function (fn) { try { fn(); } catch (e) {} }); }

  // ---------- oppstart ----------
  function init() {
    loadStore();
    Object.keys(packs.pieces).forEach(function (id) { inject(packs.pieces[id], 'pieces'); });
    Object.keys(packs.themes).forEach(function (id) { inject(packs.themes[id], 'themes'); });
    return loadBuiltin().then(notify);
  }

  global.PACKS = {
    init: init,
    importPack: importPack,
    removePack: removePack,
    pieceList: pieceList,
    themeList: themeList,
    known: known,
    builtinManifest: function (bucket, id) { return builtin[bucket][id] || null; },
    onChange: onChange,
    BUILTIN_PIECES: BUILTIN_PIECES,
    BUILTIN_THEMES: BUILTIN_THEMES,
    PIECE_FILES: PIECE_FILES,
    safeSvgText: safeSvgText,
    imgDataUrl: imgDataUrl
  };
})(window);
