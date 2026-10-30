const path=require('path'),http=require('http'),fs=require('fs');
const {chromium}=require('playwright-core');
const ROOT=path.join(__dirname,'..'),PORT=8111;
const MIME={'.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.css':'text/css','.webmanifest':'application/manifest+json','.wasm':'application/wasm'};
const server=http.createServer((req,res)=>{const p=path.join(ROOT,decodeURIComponent(req.url.split('?')[0]));if(!fs.existsSync(p)||fs.statSync(p).isDirectory()){res.writeHead(404);return res.end();}res.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'});fs.createReadStream(p).pipe(res);});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  await new Promise(r=>server.listen(PORT,r));
  const b=await chromium.launch({executablePath:'/home/lars/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome',headless:true,args:['--no-sandbox']});
  const A=await (await b.newContext()).newPage(), B=await (await b.newContext()).newPage();
  const msgs=[];
  for (const [n,p] of [['A',A],['B',B]]) {
    p.on('pageerror',e=>msgs.push(n+' ERR '+e.message));
    await p.goto(`http://127.0.0.1:${PORT}/index.html`);
    await p.waitForFunction(()=>window.NET);
    await p.click('#btn-online');
    await p.waitForFunction(()=>NET.myId,null,{timeout:60000});
  }
  await A.fill('#room-seed','diagtest'); await A.click('#btn-join');
  await A.waitForFunction(()=>NET.ready,null,{timeout:90000});
  const invite=await A.$eval('#invite-code',el=>el.textContent);
  await B.fill('#room-seed',invite); await B.click('#btn-join');
  await B.waitForFunction(()=>NET.ready,null,{timeout:90000});
  await sleep(4000);
  for (const [n,p] of [['A',A],['B',B]]) {
    console.log(n, JSON.stringify(await p.evaluate(()=>({
      myId: NET.short(NET.myId), peers: NET.peers.map(x=>NET.short(x)),
      lobby: {myId: LOBBY.state.myId && LOBBY.state.myId.slice(0,8), peers: LOBBY.state.peers.map(x=>x.slice(0,8)), pending: LOBBY.state.pending, gameId: LOBBY.state.gameId},
      listHtml: document.getElementById('lobby-list').innerHTML.slice(0,300),
      hint: document.getElementById('room-hint').textContent,
    }))));
  }
  // A challenges whoever is listed
  const btns = await A.$$('#lobby-list .lobby-row button');
  console.log('A challenge buttons:', btns.length);
  if (btns.length) {
    await btns[0].click();
    await sleep(2500);
    for (const [n,p] of [['A',A],['B',B]]) {
      console.log('after chal', n, JSON.stringify(await p.evaluate(()=>({
        pending: LOBBY.state.pending, incoming: LOBBY.state.incoming,
        chalOpen: document.getElementById('chaldlg').open,
        chalText: document.getElementById('chal-text').textContent,
        toast: (document.querySelector('.toast')||{}).textContent,
      }))));
    }
  }
  console.log('msgs:', msgs.length?msgs.join('\n'):'none');
  await b.close(); server.close();
})().catch(e=>{console.error('FEIL',e.message);server.close();process.exit(1);});
