// Check the engine picker: retired engines hidden, ?engines=all shows them,
// archived name lookup still resolves a retired id.
const { chromium } = require('playwright-core');
const CHROME = '/home/lars/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome';
const BASE = process.argv[2] || 'http://127.0.0.1:8099/';

(async () => {
  const b = await chromium.launch({ executablePath: CHROME });
  const out = {};

  for (const [name, url] of [['normal', BASE], ['all', BASE + '?engines=all']]) {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', e => errs.push(String(e)));
    await p.goto(url, { waitUntil: 'load' });
    await p.waitForFunction(() => window.ENG && window.ENG.list);
    out[name] = await p.evaluate(async () => {
      const list = await window.ENG.listPublic();
      const all = await window.ENG.list();
      const opts = [...document.querySelectorAll('#cpu-engine option')].map(o => o.value);
      return {
        options: opts,
        defaultEngine: document.getElementById('cpu-engine').value,
        publicIds: list.map(e => e.id),
        allIds: all.map(e => e.id),
        nameOfRetired: window.ENG.name('nais2'),
        nameOfAil: window.ENG.name('ail0.3'),
      };
    });
    out[name].errors = errs;
    await ctx.close();
  }

  // retired file must still exist locally (kept in the repo), 200 from our server
  {
    const ctx = await b.newContext();
    const p = await ctx.newPage();
    const codes = {};
    for (const f of ['engines/nais2.js', 'engines/ail0.3.weights.json', 'engines/nais5.js']) {
      const r = await p.request.get(BASE + f);
      codes[f] = r.status();
    }
    out.local_files = codes;
    await ctx.close();
  }

  await b.close();
  console.log(JSON.stringify(out, null, 2));
})();
