// EXIF-lesar: hent SPG-notasjonen ut att frå eit bilete.
//
// Motstykket til det share.js skriv: ein PNG med ein «eXIf»-chunk eller ein
// JPEG med APP1/Exif. Vi les TIFF-hovudet og ImageDescription (0x010E).
// Finn vi ikkje EXIF der, prøver vi PNG sin tEXt-nøkkel «Description», som
// share.js òg legg inn som reserve.
//
// Alt går lokalt i nettlesaren — biletet vert aldri lasta opp nokon stad.
(function (global) {
  'use strict';

  function ascii(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return s;
  }

  function utf8(bytes) {
    try {
      return new TextDecoder('utf-8').decode(new Uint8Array(bytes));
    } catch (e) {
      return ascii(bytes);
    }
  }

  // ---- TIFF/EXIF ----------------------------------------------------------
  // Returnerer {description, software} eller null.
  function readTiff(t) {
    if (!t || t.length < 8) return null;
    var le;
    if (t[0] === 0x49 && t[1] === 0x49) le = true;        // «II»
    else if (t[0] === 0x4D && t[1] === 0x4D) le = false;  // «MM»
    else return null;
    var u16 = function (o) { return le ? t[o] | (t[o + 1] << 8) : (t[o] << 8) | t[o + 1]; };
    var u32 = function (o) {
      return le
        ? (t[o] | (t[o + 1] << 8) | (t[o + 2] << 16) | (t[o + 3] << 24)) >>> 0
        : ((t[o] << 24) | (t[o + 1] << 16) | (t[o + 2] << 8) | t[o + 3]) >>> 0;
    };
    if (u16(2) !== 42) return null;
    var ifd = u32(4);
    if (ifd + 2 > t.length) return null;
    var n = u16(ifd);
    var out = {};
    for (var i = 0; i < n; i++) {
      var e = ifd + 2 + i * 12;
      if (e + 12 > t.length) break;
      var tag = u16(e);
      var type = u16(e + 2);
      var count = u32(e + 4);
      if (type !== 2) continue;                    // berre ASCII
      var off = count <= 4 ? e + 8 : u32(e + 8);
      if (off + count > t.length) continue;
      var val = utf8(t.slice(off, off + count)).replace(/\0+$/, '');
      if (tag === 0x010E) out.description = val;
      else if (tag === 0x0131) out.software = val;
    }
    return out.description || out.software ? out : null;
  }

  // ---- PNG ----------------------------------------------------------------
  function readPng(u8) {
    var i = 8, text = null, exif = null;
    while (i + 8 <= u8.length) {
      var len = ((u8[i] << 24) | (u8[i + 1] << 16) | (u8[i + 2] << 8) | u8[i + 3]) >>> 0;
      var type = ascii(u8.slice(i + 4, i + 8));
      var data = u8.slice(i + 8, i + 8 + len);
      if (type === 'eXIf') exif = data;
      else if (type === 'tEXt') {
        var z = -1;
        for (var k = 0; k < data.length; k++) if (data[k] === 0) { z = k; break; }
        if (z > 0 && ascii(data.slice(0, z)) === 'Description') text = utf8(data.slice(z + 1));
      } else if (type === 'IEND') break;
      i += 12 + len;
    }
    var t = exif ? readTiff(exif) : null;
    if (t) return t;
    return text ? { description: text, software: '' } : null;
  }

  // ---- JPEG ---------------------------------------------------------------
  function readJpeg(u8) {
    var i = 2;
    while (i + 4 <= u8.length) {
      if (u8[i] !== 0xFF) { i++; continue; }
      var marker = u8[i + 1];
      if (marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) { i += 2; continue; }
      var len = (u8[i + 2] << 8) | u8[i + 3];
      if (marker === 0xE1) {
        var seg = u8.slice(i + 4, i + 2 + len);
        if (seg.length > 6 && ascii(seg.slice(0, 6)) === 'Exif\0\0') {
          var t = readTiff(seg.slice(6));
          if (t) return t;
        }
      }
      if (marker === 0xDA) break;             // byrjing på biletdata
      i += 2 + len;
    }
    return null;
  }

  // ---- offentleg API ------------------------------------------------------
  // u8 = Uint8Array med heile fila. Gjev {description, software, spg} eller null.
  function read(u8) {
    if (!u8 || u8.length < 12) return null;
    var out = null;
    if (u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4E && u8[3] === 0x47) out = readPng(u8);
    else if (u8[0] === 0xFF && u8[1] === 0xD8) out = readJpeg(u8);
    if (!out) return null;
    var desc = out.description || '';
    out.spg = /SPG-V1/.test(desc) || /\[Event\s/.test(desc) ? desc : '';
    return out;
  }

  global.EXIF = { read: read, readTiff: readTiff };
})(window);
