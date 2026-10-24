// Simulerer main.js sine CPU-løkker: tel kast, omkast og trekk per tur
const fs = require('fs');
const vm = require('vm');
const src = fs.readFileSync(__dirname + '/../js/engine.js', 'utf8');
const ctx = { window: {}, console };
vm.createContext(ctx);
vm.runInContext(src, ctx);
const SS = ctx.window.SS || ctx.SS;
const cpuSrc = fs.readFileSync(__dirname + '/../js/cpu.js', 'utf8');
vm.runInContext(cpuSrc, ctx);
const CPU = ctx.window.CPU || ctx.CPU;

function sim(seed, maxTurns) {
  let s = SS.newGame({ first: 1 });  // spelar (sidan under CPU) kastar først
  const stats = { rolls: 0, rerollRoundsMax: 0, rerollRoundsTotal: 0,
                  consecRollsMax: 0, cpuMovesNoRoll: 0, turnChanges: 0, longestRerollStreakSide: 0 };
  let rerollStreak = 0, lastRollSide = -1, consecRolls = 0;
  for (let t = 0; t < maxTurns && s.winner === null; t++) {
    // turløype per side slik main.js gjer det (CPU styres av oss)
    let guard = 0;
    while (guard++ < 5000 && s.winner === null) {
      if (s.phase === 'roll') {
        SS.roll(s);
        stats.rolls++;
        consecRolls = (s.turn === lastRollSide) ? consecRolls + 1 : 1;
        lastRollSide = s.turn;
        stats.consecRollsMax = Math.max(stats.consecRollsMax, consecRolls);
        s.phase = 'move';
      }
      const res = SS.settle(s);
      if (res.over) break;
      if (res.turnEnded) { stats.turnChanges++; break; }  // ny tur = nytt løkke
      if (res.reroll) {
        rerollStreak++;
        stats.rerollRoundsTotal++;
        stats.rerollRoundsMax = Math.max(stats.rerollRoundsMax, rerollStreak);
        SS.rerollX(s);
        continue;
      }
      if (rerollStreak > stats.longestRerollStreakSide) stats.longestRerollStreakSide = rerollStreak;
      rerollStreak = 0;
      const mv = CPU.pick(s, 2);
      if (!mv) { const r2 = SS.settle(s); if (r2.turnEnded) { stats.turnChanges++; break; } break; }
      SS.applyMove(s, mv);
    }
    if (guard >= 5000) { stats.stuck = (stats.stuck || 0) + 1; }
  }
  if (rerollStreak > stats.longestRerollStreakSide) stats.longestRerollStreakSide = rerollStreak;
  stats.winner = s.winner;
  return stats;
}

const agg = { rolls: 0, rerollMax: 0, rerollTotal: 0, consecMax: 0, games: 0, stuck: 0, rerollOver20: 0, consecOver20: 0 };
for (let i = 0; i < 400; i++) {
  const st = sim(i, 4000);
  agg.games++; agg.rolls += st.rolls; agg.rerollMax = Math.max(agg.rerollMax, st.rerollRoundsMax);
  agg.rerollTotal += st.rerollRoundsTotal; agg.consecMax = Math.max(agg.consecMax, st.consecRollsMax);
  if (st.stuck) agg.stuck++;
  if (st.rerollRoundsMax > 20) agg.rerollOver20++;
  if (st.consecRollsMax > 20) agg.consecOver20++;
}
console.log(JSON.stringify(agg));
