#!/usr/bin/env python3
"""Generate the «spelet» piece set: the exact garments from the dress-up game.

Lars' five plugbilete (2026-11-01) are the spec — one image per piece:

  menn soldat    rosa åttekanta avskorege kjegle (lampeskjerm) på stonga,
                 toppflater og facettsømar synlege, mørkeraud kontur
  menn dronning  rosa to-etars objekt på stonga: smal øvre kjegle, breiare
                 nedre, horisontal søm y 41 %, hjørna stikk ut i sømen
  koner soldat   lavendel ermelaus kjole med djup V-hals, panel­sømar og
                 fajlbands, svart kontur
  koner dronning lavendel kjole med vide kimonoermer, V-hals, midjesøm,
                 A-line skjørt, spiss midt-i-fajlen, svart kontur
  konge          blågrå krone med tre takker, avtakka korpus, åttekanta
                 fot, skugga høgreside

Alle figurane har den grå stonga sittande att båe vegar (heile høgdde).
Fargane er målte frå biletdata: rosa #f89898, lavendel #e0b8f0,
krone #a8b8c8 / høgreside #384860. Silhuettpunkta er målte i same
bilete som %, og skalert til 48×80 viewBox.

Run: /usr/bin/python3 tools/make_spelet_svgs.py
Writes pieces/spelet/ — sjå docs/PAKKAR.md for kva filnamna tyder.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "pieces" / "spelet"

W, H = 48, 80
PINK, PINK_EDGE = "#f89898", "#7a1f1f"
LAV, LAV_EDGE = "#e0b8f0", "#000000"
KING_FRONT, KING_DARK, KING_EDGE = "#a8b8c8", "#384860", "#16324a"
POLE = "#a8a8a8"


def x(v):
    return round(48 * v / 100, 1)

def y(v):
    return round(80 * v / 100, 1)


def poly(pts):
    return "M" + " L".join(f"{x(a)},{y(b)}" for a, b in pts) + " Z"


def svg(body):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}"'
            f' width="{W}" height="{H}">\n' + "\n".join(body) + "\n</svg>\n")


def pole():
    return (f'<rect x="22.7" y="0" width="2.7" height="{H}" fill="{POLE}" '
            'stroke="#6f6f6f" stroke-width=".2"/>')


def filled(d, fill, edge, w=".45", op=".75"):
    return (f'<path d="{d}" fill="{fill}" stroke="{edge}" stroke-width="{w}" '
            f'stroke-opacity="{op}" stroke-linejoin="round"/>')


def line(d, edge, w=".38", op=".7"):
    return f'<path d="{d}" fill="none" stroke="{edge}" stroke-width="{w}" stroke-opacity="{op}"/>'


def frustum():
    """menn soldat: åttekanta avskorege kjegle, lampeskjerm-silhuett."""
    sil = poly([(30, 18), (68, 18), (70, 22), (73, 78), (70, 82), (28, 82), (22, 78), (28, 22)])
    return svg([
        pole(),
        filled(sil, PINK, PINK_EDGE),
        # topplate: framkant + hjørneforkantar
        line(f"M{x(33)},{y(22)} L{x(65)},{y(22)}", PINK_EDGE),
        line(f"M{x(30)},{y(18)} L{x(33)},{y(22)}", PINK_EDGE),
        line(f"M{x(68)},{y(18)} L{x(65)},{y(22)}", PINK_EDGE),
        # facettsømar
        line(f"M{x(33)},{y(22)} L{x(28)},{y(78)}", PINK_EDGE),
        line(f"M{x(65)},{y(22)} L{x(70)},{y(78)}", PINK_EDGE),
        # botnflate
        line(f"M{x(22)},{y(78)} L{x(73)},{y(78)}", PINK_EDGE),
    ])


def two_tier():
    """menn dronning: to-etars på stonga, utstikmande hjørne i sømen."""
    sil = poly([(31, 18), (68, 18), (82, 41), (75, 41), (82, 79),
                (15, 79), (30, 41), (17, 41)])
    return svg([
        pole(),
        filled(sil, PINK, PINK_EDGE),
        # sømlinje mellom etaga
        line(f"M{x(17)},{y(41)} L{x(82)},{y(41)}", PINK_EDGE),
        # facettsømar: øvre loddrett, nedre vidar seg mot 75 %
        line(f"M{x(30)},{y(18)} L{x(30)},{y(41)}", PINK_EDGE),
        line(f"M{x(68)},{y(18)} L{x(68)},{y(41)}", PINK_EDGE),
        line(f"M{x(30)},{y(41)} L{x(24)},{y(79)}", PINK_EDGE),
        line(f"M{x(68)},{y(41)} L{x(75)},{y(79)}", PINK_EDGE),
    ])


def tunic():
    """koner soldat: ermelaus lavendelkjole, djup V-hals, fajlbands."""
    sil = poly([(28, 22), (50, 42), (72, 22), (88, 80), (86, 85), (14, 85), (12, 80)])
    return svg([
        pole(),
        filled(sil, LAV, LAV_EDGE),
        # V-hals-facing: indre V-linje
        line(f"M{x(31)},{y(24)} L{x(50)},{y(40)} L{x(69)},{y(24)}", LAV_EDGE),
        # panel­sømar
        line(f"M{x(35)},{y(24)} L{x(30)},{y(80)}", LAV_EDGE),
        line(f"M{x(65)},{y(24)} L{x(70)},{y(80)}", LAV_EDGE),
        # fajlbands
        line(f"M{x(12)},{y(80)} L{x(88)},{y(80)}", LAV_EDGE),
    ])


def dress():
    """koner dronning: vide kimonoermer, midjesøm, spiss midtfajl."""
    sil = poly([(37, 22), (33, 21), (18, 23), (22, 42), (33, 42), (22, 88),
                (48, 92), (73, 88), (62, 42), (78, 42), (82, 23), (62, 21),
                (58, 22), (48, 38)])
    return svg([
        pole(),
        filled(sil, LAV, LAV_EDGE),
        # V-hals-facing
        line(f"M{x(39)},{y(24)} L{x(48)},{y(36)} L{x(56)},{y(24)}", LAV_EDGE),
        # erme-/armsopnsøm
        line(f"M{x(33)},{y(22)} L{x(33)},{y(42)}", LAV_EDGE),
        line(f"M{x(62)},{y(22)} L{x(62)},{y(42)}", LAV_EDGE),
        # midjesøm
        line(f"M{x(33)},{y(42)} L{x(62)},{y(42)}", LAV_EDGE),
        # skjørtpanel
        line(f"M{x(29)},{y(44)} L{x(24)},{y(87)}", LAV_EDGE),
        line(f"M{x(67)},{y(44)} L{x(71)},{y(87)}", LAV_EDGE),
        # fajlbands fylgjer den spisse fajlen
        line(f"M{x(23)},{y(86)} L{x(48)},{y(90)} L{x(72)},{y(86)}", LAV_EDGE),
    ])


def king():
    """konge: tre takker, avtakka korpus, åttekanta fot, skugga høgre."""
    crown = poly([(29, 16), (39, 28), (50, 21), (60, 28), (71, 16), (71, 33), (29, 33)])
    body = poly([(35, 33), (29, 80), (35, 85), (65, 85), (71, 80), (65, 33)])
    base = poly([(29, 80), (25, 83), (33, 88), (67, 88), (75, 83), (71, 80),
                 (65, 85), (35, 85)])
    out = [pole(),
           filled(body, KING_FRONT, KING_EDGE),
           filled(crown, KING_FRONT, KING_EDGE),
           filled(base, KING_FRONT, KING_EDGE)]
    # skugga høgresider: klippt til formene
    out.append('<defs><clipPath id="kb"><path d="' + body + '"/></clipPath>'
               '<clipPath id="kc"><path d="' + crown + '"/></clipPath></defs>')
    out.append(f'<g clip-path="url(#kb)"><rect x="{x(67)}" y="0" width="{W - x(67)}" height="{H}" fill="{KING_DARK}"/></g>')
    out.append(f'<g clip-path="url(#kc)"><rect x="{x(66)}" y="0" width="{W - x(66)}" height="{H}" fill="{KING_DARK}"/></g>')
    out.append(filled(body, "none", KING_EDGE))
    out.append(filled(crown, "none", KING_EDGE))
    out.append(filled(base, "none", KING_EDGE))
    # takker / facettsømar
    out.append(line(f"M{x(39)},{y(28)} L{x(39)},{y(33)} M{x(60)},{y(28)} L{x(60)},{y(33)} M{x(35)},{y(33)} L{x(29)},{y(80)} M{x(65)},{y(33)} L{x(71)},{y(80)}",
                    KING_EDGE, op=".6"))
    return svg(out)


STYLE = """/* Brikkesett «spelet»: plagga på stonga, hakket ut av opphavsspelet
   til sahkku.no — rosa avskorege kjeglar (menn), lavendelkjolar
   (koner), blågrå krone (konge). */
html[data-pieces="spelet"] .piece.red        { background-image: url('men-p0.svg'); }
html[data-pieces="spelet"] .piece.blue       { background-image: url('men-p1.svg'); }
html[data-pieces="spelet"] .piece.red.queen  { background-image: url('queen-p0.svg'); }
html[data-pieces="spelet"] .piece.blue.queen { background-image: url('queen-p1.svg'); }
html[data-pieces="spelet"] .piece.king       { background-image: url('king.svg'); }
"""

MANIFEST = """{
  "format": "snartsahkku-pakke",
  "kind": "pieces",
  "id": "spelet",
  "builtin": true,
  "names": {
    "nb": "Spillet (plagg på stonga)",
    "nn": "Spelet (plagg på stonga)",
    "se": "Speal (biktasiid stongojin)",
    "en": "The game (garments on poles)"
  },
  "files": ["men-p0.svg", "men-p1.svg", "queen-p0.svg", "queen-p1.svg", "king.svg"],
  "palette": {
    "p0": "#f89898",
    "p1": "#e0b8f0",
    "king": "#a8b8c8",
    "gold": "#ffe19a"
  },
  "license": "AGPL-3.0-or-later"
}
"""


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "men-p0.svg").write_text(frustum())
    (OUT / "queen-p0.svg").write_text(two_tier())
    (OUT / "men-p1.svg").write_text(tunic())
    (OUT / "queen-p1.svg").write_text(dress())
    (OUT / "king.svg").write_text(king())
    (OUT / "style.css").write_text(STYLE)
    (OUT / "manifest.json").write_text(MANIFEST)
    print("wrote", OUT)


if __name__ == "__main__":
    main()
