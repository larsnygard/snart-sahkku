# FLOKK — deterministisk CPU-spelar for sáhkku

## when
Be when extending, tuning, or debugging the built-in SnartSahkku CPU
(`js/cpu.js`), benchmarking it with `sahkku-ai/tools/eval_match.js`,
or writing state-fixture tests against `js/engine.js` / FEN.

## the six rules (Lars 2026-11-02, published as «Flokk-CPU» v1.36.0)
1. Never release the queen when own active count < 3 AND foe active count > 5.
2. Keep 3–6 soldiers active; move them as an even flock toward the foe
   (crowding < 2 cycle apart penalized, gaps > 10 into two armies penalized).
3. A seized king pulls back to the home rank; it strikes only when after
   the strike its distance to the nearest foe soldier ≥ 5 (wrap-col + row).
4. King stays safe on the home rank; vertical strikes only when safe.
5. Soldiers strike foe pieces when possible (+900, queen/king-win 1e6/1e9).
6. Deterministic: no `rnd`, first-max wins in legalMoves order.

## architecture
- `js/cpu.js` CPU API: `pick(st, level)` — 1 random, 2 greedy+noise (legacy),
  3 = FLOKK. `CPU.pick(st)` default = FLOKK. `CPU.flokk.pick` direct.
- `engines/sahkku-flokk.js` = dedicated S-UCI engine, **Level 1-4**.
  Level 4 = tactical safety: 1-ply counterstrike sim per opponent die
  (X=2 rolls, threat = v and v+1, capture-escape counted; 5000-move cap).
- FLOKK hard rules = ±200000 (must obey, lexicographic); soft prefs = ±300
  (king home 300, progress 15/step, crowding -150, gaps -40, trades -150).

## test-fixture recipe (the fast path)
- **`SS.setPos(fen, {turn, dice, phase, nesseby})`** — one-line position
  builder, exported from js/engine.js + in sahkku-ai/vendor/engine.js.
  Use it for ALL cpu-rule tests. Board rows top(row3/giera-home)→bottom,
  A..O; tokens M/m G/g Q/q D/d N NM NK, stacks '+', row2 = P1 first pass.
- fromFEN maps home soldiers by COLUMN ORDER: a released 'G' earlier in
  the string takes a LOWER cycle position — place released soldiers
  right-to-left on foe home row to get t=0,1,2… in order.
- Soldat SLÅR ikkje baklengs: berre framover +1..3 i eiga tallsyklus.
  Ein soldat som har forbiert fienden, kan ikkje snu og hugsa.
- FEN has NO nesseby flag — set it via setPos opts for nesseby scenarios.

## bench pitfalls (sahkku-ai/tools/eval_match.js)
- Engines run as children: `spawn('node', argv.slice(1))` — **shell string
  quoting (quotes, `&&`) breaks silently**; the command must be plain argv.
- Dice come from the referee, NOT from `go` — a `go <dice>` argument is
  ignored (looked like "all games played X__" in tests; it never did).
- `go` prints `info movepool` lines: filter them in any test harness.
- Passes burn wall-clock, not moves: a passing CPU + passive ref makes
  ~250-move games ≈ 15 s. Cap the game length in test harnesses.
- Run benches in sahkku-ai dir; `EVAL_SETOPT_A=Level=4 EVAL_SETOPT_B=Level=4`
  gives mirrored sides. Score = A's percent (50 = even).

## status (2026-11-02): design + code, bench numbers PENDING — fill from real runs, do not trust
- Flokk L3 (greedy) vs classic ref: TBD % · vs NAIS.7: TBD %
- Flokk L4 (counterstrike) vs classic ref: TBD · vs NAIS.7: TBD
