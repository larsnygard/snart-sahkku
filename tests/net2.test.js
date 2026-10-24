// Nettest med kjede-diagnostikk: addr -> resolve -> dial -> peers -> melding
const { chromium } = require('playwright-core');
const path = require('path');

(async () => {
  const browser = await chromium.launch({
    executablePath: path.join(process.env.HOME, '.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'),
    headless: true, args: ['--no-sandbox']
  });
  async function makePage(tag) {
    const page = await browser.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(tag + ' pageerror: ' + e.message.slice(0, 200)));
    page.on('console', m => { if (m.type() === 'error') errs.push(tag + ' console: ' + m.text().slice(0, 200)); });
    await page.goto('http://127.0.0.1:8090/index.html', { waitUntil: 'networkidle' });
    return { page, errs };
  }
  const A = await makePage('A'), B = await makePage('B');

  await A.page.evaluate(async () => { await NET.load(); });
  await B.page.evaluate(async () => { await NET.load(); });
  const aId = await A.page.evaluate(() => NET.myId);
  console.log('A:', aId.slice(0, 12));

  console.log('A join:', await A.page.evaluate(async () => {
    try { await NET.join('testrom-52'); return 'ok'; } catch (e) { return 'FEIL: ' + e.message; }
  }));
  // vent at A publiserer pkarr-post (PkarrPublisher sender ved påkobling)
  await new Promise(r => setTimeout(r, 4000));
  console.log('A addr:', await A.page.evaluate(() => NET.net.addr()));
  console.log('B resolve A:', await B.page.evaluate(async (id) => await NET.net.resolve(id), aId));
  console.log('B dial A:', await B.page.evaluate(async (id) => await NET.net.dial(id), aId));
  console.log('B join:', await B.page.evaluate(async (x) => {
    try { await NET.join('testrom-52' + x); return 'ok'; } catch (e) { return 'FEIL: ' + e.message; }
  }, '#' + aId));

  for (const [tag, P] of [['A', A], ['B', B]]) {
    const peers = await P.page.evaluate(async () => {
      for (let i = 0; i < 80; i++) {
        if (NET.peers.length) return NET.peers.map(p => p.slice(0, 8));
        await new Promise(r => setTimeout(r, 500));
      }
      return [];
    });
    console.log(tag, 'peers:', peers);
  }
  const gotP = A.page.evaluate(async () => new Promise(res => {
    NET.handlers.onMsg = (m) => res('mottok:' + JSON.stringify(m.data));
    setTimeout(() => res('timeout'), 15000);
  }));
  await B.page.evaluate(() => NET.send(NET.seed, JSON.stringify({ t: 'ping', x: 7 })));
  console.log('A melding:', await gotP);
  console.log('errors:', A.errs.concat(B.errs).slice(0, 8));
  await browser.close();
})().catch(e => { console.error('FEIL:', e.message); process.exit(2); });
