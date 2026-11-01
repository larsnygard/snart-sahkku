# Draktpakkar — lage, dele og installere design i SnartSáhkku

Alt utstyret appen kan kle seg med, er **pakkar**. Det finst to slag:

| Pakke | Innhald | Kvar ho verkar |
|---|---|---|
| **Brikkesett** (`pieces`) | 5 brikkebilete (SVG) | `.piece`-bileta på brettet |
| **Tema** (`theme`) | palett (CSS-variablar) + valfritt brettbilete | heile drakten: bakgrunn, panel, knappar, brett, linjer |

Innebygde design ligg som mapper i repoet — **éi mappe = éin design**:

```
pieces/classic/          pieces/short/        themes/stone/ ...
├── manifest.json        ├── manifest.json    ├── manifest.json   namn + lisens
├── style.css            ├── style.css        ├── style.css       reglane for settet
├── men-p0.svg           ├── men-p0.svg       └── board.jpg       brettbiletet
├── men-p1.svg           ├── ...              (contrast har ikkje board.jpg)
├── queen-p0.svg
├── queen-p1.svg
└── king.svg
```

`css/style.css` inneheld berre **avtalen** (variablane + standardverdiane) og
layouten, `css/theme.css` berre kontrakts-teksten og tilgjenge-reglane.
Kvar mappe vert lenkja i `index.html`, så innbygde design lastast som vanlege
filer — ingen JS-teikning, ingen tenar.

---

## 1. Nytt brikkesett (mappe-metoden, for utviklarar)

1. Lag `pieces/<id>/` der `<id>` er `[a-z0-9][a-z0-9-]{0,31}`.
2. Fem SVG-filer **med nøyaktig desse namna**:
   `men-p0.svg` (røde/solgte soldatar), `men-p1.svg` (blå/fjell-soldatar),
   `queen-p0.svg`, `queen-p1.svg` (dronningane — V-snittet er tradisjonen,
   `laddjogahpir`), `king.svg` (kongen, felles for begge sider).
   Sjå `tools/make_piece_svgs.py` for grammatikken: same viewBox (60×110),
   brikka står på botnen, høgd 46–74 av 110, smal topp og breiare botn.
   **Høgd og botnbreidd må endrast saman** — berre høgd gjev «pinnar».
3. `style.css` — fem reglar, mønsteret frå `pieces/short/style.css`:
   ```css
   html[data-pieces="min-sett"] .piece.red        { background-image: url('men-p0.svg'); }
   html[data-pieces="min-sett"] .piece.blue       { background-image: url('men-p1.svg'); }
   html[data-pieces="min-sett"] .piece.red.queen  { background-image: url('queen-p0.svg'); }
   html[data-pieces="min-sett"] .piece.blue.queen { background-image: url('queen-p1.svg'); }
   html[data-pieces="min-sett"] .piece.king       { background-image: url('king.svg'); }
   ```
   (`classic` har uspeidde reglar; han er standarden. Alle andre må spe
   `[data-pieces]`.)
4. `manifest.json` — namn på dei fire språka + lisens:
   ```json
   {
     "format": "snartsahkku-pakke",
     "kind": "pieces",
     "id": "min-sett",
     "names": { "nb": "Mitt sett", "nn": "Mitt sett", "se": "Mu sáhkku", "en": "My set" },
     "files": ["men-p0.svg", "men-p1.svg", "queen-p0.svg", "queen-p1.svg", "king.svg"],
     "license": "AGPL-3.0-or-later"
   }
   ```
5. Fast i appen:
   * `index.html`: `<link rel="stylesheet" href="pieces/min-sett/style.css?v=…">`
   * `js/packs.js`: legg `min-sett` i `BUILTIN_PIECES`
   * `sw.js`: precache stilarket, manifestet og dei fem SVG-ane, bump `CACHE`
   * `sendsahkku.sh`: treng inga endring — heile prosjektet rsyncast.

Dei fem klassane `.piece.red/.blue/.queen/.king` set appen sjølv; pakkien
bytar **berre bilete**. Storleik, posisjon, val- og hint-effektar, kongering
og M/K-merke høyrer layouten til og kan ikkje overstyrast av ein pakke.

## 2. Nytt tema (mappe-metoden)

Éi mappe `themes/<id>/` med `style.css`, `manifest.json` (same format,
`"kind": "theme"`) og valfritt `board.jpg` (≈1600×800 — brettbilete som
`--board-img`; utan board er brettet berre gradienten).

Avtalen i `css/style.css`: ALLT ein pakke må få overskrive, finst som
variabel. Sett berre dei variablane du vil endre — resten arvar standarden:

```
--bg-app --ink --muted --line --yellow --panel-bg --panel-2 --btn-bg
--btn-big-bg --dialog-bg --log-bg --edge-bg --lbl --board-img --board-tint
--board-base --board-border --line-core --line-edge --piece-filter
--chip-p0-bg/-fg --chip-p1-bg/-fg --toast-bg --input-bg --red --blue
```

**Regel frå eiga historie: ein hardkoda farge i ein komponent er ein
temafeil.** Alle flater går gjennom variablane; `contrast`-temaet er vaktbikkja
(`tests/theme_a11y.test.js` sjekkar at kvart tema set variablane sine).

Fast i appen: lenkje stilarket i `index.html`, legg id-en i `BUILTIN_THEMES`
i `js/packs.js`, precache i `sw.js`, og utvid `expect`-lista i
`tests/theme_a11y.test.js`.

## 3. Pakkefil for vanlege brukarar (import — ingen ombygg, ingen tenar)

Ein brukar som berre vil BRUKE eit design, får ei **pakkefil** av deg:
`.sahkku-pakke` (vanleg JSON; endinga er for folk — innhaldet avgjer).
Appen godtek òg vanleg `.json` og ei `.zip`-pakke med `manifest.json` på rota.

**Brikkesett-pakke:**

```json
{
  "format": "snartsahkku-pakke",
  "kind": "pieces",
  "id": "boazu",
  "names": { "nb": "Boazu", "en": "Reindeer" },
  "svg": {
    "men-p0":   "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 60 110\">…</svg>",
    "men-p1":   "<svg …>…</svg>",
    "queen-p0": "<svg …>…</svg>",
    "queen-p1": "<svg …>…</svg>",
    "king":     "<svg …>…</svg>"
  },
  "pieceFilter": "drop-shadow(0 2px 3px rgba(0,0,0,.5))",
  "license": "CC-BY-4.0",
  "author": "Guri"
}
```

**Tema-pakke:**

```json
{
  "format": "snartsahkku-pakke",
  "kind": "theme",
  "id": "midnatt-sol",
  "names": { "nb": "Midnattssol", "en": "Midnight sun" },
  "vars": { "bg-app": "linear-gradient(180deg,#2b1a0e,#120a05)", "ink": "#ffe9c9" },
  "board": "data:image/jpeg;base64,/9j/4AAQ…",
  "license": "CC0-1.0"
}
```

* SVG-ane er sjølve filteksten (ikkje data-URL) — max 48 kB per brikke.
* `board` MÅ vere data-URL (`data:image/jpeg;base64,`… eller png; max 320 kB)
  — ein importert pakke skal ikkje kunne laste noko frå nettet. Lag han med
  `base64 -w0 board.jpg`.
* `pieceFilter` er valfri og gjeld berre for brikkesettet.

**Installere:** Innstillingar → «Importer pakke». Eller del fila:
Android-delingsmenyen og «opne med» på skrivebord (filtype JSON) går
gjennom same importruta. Pakken vert valdert, lagra i nettlesaren
(localStorage) og vald med ein gong. List over importerte pakker ligg under
Innstillingar → Pakkar, med Bruk/Fjern. Alt verkar heilt offline.

**Tryggleik** (js/packs.js, hardt handheva under valideringa):
SVG-en vert avvist om han inneheld `script`/`foreignObject`/`iframe`,
`on*`-attributtar, `xlink:href`/`href` til nett eller data-URL, `url()`
eller `@import`. Tema-variablane slepp gjennom berre «CSS-trygg» tekst
(ingen `{}`, `<>`, `;`, `@`). Pakkefil maks ≈700 kB. Ein pakke kan ALDRI
endre spelelogikken — han bytar bilete og fargar, punktum.

**Id-samanslett:** innebygde id-ar er låste; ein importert pakke med same
id får `-2`, `-3`, … Vel gjerne eit eige namn (`my-`-prefiks) så du landar
i din eigen lomme.

## 4. Lag ei ferdig pakkefil av ei mappe

```
tools/make_pack_file.py pieces/short   # -> dist/short.sahkku-pakke
tools/make_pack_file.py themes/birch   # -> dist/birch.sahkku-pakke (board som data-URL)
```

## 5. Testar

`node tests/packs.test.js` — pakkevalidering (øygdeleg SVG, for store
filer, id-samanslett) og import heilt veg gjennom innstillingane i ein
ekte nettlesar. `node tests/theme_a11y.test.js` — at alle tema/pakkefila
faktisk teiknar.
