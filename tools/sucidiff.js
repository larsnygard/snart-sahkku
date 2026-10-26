// Finner første avvik mellom GUI-tilstand og motor-tilstand i S-UCI-replay.
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const SS = require('../js/engine.js');
require('../js/fen.js');
const START_FEN = 'g-g-g-g-g-g-g-g-g-g-g-g-g-g-g/.-.-.-d-.-.-.-N-.-.-.-q-.-.-./m-m-m-m-m-m-m-m-m-m-m-m-m-m-m w roll - 000 H2 0:0 0 *';
const DEC = { X: 'X', '2': 'II', '3': 'III', '_': '_' };
const ENC = { X: 'X', II: '2', III: '3', _: '_' };
const rnd = (function () { let s = 4242 >>> 0; return function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; })();
function roll3() { return [0, 1, 2].map(function () { return SS.DICE[Math.floor(rnd() * 4)]; }); }
function encMove(st, mv) {
  const p = SS.piece(st, mv.pid);
  if (p.t === 's') {
    const from = SS.soldierAt(p.o, p.at);
    const to = SS.soldierAt(p.o, p.at + (mv.kind === 'rel' ? 1 : mv.v));
    return SS.name(from) + '-' + SS.name(to);
  }
  return SS.name(p.at) + '-' + SS.name(SS.moveDest(st, mv));
}
function findMove(st, str) {
  for (const mv of SS.legalMoves(st, st.turn)) if (encMove(st, mv) === str) return mv;
  return null;
}

const eng = spawn(process.execPath, [path.join(__dirname, '..', 'engines', 'sahkku-ref.js')], { stdio: ['pipe', 'pipe', 'pipe'] });
let buf = ''; const lines = []; const waiters = [];
eng.stdout.on('data', d => { buf += d; let ix; while ((ix = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, ix).trim(); buf = buf.slice(ix + 1); if (waiters.length) waiters.shift()(l); else lines.push(l); } });
eng.stderr.on('data', d => console.log('STDERR:', d.toString().slice(0, 400)));
const send = l => eng.stdin.write(l + '\n');
const readLine = () => new Promise(r => { if (lines.length) return r(lines.shift()); waiters.push(r); });

(async function () {
  send('uci'); for (;;) { const l = await readLine(); if (l === 'uciok') break; }
  send('debug on');
  send('isready'); await readLine();
  send('setoption name Level value 1');

  let st = SS.fromFEN(START_FEN);
  const hist = [];
  const dstr = d => d.map(x => ENC[x]).join(' ');
  let guard = 0, mismatch = 0;
  outer:
  while (st.winner == null && guard++ < 300) {
    for (;;) {
      const faces = roll3();
      hist.push('roll ' + dstr(faces));
      st.dice = faces.slice(); st.used = faces.map(d => d === '_'); st.diceBy = st.turn; st.phase = 'move';
      const posCmd = 'position fen ' + START_FEN + (hist.length ? ' moves ' + hist.join(' ') : '');
      send(posCmd);
      // vent på position-FEN-loggen (info string position -> FEN)
      send('diceroll ' + dstr(faces));
      send('go');
      let bm = null;
      while (!bm) {
        const l = await readLine();
        if (l.startsWith('bestmove')) bm = l.slice(8).trim();
        else if (l.startsWith('info string position -> ')) {
          const engFen = l.slice('info string position -> '.length);
          const guiFen = SS.toFEN(st);
          if (engFen !== guiFen) {
            mismatch++;
            console.log('AVVIK etter ' + hist.length + ' token:');
            console.log('GUI : ' + guiFen);
            console.log('MOT : ' + engFen);
            console.log('hist: ' + hist.join(' | '));
            break outer;
          }
        }
      }
      if (mismatch) break outer;
      const pool = SS.legalMoves(st, st.turn);
      if (bm === 'reroll') { hist.push('reroll'); rerolls = 1; break; }
      if (bm === 'pass') { hist.push('pass'); SS.passRemaining(st); SS.settle(st); break; }
      const mv = findMove(st, bm);
      if (!mv) {
        console.log('ULOVLIG bestmove «' + bm + '» pool: ' + pool.map(m => encMove(st, m)).join(','));
        console.log('GUI-FEN: ' + SS.toFEN(st));
        break outer;
      }
      hist.push(bm);
      SS.applyMove(st, mv);
      const s = SS.settle(st);
      if (s.over) break outer;
      if (s.turnEnded) break;
      if (s.reroll) { hist.push('reroll'); break; }
    }
  }
  console.log(mismatch ? 'AVVIK FUNNET (vakt ' + guard + ')' : 'INTE AVVIK PÅ ' + guard + ' iterasjonar; winner=' + st.winner);
  send('quit');
  process.exit(mismatch ? 1 : 0);
})().catch(e => { console.log('KRASJ: ' + e.stack); eng.kill('SIGKILL'); process.exit(1); });
