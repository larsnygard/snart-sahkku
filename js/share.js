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
  // Mørk steinhell med innhogde sárgat og treskorne brikker — same uttrykk
  // som i spelet (sjå css/style.css og img/piece-*.svg).
  var CW = 44, RH = 88, PAD = 20, HEAD = 42, FOOT = 54;
  var COL = {
    bg: '#0e1116', panel: '#171b21', panelEdge: 'rgba(255,255,255,.09)',
    line: 'rgba(226,235,245,.52)', lineEdge: 'rgba(0,0,0,.55)',
    gold: '#ffd166', goldDark: '#c99a2e', ink: '#eef2ff', dim: '#9fb0d0',
    birch: ['#f2dfbe', '#e2c79f', '#b98f5c', 'rgba(60,38,16,.65)'],
    walnut: ['#8a5c3c', '#63412a', '#3c2415', 'rgba(24,12,4,.75)'],
    ebony: ['#4a4038', '#2b241f', '#15110e', 'rgba(0,0,0,.8)']
  };

  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r); g.closePath();
  }

  // Ei brikke sett litt ovanfrå: frontflate + to sidefasetter + toppflate.
  // kind: 'man' | 'woman' | 'king'; royal legg gullband på.
  function piece(g, cx, baseY, h, kind, royal, home) {
    var pal = kind === 'king' ? COL.ebony : (kind === 'woman' ? COL.walnut : COL.birch);
    if (kind === 'king') pal = COL.ebony;
    var front = pal[0], light = pal[1], dark = pal[2], stroke = pal[3];
    var wTop = h * 0.19, wBase = h * 0.31, d = h * 0.075;
    var topY = baseY - h;
    g.save();
    if (home) g.globalAlpha = 0.55;

    function frontPath() {
      g.beginPath();
      g.moveTo(cx - wTop, topY);
      if (kind === 'woman') {                       // V-snitt (laddjogahpir)
        var nY = topY - h * 0.16, wHorn = wTop * 0.62;
        g.lineTo(cx - wHorn, nY); g.lineTo(cx, topY - h * 0.06); g.lineTo(cx + wHorn, nY);
      }
      g.lineTo(cx + wTop, topY);
      g.lineTo(cx + wBase, baseY);
      g.lineTo(cx - wBase, baseY);
      g.closePath();
    }

    // sidefasetter (bak frontflata)
    g.beginPath();
    g.moveTo(cx - wTop, topY); g.lineTo(cx - wBase, baseY);
    g.lineTo(cx - wBase - d, baseY - h * 0.07); g.lineTo(cx - wTop - d, topY - h * 0.07);
    g.closePath(); g.fillStyle = light; g.fill(); g.strokeStyle = stroke; g.lineWidth = 0.8; g.stroke();

    g.beginPath();
    g.moveTo(cx + wTop, topY); g.lineTo(cx + wBase, baseY);
    g.lineTo(cx + wBase + d, baseY - h * 0.07); g.lineTo(cx + wTop + d, topY - h * 0.07);
    g.closePath(); g.fillStyle = dark; g.fill(); g.stroke();

    // frontflate med tresjattering
    var grd = g.createLinearGradient(cx, topY, cx, baseY);
    grd.addColorStop(0, front); grd.addColorStop(0.55, pal[1]); grd.addColorStop(1, pal[2]);
    frontPath(); g.fillStyle = grd; g.fill(); g.strokeStyle = stroke; g.lineWidth = 1; g.stroke();

    // toppflate
    g.beginPath();
    g.moveTo(cx - wTop, topY); g.lineTo(cx - wTop - 1.5, topY - h * 0.055);
    g.lineTo(cx + wTop + 1.5, topY - h * 0.055); g.lineTo(cx + wTop, topY);
    g.closePath(); g.fillStyle = light; g.fill(); g.stroke();

    if (royal) {                                     // gullband
      var by = topY + h * 0.30;
      g.fillStyle = COL.gold; g.fillRect(cx - wTop - 0.5, by, wTop * 2 + 1, h * 0.075);
      g.fillStyle = COL.goldDark; g.fillRect(cx - wTop - 0.5, by + h * 0.05, wTop * 2 + 1, h * 0.025);
    }
    g.restore();
  }

  function castleMark(g, x, y, r) {
    g.strokeStyle = 'rgba(255,209,102,.8)'; g.lineWidth = 1.4;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke();
    for (var k = 0; k < 8; k++) {
      var a = k * Math.PI / 4;
      g.beginPath();
      g.moveTo(x + Math.cos(a) * r * 1.35, y + Math.sin(a) * r * 1.35);
      g.lineTo(x + Math.cos(a) * r * 1.85, y + Math.sin(a) * r * 1.85);
      g.stroke();
    }
    g.fillStyle = 'rgba(255,209,102,.9)'; g.beginPath(); g.arc(x, y, r * 0.3, 0, Math.PI * 2); g.fill();
  }

  function xMark(g, x, y, r) {
    g.strokeStyle = 'rgba(255,209,102,.7)'; g.lineWidth = 1.6;
    g.beginPath();
    g.moveTo(x - r, y - r); g.lineTo(x + r, y + r);
    g.moveTo(x + r, y - r); g.lineTo(x - r, y + r);
    g.stroke();
  }

  function render(st, meta) {
    var SS = global.SS;
    var W = PAD * 2 + 15 * CW, H = HEAD + 3 * RH + FOOT;
    var cv = doc.createElement('canvas');
    cv.width = W; cv.height = H;
    var g = cv.getContext('2d');

    // bakgrunn + steinhell
    var bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#12161c'); bg.addColorStop(1, '#0a0d11');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);

    var bx = PAD - 8, by0 = HEAD - 8, bw = 15 * CW + 16, bh = 3 * RH + 16;
    roundRect(g, bx, by0, bw, bh, 12);
    var panel = g.createLinearGradient(0, by0, 0, by0 + bh);
    panel.addColorStop(0, '#1b212a'); panel.addColorStop(1, '#12161c');
    g.fillStyle = panel; g.fill();
    g.strokeStyle = COL.panelEdge; g.lineWidth = 1; g.stroke();

    // sárgat: mørk kant + lys kjerne = innhogd i steinen
    for (var c = 0; c < 15; c++) {
      var x = PAD + c * CW + CW / 2;
      g.strokeStyle = COL.lineEdge; g.lineWidth = 3;
      g.beginPath(); g.moveTo(x, HEAD + 4); g.lineTo(x, HEAD + 3 * RH - 4); g.stroke();
      g.strokeStyle = COL.line; g.lineWidth = 1.3;
      g.beginPath(); g.moveTo(x, HEAD + 4); g.lineTo(x, HEAD + 3 * RH - 4); g.stroke();
    }

    // slottet (H2) og sáhkku-merka (C2/M2)
    var midY = HEAD + RH + RH / 2;
    castleMark(g, PAD + 7 * CW + CW / 2, midY - RH * 0.12, 11);
    xMark(g, PAD + 2 * CW + CW / 2, midY - RH * 0.12, 7);
    xMark(g, PAD + 12 * CW + CW / 2, midY - RH * 0.12, 7);

    // tittelrad
    g.fillStyle = COL.ink;
    g.font = '600 16px system-ui, "Segoe UI", sans-serif';
    g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.fillText(meta.title || 'Sáhkku', PAD, 26);
    g.textAlign = 'right'; g.fillStyle = COL.dim;
    g.font = '12px system-ui, "Segoe UI", sans-serif';
    g.fillText(meta.subtitle || '', W - PAD, 26);

    // brikker: rad 2 øvst, rad 0 nedst (som UI utan spegelvending)
    for (var row = 2; row >= 0; row--) {
      for (var col = 0; col < 15; col++) {
        var i = SS.idx(col, row);
        var cx = PAD + col * CW + CW / 2;
        var rowTop = HEAD + (2 - row) * RH;
        var baseY = rowTop + RH * 0.80;
        var occ = SS.occ(st, i).filter(function (p) { return !p.captured; });
        occ.forEach(function (p, k) {
          var px = cx + (k ? CW * 0.16 : 0), py = baseY - (k ? 6 : 0);
          if (p.t === 'k') piece(g, px, py, RH * 0.92, 'king', true, false);
          else if (p.t === 'q') piece(g, px, py, RH * 0.80, 'woman', true, false);
          else piece(g, px, py, RH * 0.74, p.o === 0 ? 'man' : 'woman', false, SS.isHome(p));
        });
      }
    }

    // botnrad: resultat + nemning + tid
    var fy = HEAD + 3 * RH + 26;
    g.textAlign = 'left'; g.fillStyle = COL.ink;
    g.font = '600 13px system-ui, "Segoe UI", sans-serif';
    g.fillText(meta.footer || '', PAD, fy);
    g.fillStyle = COL.dim; g.font = '12px system-ui, "Segoe UI", sans-serif';
    g.fillText(meta.stamp || '', PAD, fy + 18);
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
