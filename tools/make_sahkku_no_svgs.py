#!/usr/bin/env python3
"""Generate the «norge» piece set: the faceted colour posts from sahkku.no.

Geometry lifted from sahkku.no's inline SVG (inspected 2026-11-01): a faceted
post seen slightly from above — front face (player colour), left facet (light),
right facet (dark), top face, bottom bevel. Soldiers 48x61.5, the stepped
king 48x80. Women carry the V notch (laddjogahpir) as horn-tip and V faces
over a notched front face.

sahkku.no shades the facets live with CSS `hsl(from var(--player-color) h s
30%/78%)`. Standalone SVG files cannot recompute that, so the three tones per
side are baked in (p0 = red side #ff9999, p1 = orange side #f9731d), plus the
same ~0.3 black hairline sahkku.no draws.

Run: /usr/bin/python3 tools/make_sahkku_no_svgs.py
Writes pieces/norge/ — sjå docs/PAKKAR.md for kva filnamna tyder.
"""
from colorsys import hls_to_rgb
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "pieces" / "norge"

HAIR = 'stroke="rgba(0,0,0,.5)" stroke-width=".3" stroke-linejoin="round"'


def tones(hue, sat, front_l):
    """(front, left, right) matching sahkku.no: left = L 78 %, right = L 30 %."""
    def hsl(l):
        r, g, b = hls_to_rgb(hue / 360, l / 100, sat / 100)
        return "#%02x%02x%02x" % (round(r * 255), round(g * 255), round(b * 255))
    return hsl(front_l), hsl(78), hsl(30)


SIDES = {
    "p0": tones(0, 100, 80),        # #ff9999 (sahkku.no: rgb(255,153,153))
    "p1": tones(23.448, 94.8, 54.5),  # #f9731d
}
KING = tones(30, 18, 15)         # ebony post, same facet grammar


def p(d, fill):
    return f'<path d="{d}" fill="{fill}" {HAIR}/>'


def svg(vw, vh, body):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {vw} {vh}"'
            f' width="{vw}" height="{vh}">\n' + "\n".join(body) + "\n</svg>\n")


def man(front, light, dark):
    """Plain soldier, 48x61.5: top face, front, dark right, light left, bevel."""
    return svg(48, 61.5, [
        p("M37,2 l-4,2 -20,0 -4,-2 4,-2 20,0 z", front),
        p("M13,4 l-3,54 26,0 -3,-54 z", front),
        p("M37,2 l9,51 -10,5 -3,-54 z", dark),
        p("M9,2 l-9,51 10,5 3,-54 z", light),
        p("M0,53 l0,3 10,5 26,0 10,-5 0,-3 -10,5 -26,0 z", front),
    ])


def queen(front, light, dark):
    """Horned woman, 48x61.5: the V notch (laddjogahpir) cut into the front."""
    return svg(48, 61.5, [
        p("M37,2 l-4,2 0,-4 z", front),                    # horn tip r
        p("M9,2 l4,2 0,-4 z", front),                      # horn tip l
        p("M13,4 l0,-4 10,16 0,10 z", front),              # V inner l
        p("M33,4 l0,-4 -10,16 0,10 z", front),             # V inner r
        p("M13,4 l-3,54 26,0 -3,-54 -10,22 z", front),     # notched front
        p("M37,2 l9,51 -10,5 -3,-54 z", dark),
        p("M9,2 l-9,51 10,5 3,-54 z", light),
        p("M0,53 l0,3 10,5 26,0 10,-5 0,-3 -10,5 -26,0 z", front),
    ])


def king(front, light, dark):
    """Stepped post, 48x80: upper tier, lower tier, top face, bevel."""
    return svg(48, 80, [
        p("M37,2 l-4,2 -20,0 -4,-2 4,-2 20,0 z", front),   # top face
        p("M13,4 l-3,26 26,0 -3,-26 z", front),            # upper front
        p("M37,2 l9,23 -10,5 -3,-26 z", dark),             # upper right
        p("M9,2 l-9,23 10,5 3,-26 z", light),              # upper left
        p("M13,30 l-3,46 26,0 -3,-46 z", front),           # lower front
        p("M37,28 l9,43 -10,5 -3,-46 z", dark),            # lower right
        p("M9,28 l-9,43 10,5 3,-46 z", light),             # lower left
        p("M0,71 l0,3 10,5 26,0 10,-5 0,-3 -10,5 -26,0 z", front),
    ])


STYLE = """/* Brikkesett «norge»: facetterte fargepostar etter mønster frå
   sahkku.no — front i spelarfarge, lys og mørk sideflate, hakka botn. */
html[data-pieces="norge"] .piece.red        { background-image: url('men-p0.svg'); }
html[data-pieces="norge"] .piece.blue       { background-image: url('men-p1.svg'); }
html[data-pieces="norge"] .piece.red.queen  { background-image: url('queen-p0.svg'); }
html[data-pieces="norge"] .piece.blue.queen { background-image: url('queen-p1.svg'); }
html[data-pieces="norge"] .piece.king       { background-image: url('king.svg'); }
"""

MANIFEST = """{
  "format": "snartsahkku-pakke",
  "kind": "pieces",
  "id": "norge",
  "builtin": true,
  "names": {
    "nb": "sahkku.no (fargede poster)",
    "nn": "sahkku.no (fargede staura)",
    "se": "sahkku.no (ivnnit posttat)",
    "en": "sahkku.no (colour posts)"
  },
  "files": ["men-p0.svg", "men-p1.svg", "queen-p0.svg", "queen-p1.svg", "king.svg"],
  "palette": {
    "p0": "#ff9999",
    "p1": "#f9731d",
    "king": "#26201b",
    "gold": "#ffe19a"
  },
  "license": "AGPL-3.0-or-later"
}
"""


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for side, (front, light, dark) in SIDES.items():
        (OUT / f"men-{side}.svg").write_text(man(front, light, dark))
        (OUT / f"queen-{side}.svg").write_text(queen(front, light, dark))
    (OUT / "king.svg").write_text(king(*KING))
    (OUT / "style.css").write_text(STYLE)
    (OUT / "manifest.json").write_text(MANIFEST)
    print("wrote", OUT)


if __name__ == "__main__":
    main()
