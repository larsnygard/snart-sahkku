# SnartSáhkku — Lágesvuotna-sáhkku som PWA

Det gamle samiske strategispillet **sáhkku** fra Laksefjorden (Lágesvuotna),
spilbart i nettleseren som en installerbar PWA — mot CPU, i to spillere
sammesteds, eller over nett via P2P.

**Fjernmotor over HTTP:** menyen har «🌐 Fjernmotor …». Der legg du inn
adressa til ein køyrerande `sahkku_ai.server` og API-nøkkelen hans, og motoren
dukker opp i motorlista og vert valt med ein gong. Appen er framleis dommaren:
trekket som kjem over nettet vert matcha mot appen sin eigen lovlege pool, so
tenaren kan ikkje dytte inn eit ulovleg trekk. Nøkkelen vert lagra berre i
`localStorage` i denne nettlesaren, aldri i repoet eller i `engines.json`.
Sjå `sahkku-ai/README.md` §7 for korleis tenaren vert starta.

Spillereglene følger [sahkku.no](https://sahkku.no/docs) (varianten *med
dronninger*):

- 3×15-brett med Slottet i H2; soldatene går i «tallsyklus» (åttetall)
- Terningene X/III/II/blank; X brukes først, så III, så II
- Landing på linjer med uutløste brikker er forbudt — banen forbi dem er fri
- Kongen kapres ved landing og deler aldri linje med andre brikker
- Dronninga slås ut som en soldat; taper du henne, taper du partiet
- Vinn: utrydd fiendens soldater, eller slå ut fiendens dronning

## Funksjoner

- **Modern PWA** med installasjon (`manifest.webmanifest` + service worker),
  offline-først cache og touch-kontrollert brett for mobil
- **UI inspirert av samisk estetikk**: dyp nordlys-blå bakgrunn, ripplinte-
  brett, rombenete brikker, rødt/blått gákti-inspirert fargesett
- **CPU-motstander med flere motorer**: klassisk (tre nivå, greedy med
  simulerte trekk) og nevrale S-UCI-motorer fra
  [sahkku-ai](https://github.com/larsnygard/sahkku-ai). Hvilke som finnes står
  i `engines/engines.json` — legg til en rad for å tilby en ny modell. Bare
  klassisk CPU lastes med appen; en NN-motor hentes lazy når du velger den
  (menyvalget «Motor»).
- **Nettspill** via [iroh](https://github.com/n0-computer/iroh) —
  Rust→WebAssembly, relay-basert P2P med gossip-rom; invittkoder
  (`rom#nodeid`), ingen server

## Prosjektstruktur

```
index.html css/ js/            appen: engine (SS), cpu, ui, main, online, nn-adapter
engines/                       sahkku-ref.js (Node, S-UCI) + sahkku-nn.js (nevral, browser)
manifest.webmanifest sw.js     PWA-manifest og service worker
net/                           iroh-P2P-modulen (Rust, wasm-pack)
net/pkg/                       ferdigbygd wasm-modul (skal med i publisering)
net/src/ net/build.sh          kilde + byggeskript for wasm-modulen
tests/                         nodesignale testar (engine) + Playwright e2e
```

## Utvikling

Alt er statisk — ingen build-steg for appen:

```sh
python3 -m http.server 8090   # http://127.0.0.1:8090/
node tests/engine.test.js     # 374 rulespesifikke testar
node tests/e2e.js             # Playwright: heile partiet i ein ekte nettlesar
node tests/online.test.js     # to nettlesarfaner i ekte iroh-rom, trekk synkroniserte
```

Nettverksmodulen bygst frå `net/` (krev `wasm-pack` + `wasm32-unknown-unknown`):

```sh
cd net && ./build.sh          # -> net/pkg/ (ferdig wasm + js-glue)
```

## Lisens

SnartSáhkku — copyright (c) 2026 Lars Christian Nygård.
Distribuert under **GNU Affero General Public License v3.0**
(se `LICENSE`). Heile kjelda — inkl. Rust/iroh-modulen i `net/` — er
omfatta av AGPL-en. Dei avhengige rutinebøkene (iroh, wasm-bindgen, m.fl.)
er MIT/Apache-2.0-likensierte og statisk lenkja inn i wasm-filen;
kjelde til wasm-modulen liggjer ved i `net/src/`.

Publisert på <https://snart.com/sahkku/> — AGPL-pliktene (tilgjenge av
kjelde for nettbasert teneste) er oppfylte: dette repoet er kjelda.
