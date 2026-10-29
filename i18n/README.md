# Språkfiler

Appen finst på bokmål (`nb`), nynorsk (`nn`), nordsamisk (`se`) og engelsk (`en`).

## Format

Éi JSON-fil per språk, flate nøklar med prikk-namn:

```json
{
  "menu.playCpu": "⚔︎ Spill mot CPU",
  "log.killed": "{piece} ble slått ut på {sq}!"
}
```

- `{namn}` er plasshaldarar som vert sette inn av `I18N.t(key, {navn: verdi})`.
- Nokre tekstar inneheld HTML (t.d. `<b>` og `<a>`). Dei er merkte i bruk som
  `data-i18n-html` i `index.html`; alt anna går gjennom `textContent` og vert
  handsama som rein tekst.
- `nb.json` er referansen: alle filene **må** ha nøyaktig same nøkkelsett.
  `tests/i18n.test.js` feilar om eit språk manglar ein nøkkel, har tomme
  tekstar, eller om `index.html` peikar på ein nøkkel som ikkje finst.

## Leggje til eit språk

1. Kopier `nb.json` til t.d. `fi.json` og omset verdiane (rør ikkje nøklane).
2. Legg ei rad i `LANGS` i `js/i18n.js`:
   ```js
   { id: 'fi', label: 'Suomi' },
   ```
3. Legg filene i service-worker-cachen (`sw.js`, `ASSETS`).
4. Køyr `node tests/i18n.test.js`.

Veljaren i menyen fyller seg sjølv frå `LANGS`, og valet vert lagra i
`localStorage` under `sahkku.lang`. Utan lagra val fylgjer appen språket i
nettlesaren.

## Om den nordsamiske oversetjinga

`sahkku_ai`-prosjektet og appen er nynorsk/bokmål i botnen. Den samiske
oversetjinga er eit rimeleg fyrsteutkast, ikkje gjennomgått av morsmålsbrukar:
omgrep som ikkje er stadfesta i ordbøker (t.d. terningar, trekk, kapre) bør
rettast av nokon som kan nordsamisk før dei vert rekna som endelege.
