#!/usr/bin/env python3
"""Generate the SnartSahkku piece sprites (wood solids) as standalone SVG files.

One grammar for all pieces: a tapered post seen slightly from above, with a front
face, two chisel facets, a top face and a base bevel. Men have a flat top, women a
V notch (the laddjogahpir horns), the king is a stepped post. Royals get a gold band.

Two sets share the grammar and the viewBox; only the heights differ, so a set can
be swapped by CSS alone (see [data-pieces] in css/style.css):
  classic  soldiers 74/110  — tall pins
  short    soldiers 46/110  — squat pins, wider base (easier to tell apart on a phone)

Run: /usr/bin/python3 tools/make_piece_svgs.py   (writes img/piece-*.svg)
"""
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "img"
OUT.mkdir(exist_ok=True)

W, H = 60, 110          # viewBox
BASE = 104              # where the piece stands

WOODS = {
    # name: (light, mid, dark, stroke)
    "birch":   ("#f4e2c2", "#e2c79f", "#b98f5c", "rgba(60,38,16,.62)"),
    "walnut":  ("#8a5c3c", "#63412a", "#3c2415", "rgba(24,12,4,.72)"),
    "ebony":   ("#4a4038", "#2b241f", "#15110e", "rgba(0,0,0,.8)"),
}
GOLD = ("#ffe19a", "#d8a53a")

# height per kind, half-width of the front edges, filename suffix
SETS = {
    "classic": {"man": 74, "woman": 74, "king": 88, "half_top": 10, "half_base": 17, "suffix": ""},
    "short":   {"man": 46, "woman": 46, "king": 66, "half_top": 12, "half_base": 19, "suffix": "-short"},
}


def grad(gid, stops):
    return (f'<linearGradient id="{gid}" x1="0" y1="0" x2="0" y2="1">'
            + "".join(f'<stop offset="{o}" stop-color="{c}"/>' for o, c in stops)
            + "</linearGradient>")


def piece(kind, wood, royal=False, h=74, half_top=10, half_base=17):
    light, mid, dark, stroke = WOODS[wood]
    top_y = BASE - h
    x0, x1 = 30 - half_top, 30 + half_top
    b0, b1 = 30 - half_base, 30 + half_base
    flare = top_y + max(4, round(h * 0.06))     # where the sides start to flare out

    if kind == "king":
        # stepped post: wide base -> narrow shaft -> small squared cap (ratios of h)
        y1, y2, y3 = BASE - round(h * 0.59), BASE - round(h * 0.886), BASE - h
        sil = (f"M{b0},{BASE} L{b0},{y1} L{b0+6},{y1} L{b0+6},{y2} "
               f"L{b0+9},{y2} L{b0+9},{y3} L{b1-9},{y3} L{b1-9},{y2} "
               f"L{b1-6},{y2} L{b1-6},{y1} L{b1},{y1} L{b1},{BASE} Z")
        steps = [(y1, b0, b1), (y2, b0 + 6, b1 - 6), (y3, b0 + 9, b1 - 9)]
        tops = "".join(
            f'<path d="M{l},{y} L{l+2},{y-5} L{r-2},{y-5} L{r},{y} Z" fill="#fff" opacity=".20"/>'
            for y, l, r in steps)
        notch = ""
    elif kind == "woman":
        nY, nMid = top_y - round(h * 0.49), top_y - round(h * 0.16)
        sil = (f"M{b0},{BASE} L{x0},{flare} L{x0},{top_y} L{x0+7},{nY} L30,{nMid} "
               f"L{x1-7},{nY} L{x1},{top_y} L{x1},{flare} L{b1},{BASE} Z")
        notch = (f'<path d="M{x0+7},{nY} L30,{nMid} L30,{top_y} L{x0},{top_y} Z" fill="#000" opacity=".24"/>'
                 f'<path d="M{x1-7},{nY} L30,{nMid} L30,{top_y} L{x1},{top_y} Z" fill="#fff" opacity=".11"/>')
        tops = f'<path d="M{x0},{top_y} L{x0-2},{top_y-6} L{x1+2},{top_y-6} L{x1},{top_y} Z" fill="#fff" opacity=".24"/>'
    else:
        sil = f"M{b0},{BASE} L{x0},{flare} L{x0},{top_y} L{x1},{top_y} L{x1},{flare} L{b1},{BASE} Z"
        notch = ""
        tops = f'<path d="M{x0},{top_y} L{x0-2},{top_y-6} L{x1+2},{top_y-6} L{x1},{top_y} Z" fill="#fff" opacity=".26"/>'

    left = f'M{x0},{top_y} L{b0},{BASE} L{b0-2},{BASE-7} L{x0-2},{top_y-6} Z'
    right = f'M{x1},{top_y} L{b1},{BASE} L{b1+2},{BASE-7} L{x1+2},{top_y-6} Z'
    base = (f"M{b0-2},{BASE-7} L{b0},{BASE} L{b1},{BASE} L{b1+2},{BASE-7} "
            f"L{b1+2},{BASE-4} L{b1},{BASE+1} L{b0},{BASE+1} L{b0-2},{BASE-4} Z")
    band = ""
    if royal:
        by = top_y + round(h * 0.36)
        band = (f'<path d="M{x0+1},{by} L{x1-1},{by} L{x1-1},{by+7} L{x0+1},{by+7} Z" fill="{GOLD[0]}" opacity=".95"/>'
                f'<path d="M{x0+1},{by+5} L{x1-1},{by+5} L{x1-1},{by+7} L{x0+1},{by+7} Z" fill="{GOLD[1]}"/>')

    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">
<defs>
  {grad("wood", [("0", light), (".45", mid), ("1", dark)])}
  <clipPath id="sil"><path d="{sil}"/></clipPath>
</defs>
<path d="{sil}" fill="url(#wood)" stroke="{stroke}" stroke-width="1.1"/>
<g clip-path="url(#sil)">
  <path d="{left}" fill="#fff" opacity=".13"/>
  <path d="{right}" fill="#000" opacity=".26"/>
  {tops}
  {notch}
  <g stroke="#000" stroke-width=".55" opacity=".10" fill="none">
    <path d="M{x0+3},{top_y+8} C{x0+7},{top_y+30} {b0+6},{BASE-34} {b0+3},{BASE-4}"/>
    <path d="M30,{top_y+6} C29,{top_y+34} 31,{BASE-40} 30,{BASE-2}"/>
    <path d="M{x1-3},{top_y+8} C{x1-7},{top_y+30} {b1-6},{BASE-34} {b1-3},{BASE-4}"/>
  </g>
</g>
<path d="{sil}" fill="none" stroke="{stroke}" stroke-width="1.1"/>
{band}
<path d="{base}" fill="#000" opacity=".3" stroke="{stroke}" stroke-width="1"/>
</svg>
'''


# file stem -> (kind, wood, royal)
PIECES = {
    "piece-birch": ("man", "birch", False),
    "piece-birch-queen": ("woman", "birch", True),
    "piece-walnut": ("woman", "walnut", False),
    "piece-walnut-queen": ("woman", "walnut", True),
    "piece-king": ("king", "ebony", True),
}

if __name__ == "__main__":
    for setname, cfg in SETS.items():
        for stem, (kind, wood, royal) in PIECES.items():
            p = OUT / f"{stem}{cfg['suffix']}.svg"
            p.write_text(piece(kind, wood, royal,
                               h=cfg[kind],
                               half_top=cfg["half_top"],
                               half_base=cfg["half_base"]), encoding="utf-8")
            print(f"{setname:8s} {p.name}  {p.stat().st_size} B")
