# SPG — Sáhkku Portable Game
### A PGN-inspired notation for sáhkku (Lágesvuotna rules), format version **SPG-V1**

> **Why this format exists.** No established sáhkku notation exists — neither
> the rule documents (sahkku.no), Wikipedia, nor Ludii define one. SPG fills
> that gap: a plain-text game record that stores **the dice (including every
> X re-roll), every move, and every landing effect**, PGN-style, so games can
> be archived, shared, and re-read by any tool.
>
> Implementation: `js/spg.js` in this repository (`SPG.toSPG(state, meta)`).
> The app exports a game with the *Notasjon* button as `sahkku-YYYY-MM-DD.spg`.
> For machine replay between programs, see the engine protocol in
> `docs/SAHKKU-UCI.md` — SPG is the human-facing record, S-UCI moves the wire
> format.

---

## 1. File shape

An SPG file is UTF-8, LF line endings, extension `.spg`. It has three parts:

```
[Event "Kapplanginga 3. rundar"]      # PGN-style header tags
[Date "2026-10-25"]
[Menn "Olbmát"]
[Koner "Gálgut"]
[Result "0-1"]
[Termination "dronning"]
SPG-V1                                 # format marker, always present

1. open: M(X III _) K(_ II X) -> M     # opening ritual (see §4)
1. M: II III _                         # roll 1, Menn, faces
2. K: X III _                          # roll 2, Giera, faces
   X->A2                               #   moves for that roll, indented
```

### Header tags

PGN syntax: `[Tag "value"]`, one per line, before the `SPG-V1` marker.

| tag | meaning |
|---|---|
| `Event` | name of the event/match, e.g. `"Parti mot CPU"`, `"Parti på nett"` |
| `Date` | `YYYY-MM-DD` |
| `Menn` | Menn player name, form `"Etternamn, Fornamn"`; default `"Olbmát"` (sámi for *menn*) |
| `Koner` | Koner player name, form `"Etternamn, Fornamn"`; default `"Gálgut"` (sámi for *koner*) |


There are no "white/black" sides in sáhkku — the sides are **Menn** (men) and
**Koner** (women). The tags are therefore `[Menn "..."]` and `[Koner "..."]`,
not `[White]`/`[Black]`.

A computer opponent is marked with `(c)` followed by the engine, so a game
against the neural engine on the Koner side reads:

```
[Menn "Olbmát"]
[Koner "Gálgut (c) sahkku-nn"]
```

The classic engine writes `(c) klassisk nivå 2` (level 1–3). Unknown human
names fall back to the sámi side names `Olbmát` / `Gálgut`.
| `Result` | `1-0` Menn won · `0-1` Giera won · `*` game not finished |
| `Termination` | how the game ended: `dronning` (queen captured) · `utryddelse` (annihilation — opponent has no soldiers left) · `overgivelse` (resignation). Omitted for unfinished games |

Additional tags are allowed; readers must ignore unknown tags (PGN rule).

The line `SPG-V1` on its own marks the format version. Readers that do not
recognize the marker must refuse the file. The game body follows after one
blank line.

## 2. The body: rolls and moves

* The body is a sequence of **rolls**, numbered continuously from 1
  (`1.`, `2.`, …). X re-rolls (§4.2) are numbered as their own roll lines and
  marked `(omkast #n)`. The opening ritual (§4.1) uses roll number 1 and is
  not counted.
* Each roll line: `N. S: d1 d2 d3` — `S` is the side to move
  (`M` = Menn/bieljet, `K` = Giera/konar), the three faces are `X`, `II`,
  `III` or `_` (blank).
* Move lines follow under their roll, indented three spaces.
* **A roll line with no move lines below it means the side passed** (all dice
  skipped: nothing legal, no X-reroll available).
* The dice order on the line is the slot order used by the rules: slots are
  consumed highest-rank first (`X > III > II`), blanks (`_`) are never
  playable.

## 3. Move lines

All three spaces indented under the roll they belong to.

### 3.1 Release — `X->H2`

An X die may release a home-rank soldier into its number-cycle. Written as
`X->square`. The target square **identifies the released soldier uniquely**:
each soldier's personal 60-square number cycle enters the board at its own
square, so `X->A2` tells the reader exactly which soldier left the home rank.
The moving soldier gets no letter prefix.

### 3.2 Normal moves — `II: K3->K5x [K5]`

`<die>: <piece><from>-><to><suffix>` — the piece moves from `from` to `to`
using that die's value (a die-letter prefix `II:` / `III:` is written only
for II/III moves; X moves use plain from->to, e.g. `X A2->D2` as `A2->D2`).

**Piece letters** (prefix on the *from* square):

| letter | piece |
|---|---|
| `M` | Menn (bieljet) soldier |
| `K` | Giera (konar) soldier |
| `Q` | queen — each side's queen uses the same letter |
| `k` | the neutral king |

**Landing-effect suffixes** (attached directly to the destination square):

| suffix | meaning |
|---|---|
| `x [S1,S2]` | the landing captured enemy pieces; the list names each: a captured soldier is its square + owner letter (`K5` = a Giera soldier at K5 — that is the **prison**: captured soldiers stand on the capturer's square list), the captured queen is `Q` |
| `§` | the landing **captured the king on the tower** (the king stands on the middle rank; landing on him takes him — the king changes owner, `st.kings++`; this does **not** end the game) |

Examples:

```
   II: K3->K5x [K5M]         # Giera soldier, 2-step K3→K5: takes the Menn soldier at K5
   III: Q1->Q3               # queen, 3-step
   MK2->H2§                  # Menn soldier lands on the tower square H2: takes the king
   kH2->K2                   # the (now Menn-owned) king steps out of the tower line
   QA3->C3                   # queen on an X slot (no die prefix: X moves need none)
```

A capture list `[G2K,Q]` means: one Giera soldier on G2 **and** the queen.
If the queen is captured the game ends immediately (`[Termination "dronning"]`).

### 3.3 Squares

Columns `A`–`O` (15), rows `1`–`3`. Names are **always written from Menn's
view**: row 3 is Menn's home rank, row 2 is the middle rank (the tower,
where the king stands), row 1 is Giera's home rank. Same board, same names,
for both sides — like chess files/ranks.

## 4. Opening ritual and X re-rolls

### 4.1 Opening ritual (who starts)

Both sides roll; the side with more X faces starts. Ties are re-rolled.
Recorded with roll number 1, one line per pair of rolls:

```
1. open#1: M(X III _) K(_ II X)          # tie (1 X each) -> re-roll
1. open#2: M(X _ X) K(III II _) -> M     # M has 2 X, K has 0 -> Menn starts
```

A ritual decided on the first pair is written without `#n`:
`1. open: M(X III _) K(_ II X) -> M` (the `-> side` appears only on the last
pair). The ritual lines do not consume the body's roll numbering: the first
real roll is `1.` as well.

### 4.2 X re-roll (omkast)

When the active die is X and **nothing is legal** for the whole roll, the
side may re-roll all its X dice at once (sahkku.no rule; the II/III/blank
dice are fixed). In SPG the re-roll is written as a **new numbered roll
line** marked `(omkast #n)`, with a `X!` body line under it:

```
9. M: X _ X                              # active die X, move pool empty
10. M (omkast #1): II _ X                # all X dice re-rolled, new faces
    X!                                   #   records the re-roll itself
    X->B1                                #   moves for the new faces
```

`n` counts re-rolls within the same turn (`#1`, `#2`, …). Re-rolling is
voluntary (the side may also pass). `X!` appears **only** on omkast lines —
the plain X release (§3.1) is written `X->square`.

## 5. Game end

The last body line of a finished game repeats the result with the reason in
braces:

```
1-0 {dronning}
```

`*` is not written at the end of unfinished games (the header already says
`*`).

## 6. Replayability (why this is a complete record)

A conformant reader can rebuild every position from the start position using
only the file:

1. **Dice** are explicit on each roll line (faces + slot order).
2. **Releases** are identified by target square (unique per soldier, §3.1).
3. **Normal moves** identify the piece by letter + square; queens and the
   king are unique per side, soldiers sit on unique squares at move time.
4. **Landing effects** (`x [..]`, `§`) replay deterministically under the
   referee rules (`js/engine.js`): captures, prison lists, king ownership.
5. Passes (empty move lists), re-rolls, the opening ritual and the result
   are all recorded explicitly.

So `startpos + SPG body = final position`, given the rule set. (Machine
replay across programs uses the S-UCI `position ... moves` tokens —
`docs/SAHKKU-UCI.md` §5 — which carry the same information in a compact
form.)

## 7. Full example

Complete, real export from the app (CPU game; the last move captures Giera's
queen). All constructs appear: opening ritual, release, II/III moves, king
capture on the tower (`§`), king rides, queen rides, prison list (`x [Q]`):

```
[Event "Parti mot CPU"]
[Date "2026-10-25"]
[Menn "Olbmát"]
[Koner "Gálgut"]
[Result "1-0"]
[Termination "dronning"]
SPG-V1

1. open: M(X X X) K(III III III) -> M
1. M: II II III
2. K: _ X _
   X->C2
3. M: III II II
4. K: X _ III
   X->A2
   III: QC2->F2
5. M: II II II
6. K: III III III
   III: QF2->I2
   III: KA2->D2
   III: KD2->G2
7. M: II _ X
   X->M2
   II: QM2->K2
8. K: X II _
   KG2->H2§
   II: KH2->J2
9. M: II II _
   II: QK2->M2
   II: QM2->K2
10. K: II II II
   II: QI2->G2
   II: kH2->F2
   II: kF2->H2
11. M: _ _ II
   II: QK2->I2
12. K: X III II
   KJ2->K2
   III: KK2->N2
   II: kH2->J2
13. M: III III II
   III: QI2->F2
   III: QF2->I2
   II: QI2->G2x [Q]
1-0 {dronning}
```

Reading highlights:

* `1. open: M(X X X) K(III III III) -> M` — Menn rolls three X, Giera none:
  Menn starts. No re-roll needed.
* Move 2, `X->C2` — Giera releases the home-rank soldier whose number cycle
  enters the board at C2.
* Move 6 (roll `III III III`, three III slots): the first `III: KA2->D2`
  rides the soldier released to A2 (move 4) three steps along the number
  cycle; the second `III: KD2->G2` rides **that same soldier** three steps
  on; the third `III: QF2->I2` rides the queen. Soldiers only ever move
  **forward** along their side's number cycle — the square names pin each
  rider exactly.
* Move 8, `KG2->H2§` — X slot: Giera's soldier lands on the middle rank H2
  and takes the **neutral king on the tower**; the king becomes Giera-owned.
  `II: KH2->J2` is a Giera soldier (K prefix) riding on from H2.
* Move 10, `II: kH2->F2`, `II: kF2->H2` — lowercase `k` = the king (owned by
  Giera) rides two-step straight lines along the middle rank: H2→F2→H2.
* Move 13: Menn's queen rides the cycle I2→F2→I2 (two III slots), then the
  II slot takes her to G2 where she lands on Giera's queen:
  `II: QI2->G2x [Q]` — capture list `[Q]`, the queen. Game over:
  `1-0 {dronning}`.
* The prison: captured soldiers are **removed from the board** and listed in
  the capturer's landing annotation (`x [G2K]` = a Giera-owned soldier taken
  at G2). They never re-enter.
* Pass: move 11's roll `II II _` — Menn uses one II (`II: QK2->I2`); the
  last II is not annotated, it ends the turn (unused dice at turn end are
  implicit). A **whole** roll with no move lines is a full pass.

A whole-roll pass looks like:

```
23. M: _ _ _
```

(blank faces only — nothing playable; the roll line stands alone).

## 8. Writing engines/tools for SPG

* **Writers**: keep the file valid under §1–§5; unknown extra tags are fine.
  Never number gaps, always one roll line per roll (incl. re-rolls).
* **Readers**: ignore unknown tags and unknown piece suffixes gracefully;
  refuse files whose marker is not `SPG-V1`.
* **Viewers**: render side names Menn/bieljet (white) vs Giera/konar (black);
  board with Menn's home rank (row 3) at the bottom.
* Version bump rules: SPG-V2+ may add tags; body syntax changes only in a
  new version marker.
```
