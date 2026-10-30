// Deling av parti som bilete med SPG i EXIF, + Nesseby på som standard,
// + slutt paa parti gaar i gjennomgang.
//
// Køyr:  node tests/share_image.test.js
const fs = require('fs');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
               '.png': 'image/png', '.css': 'text/css', '.webmanifest': 'application/manifest+json' };
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' :: ' + x : '')); } };

// ---------- PNG/EXIF-lesar ----------
function chunks(buf) {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  ok('PNG-signatur', sig.every((v, i) => buf[i] === v));
  const out = [];
  let i = 8;
  while (i < buf.length) {
    const len = buf.readUInt32BE(i);
    const type = buf.toString('ascii', i + 4, i + 8);
    out.push({ type, len, data: buf.subarray(i + 8, i + 8 + len) });
    i += 12 + len;
  }
  return out;
}
function tiffTag(tiff, tag) {
  const le = tiff[0] === 0x49;
  const u16 = (o) => le ? tiff.readUInt16LE(o) : tiff.readUInt16BE(o);
  const u32 = (o) => le ? tiff.readUInt32LE(o) : tiff.readUInt32BE(o);
  ok('TIFF-hovud', tiff[2] === 42, tiff[2]);
  const n = u16(8);
  for (let k = 0; k < n; k++) {
    const e = 10 + k * 12;
    if (u16(e) === tag) {
      const cnt = u32(e + 4);
      const valOff = cnt <= 4 ? e + 8 : u32(e + 8);
      return tiff.toString('utf8', valOff, valOff + cnt - 1);
    }
  }
  return null;
}

const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});

(async () => {
  await new Promise(r => server.listen(8101, r));
  const browser = await chromium.launch({
    executablePath: path.join(process.env.HOME, '.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'),
    headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto('http://127.0.0.1:8101/index.html');
  await page.waitForFunction(() => window.__APP && window.SHARE && window.SS);

  // ---- 1. Nesseby er på som standard ----
  const nb = await page.evaluate(() => ({
    app: !!window.__APP.nesseby,
    boks: document.getElementById('chk-nesseby').checked,
  }));
  ok('app.nesseby er sann ved start', nb.app === true, JSON.stringify(nb));
  ok('Nesseby-boksen er kryssa av', nb.boks === true, JSON.stringify(nb));

  // ---- 2. bilete: PNG med eXIf + tEXt, rett storleik ----
  const out = await page.evaluate(async () => {
    const SS = window.SS;
    // eit lite, lovleg opningsparti so stillinga ikkje er tom
    const st = SS.newGame({ first: 0, nesseby: true });
    // NB: ikkje openingRoll med ein KONSTANT rng — då slår båe sider likt i det
    // uendelege (opningsritualet kastar om att ved likskap), og sida heng.
    let r = 12345;
    SS.openingRoll(st, () => ((r = (r * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff));
    const spg = '[Event "Test"]\n[Result "1-0"]\nSPG-V1\n\n1. open: M(X _ _) K(_ _ _) -> M\n';
    const img = await window.SHARE.image(st, {
      spg, software: 'SnartSáhkku test', title: 'Sáhkku — test',
      subtitle: 'CPU: NAIS.2', footer: 'Menn · test', stamp: '2026-10-29 12:00 UTC',
    });
    const bytes = Array.from(img.bytes);
    // dekkar biletet i ein <img> for å sjå at det er gyldig
    let w = 0, h = 0;
    try {
      const url = URL.createObjectURL(img.blob);
      const el = new Image();
      await new Promise((res, rej) => { el.onload = res; el.onerror = rej; el.src = url; });
      w = el.naturalWidth; h = el.naturalHeight;
    } catch (e) { return { feil: String(e) }; }
    return { bytes, w, h, b64: img.bytes.length };
  });
  ok('ingen feil i sidekoden', !out.feil, out.feil);
  const buf = Buffer.from(out.bytes);
  const cs = chunks(buf);
  const ihdr = cs.find(c => c.type === 'IHDR');
  ok('breidd 700 px', ihdr && ihdr.data.readUInt32BE(0) === 700, ib(ihdr));
  ok('høgd 360 px', ihdr && ihdr.data.readUInt32BE(4) === 360, ib(ihdr));
  ok('biletet lastar i ein <img>', out.w === 700 && out.h === 360, out.w + 'x' + out.h);

  // ---- 3. EXIF: ImageDescription = SPG ----
  const exif = cs.find(c => c.type === 'eXIf');
  ok('eXIf-chunk finst', !!exif);
  if (exif) {
    const desc = tiffTag(exif.data, 0x010E);
    ok('EXIF ImageDescription inneheld SPG-standarden', !!desc && desc.includes('SPG-V1'), JSON.stringify(desc && desc.slice(0, 40)));
    ok('EXIF ImageDescription inneheld trekket', !!desc && desc.includes('M(X _ _)'), JSON.stringify(desc && desc.slice(0, 60)));
    ok('EXIF Software er sett', tiffTag(exif.data, 0x0131) === 'SnartSáhkku test', tiffTag(exif.data, 0x0131));
  }
  const text = cs.find(c => c.type === 'tEXt' && c.data.toString('latin1').startsWith('Description\0'));
  ok('tEXt-fallback finst', !!text);
  if (text) {
    const s = text.data.toString('utf8');
    ok('tEXt inneheld notasjonen', s.includes('SPG-V1') && s.includes('M(X _ _)'), s.slice(0, 60));
  }
  ok('eXIf kjem før IDAT', cs.findIndex(c => c.type === 'eXIf') < cs.findIndex(c => c.type === 'IDAT'));

  // ---- 4. slutten av eit parti fører til gjennomgang ----
  const rev = await page.evaluate(async () => {
    const app = window.__APP, SS = window.SS;
    const st = SS.newGame({ first: 0 });
    const fens = [SS.toFEN(st)];
    app.st = st; app.mode = 'cpu'; app.archived = false;
    // eit syntetisk, arkivert parti med to «trekk»
    const rec = { id: 'test1', ts: new Date().toISOString(), mode: 'cpu', engine: 'classic',
                  level: 2, first: 0, nesseby: false, result: '1-0', reason: 'dronning',
                  plies: 1, steps: [], fens: fens.concat(fens), spg: '[Event "t"]\nSPG-V1\n' };
    window.ARCH.save(rec);
    app.lastRec = rec;
    document.getElementById('endscore').showModal();
    document.getElementById('endscore').close();     // lukkar -> gjennomgang
    // <dialog>-«close» kjem som ei eiga oppgåve, so vent ei lita stund
    await new Promise(function (res) { setTimeout(res, 120); });
    return {
      mode: app.mode,
      bar: !document.getElementById('replay-bar').classList.contains('hidden'),
      knappar: !!document.getElementById('btn-review') && !!document.getElementById('btn-share'),
      spelSynleg: !document.getElementById('game').classList.contains('hidden'),
    };
  });
  ok('lukking av sluttdialogen går til gjennomgang', rev.mode === 'review', JSON.stringify(rev));
  ok('avspelingslinja er synleg', rev.bar === true, JSON.stringify(rev));
  ok('sluttdialogen har «Gå gjennom» og «Del bilete»', rev.knappar === true);

  // ---- 5. same knapp finst i gjennomgangen og delar stillinga der ----
  const revShare = await page.evaluate(async () => {
    // fang bloba i staden for å opne systemdialogen
    let fanga = null;
    const orig = window.SHARE.share;
    window.SHARE.share = function (blob, fname) { fanga = { blob, fname }; return Promise.resolve('fanga'); };
    document.getElementById('btn-share-rev').click();
    await new Promise(r => setTimeout(r, 400));
    window.SHARE.share = orig;
    if (!fanga) return { feil: 'ingen blob' };
    const buf = new Uint8Array(await fanga.blob.arrayBuffer());
    let i = 8, ch = [];
    while (i < buf.length) {
      const len = (buf[i] << 24 | buf[i + 1] << 16 | buf[i + 2] << 8 | buf[i + 3]) >>> 0;
      ch.push(String.fromCharCode(buf[i + 4], buf[i + 5], buf[i + 6], buf[i + 7]));
      i += 12 + len;
    }
    return { fname: fanga.fname, storleik: buf.length, chunks: ch };
  });
  ok('gjennomgangen har eigen del-knapp', !!revShare && !revShare.feil, JSON.stringify(revShare));
  ok('del frå gjennomgangen gjev PNG-namn med stempel',
     revShare && /^sahkku-\d{4}-\d{2}-\d{2}T\d{4}Z\.png$/.test(revShare.fname || ''), revShare && revShare.fname);
  ok('biletet frå gjennomgangen har eXIf',
     revShare && Array.isArray(revShare.chunks) && revShare.chunks.includes('eXIf'), JSON.stringify(revShare && revShare.chunks));

  ok('ingen JS-feil', errs.length === 0, errs.join(' | '));
  console.log('share_image: ' + pass + ' pass, ' + fail + ' fail');
  await browser.close();
  server.close();
  process.exit(fail ? 1 : 0);
})();

function ib(c) { return c ? c.data.readUInt32BE(0) + 'x' + c.data.readUInt32BE(4) : 'ingen IHDR'; }
