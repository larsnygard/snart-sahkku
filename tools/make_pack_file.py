#!/usr/bin/env python3
"""Lag ei .sahkku-pakke-fil av ei designmappe (pieces/<id> eller themes/<id>).

Bruk:  /usr/bin/python3 tools/make_pack_file.py pieces/short
       /usr/bin/python3 tools/make_pack_file.py themes/birch
Skriv:  dist/<id>.sahkku-pakke   (vanleg JSON; send fila til brukarane)

Brikkesett: manifest.json + dei fem SVG-ane vert slagne saman (svg-felta med
filteksten).  Tema: manifest.json + brettbiletet som base64-data-URL (max
320 kB).  Sjå docs/PAKKAR.md.
"""
import base64
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MAX_IMG = 320_000


def main(src_dir: str) -> None:
    src = Path(src_dir).resolve()
    man = json.loads((src / "manifest.json").read_text(encoding="utf-8"))
    pack = {
        "format": "snartsahkku-pakke",
        "kind": man["kind"],
        "id": man["id"],
        "names": man.get("names", {}),
        "license": man.get("license", "AGPL-3.0-or-later"),
        "author": man.get("author", ""),
    }
    if man["kind"] == "pieces":
        pack["svg"] = {
            Path(f).stem: (src / f).read_text(encoding="utf-8")
            for f in man["files"]
        }
    else:
        board = man.get("board")
        if board:
            raw = (src / board).read_bytes()
            if len(raw) > MAX_IMG:
                sys.exit(f"brettbilete for stort: {len(raw)} B > {MAX_IMG} B")
            mime = "image/jpeg" if board.endswith((".jpg", ".jpeg")) else "image/png"
            pack["board"] = f"data:{mime};base64,{base64.b64encode(raw).decode()}"
    out_dir = ROOT / "dist"
    out_dir.mkdir(exist_ok=True)
    out = out_dir / f"{pack['id']}.sahkku-pakke"
    out.write_text(json.dumps(pack, ensure_ascii=False), encoding="utf-8")
    print(f"{out}  {out.stat().st_size} B")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
