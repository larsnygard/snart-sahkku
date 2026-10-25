# S-UCI — Sáhkku Chess-UCI-style Engine Protocol

Version **S-UCI 1.0** · Part of SnartSáhkku (soon at [snart.com/sahkku](https://snart.com/sahkku)) · AGPL-3.0

S-UCI is a text protocol, modelled on [UCI (Universal Chess Interface)](https://deepbluechess.com/doc/uci.html),
for communication between a **GUI** (the game: SnartSáhkku, a tournament frontend, a
board) and a **Sáhkku engine** (a program that chooses moves). It runs over a
pipe: the GUI writes commands to the engine's **stdin**, the engine replies on
**stdout**. One command per line, UTF-8, `\n` line endings. Everything is
case-sensitive lowercase unless stated.

Why the protocol differs from chess UCI (read this once, then write engines):

1. **Sáhkku is a dice game.** The engine must never invent random numbers.
   The GUI owns the RNG: before asking for a move, the GUI delivers the
   rolled dice with `diceroll`. FEN therefore carries dice and slot state.
2. **One turn is many moves.** A turn = one roll of 3 dice; each die (X/II/III)
   may trigger a move, in descending value order, and X may be re-rolled under
   the game rules. The protocol therefore has the engine keywords `pass` and
   `reroll` in addition to ordinary moves, and the GUI drives the turn loop.
3. **The king is neutral**, standing in the castle H2; there is no "king
   safety" and no checkmate. Wins: capture the king, capture the opponent's
   queen, or annihilate their soldiers (per the game rules at sahkku.no).
4. **Soldiers walk a number-cycle**, and stacked pieces share a square, so
   position encoding carries pieces as square tokens; moves are encoded
   `from-to` in square names, which the referee resolves deterministically.

---

## 1. The game at a glance (what an engine author must know)

* Two sides: **Menn** (men, `w`, encodes first, home rank row 1 = A1..O1) and
  **Giera** (women, `b`, home rank row 3). 15 home squares each, 15 soldiers
  per side, one queen per side (Menn queen starts on **L2**, Giera queen on
  **D2**), and one **neutral king on H2**.
* Dice faces: `X  II  III  _` (blank). A roll of 3 dice is spent in descending
  rank order **X > III > II > _**; `_` is an immediate free pass of that slot.
* `X` releases the **frontmost** undetached soldier of the side to move (the
  one furthest along its number-cycle) onto the next square of its cycle, and
  also allows a one-step release of a queen in any of the 4 straight directions.
* II/III move a released soldier **v** steps forward along its cycle, a queen
  **v** straight steps (R/L/F/B, no turning mid-move), and the king **v**
  straight steps. Landing rules are enforced by the game (you can never land
  where a home-ranked piece stands; kings never share a line with pieces;
  capturing an enemy queen/king is a win).
* **X-reroll rule:** if the active die is `X` and **no move at all** is legal
  with the whole roll, the player may re-roll all X dice (all X dice at once),
  optionally repeatedly. The engine signals this with the keyword `reroll`.
* When no legal move exists for the remaining dice (and no X-reroll applies),
  the side plays `pass`: the remaining dice are skipped and the turn ends.
* The turn ends when all dice slots are spent (used, passed, or skipped).

The referee (game rules) is `js/engine.js` in this repository; it is the
reference implementation of legality. `SS.legalMoves(state, side)` lists every
legal move for the active die.

## 2. Handshake

GUI sends:

```
uci
```

Engine answers (order free, `uciok` last):

```
id name <name> <version>
id author <author>
option name <name> type <type> default <value> [min <n> max <n>]
option ...
uciok
```

GUI then sends `isready`; engine answers `readyok` when it can accept a
`position`/`go` immediately.

### Engine options

An engine declares options in the handshake with lines like:

```
option name Level type spin default 2 min 1 max 3
option name Resign type button
```

The GUI sets them with `setoption name <name> value <value>`
(`value` omitted for `type button`). Options: `type spin` (integer, min/max),
`type check` (on/off), `type combo` (`var a var b ...`), `type string`,
`type button`. A GUI ignores unknown option names and never sends
`setoption` for undeclared options.

The reference engine (`engines/sahkku-ref.js`, see §9) declares:

```
option name Level type spin default 2 min 1 max 3
```

* `Level 1` — uniform-random among legal moves.
* `Level 2` — greedy evaluation with ±125 noise.
* `Level 3` — deterministic greedy (strongest).

## 3. Positions: S-UCI FEN

A position is one line:

```
<board> <side> <phase> <dice> <used> <kingSq> <kills> <moves> <result> [{reason}]
```

Nine required fields, whitespace-separated; a tenth `{...}` comment is optional.

**board** — the 3×15 board, rows written **top to bottom** (row 3 = Giera's
home rank, row 2, row 1 = Menn's home rank), rows joined with `/`, squares
within a row written **A→O left to right** (from Menn's perspective) and joined
with `-`. Squares are either `.` (empty), a piece token, or a stack of tokens
joined with `+` (stacked soldiers are common in sáhkku).

Piece tokens (case = side, letter = kind, home pieces are lowercase):

| token | piece |
|---|---|
| `M` / `m` | Menn soldier released / on home rank |
| `G` / `g` | Giera soldier released / on home rank |
| `M'` / `G'` | released soldier standing on the **middle rank (rank 2)** on its **second pass** of the number-cycle (rank-2 squares are visited twice by each side's cycle: plain = first pass, `'` = second pass) |
| `Q` / `q` | Menn queen released (anywhere) / on home square L2 |
| `D` / `d` | Giera queen released (anywhere) / on home square D2 |
| `N` | king, **neutral** (never movable, capturable by any side) |
| `NM` / `NK` | king **seized by Menn / Giera** (rides for that side) |

A seized king is NOT encoded as a soldier: the king is a piece of its own,
and the engine's legality (the king never lands on occupied squares, the
soldier/queen king-capture at `§`) turns on his ownership. Omitting it from
FEN produced illegal positions after a king seizure — the three king tokens
are required. Captured pieces simply do not appear. A soldier's exact
number-cycle position is implied by its square plus the pass marker: each
square lies on at most one released-soldier cycle position per side per
pass (a home-rank square maps to that side's home slot).

**side** — `w` (Menn to act) or `b` (Giera).

**phase** — `roll` (dice not thrown; GUI must roll before asking for a move),
`move` (dice present, moves pending), `over` (game finished).

**dice** — the three active die faces in slot order: `X`, `2` (=II), `3`
(=III), `_` (blank); e.g. `X 2 _`. The literal `-` when phase is `roll`
and nothing has been thrown.

**used** — three chars `0`/`1` marking per-slot: 0 = not spent, 1 = spent
(moved with, passed, or skipped because `_`). Must be `000` when dice is `-`.
The engine plays the **highest-ranked unspent slot** (X > III > II > _); the
referee enforces this order.

**kingSq** — the king's square name (`H2` at the start).

**kills** — captures per side, `w:b` (Menn captures : Giera captures).

**moves** — integer plies (applied moves) so far, for notation/clockkeeping.

**result** — `*` (running), `1-0` (Menn won), `0-1` (Giera won). When not `*`,
phase must be `over`. The optional tenth field `{reason}` is free text, e.g.
`{kongen kapra}`.

**Start position FEN** (canonical — every GUI and engine must accept it):

```
g-g-g-g-g-g-g-g-g-g-g-g-g-g-g/.-.-.-d-.-.-.-N-.-.-.-q-.-.-./m-m-m-m-m-m-m-m-m-m-m-m-m-m-m w roll - 000 H2 0:0 0 *
```

Square names: columns `A`..`O`, ranks `1`..`3`; row 2's letters are mirrored
from Menn's perspective, so row 2 reads `O2..A2` left-to-right in cycle terms
— write row 2 left-to-right as **A2, B2, …, O2** (i.e. the letters ascend
left-to-right on every row; A2 sits under A1).

## 4. Moves

### Syntax

A move is `<from>-<to>` with square names: `A1-B1` (Menn releases the frontmost
home soldier on A1; it lands on B1), `C1-E1` (a released Menn soldier walks II…
well, III steps: C1→D1→E1), `H2-F2` (king two steps left), `L2-L1` (queen
release step), and so on. The die value is implied by the landing distance
(the referee recomputes it from the state). A GUI must send moves that appear
verbatim in `info movepool`/`bestmove` output; the referee resolves stacks by
taking the **frontmost** (number-cycle-highest) piece matching `from→to`.

### Keywords (the engine's whole vocabulary)

| keyword | meaning | when legal |
|---|---|---|
| `<from>-<to>` | ordinary move | the move is in the move pool for the active die |
| `reroll` | re-roll all X dice at once, the turn does **not** end | active die is X **and** the move pool is empty (the X-reroll rule) |
| `pass` | skip all remaining dice; the turn ends | the move pool is empty and no X-reroll applies |
| `resign` | the engine resigns; the opponent wins | any time during `move` |
| `none` | no move exists and the engine will not resign | phase `over` (engine answering a late `go`), or when it refuses to move — GUI treats like `resign` |

The engine **never** encodes dice, rank order, captures, releases, king
captures, stacking, cycles — it just says which piece travels where (or a
keyword). The referee applies the full effect.

### The GUI's dice obligation

Before every `go`, the GUI must have delivered dice for the current turn:
the position's `phase` is `move` with three concrete dice, and the
last command sequence for this turn was a `diceroll` (§5). The engine must
not assume any randomness of its own.

## 5. Commands (GUI → engine)

| command | behaviour |
|---|---|
| `uci` | handshake, ends with `uciok` |
| `isready` | engine answers `readyok` |
| `ucinewgame` | reset all game-specific state (hash, stats). Optional extensions: `position startpos moves ...` follow immediately |
| `setoption name N value v` | set declared option (only between games; GUI never sends it mid-`go`) |
| `position startpos` | set canonical start position |
| `position fen <fen>` | set the given FEN (§3) |
| `position startpos moves <t...>` / `position fen <f> moves <t...>` | set base, then replay tokens (below) |
| `diceroll <d1> <d2> <d3>` | deliver this turn's roll for the **side to move** in the current position: sets dice/used (`000`), phase `move`. Faces are `X`, `2`, `3`, `_`. Sent at **turn start**, right after the `position` that ends the previous turn, and once more immediately after a `reroll` (new faces, turn does not end). Mid-turn `position` commands (after a move) carry the dice and used-mask via replay `roll` tokens — the GUI never sends `diceroll` at any other time |
| `go [movetime <ms>] [depth <n>] [nodes <n>]` | play the best move for the side to move. All parameters optional; engines that ignore all of them (instant engines) are conformant. Answer: `bestmove <move>` (§4) |
| `movelist` | print the current move pool (§7), then `movepool done`. Handy for debugging new engines |
| `stop` | only meaningful for long searches; engine finishes the move and prints `bestmove` quickly. Instant engines may ignore |
| `debug on` / `debug off` | engine may echo diagnostics prefixed `info string` |
| `save statefile` / `load statefile` | optional; engine persists internal state (hashes). Non-supporting engines answer `error unsupported` |
| `quit` | engine exits immediately, cleanly |

**Replay tokens** in `moves <t...>` (space-separated):

* `<from>-<to>` — an ordinary move (engine applies referee effects).
* `roll <d1> <d2> <d3>` — the GUI rolled dice for the side to move (turn start;
  phase → `move`, used → `000`). Exactly one `roll` precedes each turn's moves.
* `pass` — side skipped remaining dice (turn ends).
* `reroll` — X dice re-rolled; **the next token after `reroll` must be
  `roll <d1> <d2> <d3>`** delivering the new faces (deterministic engines:
  seed the RNG from the game id; the GUI replays with the same rolls).
* `resign` — the side to move resigns (game over, opponent wins).

A conformant engine applies replays by the game rules: after each token the
referee settles the turn (dice exhausted → turn ends; no dice left → the GUI
will start the next turn with `roll`). The engine must answer `error <text>`
and ignore a malformed position.

### Answers (engine → GUI)

* `id name ...`, `id author ...`, `option ...`, `uciok`, `readyok`
* `bestmove <move>` — §4. **The only terminal answer to `go`.**
* `info string <text>` — human log line; GUI may show/ignore.
* `info depth <n> score cp <n> nodes <n> time <ms> pv <m1> <m2> ...`
  — search stats, any subset. `cp` = centipawns-style heuristic score,
  positive = good for side to move. `pv` = principal variation, moves in §4
  syntax + keywords, **starting with the bestmove**.
* `info movepool <from>-<to>` — one per legal move for the active die (the
  engine may emit these before any `bestmove`; GUI uses for legality display).
* `movepool done` — last line after a `movelist` command.
* `error <text>` — malformed command / unsupported feature; the GUI logs
  it and keeps the engine running.
* After `bestmove`, the GUI applies the move (referee), may print the new
  `position ...` and continues. **The engine must not send anything
  unsolicited while waiting for a command.**

## 6. Turn lifecycle (who does what)

For each turn of side S:

1. GUI: `position ...` (current state, phase `roll`), `diceroll X 2 _`
   (faces for S), `go`.
2. Engine answers `bestmove <from>-<to>` | `reroll` | `pass` | `resign` | `none`.
3. GUI applies the referee effect:
   * move → slot marked used; if dice remain (diceLeft > 0) and the game is
     running → `go` again for S (same dice, same position minus that slot).
   * `reroll` → GUI rolls new faces for the X dice, `diceroll` again, `go`.
   * `pass` → turn ends; next side: step 1 for the opponent.
4. When the last die slot is spent, the referee ends the turn: GUI proceeds
   to the next side (step 1).
5. Game end (king captured / queen captured / annihilation / `resign` /
   GUI `resign`) → FEN with `1-0`/`0-1`; GUI sends `ucinewgame` for a rematch.

**A conformant engine never rolls dice, never mutates the position, and
answers exactly one `bestmove` per `go`.**

## 7. The move pool

The move pool = every legal move for the **active (highest unspent) die slot**
under the game rules (`SS.legalMoves` in `js/engine.js`). Engines:

* **must** return a pool member, `reroll` (only under the X-reroll rule:
  active die X, pool empty), `pass`, `resign` or `none`;
* **must not** return a move for a spent slot, a `_` slot, the opponent,
  a home-ranked piece (release is X-only), the neutral king (it has a move
  pool like a queen once released? no: the king is always "released"),
  a king move onto/along a line with pieces, etc. — the referee rejects
  illegal answers with `error illegal bestmove <m>` and re-sends the same
  `go` **once**; a second illegal answer is a protocol violation (the GUI
  kills the engine).

Reference: `movelist` on the start position (after `diceroll X X _`) prints:

```
info movepool A1-B1
info movepool A1-B1      <- stacks resolve to the frontmost; GUI dedupes
movepool done
```

(Start position: X releases the frontmost home soldier — with the pristine
home rank, the frontmost is well-defined; both X dice give the same pool.)

## 8. Conformance levels

* **Level A (playable):** `uci`/`uciok`, `isready`/`readyok`, `ucinewgame`,
  `position` (all 4 forms), `diceroll`, `go` (ignores all parameters),
  `bestmove`, `quit`.
* **Level B (+ info):** all of A, `info movepool` before each `bestmove`,
  `info string` logging, `setoption` support, `movelist`, `stop`.
* **Level C (+ search):** all of B, multi-second `go movetime`/`depth`/`nodes`
  search, `info depth score nodes time pv`, `save`/`load`, `debug`.

The GUI must run Level-A engines fully; B/C features are progressive.

## 9. Reference engine & test kit

* `js/engine.js` — the referee (rules, legality, FEN via `js/fen.js`
  `SS.toFEN`/`SS.fromFEN`). Zero DOM. Pure.
* `js/cpu.js` — the greedy policy (levels 1–3).
* `engines/sahkku-ref.js` — a Level-A/B Node engine speaking S-UCI on
  stdin/stdout, built on the two files above. Run: `node engines/sahkku-ref.js`.
* `tests/suci.test.js` — drives the reference engine through a **complete
  game** as a GUI would (handshake, diceroll, go, referee-checked bestmoves)
  and fails on any protocol violation. Run: `node tests/suci.test.js`.

```
$ node engines/sahkku-ref.js
uci
id name SahkkuRef 1.0
id author SnartSahkku (reference)
option name Level type spin default 2 min 1 max 3
uciok
```

## 10. Minimal engine skeleton (Python, Level A)

```python
import sys, subprocess, json

def read_state():                       # parse FEN per §3
    ...

def moves_for(state, side):             # your own move generator
    ...

for line in sys.stdin:
    cmd = line.split()
    if not cmd: continue
    if cmd[0] == "uci":
        print("id name MySahkku 0.1"); print("id author me")
        print("uciok"); sys.stdout.flush()
    elif cmd[0] == "isready":
        print("readyok"); sys.stdout.flush()
    elif cmd[0] == "ucinewgame":
        pass
    elif cmd[0] == "position":
        fen = " ".join(cmd[2:cmd.index("moves")] if "moves" in cmd else cmd[2:])
        state = parse_fen(fen)          # + replay tokens after "moves"
    elif cmd[0] == "diceroll":
        state.dice = cmd[1:4]           # faces for the side to move
    elif cmd[0] == "go":
        pool = moves_for(state, state.side)          # active die only
        if not pool:
            if state.active_die == "X" and state.can_reroll_x():
                mv = "reroll"
            else:
                mv = "pass"
        else:
            mv = pick_best(pool)        # your search/heuristic; "E4-G6" style
        print("bestmove", mv); sys.stdout.flush()
    elif cmd[0] == "quit":
        break
```

The rules themselves are the hard part, not the protocol: read
[the rules document](https://sahkku.no/docs), mirror `SS.legalMoves`, and run
`node tests/suci.test.js` against your engine (`SAHKKU_ENGINE=<cmd> node
tests/suci.test.js` if you set one up) before shipping.

## 11. Versioning

S-UCI 1.0 is frozen: engines and GUIs interoperate forever. Future features
(new FEN fields, commands) are added **only** behind handshake capability
lines (`option name ...`) and are ignored by peers that don't declare them.
Protocol changes that break 1.0 require S-UCI 2.0 and a new document.
