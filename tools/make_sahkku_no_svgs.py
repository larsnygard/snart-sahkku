#!/usr/bin/env python3
"""Generate the «norge» piece set: the costumed figures on a pole from sahkku.no.

Reference: Lars' renders of the sahkku.no originals (2026-11-01). A gray pole
runs through the middle, protruding above and below the figure. On the pole:

  menn (p0)   pink tunic with pointed sleeve wings, flared skirt, chamfered
              base — and the STJERNELUE (the four-winds star hat)
  koner (p1)  the same body, orange, with a FLAT lue (brim + low crown) and a
              V-neck seam; skirt with a hem band
  dronning    same figures, slightly larger, with gold hem + collar bands
              (større og meir utsmykka)
  konge       three-pointed crown, tapered faceted body, octagonal base band,
              steel blue (front #a8c0d4, shaded right #3a5165, navy outline)

Facets follow sahkku.no's rule: front = player colour, left = L 78 %, right =
L 30 %, thin black hairline. Standalone SVGs bake the tones in (their live app
recomputes them with hsl(from var(--player-color))).

Run: /usr/bin/python3 tools/make_sahkku_no_svgs.py
Writes pieces/norge/ — sjå docs/PAKKAR.md for kva filnamna tyder.
"""
from colorsys import hls_to_rgb
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "pieces" / "norge"

HAIR = 'stroke="#000" stroke-opacity=".6" stroke-width=".4" stroke-linejoin="round"'
THIN = 'fill="none" stroke="#000" stroke-opacity=".55" stroke-width=".35"'
W = 48
FH = 72                      # figure viewBox height (pole included)
CX = 24
BASE = 60                    # feet line

def tones(hue, sat, front_l):
    def hsl(l):
        r, g, b = hls_to_rgb(hue / 360, l / 100, sat / 100)
        return "#%02x%02x%02x" % (round(r * 255), round(g * 255), round(b * 255))
    return hsl(front_l), hsl(78), hsl(30)

SIDES = {
    "p0": tones(0, 100, 80),            # #ff9999 — menn
    "p1": tones(23.448, 94.8, 54.5),    # #f9731d — koner
}
GOLD = "#ffe19a"
KING_FRONT, KING_LIGHT, KING_DARK, KING_EDGE = "#a8c0d4", "#c8d8e6", "#3a5165", "#16324a"
POLE_FILL = ("url(#pole)", "#8c8c8c")


def svg(vh, body):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {vh}"'
            f' width="{W}" height="{vh}">\n' + "\n".join(body) + "\n</svg>\n")


def P(d, fill, hair=HAIR):
    return f'<path d="{d}" fill="{fill}" {hair}/>'


def defs(vh, clip_d):
    return ('<defs>'
            '<linearGradient id="pole" x1="0" y1="0" x2="1" y2="0">'
            '<stop offset="0" stop-color="#8a8a8a"/><stop offset=".5" stop-color="#bfbfbf"/>'
            '<stop offset="1" stop-color="#8a8a8a"/></linearGradient>'
            f'<clipPath id="fig"><path d="{clip_d}"/></clipPath>'
            '</defs>')


def pole(vh):
    return (f'<rect x="22.1" y="1" width="3.8" height="{vh - 2}" fill="url(#pole)" '
            'stroke="#555" stroke-width=".25"/>')


def body_path(queen=False):
    """Tunic with pointed sleeve wings + flared chamfered skirt, on a neck."""
    s = 1.06 if queen else 1.0
    sy, wy = 24, 34
    def m(v):  # scale around the centre
        return CX + (v - CX) * s
    return (f"M{m(19):.1f},{sy} L{m(17):.1f},19 L{m(31):.1f},19 L{m(29):.1f},{sy} "
            f"L{m(43):.1f},{sy + 4} L{m(35):.1f},{wy} L{m(44):.1f},56 L{m(40):.1f},{BASE} "
            f"L{m(8):.1f},{BASE} L{m(4):.1f},56 L{m(13):.1f},{wy} L{m(5):.1f},{sy + 4} Z")


def star_path(cx, cy, r_out, r_in):
    """Four-winds star: 4 long points (up, left, right, down-knees), 4 short."""
    pts = []
    import math
    for k in range(8):
        ang = math.pi / 4 * k - math.pi / 2
        r = r_out if k % 2 == 0 else r_in
        pts.append(f"{cx + r * math.cos(ang):.1f},{cy + r * math.sin(ang):.1f}")
    return "M" + " L".join(pts) + " Z"


def flat_hat_path(queen=False):
    """Flat lue: wide brim + low crown (damer)."""
    s = 1.06 if queen else 1.0
    def m(v):
        return CX + (v - CX) * s
    return (f"M{m(13):.1f},24 L{m(13):.1f},21.5 L{m(16):.1f},20 L{m(32):.1f},20 "
            f"L{m(35):.1f},21.5 L{m(35):.1f},24 Z "
            f"M{m(18):.1f},20 L{m(18):.1f},15.5 L{m(20):.1f},13.5 L{m(28):.1f},13.5 "
            f"L{m(30):.1f},15.5 L{m(30):.1f},20 Z")


def figure_svg(front, light, dark, star=True, queen=False):
    """Costumed figure on a pole. star=True → stjernelue (menn), else flat lue."""
    clip = body_path(queen)
    if star:
        hat = star_path(CX, 13.5, 12.5 if queen else 11, 3.6 if queen else 3.2)
    else:
        hat = flat_hat_path(queen)
    clip_all = clip + " " + hat
    out = [defs(FH, clip_all), pole(FH)]
    out.append(P(clip, front))
    out.append(P(hat, front))
    # facet panels, clipped to the whole figure (body + hat)
    out.append(f'<g clip-path="url(#fig)">'
               f'<rect x="0" y="0" width="17.5" height="{FH}" fill="{light}"/>'
               f'<rect x="30.5" y="0" width="{W - 30.5}" height="{FH}" fill="{dark}"/>'
               '</g>')
    # outlines on top of the facets
    out.append(f'<path d="{clip}" fill="none" stroke="#000" stroke-opacity=".6" stroke-width=".4" stroke-linejoin="round"/>')
    out.append(f'<path d="{hat}" fill="none" stroke="#000" stroke-opacity=".6" stroke-width=".4" stroke-linejoin="round"/>')
    # facet seams
    out.append(f'<path d="M17.5,19 V{BASE}" {THIN}/>')
    out.append(f'<path d="M30.5,19 V{BASE}" {THIN}/>')
    # waist seam
    wy = 34
    out.append(f'<path d="M13,{wy} L35,{wy}" {THIN}/>')
    # hem chamfers
    out.append(f'<path d="M4,56 L8,{BASE}" {THIN}/>')
    out.append(f'<path d="M44,56 L40,{BASE}" {THIN}/>')
    if not star:
        # V-neck seam (damene)
        out.append('<path d="M20,24 L24,32 L28,24" fill="none" stroke="#000" stroke-opacity=".6" stroke-width=".4"/>')
    # hem band line
    out.append(f'<path d="M6.5,54 L41.5,54" {THIN}/>')
    if queen:
        out.append(f'<g clip-path="url(#fig)">'
                   f'<rect x="0" y="54" width="{W}" height="3.4" fill="{GOLD}"/>'
                   f'<rect x="0" y="34" width="{W}" height="2.2" fill="{GOLD}"/>'
                   # keep the right-side shadow over the gold bands
                   f'<rect x="30.5" y="0" width="{W - 30.5}" height="{FH}" fill="{dark}" opacity=".38"/>'
                   f'</g>')
        out.append(f'<path d="M6.5,54 L41.5,54" {THIN}/>')
        out.append(f'<path d="M5.4,57.4 L41.4,57.4" {THIN}/>')
    return svg(FH, out)


def king_svg():
    """Konge 48×80: three-point crown, tapered body, octagonal base band, steel blue."""
    VH = 80
    crown = "M14,13 L19,22 L24,17 L29,22 L34,13 L34,26 L14,26 Z"
    body = "M17,26 L14,66 L17,70 L31,70 L34,66 L31,26 Z"
    base = "M14,66 L12,68.5 L16,72 L32,72 L36,68.5 L34,66 L31,70 L17,70 Z"
    clip = crown + " " + body + " " + base
    def K(d):
        return f'fill="none" stroke="{KING_EDGE}" stroke-width=".45" stroke-linejoin="round"'
    out = [
        f'<defs><linearGradient id="pole" x1="0" y1="0" x2="1" y2="0">'
        '<stop offset="0" stop-color="#8a8a8a"/><stop offset=".5" stop-color="#bfbfbf"/>'
        '<stop offset="1" stop-color="#8a8a8a"/></linearGradient>'
        f'<clipPath id="fig"><path d="{clip}"/></clipPath></defs>',
        f'<rect x="22.1" y="1" width="3.8" height="{VH - 2}" fill="url(#pole)" '
        'stroke="#555" stroke-width=".25"/>',
        P(body, KING_FRONT, HAIR),
        P(crown, KING_FRONT, HAIR),
        P(base, KING_FRONT, HAIR),
        f'<g clip-path="url(#fig)">'
        f'<rect x="0" y="0" width="17.5" height="{VH}" fill="{KING_LIGHT}"/>'
        f'<rect x="30.5" y="0" width="{W - 30.5}" height="{VH}" fill="{KING_DARK}"/>'
        f'</g>',
        f'<path d="{body}" {K(body)}/>',
        f'<path d="{crown}" {K(crown)}/>',
        f'<path d="{base}" {K(base)}/>',
        f'<path d="M17.5,26 V70 M30.5,26 V70 M19,22 V26 M29,22 V26" '
        f'fill="none" stroke="{KING_EDGE}" stroke-opacity=".6" stroke-width=".35"/>',
    ]
    return svg(VH, out)


STYLE = """/* Brikkesett «norge»: kostymfigurane på stonga, slik sahkku.no teiknar
   dei — menn med stjernelue, koner med flat lue, dronningene litt større med
   gullband, kongen med krone. */
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
    "nb": "sahkku.no (draktfigurene)",
    "nn": "sahkku.no (draktfigurane)",
    "se": "sahkku.no (draktolbmot)",
    "en": "sahkku.no (costume figures)"
  },
  "files": ["men-p0.svg", "men-p1.svg", "queen-p0.svg", "queen-p1.svg", "king.svg"],
  "palette": {
    "p0": "#ff9999",
    "p1": "#f9731d",
    "king": "#a8c0d4",
    "gold": "#ffe19a"
  },
  "license": "AGPL-3.0-or-later"
}
"""


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for side, (front, light, dark) in SIDES.items():
        star = side == "p0"                     # menn = stjernelue, koner = flat lue
        (OUT / f"men-{side}.svg").write_text(figure_svg(front, light, dark, star=star))
        (OUT / f"queen-{side}.svg").write_text(figure_svg(front, light, dark, star=star, queen=True))
    (OUT / "king.svg").write_text(king_svg())
    (OUT / "style.css").write_text(STYLE)
    (OUT / "manifest.json").write_text(MANIFEST)
    print("wrote", OUT)


if __name__ == "__main__":
    main()
