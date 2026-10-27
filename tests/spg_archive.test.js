// Arkivet: SPG-import/eksport (fleire parti i éi fil) og .spgz (zip).
//
// Testar gjennom appens eigen kode (ARCH.*), med localStorage-stub:
//   1. tre spel → SPG-tekst med tre parti i
//   2. import att → tre postar som spelar til same sluttstilling
//   3. .spgz: zip → import → same resultat, og Python kan lese zip-en
//   4. dedup: same fil to gonger gjev ingen duplikat
//   5. importBundle (JSON) verkar framleis
// Køyr:  node tests/spg_archive.test.js
const fs = require('fs');
const path = require('path');
const ROOT = '/home/lars/src/SnartSahkku';

const store = {};
global.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; },
};
global.SS = require(path.join(ROOT, 'js/engine.js'));
require(path.join(ROOT, 'js/fen.js'));
require(path.join(ROOT, 'js/spg.js'));
require(path.join(ROOT, 'js/zip.js'));
require(path.join(ROOT, 'js/archive.js'));
const SS = global.SS, SPG = global.SPG, ARCH = global.ARCH, ZIP = global.ZIP;

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) pass++; else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' :: ' + extra : '')); }
};

function playGame(seed) {
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const st = SS.newGame({ first: 0 });
  SS.openingRoll(st, rnd);
  let mv = 0, it = 0;
  while (st.winner === null && mv < 120 && it < 4000) {
    it++;
    if (st.phase === 'roll') { SS.roll(st, rnd); st.phase = 'move'; continue; }
    const lm = SS.legalMoves(st, st.turn);
    if (!lm.length) { SS.passRemaining(st); continue; }
    SS.applyMove(st, lm[Math.floor(rnd() * lm.length)]); mv++;
    SS.settle(st);
  }
  return st;
}

(async () => {
  // --- 1. tre avslutta parti → arkivpostar ---------------------------------
  const games = [playGame(11), playGame(22), playGame(33)];
  ok('alle tre partia vart avgjorde', games.every(g => g.winner !== null),
     games.map(g => g.winner).join(','));

  const recs = games.map((st, i) => {
    const rec = {
      id: 'test-' + i, ts: '2026-10-27T2' + i + ':00:00Z', mode: 'cpu', engine: 'test',
      level: 2, first: st.turn === 0 ? 0 : 0,
      result: st.winner === 0 ? '1-0' : '0-1', reason: st.winReason,
      plies: 0, steps: ARCH.stepsFrom(st),
      menn: 'TestMenn' + i, koner: 'TestKoner' + i,
      spg: SPG.toSPG(st, { event: 'Test ' + i, start: '2026-10-27T2' + i + ':00:00Z',
                           menn: 'TestMenn' + i, koner: 'TestKoner' + i }),
    };
    rec.plies = rec.steps.reduce((a, s) => a + s.moves.length, 0);
    return rec;
  });
  recs.forEach(r => ARCH.save(r));
  ok('tre parti i arkivet', ARCH.list().length === 3, ARCH.list().length);

  // --- 2. eksport: éi SPG-fil med tre parti -------------------------------
  const exp = ARCH.exportSpgText();
  ok('eksporten tok med alle tre', exp.games === 3, JSON.stringify(exp));
  const chunks = SPG.splitGames(exp.text);
  ok('fila har tre parti', chunks.length === 3, chunks.length);
  const parsed = SPG.parseMany(exp.text);
  ok('alle tre kan lesast att', parsed.length === 3, parsed.length);
  ok('resultata er med', parsed.every(g => g.result === '1-0' || g.result === '0-1'),
     parsed.map(g => g.result).join(','));

  // --- 3. import att i eit tomt arkiv ------------------------------------
  ARCH.clear();
  const imp = ARCH.importSpg(exp.text);
  ok('import gav tre postar', imp.added === 3, JSON.stringify(imp));
  // Arkivet sorterer på tid, so samanlikn på innhald, ikkje på indeks.
  const want = games.map(g => SS.toFEN(g)).sort();
  const back = ARCH.list();
  ok('sluttstillingane er identiske etter ein runde',
     JSON.stringify(back.map(r => r.fens[r.fens.length - 1]).sort()) === JSON.stringify(want),
     back.map(r => r.fens[r.fens.length - 1]).join(' | '));
  ok('notasjonen vart halden på (spg-tekst)', back.every(r => r.spg && r.spg.includes('SPG-V1')));
  ok('tala (menn/koner) vart lesne', back.every(r => /TestMenn/.test(r.menn || '')),
     back.map(r => r.menn).join(','));

  // --- 4. dedup ----------------------------------------------------------
  const again = ARCH.importSpg(exp.text);
  ok('import av same fil gjev ingen duplikat', again.added === 0 && again.skipped === 3,
     JSON.stringify(again));
  ok('arkivet har framleis tre', ARCH.list().length === 3, ARCH.list().length);

  // --- 5. .spgz: zip-rundtur ---------------------------------------------
  const z = await ARCH.exportSpgzBlob();
  ok('zip vart laga med tre filer', z.files === 3, z.files);
  const bytes = new Uint8Array(await z.blob.arrayBuffer());
  ok('zip-signatur', bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 3 && bytes[3] === 4,
     Array.from(bytes.slice(0, 4)).join(','));
  ok('zip er mindre enn SPG-teksten (komprimert)',
     bytes.length < Buffer.byteLength(exp.text),
     bytes.length + ' mot ' + Buffer.byteLength(exp.text));
  fs.writeFileSync('/tmp/spg_archive_check.spgz', Buffer.from(bytes));

  ARCH.clear();
  const zimp = await ARCH.importSpgz(bytes);
  ok('zip-import gav tre postar', zimp.added === 3, JSON.stringify(zimp));
  const zback = ARCH.list();
  ok('zip-rundtur gjev same sluttstillingar',
     JSON.stringify(zback.map(r => r.fens[r.fens.length - 1]).sort()) === JSON.stringify(want),
     zback.map(r => r.fens[r.fens.length - 1]).join(' | '));

  // --- 6. JSON-import verkar framleis ------------------------------------
  ARCH.clear();
  const bundle = { v: 1, app: 'SnartSahkku', games: [recs[0]] };
  const jimp = ARCH.importBundle(bundle);
  ok('JSON-import verkar framleis', jimp.added === 1, JSON.stringify(jimp));

  // --- 7. zip-lesaren toler ei ugyldig fil -------------------------------
  let threw = false;
  try { await ZIP.read(new Uint8Array([1, 2, 3, 4])); } catch (e) { threw = true; }
  ok('ugyldig zip vert avvist', threw);

  console.log(JSON.stringify({ spg_teikn: exp.text.length, zip_byte: bytes.length,
                               spg_byte: Buffer.byteLength(exp.text), pass, fail }));
  process.exit(fail ? 1 : 0);
})();
