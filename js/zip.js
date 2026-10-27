// zip.js — minimal ZIP-lesar/skrivar for .spgz (SPG-filer i ein zip-container).
//
// Kvifor zip og ikkje gzip? SPG er tekst og vert komprimert til ~1/4-1/6,
// men gzip komprimerer ÉIN straum: då må alle parti liggje i same fil og
// heile historia pakkast ut for å lese eitt parti. Zip held kvart parti som
// si eiga oppføring med namn, so ein kan plukke ut eitt parti, sjå kva fila
// inneheld, og leggje til fleire seinare — same grunn til at PGN-samlingar
// (TWIC, ChessBase) vert sende som .zip.
//
// Formatet er standard ZIP (deflate eller «store»), UTF-8-namn, inga kryptering.
// Komprimeringa brukar CompressionStream('deflate-raw') der han finst, elles
// vert oppføringa lagra ukomprimert (framleis ei gyldig zip-fil).
(function (global) {
  'use strict';

  var CRC = (function () {
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
    for (var i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function dosTime(d) {
    var date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    var time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
    return { date: date & 0xFFFF, time: time & 0xFFFF };
  }

  function u16(v) { return [v & 0xFF, (v >>> 8) & 0xFF]; }
  function u32(v) { return [v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF]; }

  function deflateRaw(bytes) {
    if (typeof CompressionStream === 'undefined') return Promise.resolve(null);
    try {
      var cs = new CompressionStream('deflate-raw');
      var w = cs.writable.getWriter();
      w.write(bytes); w.close();
      return new Response(cs.readable).arrayBuffer()
        .then(function (ab) { return new Uint8Array(ab); })
        .catch(function () { return null; });
    } catch (e) { return Promise.resolve(null); }
  }

  function inflateRaw(bytes) {
    if (typeof DecompressionStream === 'undefined') return Promise.reject(new Error('ingen DecompressionStream'));
    var ds = new DecompressionStream('deflate-raw');
    var w = ds.writable.getWriter();
    w.write(bytes); w.close();
    return new Response(ds.readable).arrayBuffer().then(function (ab) { return new Uint8Array(ab); });
  }

  var enc = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
  var dec = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null;

  // files: [{name, text}] -> Promise<Uint8Array>
  function write(files) {
    var now = dosTime(new Date());
    return Promise.all(files.map(function (f) {
      var raw = enc.encode(f.text);
      return deflateRaw(raw).then(function (def) {
        var useDef = !!(def && def.length && def.length < raw.length);
        return { name: enc.encode(f.name), raw: raw, data: useDef ? def : raw,
                 method: useDef ? 8 : 0, crc: crc32(raw) };
      });
    })).then(function (entries) {
      var chunks = [], central = [], offset = 0;
      entries.forEach(function (e) {
        var lh = [].concat(u32(0x04034b50), u16(20), u16(0x0800), u16(e.method),
          u16(now.time), u16(now.date), u32(e.crc), u32(e.data.length),
          u32(e.raw.length), u16(e.name.length), u16(0));
        var head = new Uint8Array(lh);
        chunks.push(head, e.name, e.data);
        central.push({ e: e, off: offset });
        offset += head.length + e.name.length + e.data.length;
      });
      var cdStart = offset, cdChunks = [];
      central.forEach(function (c) {
        var e = c.e;
        var ch = new Uint8Array([].concat(u32(0x02014b50), u16(20), u16(20), u16(0x0800),
          u16(e.method), u16(now.time), u16(now.date), u32(e.crc), u32(e.data.length),
          u32(e.raw.length), u16(e.name.length), u16(0), u16(0), u16(0), u16(0),
          u32(0), u32(c.off)));
        cdChunks.push(ch, e.name);
        offset += ch.length + e.name.length;
      });
      var cdSize = offset - cdStart;
      var eocd = new Uint8Array([].concat(u32(0x06054b50), u16(0), u16(0),
        u16(entries.length), u16(entries.length), u32(cdSize), u32(cdStart), u16(0)));
      var total = offset + eocd.length, out = new Uint8Array(total), p = 0;
      chunks.concat(cdChunks, [eocd]).forEach(function (c) {
        out.set(c, p); p += c.length;
      });
      return out;
    });
  }

  // Uint8Array -> Promise<[{name, text}]>
  function read(bytes) {
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var eocd = -1;
    for (var i = bytes.length - 22; i >= 0 && i >= bytes.length - 66000; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) return Promise.reject(new Error('ikkje ei zip-fil'));
    var n = dv.getUint16(eocd + 10, true), cdOff = dv.getUint32(eocd + 16, true);
    var items = [], p = cdOff;
    for (var k = 0; k < n; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) return Promise.reject(new Error('øydelagd zip-katalog'));
      var method = dv.getUint16(p + 10, true);
      var csize = dv.getUint32(p + 20, true);
      var nameLen = dv.getUint16(p + 28, true);
      var extraLen = dv.getUint16(p + 30, true);
      var cmtLen = dv.getUint16(p + 32, true);
      var lho = dv.getUint32(p + 42, true);
      var name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
      // lokal header: ho har sitt eige namn/extra, so data byrjar etter dei
      var lNameLen = dv.getUint16(lho + 26, true), lExtraLen = dv.getUint16(lho + 28, true);
      var dOff = lho + 30 + lNameLen + lExtraLen;
      items.push({ name: name, method: method, data: bytes.subarray(dOff, dOff + csize) });
      p += 46 + nameLen + extraLen + cmtLen;
    }
    return Promise.all(items.map(function (it) {
      var plain = it.method === 8 ? inflateRaw(it.data) : Promise.resolve(it.data);
      return plain.then(function (raw) { return { name: it.name, text: dec.decode(raw) }; });
    }));
  }

  global.ZIP = { write: write, read: read, crc32: crc32 };
})(typeof window !== 'undefined' ? window : globalThis);
