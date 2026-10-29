// Deling av eit parti som BILETE, med SPG-notasjonen i EXIF-data.
//
// Kvifor eige bilete i staden for berre «last ned SPG»: ein deler eit bilete i
// ein chat, og då fylgjer notasjonen med i fila. PNG har sidan 2017 ein eigen
// «eXIf»-chunk for dette — han er ekte EXIF (TIFF-hovud), ikkje eit påfunn.
// Vi legg òg ein «tEXt»-chunk med same teksten, fordi mange verktøy les den
// vegen i staden; då fungerer begge lesarane.
(function (global) {
  'use strict';
  var doc = global.document;

  // ---------- PNG-bygging ----------
  var CRC_T = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) c = CRC_T[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function be32(n) { return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]; }
  function le32(n) { return [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]; }

  function strBytes(s) {
    var out = [];
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xC0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0x10000) out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else out.push(0xF0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return out;
  }

  function chunk(type, data) {
    var body = strBytes(type).concat(data);
    return be32(data.length).concat(body, be32(crc32(body)));
  }

  // ---------- EXIF (eXIf = TIFF-hovud med éin IFD) ----------
  // Kvar oppføring: tag, type ASCII (2), tal, og verdi. Verdiar på 4 byte eller
  // mindre ligg direkte i oppføringa, elles som offset i datablokka.
  function tiff(tags) {
    var n = tags.length;
    var dataStart = 8 + 2 + 12 * n + 4;
    var data = [];
    var entries = tags.map(function (t) {
      var val = strBytes(t.value).concat([0]);        // NUL-terminert ASCII
      var e = { tag: t.tag, count: val.length };
      if (val.length <= 4) {
        e.inline = val.concat([0, 0, 0, 0].slice(val.length));
      } else {
        e.offset = dataStart + data.length;
        data = data.concat(val);
        if (data.length % 2) data.push(0);            // halde IFD-datablokka partal
      }
      return e;
    });
    var out = [0x49, 0x49, 0x2A, 0x00].concat(le32(8), [n & 255, (n >> 8) & 255]);
    entries.forEach(function (e) {
      out = out.concat([e.tag & 255, (e.tag >> 8) & 255, 2, 0], le32(e.count));
      out = out.concat(e.inline || le32(e.offset));
    });
    return out.concat([0, 0, 0, 0]).concat(data);     // ingen neste IFD
  }

  function readBE(b, i) { return ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0; }

  // Set inn eXIf + tEXt rett etter IHDR.
  function pngWithMeta(png, meta) {
    var chunks = chunk('eXIf', tiff([
      { tag: 0x010E, value: meta.spg || '' },          // ImageDescription
      { tag: 0x0131, value: meta.software || '' }      // Software
    ]));
    var text = chunk('tEXt', strBytes('Description').concat([0], strBytes(meta.spg || '')));
    var out = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    var i = 8, sat = false;
    while (i < png.length) {
      var len = readBE(png, i);
      var type = String.fromCharCode(png[i + 4], png[i + 5], png[i + 6], png[i + 7]);
      var total = 12 + len;
      out = out.concat(Array.prototype.slice.call(png.subarray(i, i + total)));
      if (type === 'IHDR' && !sat) { out = out.concat(chunks, text); sat = true; }
      i += total;
    }
    return new Uint8Array(out);
  }

  // ---------- teikning av brettet ----------
  var CELL = 40, PAD = 18, HEAD = 36, FOOT = 44;
  var COL = {
    bg: '#0e141b', cell: '#18212c', edge: '#2b3a4a', label: '#7f93a8',
    red: '#e05a4d', redDark: '#b23a2e', blue: '#4a82d8', blueDark: '#2a58a8',
    gold: '#ffd97a', goldDark: '#d8a53a', ink: '#e7eef8', dim: '#9db0c4'
  };

  function disc(g, x, y, r, c1, c2, ring) {
    var grd = g.createLinearGradient(x, y - r, x, y + r);
    grd.addColorStop(0, c1); grd.addColorStop(1, c2);
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2);
    g.fillStyle = grd; g.fill();
    g.lineWidth = 1.4; g.strokeStyle = ring; g.stroke();
  }

  function render(st, meta) {
    var SS = global.SS;
    var W = PAD * 2 + 15 * CELL, H = HEAD + 3 * CELL + FOOT + PAD;
    var cv = doc.createElement('canvas');
    cv.width = W; cv.height = H;
    var g = cv.getContext('2d');

    g.fillStyle = COL.bg; g.fillRect(0, 0, W, H);

    // tittelrad
    g.fillStyle = COL.ink;
    g.font = 'bold 17px system-ui, "Segoe UI", sans-serif';
    g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.fillText(meta.title || 'Sáhkku', PAD, 24);
    g.textAlign = 'right';
    g.fillStyle = COL.dim;
    g.font = '13px system-ui, "Segoe UI", sans-serif';
    g.fillText(meta.subtitle || '', W - PAD, 24);

    // rutenett: rad 2 øvst, rad 0 nedst (som UI utan spegelvending)
    for (var row = 2; row >= 0; row--) {
      for (var c = 0; c < 15; c++) {
        var i = SS.idx(c, row);
        var x = PAD + c * CELL, y = HEAD + (2 - row) * CELL;
        g.fillStyle = i === SS.CASTLE ? '#20303f' : COL.cell;
        g.fillRect(x + 1, y + 1, CELL - 2, CELL - 2);
        g.strokeStyle = COL.edge; g.lineWidth = 1;
        g.strokeRect(x + 0.5, y + 0.5, CELL - 1, CELL - 1);
        // brikker
        var occ = SS.occ(st, i).filter(function (p) { return !p.captured; });
        occ.forEach(function (p, k) {
          var cx = x + CELL / 2 + (k ? 5 : 0), cy = y + CELL / 2 - (k ? 5 : 0);
          var r = 14;
          if (p.t === 'k') {
            disc(g, cx, cy, r, COL.gold, COL.goldDark, '#ffe9ad');
            g.fillStyle = '#5a3d10'; g.font = 'bold 16px serif';
            g.textAlign = 'center'; g.textBaseline = 'middle';
            g.fillText('♚', cx, cy + 1);
          } else if (p.t === 'q') {
            disc(g, cx, cy, r, p.o === 0 ? COL.red : COL.blue,
                 p.o === 0 ? COL.redDark : COL.blueDark, COL.gold);
            g.fillStyle = '#fff6e0'; g.font = 'bold 15px serif';
            g.textAlign = 'center'; g.textBaseline = 'middle';
            g.fillText(p.o === 0 ? '♀' : '⚕', cx, cy + 1);
          } else {
            disc(g, cx, cy, r * 0.82, p.o === 0 ? COL.red : COL.blue,
                 p.o === 0 ? COL.redDark : COL.blueDark,
                 p.o === 0 ? '#ff8a7a' : '#86b4ff');
            if (SS.isHome(p)) {                        // uaktivert: hol i midten
              g.beginPath(); g.arc(cx, cy, r * 0.34, 0, Math.PI * 2);
              g.fillStyle = COL.bg; g.fill();
            }
          }
        });
      }
    }

    // botnrad: resultat + nemning + tid
    var by = HEAD + 3 * CELL + 22;
    g.textAlign = 'left'; g.fillStyle = COL.ink;
    g.font = 'bold 14px system-ui, "Segoe UI", sans-serif';
    g.fillText(meta.footer || '', PAD, by);
    g.fillStyle = COL.dim; g.font = '12px system-ui, "Segoe UI", sans-serif';
    g.fillText(meta.stamp || '', PAD, by + 17);
    return cv;
  }

  function canvasBytes(cv) {
    return new Promise(function (res, rej) {
      if (cv.toBlob) {
        cv.toBlob(function (b) {
          if (!b) return rej(new Error('toBlob gav ingenting'));
          var fr = new global.FileReader();
          fr.onload = function () { res(new Uint8Array(fr.result)); };
          fr.onerror = rej;
          fr.readAsArrayBuffer(b);
        }, 'image/png');
      } else {
        var b64 = cv.toDataURL('image/png').split(',')[1];
        var bin = global.atob(b64), out = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        res(out);
      }
    });
  }

  // st -> {blob, bytes}
  function image(st, meta) {
    var cv = render(st, meta);
    return canvasBytes(cv).then(function (raw) {
      var bytes = pngWithMeta(raw, meta);
      return { bytes: bytes, blob: new global.Blob([bytes], { type: 'image/png' }) };
    });
  }

  // Del via systemdialogen om han finst (telefon), elles last ned.
  function share(blob, fname, title) {
    var file = null;
    try { file = new global.File([blob], fname, { type: 'image/png' }); } catch (e) {}
    if (file && global.navigator && global.navigator.canShare &&
        global.navigator.canShare({ files: [file] })) {
      return global.navigator.share({ files: [file], title: title || 'Sáhkku' })
        .then(function () { return 'delt'; })
        .catch(function () { download(blob, fname); return 'lasta ned'; });
    }
    download(blob, fname);
    return Promise.resolve('lasta ned');
  }

  function download(blob, fname) {
    var a = doc.createElement('a');
    a.href = global.URL.createObjectURL(blob);
    a.download = fname;
    doc.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { global.URL.revokeObjectURL(a.href); }, 4000);
  }

  global.SHARE = {
    render: render, image: image, share: share, download: download,
    exifPng: pngWithMeta, tiff: tiff, crc32: crc32
  };
})(window);
