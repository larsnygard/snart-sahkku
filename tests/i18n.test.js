// Språktest: nøkkelparitet, dekte nøklar, at bytet faktisk slår gjennom i
// grensesnittet, og at ingenting står att på feil språk i HTML-en.
//
// Køyr:  node tests/i18n.test.js
const fs = require('fs');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const LANGS = ['nb', 'nn', 'se', 'en'];
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
               '.png': 'image/png', '.css': 'text/css', '.webmanifest': 'application/manifest+json' };
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' :: ' + x : '')); } };

// ---------- statisk: nøkkelsett og dekte nøklar ----------
const dict = {};
LANGS.forEach(l => {
  dict[l] = JSON.parse(fs.readFileSync(path.join(ROOT, 'i18n', l + '.json'), 'utf8'));
});
const base = Object.keys(dict.nb).sort();
LANGS.forEach(l => {
  const keys = Object.keys(dict[l]).sort();
  const missing = base.filter(k => !keys.includes(k));
  const extra = keys.filter(k => !base.includes(k));
  ok(l + ': same nøkkelsett som nb', missing.length === 0 && extra.length === 0,
     'manglar ' + JSON.stringify(missing.slice(0, 4)) + ' ekstra ' + JSON.stringify(extra.slice(0, 4)));
  const empty = keys.filter(k => !String(dict[l][k]).trim());
  ok(l + ': ingen tomme tekstar', empty.length === 0, JSON.stringify(empty.slice(0, 4)));
  const sameAsNb = keys.filter(k => l !== 'nb' && dict[l][k] === dict.nb[k] && /[a-zæøå]{4,}/i.test(dict.nb[k]) && !k.startsWith('archive.json') && !k.startsWith('archive.spg'));
  // ikkje ein feil, men verdt å sjå: kor mange står uomsette
  console.log('  ' + l + ': ' + (keys.length - sameAsNb.length) + '/' + keys.length + ' nøklar skil seg frå bokmål');
});

// HTML: alle data-i18n-* må peike på ein nøkkel som finst
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const attrs = [...html.matchAll(/data-i18n(?:-html|-title|-ph|-aria)?="([^"]+)"/g)].map(m => m[1]);
const ukjende = [...new Set(attrs)].filter(k => !(k in dict.nb));
ok('alle data-i18n-nøklar i HTML finst i nb.json', ukjende.length === 0, JSON.stringify(ukjende));

// Ingen norsk tekst att utanfor data-i18n (brand-namn og «CPU:» er lov).
// Teksten inne i data-i18n-elementa ER norsk med vilje — han er reserveinnhald
// som vert bytt ut når språkfila er lasta, og gjer sida lesbar utan JS.
let stripped = html;
for (let i = 0; i < 6; i++) {
  stripped = stripped.replace(/<(\w+)[^>]*data-i18n[^>]*>[\s\S]*?<\/\1>/g, '');
}
const textNodes = [...stripped.matchAll(/>([^<>{}]+)</g)].map(m => m[1].trim())
  .filter(t => t && /[a-zA-ZæøåÆØÅ]{4,}/.test(t))
  .filter(t => !/^(CPU:|Lágesvuotna-sáhkku|Snart|Sáhkku|v\d)/.test(t));
ok('ingen fri norsk tekst att i index.html', textNodes.length === 0, JSON.stringify(textNodes.slice(0, 6)));

// ---------- dynamisk: bytet slår gjennom ----------
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});

(async () => {
  await new Promise(r => server.listen(8105, r));
  const browser = await chromium.launch({
    executablePath: path.join(process.env.HOME, '.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'),
    headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto('http://127.0.0.1:8105/index.html');
  await page.waitForFunction(() => window.__APP && window.I18N && window.I18N.ready);

  const før = await page.evaluate(() => ({
    lang: window.I18N.lang,
    knapp: document.getElementById('btn-cpu').textContent.trim(),
    arkiv: document.getElementById('btn-archive').textContent.trim(),
    veljar: [...document.getElementById('sel-lang').options].map(o => o.value),
  }));
  ok('språkveljaren har fire språk', JSON.stringify(før.veljar) === JSON.stringify(LANGS), JSON.stringify(før.veljar));
  ok('startar på norsk', før.lang === 'nb', før.lang);
  ok('knappane er omsette ved start', før.knapp.indexOf('Spill mot CPU') >= 0 && før.arkiv.indexOf('Arkiv') >= 0, JSON.stringify(før));

  // byte til engelsk via den verkelege veljaren
  await page.selectOption('#sel-lang', 'en');
  await page.waitForFunction(() => window.I18N.lang === 'en');
  const en = await page.evaluate(() => ({
    knapp: document.getElementById('btn-cpu').textContent.trim(),
    arkiv: document.getElementById('btn-archive').textContent.trim(),
    tur: document.getElementById('turn-indicator').textContent.trim(),
    reglar: document.querySelector('#rules h3').textContent.trim(),
    lagra: localStorage.getItem('sahkku.lang'),
    htmlLang: document.documentElement.lang,
  }));
  ok('engelsk: menyen er omsett', en.knapp.indexOf('Play vs CPU') >= 0 && en.arkiv.indexOf('Archive') >= 0, JSON.stringify(en));
  ok('engelsk: HUD-en er omsett', en.tur === 'Turn:', en.tur);
  ok('engelsk: reglane er omsette', en.reglar === 'How to play', en.reglar);
  ok('valet vert lagra', en.lagra === 'en', en.lagra);
  ok('<html lang> fylgjer språket', en.htmlLang === 'en', en.htmlLang);

  // nynorsk
  await page.selectOption('#sel-lang', 'nn');
  await page.waitForFunction(() => window.I18N.lang === 'nn');
  const nn = await page.evaluate(() => ({
    knapp: document.getElementById('btn-cpu').textContent.trim(),
    meny: document.getElementById('btn-menu').textContent.trim(),
    ikkjeBm: document.getElementById('btn-local').textContent.trim(),
    reglar: document.querySelector('#rules h3').textContent.trim(),
  }));
  ok('nynorsk: «Spel mot CPU»', nn.knapp.indexOf('Spel mot CPU') >= 0, nn.knapp);
  ok('nynorsk: «Slik spelar du»', nn.reglar === 'Slik spelar du', nn.reglar);
  ok('nynorsk: «To spelarar her»', nn.ikkjeBm.indexOf('spelarar') >= 0, nn.ikkjeBm);

  // samisk
  await page.selectOption('#sel-lang', 'se');
  await page.waitForFunction(() => window.I18N.lang === 'se');
  const se = await page.evaluate(() => ({
    knapp: document.getElementById('btn-cpu').textContent.trim(),
    reglar: document.querySelector('#rules h3').textContent.trim(),
  }));
  ok('samisk: menyen er omsett', se.knapp.indexOf('Speallat') >= 0, se.knapp);
  ok('samisk: reglane er omsette', se.reglar === 'Nugo spealat', se.reglar);

  // variablar i meldingar
  const vars = await page.evaluate(() => ({
    drap: window.I18N.t('log.killed', { piece: 'Soldat', sq: 'H2' }),
    vinst: window.I18N.t('log.win', { side: 'Menn', reason: 'x' }),
    ukjend: window.I18N.t('finn.ikkje.denne'),
  }));
  ok('variablar vert sette inn', vars.drap.indexOf('H2') > 0 && vars.drap.indexOf('{') < 0, vars.drap);
  ok('ukjend nøkkel gjev nøkkelen (ikkje tom tekst)', vars.ukjend === 'finn.ikkje.denne', vars.ukjend);

  // tilbake til bokmål, og at valet overlever omlasting
  await page.selectOption('#sel-lang', 'nb');
  await page.waitForFunction(() => window.I18N.lang === 'nb');
  await page.reload();
  await page.waitForFunction(() => window.__APP && window.I18N && window.I18N.ready);
  const etter = await page.evaluate(() => ({ lang: window.I18N.lang, knapp: document.getElementById('btn-cpu').textContent.trim() }));
  ok('språket held etter omlasting', etter.lang === 'nb' && etter.knapp.indexOf('Spill mot CPU') >= 0, JSON.stringify(etter));

  ok('ingen JS-feil', errs.length === 0, errs.join(' | '));
  console.log('i18n: ' + pass + ' pass, ' + fail + ' fail');
  await browser.close();
  server.close();
  process.exit(fail ? 1 : 0);
})();
