// Statistisk test av terningane i den verkelege kjernen (js/engine.js).
//
// Kvart kast er tre terningar med fire fjes (X, II, III, blank), so
// P(X) = 0,25 per terning og P(minst éin X) = 1 - 0,75^3 = 57,8 %.
// Testen måler:
//   * frekvensen per fjes mot 25 % (kjikvadrat, 3 fridomsgradar)
//   * fordelinga av talet på X per kast mot Binomial(3, 0.25)
//   * seriekorrelasjon mellom påfølgjande kast (uavhengigheit)
// Køyr:  node tests/dice_random.test.js [n]
const path = require('path');
global.SS = require(path.join(__dirname, '..', 'js', 'engine.js'));
const SS = global.SS;

const N = parseInt(process.argv[2] || '200000', 10);
const FACES = ['X', 'II', 'III', '_'];
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) pass++; else { fail++; console.log('  FAIL ' + name + (extra ? ' :: ' + extra : '')); }
};

// --- 1. fjesfrekvens, gjennom SS.roll (same veg som appen) --------------
const st = SS.newGame({ first: 0 });
const faces = { X: 0, II: 0, III: 0, _: 0 };
const xPerRoll = [0, 0, 0, 0];
let prevFaceSum = null, serSum = 0, serCnt = 0, prevSum = null;
for (let i = 0; i < N; i++) {
  st.phase = 'roll';
  const d = SS.roll(st);
  let xs = 0;
  for (const f of d) { faces[f]++; if (f === 'X') xs++; }
  xPerRoll[xs]++;
  const sum = d.reduce((a, f) => a + FACES.indexOf(f), 0);
  if (prevSum !== null) { serSum += (sum - 4.5) * (prevSum - 4.5); serCnt++; }
  prevSum = sum;
}
const total = 3 * N;
const exp = total / 4;
let chi = 0;
for (const f of FACES) chi += Math.pow(faces[f] - exp, 2) / exp;

console.log('kast:', N, '| terningar:', total);
console.log('fjes:', JSON.stringify(faces),
  '| andel X:', (faces.X / total).toFixed(4),
  '| kjikvadrat:', chi.toFixed(2), '(kritisk 16.27 ved p=0.001, df=3)');
ok('fjesfordelinga er jamn (kjikvadrat < 16.27)', chi < 16.27, 'chi=' + chi.toFixed(2));
ok('X-raten er ~25 %', Math.abs(faces.X / total - 0.25) < 0.01, String(faces.X / total));

// --- 2. talet på X per kast mot Binomial(3, 0.25) ----------------------
const C = (n, k) => { let r = 1; for (let i = 0; i < k; i++) r = r * (n - i) / (i + 1); return r; };
let chiX = 0;
const rows = [];
for (let k = 0; k <= 3; k++) {
  const p = C(3, k) * Math.pow(0.25, k) * Math.pow(0.75, 3 - k);
  const e = p * N;
  chiX += Math.pow(xPerRoll[k] - e, 2) / e;
  rows.push(`  ${k} X: ${xPerRoll[k]} (venta ${e.toFixed(0)}, ${(100 * xPerRoll[k] / N).toFixed(1)} %)`);
}
console.log('talet på X per kast:');
console.log(rows.join('\n'));
console.log('kjikvadrat for X-fordelinga:', chiX.toFixed(2), '(kritisk 16.27, df=3)');
ok('X per kast følgjer Binomial(3, 0.25)', chiX < 16.27, 'chi=' + chiX.toFixed(2));
const pAtLeastOne = 1 - xPerRoll[0] / N;
console.log('P(minst éin X) målt:', (100 * pAtLeastOne).toFixed(1), '% (venta 57.8 %)');
ok('P(minst éin X) er ~57,8 %', Math.abs(pAtLeastOne - 0.578) < 0.01, String(pAtLeastOne));

// --- 3. uavhengigheit: seriekorrelasjon mellom påfølgjande kast --------
const serCorr = serSum / serCnt / 1.875;   // varians per kast-sum er 3*1.25 = 3.75 -> kovarians-skala
console.log('seriekorrelasjon mellom påfølgjande kast:', serCorr.toFixed(4), '(venta ~0)');
ok('kasta er ikkje seriekorrelerte', Math.abs(serCorr) < 0.02, String(serCorr));

// --- 4. opningskastet: likt fordelt mellom sidene ---------------------
let first0 = 0;
for (let i = 0; i < 20000; i++) {
  const s2 = SS.newGame({ first: 0 });
  const op = SS.openingRoll(s2);
  if (op.first === 0) first0++;
}
const share = first0 / 20000;
console.log('opning: Menn byrjar', (100 * share).toFixed(1), '% av 20 000');
ok('opninga er rettvis (~50/50)', Math.abs(share - 0.5) < 0.02, String(share));

console.log('dice: ' + pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
